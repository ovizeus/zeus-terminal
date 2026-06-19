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

// Is the position improving from its worst adverse extreme by more than eps?
// LONG: price bounced up off the running low. SHORT: price dropped off the running high.
function _recovering(currentPrice, extremeSoFar, side, eps) {
  const c = +currentPrice, e = +extremeSoFar, ep = +eps || 0;
  if (!isFinite(c) || !isFinite(e) || e <= 0) return false;
  return String(side).toUpperCase() === 'LONG'
    ? c > e * (1 + ep)
    : c < e * (1 - ep);
}

// Cut iff adverse past the threshold AND not recovering.
function _shouldEarlyExit(o) {
  if (!o || typeof o.adversePct !== 'number' || typeof o.threshold !== 'number') return false;
  return o.adversePct >= o.threshold && o.recovering === false;
}

// Replay a price path through the smart cut. The discriminator is SUSTAINED falling:
// `recovering` = the adverse move is not yet sustained (fewer than `sustain` consecutive new
// adverse extremes). A dip-then-recover winner makes 1 new low then turns → spared. A genuine
// loser makes consecutive new lows → cut. Returns the counterfactual exit PnL fraction, or the
// supplied baselinePnlPct if the cut never fires.
function _smartCutPnlPct(pricePath, cfg) {
  if (!Array.isArray(pricePath) || pricePath.length === 0 || !cfg) return (cfg && cfg.baselinePnlPct) || 0;
  const side = String(cfg.side).toUpperCase();
  const entry = +cfg.entry, threshold = +cfg.threshold;
  const K = Number.isFinite(+cfg.sustain) ? +cfg.sustain : 2;
  const baseline = +cfg.baselinePnlPct || 0;
  if (!isFinite(entry) || entry <= 0 || !isFinite(threshold)) return baseline;
  let extreme = null, consec = 0;
  for (const raw of pricePath) {
    const p = +raw; if (!isFinite(p)) continue;
    const newExtreme = extreme === null ? false : (side === 'LONG' ? p < extreme : p > extreme);
    extreme = extreme === null ? p : (side === 'LONG' ? Math.min(extreme, p) : Math.max(extreme, p));
    consec = newExtreme ? consec + 1 : 0;
    const adversePct = side === 'LONG' ? (entry - p) / entry : (p - entry) / entry;
    if (_shouldEarlyExit({ adversePct, recovering: consec < K, threshold })) {
      return side === 'LONG' ? (p - entry) / entry : (entry - p) / entry;
    }
  }
  return baseline;
}

module.exports = { _cappedPnl, _rrStats, _recovering, _shouldEarlyExit, _smartCutPnlPct };
