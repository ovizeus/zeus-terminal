// server/services/mlDslPolicy.js
// v1 DETERMINISTIC momentum-aware DSL pivot proposer (SHADOW). The bootstrap policy
// the ML learner will later refine. Pure: no I/O, no DOM, no DB. Percentages are
// trail widths as % of price, same units as serverDSL params.
'use strict';
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Base trail widths (looser than the static `fast` preset, which cut winners short)
const BASE = { plPct: 0.80, prPct: 0.70, ivPct: 0.30 };
const REGIME_W = { TREND: 1.4, TREND_UP: 1.4, TREND_DOWN: 1.4, BREAKOUT: 1.2, EXPANSION: 1.2, RANGE: 0.7, SQUEEZE: 0.7, VOLATILE: 1.6, CHAOS: 1.6 };
const ATR_BASELINE_PCT = 1.0; // "normal" volatility → atrW = 1.0 (neutral); higher/lower scales the trail

function decide(f) {
  // v1: momentum thresholds are direction-agnostic (LONG/SHORT use the same width
  // multipliers). dslSafety.clamp (Task 2) enforces direction-aware stop bounds before
  // any proposal reaches the AT loop, so `side` is intentionally not branched on here.
  const m = Number.isFinite(f.momentum) ? clamp(f.momentum, -1, 1) : 0;
  const regimeW = REGIME_W[String(f.regime || '').toUpperCase()] || 1.0;
  // atrPct is a per-bar volatility %; normalise against ATR_BASELINE_PCT so normal vol is
  // neutral. Clamp [0.6,2.0] caps how far low/high vol can tighten/widen the trail.
  const atrW = clamp((Number.isFinite(f.atrPct) ? f.atrPct : ATR_BASELINE_PCT) / ATR_BASELINE_PCT, 0.6, 2.0);
  const widthW = regimeW * atrW;

  let action, reason, prMul, ivMul, plMul;
  if (m <= -0.8) {
    action = 'EXIT'; reason = 'momentum reversed hard';
    prMul = 0.6; ivMul = 0.6; plMul = 0.5;            // irrelevant on exit; tight anyway
  } else if (m >= 0.4) {
    action = 'LOOSEN'; reason = 'momentum up — let it run';
    prMul = 1.3; ivMul = 1.4; plMul = 1.1;            // wider trail, give room
  } else if (m <= -0.1) {
    action = 'TIGHTEN'; reason = 'momentum fading — lock profit';
    prMul = 0.7; ivMul = 0.7; plMul = 0.6;            // tighter stop nearer price
  } else if ((Number.isFinite(f.mfePct) ? f.mfePct : 0) > 0.8) {
    action = 'BREATHER'; reason = 'in profit, mild pullback — give PR room';
    prMul = 1.1; ivMul = 1.1; plMul = 1.0;            // small room, hold PL
  } else {
    action = 'HOLD'; reason = 'no clear signal';
    prMul = 1.0; ivMul = 1.0; plMul = 1.0;
  }
  return {
    plPct: clamp(BASE.plPct * widthW * plMul, 0.1, 5),
    prPct: clamp(BASE.prPct * widthW * prMul, 0.1, 5),
    ivPct: clamp(BASE.ivPct * widthW * ivMul, 0.05, 5),
    action, reason,
  };
}
// initialCap(f) — the ML loss-cap placed at ENTRY (active-from-entry DSL). Runs before any
// momentum data exists, so it sizes the initial stop as a FRACTION of the brain's hard-SL
// distance (which is already ATR/regime-aware). The fraction is ALWAYS < 1 → the cap is
// guaranteed TIGHTER than the exchange hard SL (the whole point: cut early, never bleed the
// full hard SL). Asymmetric: counter-trend = tighter (cut a bad bet fast), with-trend = more
// room (don't whipsaw a good one); ranging/squeeze tighter than trending. Pure; fail-safe.
// f: { hardSlPct, regime, withTrend, side }. Returns { capPct, posture, frac }.
const _REGIME_FRAC = {
  TREND: 0.75, TREND_UP: 0.75, TREND_DOWN: 0.75, BREAKOUT: 0.70, EXPANSION: 0.70,
  RANGE: 0.55, SQUEEZE: 0.55, VOLATILE: 0.80, CHAOS: 0.80,
};
function initialCap(f) {
  f = f || {};
  const hardSlPct = clamp(Number.isFinite(f.hardSlPct) && f.hardSlPct > 0 ? f.hardSlPct : 1.5, 0.2, 20);
  const regimeFrac = _REGIME_FRAC[String(f.regime || '').toUpperCase()] || 0.65;
  // counter-trend → tighter; with-trend → a bit more room; unknown → neutral
  const trendW = f.withTrend === false ? 0.70 : (f.withTrend === true ? 1.10 : 1.0);
  const frac = clamp(regimeFrac * trendW, 0.30, 0.90); // strictly < 1 → tighter than the hard SL
  const capPct = clamp(hardSlPct * frac, 0.15, hardSlPct * 0.95); // never reaches the hard SL
  const posture = frac <= 0.55 ? 'TIGHT' : (frac >= 0.80 ? 'WIDE' : 'NORMAL');
  return { capPct, posture, frac };
}

module.exports = { decide, initialCap };
