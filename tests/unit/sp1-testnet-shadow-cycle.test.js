'use strict';

// [2026-10-09] Parity-row writes are gated on PARITY_SHADOW_ENABLED, which is ON
// in the operator's deployment but ships OFF. These tests passed only because the
// test process was reading his live data/migration_flags.json; flags are isolated
// under test now (a run was rewriting that file), so the premise is declared here.
jest.mock('../../server/migrationFlags', () => {
    const actual = jest.requireActual('../../server/migrationFlags');
    const ON = new Set(['PARITY_SHADOW_ENABLED', 'SERVER_AT_TESTNET', 'SERVER_BRAIN_DEMO']);
    return new Proxy(actual, { get: (t, p) => (ON.has(p) ? true : t[p]) });
});

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

  // [2026-10-16] These tests are about the SCOPE (demo + testnet-live, REAL
  // excluded). A second, orthogonal condition was added since: the server only
  // emits for users who have produced a client parity row recently, because
  // the others cannot pair. That filter correctly made every assertion here
  // return an empty set — the tests caught a real behaviour change, which is
  // the system working. Neutralised to 'unknown' (permissive) so these keep
  // testing the one thing they are about; the activity filter has its own
  // suite in parity-scope-active-users.test.js.
  beforeEach(() => { brain.__sp1.setActiveParityUsersForTest(null); });

  afterEach(() => { brain.__sp1.setMainCycleActiveForTest(null); });

  // [2026-10-14] This test used to assert demo users were EXCLUDED. That scope
  // was deliberately widened, so the expectation is updated rather than deleted.
  //
  // Why: the parity harness is the evidence gate for SERVER_BRAIN/SERVER_AT, and
  // it could not be fed. brain_parity_log held 1148 client rows for uid 1, still
  // growing, against 7 server rows from a single second on 2026-10-10. The
  // general writer _runShadowCycle sits on the ELSE of _shouldRunMainCycle()
  // (SERVER_BRAIN || SERVER_BRAIN_DEMO) and the demo carve-out is ON, so it is
  // never scheduled; this cycle was the only compensation and it was scoped to
  // testnet-live users, which the operator is not — he trades demo. So no
  // evidence could ever accumulate.
  //
  // What this test still protects, and what matters, is unchanged: the cycle is
  // SCOPED (it does not write for everyone) and REAL-money users stay out.
  test('writes server rows for demo AND testnet-live users — the parity scope', () => {
    const seen = [];
    jest.spyOn(db, 'logParityRow').mockImplementation((uid, sym, src) => seen.push([uid, src]));
    brain.__sp1.setMainCycleActiveForTest(true); // demo main cycle active
    brain.__sp1.runTestnetShadowCycle();
    expect(seen.map(r => r[0]).sort()).toEqual([1, 2]);
    expect(seen.every(r => r[1] === 'server')).toBe(true);
  });

  test('a REAL-money user is still excluded from shadow rows', () => {
    const seen = [];
    jest.spyOn(db, 'logParityRow').mockImplementation((uid, sym, src) => seen.push([uid, src]));
    // uid 1 live on REAL, uid 2 demo → only the demo user may appear.
    serverAT.getMode.mockImplementation(uid => (uid === 1 ? 'live' : 'demo'));
    serverAT._resolveExecutionEnv.mockReturnValue({ env: 'REAL' });
    brain.__sp1.setMainCycleActiveForTest(true);
    brain.__sp1.runTestnetShadowCycle();
    expect(seen.map(r => r[0])).toEqual([2]);
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
