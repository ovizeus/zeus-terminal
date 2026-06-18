const { isUntrustedEmptyHeld } = require('../../server/services/reconHelpers');

describe('reconHelpers.isUntrustedEmptyHeld', () => {
  test('empty held-map while tracking live positions → UNTRUSTED (stale/failed poll, skip destructive recon)', () => {
    expect(isUntrustedEmptyHeld(0, 3)).toBe(true);
    expect(isUntrustedEmptyHeld(0, 1)).toBe(true);
  });
  test('non-empty held-map → trusted (normal recon proceeds)', () => {
    expect(isUntrustedEmptyHeld(2, 3)).toBe(false);
    expect(isUntrustedEmptyHeld(3, 3)).toBe(false);
    expect(isUntrustedEmptyHeld(1, 1)).toBe(false);
  });
  test('empty held-map AND zero tracked → trusted (genuinely nothing to reconcile)', () => {
    expect(isUntrustedEmptyHeld(0, 0)).toBe(false);
  });
  test('defensive: non-finite / negative inputs → not untrusted (never skip on garbage)', () => {
    expect(isUntrustedEmptyHeld(undefined, 3)).toBe(false);
    expect(isUntrustedEmptyHeld(0, undefined)).toBe(false);
    expect(isUntrustedEmptyHeld(NaN, NaN)).toBe(false);
    expect(isUntrustedEmptyHeld(-1, 3)).toBe(false);
  });
});
