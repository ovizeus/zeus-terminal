// server/services/dslSafety.js
// Fail-closed double safety net for the ML-DSL. Net A: stop never wider than the
// entry SL. Net B: max-loss kill-switch → forcedExit. Invalid input degrades to a
// safe TIGHT default (never "no stop"). Pure: no I/O.
'use strict';
const SAFE_DEFAULT = { plPct: 0.5, prPct: 0.5, ivPct: 0.3 }; // tight fail-safe
const DEFAULT_MAX_LOSS_PCT = 1.5; // hard kill-switch threshold when pos.maxLossPct absent
const num = (v, d) => (Number.isFinite(v) ? v : d);

function clamp(proposed, pos) {
  const side = pos && pos.side === 'SHORT' ? 'SHORT' : 'LONG';
  const entry = num(pos && pos.entry, 0);
  const price = num(pos && pos.price, entry); // missing live price falls back to entry → Net B sees 0 loss (kill-switch inert until a real price arrives)
  const originalSL = num(pos && pos.originalSL, 0);
  const maxLossPct = num(pos && pos.maxLossPct, DEFAULT_MAX_LOSS_PCT);

  // sanitize proposal — fail-closed to tight default
  let plPct = num(proposed && proposed.plPct, SAFE_DEFAULT.plPct);
  let prPct = num(proposed && proposed.prPct, SAFE_DEFAULT.prPct);
  let ivPct = num(proposed && proposed.ivPct, SAFE_DEFAULT.ivPct);
  let action = (proposed && proposed.action) || 'HOLD';
  let reason = (proposed && proposed.reason) || 'safety default';
  plPct = Math.max(0.05, Math.min(5, plPct));
  prPct = Math.max(0.05, Math.min(5, prPct));
  ivPct = Math.max(0.05, Math.min(5, ivPct));

  // ── Net A: PL never wider than originalSL (fail-closed if the floor is unknown) ──
  if (entry > 0 && price > 0 && originalSL > 0) {
    const maxPlPct = side === 'LONG'
      ? (price - originalSL) / price * 100
      : (originalSL - price) / price * 100;
    if (Number.isFinite(maxPlPct) && maxPlPct > 0) plPct = Math.min(plPct, maxPlPct);
    // maxPlPct <= 0 means price already past originalSL — Net A cannot set a meaningful
    // floor; shadow proposal left as-is. Net B fires independently on maxLossPct, not on
    // an originalSL crossing.
  } else {
    // floor unknown OR invalid pos (no entry/price) → cannot guarantee "not wider than
    // originalSL" → degrade plPct to the tight default (fail-closed).
    plPct = Math.min(plPct, SAFE_DEFAULT.plPct);
  }

  // ── Net B: max-loss kill-switch ──
  let forcedExit = false;
  if (entry > 0 && price > 0) {
    const lossPct = side === 'LONG' ? (entry - price) / entry * 100 : (price - entry) / entry * 100;
    if (lossPct >= maxLossPct) { forcedExit = true; action = 'EXIT'; reason = `max-loss ${maxLossPct}% hit`; }
  }
  return { plPct, prPct, ivPct, action, reason, forcedExit };
}
module.exports = { clamp };
