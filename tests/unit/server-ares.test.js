'use strict';
// [SERVER-ARES 2026-06-07] serverAres orchestration — state seed/migration,
// gating, GO dispatch through serverAT, reservation release on refusal,
// close-hook wallet accounting. All I/O mocked (lesson: mocks MUST mirror
// the real module shape — db.getAresState/saveAresState are MODULE exports).

const _dbStore = new Map();
jest.mock('../../server/services/database', () => ({
    getAresState: (uid) => (_dbStore.has(uid) ? JSON.parse(JSON.stringify(_dbStore.get(uid))) : null),
    saveAresState: (uid, data) => { _dbStore.set(uid, JSON.parse(JSON.stringify(data))); },
    auditLog: () => {},
}));

const _atMock = {
    serverFullyOwnsEntries: jest.fn(() => true),
    getOpenPositions: jest.fn(() => []),
    processBrainDecision: jest.fn(() => ({ seq: 4242 })),
    isKillActive: jest.fn(() => false),
    resolveExecutionEnv: jest.fn(() => ({ env: 'TESTNET' })),
    toggleActive: jest.fn(() => ({ ok: true })), // setAresActive(true) forces AT off via this
};
jest.mock('../../server/services/serverAT', () => _atMock);

const _flags = { SERVER_ARES: true };
jest.mock('../../server/migrationFlags', () => ({
    get SERVER_ARES() { return _flags.SERVER_ARES; },
}));

jest.mock('../../server/services/audit', () => ({ record: () => {} }));

const serverAres = require('../../server/services/serverAres');

// Market context where every rule gate passes (NY session enforced via mocked hour
// is impossible — evaluateAres reads real clock hour; instead we pin Date).
const GO_MCTX = {
    price: 62000, priceTs: 1,
    regime: { regime: 'TREND_UP', confidence: 75, trendBias: 'bullish' },
    confluenceScore: 80,
    atrPct: 1.2,
    killActive: false,
};

// Pin UTC 14:00 (NEW YORK window) — evaluateAres derives session from Date.now().
const NY_TS = Date.UTC(2026, 5, 7, 14, 0, 0);
let _nowSpy;
beforeAll(() => { _nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NY_TS); });
afterAll(() => { _nowSpy.mockRestore(); });

beforeEach(() => {
    _dbStore.clear();
    _flags.SERVER_ARES = true;
    _atMock.serverFullyOwnsEntries.mockReturnValue(true);
    _atMock.getOpenPositions.mockReturnValue([]);
    _atMock.processBrainDecision.mockClear();
    _atMock.processBrainDecision.mockReturnValue({ seq: 4242 });
    _atMock.resolveExecutionEnv.mockReturnValue({ env: 'TESTNET' });
    serverAres._resetRealBalanceForTest();
});

describe('REAL exchange balance sizing', () => {
    // CLEAN engine (would trade) + opt-in; vary the cached real exchange balance.
    const _seed = () => _dbStore.set(1, {
        wallet: { balance: 0, locked: 0, realizedPnL: 0, fundedTotal: 0 }, // virtual wallet EMPTY on real
        engine: { tradeHistory: [], consecutiveLoss: 0, consecutiveWin: 0, lastLossTs: 0, lastTradeTs: 0, winRate10: 0, totalTrades: 0, totalWins: 0, totalLosses: 0 },
        mission: { startBalance: 1000, startTs: NY_TS - 86400000 },
        lastDecision: null, realOptIn: true, killSwitch: false, aresActive: true,
        dailyLoss: { day: null, lossUsd: 0, startBalance: 0 },
    });

    test('REAL: sizes off the live exchange balance even with an EMPTY virtual wallet', () => {
        _seed();
        serverAres._setRealBalanceForTest(1, 1000); // $1000 real on the exchange
        _atMock.resolveExecutionEnv.mockReturnValue({ env: 'REAL' });
        const entry = serverAres.tick(1, GO_MCTX);
        expect(entry).not.toBeNull();
        const stc = _atMock.processBrainDecision.mock.calls[0][1];
        expect(stc.size).toBe(20);  // 2% of the REAL $1000 (not the empty virtual wallet)
        expect(stc.lev).toBeLessThanOrEqual(5);
    });

    test('REAL: fail-closed when the exchange balance is not known yet (no trade)', () => {
        _seed(); // no _setRealBalanceForTest → cache empty → realAvail 0
        _atMock.resolveExecutionEnv.mockReturnValue({ env: 'REAL' });
        expect(serverAres.tick(1, GO_MCTX)).toBeNull();
        expect(_atMock.processBrainDecision).not.toHaveBeenCalled();
    });

    test('REAL: small $50 account still places a viable floored trade', () => {
        _seed();
        serverAres._setRealBalanceForTest(1, 50);
        _atMock.resolveExecutionEnv.mockReturnValue({ env: 'REAL' });
        const entry = serverAres.tick(1, GO_MCTX);
        expect(entry).not.toBeNull();
        const stc = _atMock.processBrainDecision.mock.calls[0][1];
        expect(stc.size).toBe(5);   // floored to min-notional (2% of $50 = $1 → $5, ≤ 25% ceiling)
    });

    test('TESTNET still uses the virtual wallet (real balance ignored)', () => {
        _dbStore.set(1, { balance: 655, locked: 0, realizedPnL: 0, fundedTotal: 46905 });
        serverAres.setAresActive(1, true);
        serverAres._setRealBalanceForTest(1, 999999); // should be ignored on testnet
        _atMock.resolveExecutionEnv.mockReturnValue({ env: 'TESTNET' });
        const entry = serverAres.tick(1, GO_MCTX);
        expect(entry).not.toBeNull();
        const stc = _atMock.processBrainDecision.mock.calls[0][1];
        expect(stc.size).toBeCloseTo(655 * 0.12, 1); // virtual $655 tier, NOT the real balance
    });
});

describe('REAL-money consent gate (fail-closed)', () => {
    const _fund = () => { _dbStore.set(1, { balance: 655, locked: 0, realizedPnL: 0, fundedTotal: 46905 }); serverAres.setAresActive(1, true); };

    test('REAL env without opt-in BLOCKS the entry', () => {
        _fund();
        _atMock.resolveExecutionEnv.mockReturnValue({ env: 'REAL' });
        expect(serverAres.tick(1, GO_MCTX)).toBeNull();
        expect(_atMock.processBrainDecision).not.toHaveBeenCalled();
    });

    test('REAL env WITH explicit opt-in dispatches', () => {
        _fund();
        _atMock.resolveExecutionEnv.mockReturnValue({ env: 'REAL' });
        serverAres._setRealBalanceForTest(1, 1000); // real exchange balance known
        expect(serverAres.setRealOptIn(1, true)).toBe(true); // loads funded state, preserves balance
        const entry = serverAres.tick(1, GO_MCTX);
        expect(entry).not.toBeNull();
        expect(_atMock.processBrainDecision).toHaveBeenCalledTimes(1);
    });

    test('TESTNET dispatches without opt-in (consent only gates REAL)', () => {
        _fund();
        _atMock.resolveExecutionEnv.mockReturnValue({ env: 'TESTNET' });
        expect(serverAres.tick(1, GO_MCTX)).not.toBeNull();
        expect(_atMock.processBrainDecision).toHaveBeenCalledTimes(1);
    });

    test('setRealOptIn / getRealOptIn roundtrip + revoke', () => {
        expect(serverAres.getRealOptIn(1)).toBe(false); // default fail-closed
        serverAres.setRealOptIn(1, true);
        expect(serverAres.getRealOptIn(1)).toBe(true);
        serverAres.setRealOptIn(1, false);
        expect(serverAres.getRealOptIn(1)).toBe(false);
    });
});

describe('ARES active toggle + mutual exclusion with AT', () => {
    test('ARES does NOT trade when aresActive is off (default)', () => {
        _dbStore.set(1, { balance: 655, locked: 0, realizedPnL: 0, fundedTotal: 46905 }); // aresActive defaults false
        expect(serverAres.getAresActive(1)).toBe(false);
        expect(serverAres.tick(1, GO_MCTX)).toBeNull();
        expect(_atMock.processBrainDecision).not.toHaveBeenCalled();
    });

    test('activating ARES forces AT off (both modes) and flips aresActive', () => {
        _dbStore.set(1, { balance: 655, locked: 0, realizedPnL: 0, fundedTotal: 46905 });
        const v = serverAres.setAresActive(1, true);
        expect(v).toBe(true);
        expect(serverAres.getAresActive(1)).toBe(true);
        // AT forced off for BOTH modes
        const modes = _atMock.toggleActive.mock.calls.map(c => [c[1], c[2]]);
        expect(modes).toContainEqual([false, 'demo']);
        expect(modes).toContainEqual([false, 'live']);
    });

    test('ARES trades once activated; deactivating stops it', () => {
        _dbStore.set(1, { balance: 655, locked: 0, realizedPnL: 0, fundedTotal: 46905 });
        serverAres.setAresActive(1, true);
        expect(serverAres.tick(1, GO_MCTX)).not.toBeNull();
        serverAres.setAresActive(1, false);
        _atMock.processBrainDecision.mockClear();
        expect(serverAres.tick(1, GO_MCTX)).toBeNull(); // off → no trade
    });
});

describe('hardening — stale balance + withdraw race', () => {
    test('fresh real balance is not flagged stale; very old balance IS stale', () => {
        serverAres._setRealBalanceForTest(1, 500, 0);          // just now
        expect(serverAres._realBalanceMetaForTest(1).stale).toBe(false);
        serverAres._setRealBalanceForTest(1, 500, 5 * 60 * 1000); // 5 min old (> 2× 45s TTL)
        const meta = serverAres._realBalanceMetaForTest(1);
        expect(meta.stale).toBe(true);
        expect(meta.avail).toBe(500); // still used (fail-safe), just flagged
    });

    test('withdraw is refused while an ARES entry is in flight', () => {
        _dbStore.set(1, { balance: 500, locked: 0, realizedPnL: 0, fundedTotal: 500 });
        serverAres._setEntryInFlightForTest(1, true);
        const r = serverAres.withdraw(1, 50);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/in progress/i);
        serverAres._setEntryInFlightForTest(1, false);
        const r2 = serverAres.withdraw(1, 50); // now allowed
        expect(r2.ok).toBe(true);
    });
});

describe('persistent kill-switch', () => {
    test('killSwitch=true blocks tick in any env (survives via state blob)', () => {
        _dbStore.set(1, { balance: 655, locked: 0, realizedPnL: 0, fundedTotal: 46905 });
        serverAres.setAresActive(1, true);
        serverAres.setKillSwitch(1, true);
        expect(serverAres.getKillSwitch(1)).toBe(true);
        expect(serverAres.tick(1, GO_MCTX)).toBeNull();
        expect(_atMock.processBrainDecision).not.toHaveBeenCalled();
        // re-enable → dispatches again (testnet)
        serverAres.setKillSwitch(1, false);
        expect(serverAres.tick(1, GO_MCTX)).not.toBeNull();
    });
});

describe('daily-loss circuit breaker (REAL only)', () => {
    const _today = new Date(NY_TS).toISOString().slice(0, 10);
    // Full-shape state with a CLEAN engine (empty history → neutral confidence → would trade),
    // so the test isolates the daily-loss gate from engine-state side effects.
    const _seed = (lossUsd) => _dbStore.set(1, {
        wallet: { balance: 1000, locked: 0, realizedPnL: 0, fundedTotal: 1000 },
        engine: { tradeHistory: [], consecutiveLoss: 0, consecutiveWin: 0, lastLossTs: 0, lastTradeTs: 0, winRate10: 0, totalTrades: 0, totalWins: 0, totalLosses: 0 },
        mission: { startBalance: 1000, startTs: NY_TS - 86400000 },
        lastDecision: null,
        realOptIn: true,
        aresActive: true,
        dailyLoss: { day: _today, lossUsd, startBalance: 1000 }, // cap = 1000×6% = $60
        killSwitch: false,
    });

    test('REAL entry paused once day loss ≥ cap; testnet unaffected', () => {
        _seed(200); // $200 ≥ $60 cap
        serverAres._setRealBalanceForTest(1, 1000); // real balance known → reaches the daily-loss gate
        _atMock.resolveExecutionEnv.mockReturnValue({ env: 'REAL' });
        expect(serverAres.tick(1, GO_MCTX)).toBeNull();
        expect(_atMock.processBrainDecision).not.toHaveBeenCalled();
        // Same state on TESTNET → NOT paused (breaker only gates REAL).
        _atMock.resolveExecutionEnv.mockReturnValue({ env: 'TESTNET' });
        expect(serverAres.tick(1, GO_MCTX)).not.toBeNull();
    });

    test('small loss under cap does NOT pause REAL', () => {
        _seed(10); // $10 < $60 cap
        serverAres._setRealBalanceForTest(1, 1000); // real balance known
        _atMock.resolveExecutionEnv.mockReturnValue({ env: 'REAL' });
        expect(serverAres.tick(1, GO_MCTX)).not.toBeNull();
    });

    test('onPositionClosed accrues the day loss (close hook null-safe with no lastDecision)', () => {
        _dbStore.set(1, { balance: 1000, locked: 0, realizedPnL: 0, fundedTotal: 1000 });
        serverAres.onPositionClosed({ owner: 'ARES', userId: 1, seq: 9, closePnl: -50, size: 0, lev: 0, margin: 0 });
        const st = serverAres._loadStateForTest(1);
        expect(st.dailyLoss.lossUsd).toBeCloseTo(50, 2); // recorded despite null lastDecision
    });
});

describe('state seed/migration', () => {
    test('legacy flat client snapshot migrates into wallet shape (operator $655 preserved)', () => {
        _dbStore.set(1, { balance: 655, locked: 0, available: 655, realizedPnL: 0, fundedTotal: 46905, stageName: 'SEED' });
        const pub = serverAres.getPublicState(1);
        expect(pub.wallet.balance).toBe(655);
        expect(pub.wallet.fundedTotal).toBe(46905);
        expect(pub.serverSide).toBe(true);
    });
    test('missing row → defaults (zero wallet, no crash)', () => {
        const pub = serverAres.getPublicState(99);
        expect(pub.wallet.balance).toBe(0);
    });
});

describe('tick gating (fail-closed)', () => {
    test('flag OFF → no evaluation, no dispatch', () => {
        _flags.SERVER_ARES = false;
        _dbStore.set(1, { balance: 655, locked: 0, realizedPnL: 0, fundedTotal: 0 });
        expect(serverAres.tick(1, GO_MCTX)).toBeNull();
        expect(_atMock.processBrainDecision).not.toHaveBeenCalled();
    });
    test('server does NOT fully own entries → no dispatch', () => {
        _atMock.serverFullyOwnsEntries.mockReturnValue(false);
        _dbStore.set(1, { balance: 655, locked: 0, realizedPnL: 0, fundedTotal: 0 });
        expect(serverAres.tick(1, GO_MCTX)).toBeNull();
        expect(_atMock.processBrainDecision).not.toHaveBeenCalled();
    });
    test('bad price → null', () => {
        expect(serverAres.tick(1, { ...GO_MCTX, price: 0 })).toBeNull();
    });
});

describe('GO path — dispatch through serverAT', () => {
    test('reserves stake, dispatches owner=ARES decision, records lastTradeTs', () => {
        _dbStore.set(1, { balance: 655, locked: 0, realizedPnL: 0, fundedTotal: 46905 });
        serverAres.setAresActive(1, true);
        const entry = serverAres.tick(1, GO_MCTX);
        expect(entry).toEqual({ seq: 4242 });
        expect(_atMock.processBrainDecision).toHaveBeenCalledTimes(1);
        const [dec, stc, uid, intent] = _atMock.processBrainDecision.mock.calls[0];
        expect(dec.owner).toBe('ARES');
        expect(dec.symbol).toBe('BTCUSDT');
        expect(dec.fusion.dir).toBe('LONG');           // TREND_UP forces LONG
        expect(uid).toBe(1);
        expect(stc.lev).toBeGreaterThanOrEqual(5);
        expect(stc.lev).toBeLessThanOrEqual(20);
        expect(intent).toBeCloseTo(655 * 0.12, 1);      // $655 tier (300..1000) = 12% stake
        const st = _dbStore.get(1);
        expect(st.wallet.locked).toBeCloseTo(intent, 2); // reservation held
        expect(st.engine.lastTradeTs).toBe(NY_TS);
        // 2nd tick within cooldown → blocked (no second dispatch)
        const second = serverAres.tick(1, GO_MCTX);
        expect(second).toBeNull();
        expect(_atMock.processBrainDecision).toHaveBeenCalledTimes(1);
    });
    test('entry refused by serverAT → reservation released', () => {
        _atMock.processBrainDecision.mockReturnValue(null);
        _dbStore.set(1, { balance: 655, locked: 0, realizedPnL: 0, fundedTotal: 0 });
        serverAres.setAresActive(1, true);
        expect(serverAres.tick(1, GO_MCTX)).toBeNull();
        expect(_dbStore.get(1).wallet.locked).toBe(0);
    });
    test('open ARES position blocks a second entry (MAX_OPEN=1)', () => {
        _atMock.getOpenPositions.mockReturnValue([{ owner: 'ARES', symbol: 'BTCUSDT' }]);
        _dbStore.set(1, { balance: 655, locked: 78.6, realizedPnL: 0, fundedTotal: 0 });
        serverAres.setAresActive(1, true);
        expect(serverAres.tick(1, GO_MCTX)).toBeNull();
        expect(_atMock.processBrainDecision).not.toHaveBeenCalled();
    });
    test('AT-owned open positions do NOT block ARES (separate slot)', () => {
        _atMock.getOpenPositions.mockReturnValue([{ owner: 'AT', symbol: 'ETHUSDT' }, { owner: 'AT', symbol: 'BTCUSDT' }]);
        _dbStore.set(1, { balance: 655, locked: 0, realizedPnL: 0, fundedTotal: 0 });
        serverAres.setAresActive(1, true);
        const entry = serverAres.tick(1, GO_MCTX);
        expect(entry).toEqual({ seq: 4242 });
        // maxPos passed to serverAT covers existing AT positions + the ARES slot
        const stc = _atMock.processBrainDecision.mock.calls[0][1];
        expect(stc.maxPos).toBe(3);
    });
});

describe('onPositionClosed — wallet accounting', () => {
    test('win: releases stake, applies net PnL (gross − taker fees ×2), streak updates', () => {
        _dbStore.set(1, {
            wallet: { balance: 576.4, locked: 78.6, realizedPnL: 0, fundedTotal: 46905 },
            engine: { tradeHistory: [], consecutiveLoss: 0, consecutiveWin: 0, lastLossTs: 0, lastTradeTs: 0, winRate10: 0, totalTrades: 0, totalWins: 0, totalLosses: 0 },
            mission: { startBalance: 655, startTs: NY_TS },
            lastDecision: { executedSeq: 4242, stake: 78.6 },
        });
        serverAres.onPositionClosed({ owner: 'ARES', userId: 1, seq: 4242, closePnl: 20, size: 78.6, lev: 10, margin: 78.6 });
        const st = _dbStore.get(1);
        const fees = 78.6 * 10 * 0.00055 * 2;
        expect(st.wallet.locked).toBe(0);
        expect(st.wallet.balance).toBeCloseTo(576.4 + 20 - fees, 6);
        expect(st.engine.consecutiveWin).toBe(1);
        expect(st.engine.totalTrades).toBe(1);
        expect(st.engine.winRate10).toBe(100);
    });
    test('loss: streak + lastLossTs set', () => {
        _dbStore.set(1, {
            wallet: { balance: 600, locked: 50, realizedPnL: 0, fundedTotal: 0 },
            engine: { tradeHistory: [], consecutiveLoss: 0, consecutiveWin: 2, lastLossTs: 0, lastTradeTs: 0, winRate10: 100, totalTrades: 2, totalWins: 2, totalLosses: 0 },
            mission: { startBalance: 655, startTs: NY_TS },
            lastDecision: { executedSeq: 7, stake: 50 },
        });
        serverAres.onPositionClosed({ owner: 'ARES', userId: 1, seq: 7, closePnl: -15, size: 50, lev: 8, margin: 50 });
        const st = _dbStore.get(1);
        expect(st.engine.consecutiveLoss).toBe(1);
        expect(st.engine.consecutiveWin).toBe(0);
        expect(st.engine.lastLossTs).toBe(NY_TS);
    });
    test('non-ARES position ignored', () => {
        _dbStore.set(1, { wallet: { balance: 100, locked: 0, realizedPnL: 0, fundedTotal: 0 }, engine: { tradeHistory: [], consecutiveLoss: 0, consecutiveWin: 0, lastLossTs: 0, lastTradeTs: 0, winRate10: 0, totalTrades: 0, totalWins: 0, totalLosses: 0 }, mission: {}, lastDecision: null });
        serverAres.onPositionClosed({ owner: 'AT', userId: 1, seq: 1, closePnl: 99, size: 10, lev: 5 });
        expect(_dbStore.get(1).wallet.balance).toBe(100);
    });
});

describe('fund / withdraw', () => {
    test('fund adds balance + fundedTotal; withdraw blocked while locked/open', () => {
        expect(serverAres.fund(1, 100).ok).toBe(true);
        expect(serverAres.fund(1, -5).ok).toBe(false);
        let st = _dbStore.get(1);
        expect(st.wallet.balance).toBe(100);
        expect(st.wallet.fundedTotal).toBe(100);
        st.wallet.locked = 10; _dbStore.set(1, st);
        expect(serverAres.withdraw(1, 50).ok).toBe(false);
        st.wallet.locked = 0; _dbStore.set(1, st);
        _atMock.getOpenPositions.mockReturnValue([{ owner: 'ARES' }]);
        expect(serverAres.withdraw(1, 50).ok).toBe(false);
        _atMock.getOpenPositions.mockReturnValue([]);
        expect(serverAres.withdraw(1, 50).ok).toBe(true);
        expect(serverAres.withdraw(1, 5000).ok).toBe(false);
        expect(_dbStore.get(1).wallet.balance).toBe(50);
    });
});
