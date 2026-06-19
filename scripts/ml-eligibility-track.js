#!/usr/bin/env node
/**
 * ML influence eligibility + activity tracker (flip/soak telemetry, READ-ONLY).
 *
 * Reports, for the daily soak track:
 *   1. Bandit L4 cells vs the MIN_OBSERVATIONS=30 eligibility threshold (how many are live,
 *      how close the rest are).
 *   2. ml_influence_audit activity: accepted / rejected / skipped, plus last-24h, plus the
 *      average confidence delta the ML actually applied (cut vs boost).
 * READ-ONLY: opens the DB readonly, never writes, never touches the running engine.
 *
 *   node scripts/ml-eligibility-track.js
 */
const path = require('path');
const Database = require('better-sqlite3');

const MIN_OBS = 30; // mirrors server/services/ml/_ring5/influenceEligibility.js MIN_OBSERVATIONS
const dbPath = path.join(__dirname, '..', 'data', 'zeus.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const DAY_MS = 86400000;
const now = 1781818577549; // updated per-run via MAX(created_at); fallback below
let nowTs = now;
try { const m = db.prepare('SELECT MAX(created_at) m FROM ml_influence_audit').get(); if (m && Number.isFinite(+m.m)) nowTs = +m.m; } catch (_) { }

console.log('\n══════ ML INFLUENCE ELIGIBILITY + ACTIVITY ══════');

// 1) eligibility per L4 cell
try {
  const l4 = db.prepare("SELECT cell_key, observation_count obs FROM ml_bandit_posteriors WHERE level = 4 ORDER BY observation_count DESC").all();
  const eligible = l4.filter(c => c.obs >= MIN_OBS);
  console.log(`\n── eligibility (threshold ${MIN_OBS} obs/cell) ──`);
  console.log(`  L4 cells: ${l4.length} | ELIGIBLE: ${eligible.length} | below: ${l4.length - eligible.length}`);
  if (eligible.length) console.log(`  ✅ eligible: ${eligible.map(c => `${c.cell_key}(${c.obs})`).join(', ')}`);
  const near = l4.filter(c => c.obs < MIN_OBS).slice(0, 6);
  if (near.length) console.log('  closest below: ' + near.map(c => `${c.cell_key}=${c.obs}(${MIN_OBS - c.obs} to go)`).join(' | '));
} catch (e) { console.log('  eligibility: ERR ' + e.message); }

// 2) influence activity
try {
  const tot = db.prepare("SELECT gate_status, COUNT(*) n FROM ml_influence_audit GROUP BY gate_status").all();
  const tmap = {}; for (const r of tot) tmap[r.gate_status] = r.n;
  console.log('\n── influence activity (all-time) ──');
  console.log(`  accepted=${tmap.accepted || 0}  rejected=${tmap.rejected || 0}  skipped=${tmap.skipped || 0}`);

  const since = nowTs - DAY_MS;
  const d = db.prepare("SELECT gate_status, COUNT(*) n FROM ml_influence_audit WHERE created_at >= ? GROUP BY gate_status").all(since);
  const dmap = {}; for (const r of d) dmap[r.gate_status] = r.n;
  console.log(`  last 24h: accepted=${dmap.accepted || 0}  rejected=${dmap.rejected || 0}  skipped=${dmap.skipped || 0}`);

  // applied confidence delta (proposed - phase2) on accepted rows
  const acc = db.prepare("SELECT phase2_confidence p2, proposed_confidence pr FROM ml_influence_audit WHERE gate_status='accepted' AND proposed_confidence IS NOT NULL ORDER BY rowid DESC LIMIT 200").all();
  if (acc.length) {
    let sum = 0, cut = 0, boost = 0;
    for (const r of acc) { const dlt = (+r.pr) - (+r.p2); sum += dlt; if (dlt < 0) cut++; else if (dlt > 0) boost++; }
    console.log(`  applied delta (last ${acc.length} accepted): avg=${(sum / acc.length).toFixed(1)} conf pts | cuts=${cut} boosts=${boost} (ML ${sum < 0 ? 'trims' : 'lifts'} brain confidence)`);
  }
} catch (e) { console.log('  activity: ERR ' + e.message); }

console.log('');
db.close();
