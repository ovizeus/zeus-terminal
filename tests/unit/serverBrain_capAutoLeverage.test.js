'use strict';

// [LEVER-A 2026-06-22] Auto leverage cap. Root-cause analysis of the testnet soak
// bleed found liquidations + SL-overshoot losses concentrated at high leverage
// (up to 20x → -$1037 liquidations, -115% of margin). MAX_LEVERAGE env was 125
// (Binance max, no real cap) and the R1 MAX_LEVERAGE principle is advisory-only.
// This pure helper hard-caps the leverage the brain feeds into sizing/geometry.

const sb = require('../../server/services/serverBrain');

describe('_capAutoLeverage (Lever A — hard auto leverage cap)', () => {
  const cap = (l, c) => sb._capAutoLeverage(l, c);

  it('caps leverage above the cap', () => {
    expect(cap(20, 10)).toBe(10);
    expect(cap(125, 10)).toBe(10);
    expect(cap(12, 10)).toBe(10);
  });

  it('leaves leverage at/below the cap untouched', () => {
    expect(cap(8, 10)).toBe(8);
    expect(cap(10, 10)).toBe(10);
    expect(cap(1, 10)).toBe(1);
  });

  it('returns a safe default (5) for invalid / non-positive leverage', () => {
    expect(cap(undefined, 10)).toBe(5);
    expect(cap(0, 10)).toBe(5);
    expect(cap(-3, 10)).toBe(5);
    expect(cap(NaN, 10)).toBe(5);
  });

  it('applies NO cap when the cap is invalid / non-positive (returns lev)', () => {
    expect(cap(20, 0)).toBe(20);
    expect(cap(20, undefined)).toBe(20);
    expect(cap(20, NaN)).toBe(20);
  });
});
