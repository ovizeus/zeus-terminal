'use strict';
const { _disasterStopPrice, _shouldDisasterClose } = require('../../server/services/serverAT');

describe('disaster backstop (fix #1)', () => {
  test('uses originalSL when present', () => {
    expect(_disasterStopPrice({ side: 'LONG', price: 100, originalSL: 95, slPct: 1.5 })).toBe(95);
  });
  test('derives from slPct when originalSL missing — never null', () => {
    expect(_disasterStopPrice({ side: 'LONG', price: 100, originalSL: null, slPct: 1.5 })).toBeCloseTo(98.5, 6);
  });
  test('SHORT derives above entry', () => {
    expect(_disasterStopPrice({ side: 'SHORT', price: 100, originalSL: null, slPct: 1.5 })).toBeCloseTo(101.5, 6);
  });
  test('LONG closes when price <= disaster stop', () => {
    expect(_shouldDisasterClose({ side: 'LONG', price: 100, originalSL: 95, slPct: 1.5 }, 94)).toBe(true);
    expect(_shouldDisasterClose({ side: 'LONG', price: 100, originalSL: 95, slPct: 1.5 }, 96)).toBe(false);
  });
  test('never closes on null/0 derived stop guard (no instant HIT_SL)', () => {
    expect(_shouldDisasterClose({ side: 'LONG', price: 100, originalSL: null, slPct: 0 }, 100)).toBe(false);
  });
  test('SHORT closes when price >= disaster stop', () => {
    expect(_shouldDisasterClose({ side: 'SHORT', price: 100, originalSL: 106, slPct: 1.5 }, 107)).toBe(true);
    expect(_shouldDisasterClose({ side: 'SHORT', price: 100, originalSL: 106, slPct: 1.5 }, 105)).toBe(false);
  });
});
