describe('SP1 _runTestnetShadowCycle', () => {
  let brain, serverState, serverAT, db;
  beforeEach(() => {
    jest.resetModules();
    serverState = require('../../server/services/serverState');
    serverAT = require('../../server/services/serverAT');
    db = require('../../server/services/database');
    brain = require('../../server/services/serverBrain');

    jest.spyOn(serverState, 'getReadySymbols').mockReturnValue(['BTCUSDT']);
    jest.spyOn(serverState, 'getSnapshotForSymbol').mockReturnValue({
      symbol: 'BTCUSDT', price: 50000, priceTs: Date.now(), stale: false,
      indicators: { regime: 'RANGE', stDir: 'bull' }, rsi: { '5m': 55 },
      fr: -0.001, oi: 100, oiPrev: 90,
    });
    jest.spyOn(serverState, 'getBarsForSymbol').mockReturnValue([]);
    brain.__sp1.setStcForTest(1, { symbols: ['BTCUSDT'] }); // testnet-live
    brain.__sp1.setStcForTest(2, { symbols: ['BTCUSDT'] }); // demo
    jest.spyOn(serverAT, 'getMode').mockImplementation(uid => uid === 1 ? 'live' : 'demo');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'TESTNET' });
  });

  afterEach(() => { brain.__sp1.setMainCycleActiveForTest(null); });

  test('writes server rows ONLY for testnet-live users (uid=1), not demo (uid=2)', () => {
    const seen = [];
    jest.spyOn(db, 'logParityRow').mockImplementation((uid, sym, src) => seen.push([uid, src]));
    brain.__sp1.setMainCycleActiveForTest(true); // demo main cycle active
    brain.__sp1.runTestnetShadowCycle();
    expect(seen).toEqual([[1, 'server']]);
  });

  test('is a no-op when the main cycle is NOT active (regular shadow covers it)', () => {
    const spy = jest.spyOn(db, 'logParityRow');
    brain.__sp1.setMainCycleActiveForTest(false);
    brain.__sp1.runTestnetShadowCycle();
    expect(spy).not.toHaveBeenCalled();
  });

  test('never calls execution / telegram side-effects', () => {
    const exec = jest.spyOn(serverAT, 'processBrainDecision').mockImplementation(() => {});
    jest.spyOn(db, 'logParityRow').mockImplementation(() => {});
    brain.__sp1.setMainCycleActiveForTest(true);
    brain.__sp1.runTestnetShadowCycle();
    expect(exec).not.toHaveBeenCalled();
  });
});
