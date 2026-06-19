'use strict';

// [AUDIT-20260619 P1-3 / SL-floor] Defense-in-depth: the DSL stop must never move
// AGAINST the trader. The stop (pivotLeft/currentSL) only ever tightens by design
// (the "breather room" lives on pivotRight, not the stop). _isSLImprovement is the
// pure predicate the DSL→SL consumer uses to refuse a non-improving (looser) SL
// before it reaches pos.sl / the exchange.
//
//   LONG  : tighter = HIGHER stop (closer to price from below) → newSL >= oldSL
//   SHORT : tighter = LOWER  stop (closer to price from above) → newSL <= oldSL

const { _slGuardHooks } = require('../../server/services/serverAT');
const ok = _slGuardHooks.isSLImprovement;

describe('_isSLImprovement — stop never loosens', () => {
  test('LONG: looser (lower) SL rejected', () => { expect(ok('LONG', 100, 99)).toBe(false); });
  test('LONG: tighter (higher) SL accepted', () => { expect(ok('LONG', 100, 101)).toBe(true); });
  test('LONG: equal SL accepted (no loosening)', () => { expect(ok('LONG', 100, 100)).toBe(true); });
  test('SHORT: looser (higher) SL rejected', () => { expect(ok('SHORT', 100, 101)).toBe(false); });
  test('SHORT: tighter (lower) SL accepted', () => { expect(ok('SHORT', 100, 99)).toBe(true); });

  test('first placement (no prior SL) accepted', () => {
    expect(ok('LONG', null, 100)).toBe(true);
    expect(ok('LONG', 0, 100)).toBe(true);
    expect(ok('SHORT', undefined, 100)).toBe(true);
  });

  test('garbage new SL never placed', () => {
    expect(ok('LONG', 100, 0)).toBe(false);
    expect(ok('LONG', 100, -5)).toBe(false);
    expect(ok('LONG', 100, NaN)).toBe(false);
  });
});
