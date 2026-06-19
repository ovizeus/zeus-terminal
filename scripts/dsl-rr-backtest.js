// Read-only offline proof: for a sweep of loss-side cut thresholds, recompute R:R/expectancy
// over the real engine-testnet closed trades, vs the baseline (no cut). Quantifies the
// avgLoss reduction vs winner give-back, per side, and finds the expectancy-optimal cut.
const Database = require('better-sqlite3');
const path = require('path');
const { _cappedPnl, _rrStats } = require('../server/services/dslRrSim');

const db = new Database(path.join(__dirname, '..', 'data', 'zeus.db'), { readonly: true });

const trades = [];
for (const r of db.prepare('SELECT data FROM at_closed').all()) {
  let d; try { d = JSON.parse(r.data); } catch (_) { continue; }
  if (String(d.env || '').toUpperCase() !== 'TESTNET') continue;
  if (d.mode !== 'live' && !d.autoTrade) continue;
  if (!isFinite(+d.closePnl)) continue;
  trades.push({
    side: String(d.side || '').toUpperCase(),
    entry: +d.entry, minPrice: +d._minPrice, maxPrice: +d._maxPrice,
    closePnl: +d.closePnl, margin: +d.margin, lev: +d.lev,
  });
}

function sweep(list, label) {
  const base = _rrStats(list.map(t => t.closePnl));
  console.log(`\n=== ${label} (n=${list.length}) ===`);
  console.log(`  BASELINE  WR=${(base.wr*100).toFixed(0)}% RR=${base.rr.toFixed(2)} exp=${base.expectancy.toFixed(1)} avgWin=${base.avgWin.toFixed(1)} avgLoss=${base.avgLoss.toFixed(1)}`);
  let best = { cut: null, exp: base.expectancy };
  for (const cut of [0.005, 0.0075, 0.01, 0.0125, 0.015, 0.0175, 0.02, 0.025, 0.03]) {
    const pnls = list.map(t => { const c = _cappedPnl(t, cut); return c == null ? t.closePnl : c; });
    const s = _rrStats(pnls);
    if (s.expectancy > best.exp) best = { cut, exp: s.expectancy };
    console.log(`  cut=${(cut*100).toFixed(2)}%  WR=${(s.wr*100).toFixed(0)}% RR=${s.rr.toFixed(2)} exp=${s.expectancy.toFixed(1)} avgWin=${s.avgWin.toFixed(1)} avgLoss=${s.avgLoss.toFixed(1)}`);
  }
  console.log(`  -> BEST cut for expectancy: ${best.cut == null ? 'none (baseline best)' : (best.cut*100).toFixed(2)+'%'} (exp ${best.exp.toFixed(1)})`);
}

const usable = trades.filter(t => _cappedPnl(t, 0.02) !== null);
console.log(`Total engine-testnet closed=${trades.length}  usable (have entry/min/max/margin/lev)=${usable.length}`);
sweep(usable, 'ALL');
sweep(usable.filter(t => t.side === 'LONG'), 'LONG');
sweep(usable.filter(t => t.side === 'SHORT'), 'SHORT');
