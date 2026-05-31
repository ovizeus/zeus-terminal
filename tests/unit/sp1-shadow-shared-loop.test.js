describe('SP1 _runShadowForUsers (shared loop)', () => {
  let brain, serverState, db;
  beforeEach(() => {
    jest.resetModules();
    serverState = require('../../server/services/serverState');
    db = require('../../server/services/database');
    brain = require('../../server/services/serverBrain');

    jest.spyOn(serverState, 'getReadySymbols').mockReturnValue(['BTCUSDT']);
    jest.spyOn(serverState, 'getSnapshotForSymbol').mockReturnValue({
      symbol: 'BTCUSDT', price: 50000, priceTs: Date.now(), stale: false,
      indicators: { regime: 'RANGE', stDir: 'bull' }, rsi: { '5m': 55 },
      fr: -0.001, oi: 100, oiPrev: 90,
    });
    jest.spyOn(serverState, 'getBarsForSymbol').mockReturnValue([]);
  });

  test('logs a server parity row for every included user', () => {
    const seen = [];
    jest.spyOn(db, 'logParityRow').mockImplementation((uid, sym, src) => seen.push([uid, sym, src]));
    brain.__sp1.setStcForTest(1, { symbols: ['BTCUSDT'] });
    brain.__sp1.setStcForTest(2, { symbols: ['BTCUSDT'] });

    brain.__sp1.runShadowForUsers(uid => uid === 1); // include only uid=1

    expect(seen).toEqual([[1, 'BTCUSDT', 'server']]);
  });

  test('skips a symbol the user has not subscribed to', () => {
    const seen = [];
    jest.spyOn(db, 'logParityRow').mockImplementation((uid, sym) => seen.push([uid, sym]));
    brain.__sp1.setStcForTest(1, { symbols: ['ETHUSDT'] }); // not BTCUSDT
    brain.__sp1.runShadowForUsers(null);
    expect(seen).toEqual([]);
  });
});
