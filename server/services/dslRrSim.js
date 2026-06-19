// DSL R:R offline sim helpers — pure, no I/O. Used by the offline backtest + (later) shadow.

// PnL of a trade if it had been cut the moment price reached `cutPct` adverse excursion.
// Cut fires iff the trade's worst adverse excursion reached cutPct → capped loss = -cutPct*notional.
// Otherwise the trade keeps its actual closePnl. Returns null if inputs are insufficient.
function _cappedPnl(t, cutPct) {
  if (!t || typeof cutPct !== 'number' || cutPct <= 0) return null;
  const entry = +t.entry, margin = +t.margin, lev = +t.lev, closePnl = +t.closePnl;
  if (!isFinite(entry) || entry <= 0 || !isFinite(margin) || !isFinite(lev) || !isFinite(closePnl)) return null;
  const side = String(t.side || '').toUpperCase();
  let minAdverse;
  if (side === 'LONG') {
    const minP = +t.minPrice; if (!isFinite(minP)) return null;
    minAdverse = (entry - minP) / entry;
  } else if (side === 'SHORT') {
    const maxP = +t.maxPrice; if (!isFinite(maxP)) return null;
    minAdverse = (maxP - entry) / entry;
  } else return null;
  if (minAdverse >= cutPct) return -(cutPct * margin * lev);
  return closePnl;
}

// WR / avgWin / avgLoss / R:R / expectancy of a list of PnL numbers (treats 0 as a loss).
function _rrStats(pnls) {
  const arr = (pnls || []).filter(p => typeof p === 'number' && isFinite(p));
  const n = arr.length;
  if (!n) return { n: 0, wr: 0, avgWin: 0, avgLoss: 0, rr: 0, expectancy: 0 };
  const wins = arr.filter(p => p > 0), losses = arr.filter(p => p <= 0);
  const avgWin = wins.length ? wins.reduce((s, p) => s + p, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, p) => s + p, 0) / losses.length : 0;
  const rr = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;
  const expectancy = arr.reduce((s, p) => s + p, 0) / n;
  return { n, wr: wins.length / n, avgWin, avgLoss, rr, expectancy };
}

module.exports = { _cappedPnl, _rrStats };
