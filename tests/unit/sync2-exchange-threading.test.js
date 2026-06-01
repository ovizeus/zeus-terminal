const serverAT = require('../../server/services/serverAT');
const resolve = serverAT.__sync2.resolveEntryExchange;

describe('[SYNC-2] _resolveEntryExchange — live position carries its own exchange', () => {
  test('no exchange on entry → take it from creds (Bybit live → bybit, not binance default)', () => {
    expect(resolve({ symbol: 'BTCUSDT' }, { exchange: 'bybit', apiKey: 'x' })).toBe('bybit');
  });

  test('binance creds → binance', () => {
    expect(resolve({}, { exchange: 'binance', apiKey: 'x' })).toBe('binance');
  });

  test('entry already has an exchange → keep it (do not override)', () => {
    expect(resolve({ exchange: 'bybit' }, { exchange: 'binance', apiKey: 'x' })).toBe('bybit');
  });

  test('no creds / demo → null (not silently binance)', () => {
    expect(resolve({}, null)).toBe(null);
    expect(resolve({}, { apiKey: 'x' })).toBe(null);
  });
});
