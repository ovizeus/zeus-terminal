// server/services/seqGuard.js
// Rewind-safe sequence counter guard for the AT engine.
//
// ROOT CAUSE (2026-06-18): the per-user position seq counter (`us.seq`) is loaded at
// restart from the persisted engine:N snapshot. If that snapshot lags behind the
// highest seq already issued to a still-OPEN position, the counter rewinds and the
// next `++us.seq` reissues a seq already in use → seq collision → the dedup/adopt
// guards (keyed on seq) misfire → real exchange positions get re-adopted as
// source=external/lev=1 (the "Manual x1" orphan) and same-(user,symbol,side,mode)
// UNIQUE-index inserts fail.
//
// Fix: on restore, clamp the loaded counter to never sit below any known open seq.
// Pure, no I/O. In the healthy case (saved counter already >= all open seqs) this is
// a no-op — zero behaviour change.
'use strict';

function rewindSafeSeq(savedSeq, seqs) {
  let m = Number.isFinite(savedSeq) ? savedSeq : 0;
  if (Array.isArray(seqs)) {
    for (const s of seqs) {
      if (Number.isFinite(s) && s > m) m = s;
    }
  }
  return m;
}

module.exports = { rewindSafeSeq };
