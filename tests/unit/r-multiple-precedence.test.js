'use strict';

// [AUDIT-20260619 P2] r_multiple operator-precedence bug at serverAT.js:2560.
//   Math.abs(pnlPct / pos.slPct || 1)  parses as  Math.abs((pnlPct / slPct) || 1)
// so when slPct === 0 (legitimately set when SL distance is unknown/corrupt) and
// the trade won (pnlPct > 0), pnlPct/0 = Infinity, and `Infinity || 1` is Infinity,
// not 1. Infinity was then written into ml_attribution_events, polluting the R5A
// measurement triad / learning inputs (the data the soak/flip-gate relies on).
// Fix: divide by (slPct || 1) so the zero-guard is on the DENOMINATOR.

const { _attribTestHooks } = require('../../server/services/serverAT');
const rMultiple = _attribTestHooks.rMultiple;

describe('_rMultiple — finite, correct sign, zero-SL safe', () => {
  test('win with slPct=0 → finite (denominator guarded), NOT Infinity', () => {
    const r = rMultiple(true, 5, 2.0, 0); // rr set, pnl=5>0, pnlPct=2, slPct=0
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(2.0); // 2.0 / (0||1) = 2.0
  });

  test('normal win → pnlPct / slPct', () => {
    expect(rMultiple(true, 5, 3.0, 1.5)).toBeCloseTo(2.0, 6);
  });

  test('loss → -1', () => {
    expect(rMultiple(true, -5, -1.2, 1.0)).toBe(-1);
  });

  test('flat (pnl=0) or no rr → null', () => {
    expect(rMultiple(true, 0, 0, 1)).toBeNull();
    expect(rMultiple(false, 5, 2, 1)).toBeNull();
  });

  test('win with negative pnlPct value still finite & positive magnitude', () => {
    // defensive: abs keeps it positive even on odd inputs
    expect(rMultiple(true, 5, -2.0, 0)).toBe(2.0);
  });
});
