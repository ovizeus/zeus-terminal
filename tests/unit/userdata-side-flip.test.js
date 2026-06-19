'use strict';

// [AUDIT-20260619 P1-5] The ACCOUNT_UPDATE handler matches an existing position by
// userId+symbol+status==='OPEN' only — NOT by side. The MODIFIED branch updated
// qty/entry/uPnL but never existing.side. On a one-way account a sign-flipped
// non-zero net amount means the position REVERSED (manual reverse / reduce overshoot
// / opposite fill before the old row cleared). Blindly updating the wrong-sided row
// inverts PnL, puts the server-net SL on the wrong side, and defeats recon self-heal.
// _isSideFlip is the pure detector the guard uses before touching the row.

const { _sideFlipHooks } = require('../../server/services/serverAT');
const flip = _sideFlipHooks.isSideFlip;

describe('_isSideFlip — net sign vs tracked side', () => {
  test('LONG tracked + negative net (flipped SHORT) → flip', () => { expect(flip('LONG', -0.5)).toBe(true); });
  test('SHORT tracked + positive net (flipped LONG) → flip', () => { expect(flip('SHORT', 0.5)).toBe(true); });
  test('LONG tracked + positive net (scale in/out) → NOT a flip', () => { expect(flip('LONG', 0.7)).toBe(false); });
  test('SHORT tracked + negative net → NOT a flip', () => { expect(flip('SHORT', -0.7)).toBe(false); });
  test('zero net (that is the CLOSED branch, not MODIFIED) → not a flip here', () => { expect(flip('LONG', 0)).toBe(false); });
  test('no tracked side / non-finite → not a flip', () => {
    expect(flip(null, -0.5)).toBe(false);
    expect(flip('LONG', NaN)).toBe(false);
  });
});
