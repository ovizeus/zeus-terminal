'use strict';
const { _resolveSoakFloor } = require('../../server/services/serverBrain');
describe('_resolveSoakFloor gating (pure)', () => {
  test('only flagOn + cutover + testnet → floor; else null', () => {
    expect(_resolveSoakFloor(true, true, true, 45)).toBe(45);
    expect(_resolveSoakFloor(false, true, true, 45)).toBe(null);
    expect(_resolveSoakFloor(true, false, true, 45)).toBe(null);
    expect(_resolveSoakFloor(true, true, false, 45)).toBe(null);
  });
});
