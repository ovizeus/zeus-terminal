const { _parsePremiumIndex } = require('../../../../server/services/markPriceCache');

describe('_parsePremiumIndex', () => {
  it('builds { SYM: markPrice } from the Binance premiumIndex array (uppercased)', () => {
    const r = _parsePremiumIndex([
      { symbol: 'BTCUSDT', markPrice: '63500.5' },
      { symbol: 'ethusdt', markPrice: '1740.2' },
    ]);
    expect(r.BTCUSDT).toBe(63500.5);
    expect(r.ETHUSDT).toBe(1740.2);
  });
  it('skips invalid / non-positive markPrices and missing symbols', () => {
    const r = _parsePremiumIndex([
      { symbol: 'X', markPrice: '0' },
      { symbol: 'Y', markPrice: 'zzz' },
      { markPrice: '5' },
      { symbol: 'Z', markPrice: '12.3' },
    ]);
    expect(r).toEqual({ Z: 12.3 });
  });
  it('returns {} for non-array input', () => {
    expect(_parsePremiumIndex(null)).toEqual({});
    expect(_parsePremiumIndex(undefined)).toEqual({});
    expect(_parsePremiumIndex({})).toEqual({});
  });
});
