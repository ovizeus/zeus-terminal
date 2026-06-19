const { _buildKlinesUrl, _klinesCacheKeyParams, _klinesTtl, FUTURES_BASE } = require('../../../../server/routes/marketProxy');

describe('_buildKlinesUrl', () => {
  it('builds the standard URL without endTime (byte-identical to today)', () => {
    const url = _buildKlinesUrl('BTCUSDT', '1h', 1000, undefined);
    expect(url).toBe(`${FUTURES_BASE}/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=1000`);
  });
  it('appends endTime when present', () => {
    const url = _buildKlinesUrl('ETHUSDT', '5m', 1000, 1699999999999);
    expect(url).toBe(`${FUTURES_BASE}/fapi/v1/klines?symbol=ETHUSDT&interval=5m&limit=1000&endTime=1699999999999`);
  });
  it('ignores a non-positive / non-numeric endTime', () => {
    expect(_buildKlinesUrl('BTCUSDT', '1h', 500, 0)).not.toContain('endTime');
    expect(_buildKlinesUrl('BTCUSDT', '1h', 500, -5)).not.toContain('endTime');
    expect(_buildKlinesUrl('BTCUSDT', '1h', 500, NaN)).not.toContain('endTime');
  });
});

describe('_klinesCacheKeyParams', () => {
  it('omits endTime when absent (same key as today)', () => {
    expect(_klinesCacheKeyParams('BTCUSDT', '1h', 1000, undefined)).toEqual({ symbol: 'BTCUSDT', interval: '1h', limit: 1000 });
  });
  it('includes endTime when present (distinct cache windows)', () => {
    expect(_klinesCacheKeyParams('BTCUSDT', '1h', 1000, 123)).toEqual({ symbol: 'BTCUSDT', interval: '1h', limit: 1000, endTime: 123 });
  });
});

describe('_klinesTtl', () => {
  it('uses the short poll TTL for tiny live polls', () => {
    expect(_klinesTtl(1, undefined)).toBe(10000);
  });
  it('uses the long historical TTL when endTime is present (immutable closed window)', () => {
    expect(_klinesTtl(1000, 123)).toBe(3600000);
  });
  it('uses the init TTL for a normal initial fetch', () => {
    expect(_klinesTtl(1000, undefined)).toBe(60000);
  });
});
