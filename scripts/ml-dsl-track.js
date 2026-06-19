#!/usr/bin/env node
/**
 * ML-DSL (DSL Drive) shadow track — counterfactual advantage of the ML stop policy vs the
 * baseline deterministic DSL, per closed position. Plus the Thompson bandit arm learning.
 * READ-ONLY: opens the DB readonly, never writes, never touches the running engine.
 *
 *   node scripts/ml-dsl-track.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const dbPath = path.join(__dirname, '..', 'data', 'zeus.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const f = (x) => (x >= 0 ? '+' : '') + x.toFixed(3);
console.log('\n══════ ML-DSL (DSL DRIVE) SHADOW TRACK ══════');

// 1) counterfactual outcomes
try {
  const o = db.prepare('SELECT arm, cohort, ml_pnl_pct, baseline_pnl_pct, advantage, win FROM ml_dsl_outcome').all();
  if (!o.length) { console.log('  (no outcomes yet)'); }
  else {
    const stat = (list) => {
      const n = list.length;
      const advSum = list.reduce((a, r) => a + (+r.advantage || 0), 0);
      const wins = list.filter((r) => +r.win === 1).length;
      return { n, advAvg: n ? advSum / n : 0, advSum, winRate: n ? 100 * wins / n : 0 };
    };
    const all = stat(o);
    console.log(`\n── counterfactual (ML stop policy vs baseline DSL), SHADOW ──`);
    console.log(`  outcomes=${all.n}  ML-beat-baseline=${all.winRate.toFixed(0)}%  cum.advantage=${f(all.advSum)}%  avg/trade=${f(all.advAvg)}%`);
    const byArm = o.reduce((m, r) => ((m[r.arm || '?'] ||= []).push(r), m), {});
    console.log('  by arm:');
    for (const [arm, list] of Object.entries(byArm)) {
      const s = stat(list);
      console.log(`    ${arm.padEnd(6)} n=${String(s.n).padStart(4)}  ML-beat=${s.winRate.toFixed(0)}%  cum.adv=${f(s.advSum)}%  avg=${f(s.advAvg)}%`);
    }
    console.log(`  → ${all.advSum >= 0 ? 'ML policy AHEAD of baseline' : 'ML policy BEHIND baseline'} by ${f(all.advSum)}% cumulative (shadow; not controlling the real stop)`);
  }
} catch (e) { console.log('  outcomes: ERR ' + e.message); }

// 2) bandit arm learning per cell
try {
  const p = db.prepare('SELECT cell_key, arm, alpha, beta, n FROM ml_dsl_arm_posterior ORDER BY n DESC').all();
  if (p.length) {
    console.log(`\n── bandit arms (Thompson, ${p.length} cells) — top by observations ──`);
    for (const r of p.slice(0, 10)) {
      const wr = (r.alpha + r.beta) > 0 ? 100 * r.alpha / (r.alpha + r.beta) : 0;
      console.log(`    ${String(r.cell_key).padEnd(34)} arm=${String(r.arm).padEnd(5)} n=${String(r.n).padStart(3)} P(win)~${wr.toFixed(0)}% (a=${r.alpha} b=${r.beta})`);
    }
  }
} catch (e) { console.log('  arms: ERR ' + e.message); }

console.log('');
db.close();
