#!/usr/bin/env node
/**
 * P&L track-record reporter (flip-gate, read-only).
 *
 * at_closed already persists every closed trade with `closePnl` + `closeTs`, so the
 * testnet track record accumulates automatically — this script just SUMMARISES it.
 * READ-ONLY: opens the DB readonly, never writes, never touches the running engine.
 *
 *   node scripts/pnl-testnet-track.js              # all-time
 *   node scripts/pnl-testnet-track.js 21           # last 21 days
 *   node scripts/pnl-testnet-track.js 21 auto      # last 21d, only autoTrade (engine) trades
 */
const path = require('path');
const Database = require('better-sqlite3');

const days = Number(process.argv[2]) || 0;            // 0 = all time
const onlyAuto = (process.argv[3] || '').toLowerCase().startsWith('auto');
const dbPath = path.join(__dirname, '..', 'data', 'zeus.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const sinceMs = days > 0 ? Date.now() - days * 86400000 : 0;
const rows = db.prepare('SELECT data FROM at_closed WHERE data IS NOT NULL').all();
db.close();

const trades = [];
for (const r of rows) {
  let o; try { o = JSON.parse(r.data); } catch (_) { continue; }
  const pnl = Number(o.closePnl);
  if (!Number.isFinite(pnl)) continue;
  const closeTs = Number(o.closeTs || o.ts) || 0;
  if (sinceMs && closeTs && closeTs < sinceMs) continue;
  if (onlyAuto && !o.autoTrade) continue;
  trades.push({
    pnl, closeTs,
    side: (o.side || '?').toUpperCase(),
    mode: o.mode || '?', env: o.env || '?', exchange: o.exchange || '?',
    tier: o.tier || '?', auto: !!o.autoTrade,
    bucket: `${o.mode || '?'}/${o.env || '?'}/${o.exchange || '?'}`,
    day: closeTs ? new Date(closeTs).toISOString().slice(0, 10) : '?',
  });
}

function stats(list) {
  const n = list.length;
  const wins = list.filter((t) => t.pnl > 0).length;
  const losses = list.filter((t) => t.pnl < 0).length;
  const total = list.reduce((a, t) => a + t.pnl, 0);
  const best = list.reduce((a, t) => Math.max(a, t.pnl), -Infinity);
  const worst = list.reduce((a, t) => Math.min(a, t.pnl), Infinity);
  return {
    n, wins, losses,
    winRate: n ? (100 * wins / (wins + losses || 1)) : 0,
    total, avg: n ? total / n : 0,
    best: n ? best : 0, worst: n ? worst : 0,
  };
}
const f = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const groupBy = (list, key) => list.reduce((m, t) => ((m[t[key]] ||= []).push(t), m), {});

console.log(`\n══════ P&L TRACK RECORD ${days ? `(last ${days}d)` : '(all-time)'}${onlyAuto ? ' · engine-only' : ''} ══════`);
console.log(`closed trades with P&L: ${trades.length}`);
if (!trades.length) { console.log('(no trades in range)'); process.exit(0); }

console.log('\n── by mode/env/exchange ──');
for (const [bk, list] of Object.entries(groupBy(trades, 'bucket')).sort((a, b) => b[1].length - a[1].length)) {
  const s = stats(list);
  console.log(`  ${bk.padEnd(22)} n=${String(s.n).padStart(5)}  P&L=${f(s.total).padStart(11)}  WR=${s.winRate.toFixed(1)}%  avg=${f(s.avg)}  best=${f(s.best)} worst=${f(s.worst)}`);
}

console.log('\n── by side (all buckets) ──');
for (const [sd, list] of Object.entries(groupBy(trades, 'side'))) {
  const s = stats(list);
  console.log(`  ${sd.padEnd(8)} n=${String(s.n).padStart(5)}  P&L=${f(s.total).padStart(11)}  WR=${s.winRate.toFixed(1)}%`);
}

console.log('\n── by tier ──');
for (const [tr, list] of Object.entries(groupBy(trades, 'tier'))) {
  const s = stats(list);
  console.log(`  ${tr.padEnd(10)} n=${String(s.n).padStart(5)}  P&L=${f(s.total).padStart(11)}  WR=${s.winRate.toFixed(1)}%`);
}

const byDay = groupBy(trades, 'day');
const dayKeys = Object.keys(byDay).sort();
console.log(`\n── daily (last ${Math.min(14, dayKeys.length)} days w/ trades) ──`);
for (const d of dayKeys.slice(-14)) {
  const s = stats(byDay[d]);
  console.log(`  ${d}  n=${String(s.n).padStart(4)}  P&L=${f(s.total).padStart(11)}  WR=${s.winRate.toFixed(0)}%`);
}

const all = stats(trades);
console.log(`\n── CUMULATIVE ──`);
console.log(`  trades=${all.n}  WR=${all.winRate.toFixed(1)}%  total P&L=${f(all.total)}  avg/trade=${f(all.avg)}`);
console.log('');
