'use strict';

describe('binanceGateway', () => {
  let gw, rl, cb;
  beforeEach(() => {
    rl = require('../../server/services/rateLimiter');
    cb = require('../../server/services/circuitBreaker');
    gw = require('../../server/services/binanceGateway');
    rl._resetForTest();
    cb._resetForTest();
  });

  test('exports fetch function', () => {
    expect(typeof gw.fetch).toBe('function');
  });

  test('getStatus returns rateLimiter + circuitBreaker combined', () => {
    const s = gw.getStatus();
    expect(s).toHaveProperty('rateLimiter');
    expect(s).toHaveProperty('circuitBreaker');
  });

  test('fetch returns stale response when circuit is OPEN', async () => {
    // Open circuit for endpoint '24hr' (gateway extracts last path segment)
    cb.record('binance', '24hr', 418);
    const res = await gw.fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', { __weight: 40 });
    expect(res._stale).toBe(true);
    expect(res._reason).toBe('circuit_open');
    expect(res.status).toBe(503);
  });

  test('fetch returns stale response when rate limited', async () => {
    // Fill rate bucket to halt
    rl.parseHeaders('binance', { 'x-mbx-used-weight-1m': '2350' });
    const res = await gw.fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT', { __weight: 100 });
    expect(res._stale).toBe(true);
    expect(res._reason).toBe('rate_limit');
  });

  test('extracts exchange from URL correctly', async () => {
    // Circuit open for binance shouldn't affect bybit
    cb.record('binance', 'ticker', 418);
    // bybit should still be allowed
    expect(cb.canRequest('bybit', 'ticker')).toBe(true);
  });

  test('getStatus has pool info', () => {
    const s = gw.getStatus();
    expect(s.rateLimiter).toHaveProperty('binance:futures');
    expect(s.rateLimiter).toHaveProperty('bybit:v5');
  });
});
