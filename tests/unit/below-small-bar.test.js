'use strict';
const { _belowSmallBar } = require('../../server/services/serverBrain');
describe('_belowSmallBar (re-tier uses soak floor when present)', () => {
  test('null floor → standard 62 bar', () => {
    expect(_belowSmallBar(61, null)).toBe(true);
    expect(_belowSmallBar(62, null)).toBe(false);
  });
  test('soak floor 45 → 45+ stays SMALL-eligible, below 45 demotes', () => {
    expect(_belowSmallBar(45, 45)).toBe(false);
    expect(_belowSmallBar(44, 45)).toBe(true);
    expect(_belowSmallBar(50, 45)).toBe(false); // 50 with floor 45 → NOT below bar (stays SMALL)
  });
  test('floor >=62 ignored (never raises) → 62 bar', () => {
    expect(_belowSmallBar(61, 80)).toBe(true);
  });
});
