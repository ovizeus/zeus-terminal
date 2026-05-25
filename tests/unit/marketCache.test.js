'use strict';

describe('marketCache', () => {
  let cache;
  beforeEach(() => {
    cache = require('../../server/services/marketCache');
    cache._resetForTest();
  });

  // Basic get/set
  test('set + get returns data within TTL', () => {
    cache.set('ticker', 'binance:BTCUSDT', { price: 77000 }, { caller: 'marketRadar' });
    const result = cache.get('ticker', 'binance:BTCUSDT');
    expect(result).not.toBeNull();
    expect(result.price).toBe(77000);
  });

  test('get returns null after TTL expires', () => {
    cache.set('ticker', 'binance:BTCUSDT', { price: 77000 }, { caller: 'marketRadar', ttlMs: 1 });
    const entry = cache._getEntry('ticker', 'binance:BTCUSDT');
    entry.ts = Date.now() - 10000;
    expect(cache.get('ticker', 'binance:BTCUSDT')).toBeNull();
  });

  test('set overwrites previous value', () => {
    cache.set('oi', 'binance:BTCUSDT', 50000, { caller: 'marketRadar' });
    cache.set('oi', 'binance:BTCUSDT', 60000, { caller: 'marketRadar' });
    expect(cache.get('oi', 'binance:BTCUSDT')).toBe(60000);
  });

  // Request dedup
  test('getOrFetch deduplicates concurrent requests', async () => {
    let fetchCount = 0;
    const fetcher = async () => { fetchCount++; return 42; };
    const [a, b] = await Promise.all([
      cache.getOrFetch('oi', 'binance:ETHUSDT', fetcher, { ttlMs: 60000, caller: 'marketRadar' }),
      cache.getOrFetch('oi', 'binance:ETHUSDT', fetcher, { ttlMs: 60000, caller: 'marketRadar' }),
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(fetchCount).toBe(1);
  });

  // Multi-exchange
  test('getAll returns all entries for a type', () => {
    cache.set('ticker', 'binance:BTCUSDT', { price: 1 }, { caller: 'marketRadar' });
    cache.set('ticker', 'binance:ETHUSDT', { price: 2 }, { caller: 'marketRadar' });
    cache.set('ticker', 'bybit:BTCUSDT', { price: 3 }, { caller: 'marketRadar' });
    const all = cache.getAll('ticker');
    expect(Object.keys(all).length).toBe(3);
  });

  test('multi-exchange keys are independent', () => {
    cache.set('oi', 'binance:BTCUSDT', 100, { caller: 'marketRadar' });
    cache.set('oi', 'bybit:BTCUSDT', 200, { caller: 'marketRadar' });
    expect(cache.get('oi', 'binance:BTCUSDT')).toBe(100);
    expect(cache.get('oi', 'bybit:BTCUSDT')).toBe(200);
  });

  // OWNERSHIP ENFORCEMENT
  test('rejects write from wrong owner', () => {
    const ok = cache.set('ticker', 'binance:BTCUSDT', { price: 77000 }, { caller: 'serverSentiment' });
    expect(ok).toBe(false);
    expect(cache.get('ticker', 'binance:BTCUSDT')).toBeNull();
  });

  test('accepts write from correct owner', () => {
    const ok = cache.set('funding', 'binance:BTCUSDT', { rate: 0.0001 }, { caller: 'marketRadar' });
    expect(ok).toBe(true);
    expect(cache.get('funding', 'binance:BTCUSDT')).not.toBeNull();
  });

  test('sentiment rejects write from marketRadar', () => {
    const ok = cache.set('sentiment', 'binance:BTCUSDT', { ls: 1.2 }, { caller: 'marketRadar' });
    expect(ok).toBe(false);
  });

  test('sentiment accepts write from serverSentiment', () => {
    const ok = cache.set('sentiment', 'binance:BTCUSDT', { ls: 1.2 }, { caller: 'serverSentiment' });
    expect(ok).toBe(true);
  });

  // SCHEMA VALIDATION
  test('rejects ticker without price', () => {
    const ok = cache.set('ticker', 'binance:BTCUSDT', { volume: 1000 }, { caller: 'marketRadar' });
    expect(ok).toBe(false);
  });

  test('rejects ticker with price <= 0', () => {
    const ok = cache.set('ticker', 'binance:BTCUSDT', { price: -5 }, { caller: 'marketRadar' });
    expect(ok).toBe(false);
  });

  test('rejects OI with negative value', () => {
    const ok = cache.set('oi', 'binance:BTCUSDT', -100, { caller: 'marketRadar' });
    expect(ok).toBe(false);
  });

  test('rejects funding without rate field', () => {
    const ok = cache.set('funding', 'binance:BTCUSDT', { markPrice: 77000 }, { caller: 'marketRadar' });
    expect(ok).toBe(false);
  });

  test('rejects depth without bids/asks arrays', () => {
    const ok = cache.set('depth', 'binance:BTCUSDT', { price: 77000 }, { caller: 'serverLiquidity' });
    expect(ok).toBe(false);
  });

  // Stats
  test('stats tracks hits, misses, and rejections', () => {
    cache.set('ticker', 'binance:X', { price: 1 }, { caller: 'marketRadar' });
    cache.get('ticker', 'binance:X'); // hit
    cache.get('ticker', 'binance:Y'); // miss
    cache.set('ticker', 'binance:Z', { bad: true }, { caller: 'marketRadar' }); // rejected (schema)
    cache.set('oi', 'binance:Z', 100, { caller: 'serverSentiment' }); // rejected (ownership)
    const stats = cache.getStats();
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(stats.misses).toBeGreaterThanOrEqual(1);
    expect(stats.rejected).toBeGreaterThanOrEqual(2);
  });

  // Freshness
  test('getFreshness returns age and stale status', () => {
    cache.set('oi', 'binance:BTCUSDT', 50000, { caller: 'marketRadar' });
    const f = cache.getFreshness('oi', 'binance:BTCUSDT');
    expect(f).not.toBeNull();
    expect(f.ageMs).toBeLessThan(100);
    expect(f.stale).toBe(false);
  });
});
