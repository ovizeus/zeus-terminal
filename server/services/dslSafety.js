// server/services/dslSafety.js
// Fail-closed double safety net for the ML-DSL. Net A: stop never wider than the
// entry SL. Net B: max-loss kill-switch → forcedExit. Invalid input degrades to a
// safe TIGHT default (never "no stop"). Pure: no I/O.
'use strict';
const SAFE_DEFAULT = { plPct: 0.5, prPct: 0.5, ivPct: 0.3 }; // tight fail-safe
const num = (v, d) => (Number.isFinite(v) ? v : d);

function clamp(proposed, pos) {
  const side = pos && pos.side === 'SHORT' ? 'SHORT' : 'LONG';
  const entry = num(pos && pos.entry, 0);
  const price = num(pos && pos.price, entry);
  const originalSL = num(pos && pos.originalSL, 0);
  const maxLossPct = num(pos && pos.maxLossPct, 1.5);

  // sanitize proposal — fail-closed to tight default
  let plPct = num(proposed && proposed.plPct, SAFE_DEFAULT.plPct);
  let prPct = num(proposed && proposed.prPct, SAFE_DEFAULT.prPct);
  let ivPct = num(proposed && proposed.ivPct, SAFE_DEFAULT.ivPct);
  let action = (proposed && proposed.action) || 'HOLD';
  let reason = (proposed && proposed.reason) || 'safety default';
  plPct = Math.max(0.05, Math.min(5, plPct));
  prPct = Math.max(0.05, Math.min(5, prPct));
  ivPct = Math.max(0.05, Math.min(5, ivPct));

  // ── Net A: PL never wider than originalSL ──
  if (entry > 0 && originalSL > 0 && price > 0) {
    if (side === 'LONG') {
      const maxPlPct = (price - originalSL) / price * 100; // widest allowed (PL at originalSL)
      if (Number.isFinite(maxPlPct) && maxPlPct > 0) plPct = Math.min(plPct, maxPlPct);
    } else {
      const maxPlPct = (originalSL - price) / price * 100;
      if (Number.isFinite(maxPlPct) && maxPlPct > 0) plPct = Math.min(plPct, maxPlPct);
    }
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
