'use strict';

// [AUDIT-20260619 FA-P1-1] The round-trip taker fee was hardcoded to Binance's
// 0.0008 (0.04%/side) and applied to Bybit too. Bybit's taker is 0.055%/side
// (0.0011 round-trip, ~37.5% higher), so PnL was overstated and the kill-switch
// daily-loss tracker fired LATE on Bybit. Fee rate is now per-exchange.

const { _feeHooks } = require('../../server/services/serverAT');
const rate = _feeHooks.feeRateForExchange;
const applyFee = _feeHooks.applyRoundTripFee;

describe('per-exchange round-trip fee', () => {
  test('binance → 0.0008, bybit → 0.0011 (higher)', () => {
    expect(rate('binance')).toBe(0.0008);
    expect(rate('bybit')).toBe(0.0011);
    expect(rate('bybit')).toBeGreaterThan(rate('binance'));
  });

  test('unknown / missing exchange → Binance default (backward-compatible)', () => {
    expect(rate('kraken')).toBe(0.0008);
    expect(rate(undefined)).toBe(0.0008);
    expect(rate(null)).toBe(0.0008);
  });

  test('case-insensitive', () => {
    expect(rate('BYBIT')).toBe(0.0011);
  });

  test('applyRoundTripFee deducts the bybit rate on bybit notional', () => {
    // notional = size*lev = 100*10 = 1000; bybit fee = 1000*0.0011 = 1.1
    expect(applyFee(50, 100, 10, 'bybit')).toBeCloseTo(50 - 1.1, 6);
    // binance: 1000*0.0008 = 0.8
    expect(applyFee(50, 100, 10, 'binance')).toBeCloseTo(50 - 0.8, 6);
    // bybit deducts MORE than binance for the same trade
    expect(applyFee(50, 100, 10, 'bybit')).toBeLessThan(applyFee(50, 100, 10, 'binance'));
  });

  test('zero/invalid notional → grossPnl unchanged', () => {
    expect(applyFee(50, 0, 10, 'bybit')).toBe(50);
  });
});
