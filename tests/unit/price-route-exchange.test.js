'use strict';

// [AUDIT-20260619 B2] The SL/TP/DSL price path (onPriceUpdate) was fed ONLY by the
// Binance feed, so a Bybit position froze whenever Binance @bookTicker stalled (Bybit's
// own live feed wasn't wired in) and ran cross-venue on Binance prices. onPriceUpdate is
// now exchange-aware: a feed tick only drives positions on the SAME exchange.

const { _priceRouteHooks } = require('../../server/services/serverAT');
const matches = _priceRouteHooks.matchesExchange;

describe('_priceUpdateMatchesExchange — a feed only drives its own exchange', () => {
  test('bybit feed drives bybit position', () => { expect(matches('bybit', 'bybit')).toBe(true); });
  test('binance feed drives binance position', () => { expect(matches('binance', 'binance')).toBe(true); });
  test('binance feed does NOT drive a bybit position (no cross-venue)', () => { expect(matches('bybit', 'binance')).toBe(false); });
  test('bybit feed does NOT drive a binance position', () => { expect(matches('binance', 'bybit')).toBe(false); });
  test('null/undefined position exchange defaults to binance', () => {
    expect(matches(null, 'binance')).toBe(true);
    expect(matches(undefined, undefined)).toBe(true);   // legacy call (no feed tag) → binance
    expect(matches(null, 'bybit')).toBe(false);
  });
  test('case-insensitive', () => { expect(matches('BYBIT', 'bybit')).toBe(true); });
});
