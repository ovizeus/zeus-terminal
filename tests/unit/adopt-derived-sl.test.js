'use strict';
const { _adoptedProtectiveStop } = require('../../server/services/serverAT');
describe('adopted-position protective SL (policy L — current-price-relative)', () => {
  test('LONG: markPrice 100, 2% → 98', () => {
    expect(_adoptedProtectiveStop('LONG', 100, 90)).toBeCloseTo(98, 6);
  });
  test('SHORT: markPrice 100, 2% → 102', () => {
    expect(_adoptedProtectiveStop('SHORT', 100, 110)).toBeCloseTo(102, 6);
  });
  test('falls back to entryPrice when markPrice missing', () => {
    expect(_adoptedProtectiveStop('LONG', 0, 200)).toBeCloseTo(196, 6); // 200*0.98
  });
  test('returns 0 when no usable price (caller guards — never false close)', () => {
    expect(_adoptedProtectiveStop('LONG', 0, 0)).toBe(0);
  });
  test('normalizes raw exchange side (BUY → LONG, stop below price)', () => {
    expect(_adoptedProtectiveStop('BUY', 100, 0)).toBeCloseTo(98, 6);
  });
  test('NaN / non-numeric inputs → 0 (no false close)', () => {
    expect(_adoptedProtectiveStop('LONG', NaN, NaN)).toBe(0);
    expect(_adoptedProtectiveStop('LONG', 'abc', 'abc')).toBe(0);
  });
});
