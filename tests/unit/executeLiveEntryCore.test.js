/**
 * Zeus Terminal — Unit Tests: _executeLiveEntryCore (M1.1 Cat B)
 *
 * TDD failing-first per `_review/audit/TEST_SCAFFOLDING_M1_20260510.md` §4.
 *
 * Function being tested: `_executeLiveEntryCore(entry, stc, creds)`
 *   Core safety machinery (entry order + safety SL + real SL retry + TP retry +
 *   emergency close) extracted DIN current `_executeLiveEntry(entry, stc)` la M1.2.
 *   Refactor target: reusable pentru BOTH Brain dispatch (Path A) AND
 *   `registerManualPosition` post-unify (Path B → delegates to this core).
 *
 * Status: ALL tests in this file initially FAIL — `_executeLiveEntryCore`
 * doesn't exist yet în serverAT.js. Tests demonstrate target safety contract
 * per ADR-001 Decision 3.1 + hard safety assertions §3.2.
 *
 * Coverage targets (per scaffolding doc §4):
 *   - Happy path (1 test): full atomic SL+TP sequence
 *   - SL retry (3 tests): transient fail recovery, emergency close exhausted, safety SL preserved
 *   - TP retry (2 tests): skip dacă dslParams set, emergency close TP fail
 *   - Fail-fast (3 tests): SafetyAssertionError sl=null+live, missing symbol, post-fill slOrderId null
 *   - Idempotency (1 test): duplicate clientReqId graceful
 *   - Edge cases (2-3 tests): LOCK_BLOCKED concurrent, GLOBAL_HALT pre-execution
 *
 * Total: 13 tests (target band 12-15).
 *
 * Refs:
 * - ADR-001 §3.2 hard safety assertions
 * - TEST_SCAFFOLDING_M1 §4 Cat B spec + §9.1 mock strategy
 * - MILESTONES_M1-M8 §M1 acceptance criteria M1.5
 * - SYSTEMATIC_SAFETY_AUDIT_20260510 §3 (1678/1720 no-SL incident root cause)
 */
'use strict';

// ── Mocks (sparse — only what we need for isolated core logic) ──
jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []), run: jest.fn(), get: jest.fn(() => undefined) })) },
    atGetState: jest.fn(() => null),
    atSetState: jest.fn(),
    saveMissedTrade: jest.fn(),
    auditLog: jest.fn(),
    getOpenPositionsForUser: jest.fn(() => []),
    getOpenPositions: jest.fn(() => []),
    getRecentActions: jest.fn(() => []),
    getLastActiveAt: jest.fn(() => null),
    setLastActiveAt: jest.fn(),
    getMaxSeq: jest.fn(() => 0),
    getGhostCandidates: jest.fn(() => []),
    deleteAtPosition: jest.fn(),
    saveAtPosition: jest.fn(),
    moveToClosedAtomic: jest.fn(),
    getRecentClosedForUser: jest.fn(() => []),
    countOpenPositions: jest.fn(() => 0),
    // [2026-10-09] serverAT restore calls db.atGetOpenUserIds(); without it the
    // restore threw, the engine state never initialised, and EVERY entry in this
    // suite returned ENTRY_FAILED — including the happy path. The suite was red
    // because the mock had drifted behind the module, not because entry broke.
    atGetOpenUserIds: jest.fn(() => []),
    atLoadOpenPositions: jest.fn(() => []),
    atGetStateByUser: jest.fn(() => []),
}));

jest.mock('../../server/services/binanceSigner', () => ({
    sendSignedRequest: jest.fn(),
}));

// [2026-10-09] Entry placement goes through the exchange router now, not straight
// to the signer. Without this mock the real router ran inside the unit test.
jest.mock('../../server/services/exchangeOps', () => ({
    placeEntry: jest.fn(),
    getPositions: jest.fn(async () => []),
    closePosition: jest.fn(),
}));

jest.mock('../../server/services/telegram', () => ({
    sendToUser: jest.fn(),
    alertOrderFilled: jest.fn(),
    notifyUser: jest.fn(),
}));

// Mock Sentry as well — _executeLiveEntry calls Sentry.captureMessage/captureException
jest.mock('@sentry/node', () => ({
    init: jest.fn(),
    captureMessage: jest.fn(),
    captureException: jest.fn(),
    withScope: jest.fn((fn) => fn({ setUser: jest.fn(), setTag: jest.fn(), setExtra: jest.fn() })),
    setUser: jest.fn(),
    setContext: jest.fn(),
}));

// [Fix #3 2026-05-20] Mock credentialStore.getExchangeCreds to allow
// registerManualPosition() to resolve creds for the live path. Pre-fix,
// the call site passed `null` for creds which would silently fail when
// _executeLiveEntryCore tried to sign requests.
const _MOCK_USER_CREDS = {
    apiKey: 'user-mock-key',
    apiSecret: 'user-mock-secret',
    isTestnet: true,
    baseUrl: 'https://testnet.binancefuture.com',
};
jest.mock('../../server/services/credentialStore', () => ({
    getExchangeCreds: jest.fn(() => _MOCK_USER_CREDS),
}));

// ── Import target module ──
const serverAT = require('../../server/services/serverAT.js');
const { sendSignedRequest } = require('../../server/services/binanceSigner.js');
const exchangeOps = require('../../server/services/exchangeOps');
const telegram = require('../../server/services/telegram.js');

// ── Test fixtures ──
function makeValidLiveEntry(overrides = {}) {
    return {
        seq: 12345,
        userId: 1,
        symbol: 'ETHUSDT',
        side: 'LONG',
        mode: 'live',
        entryPrice: 2330,
        qty: 0.5,
        lev: 10,
        sl: 2300,
        tp: 2400,
        size: 50,
        autoTrade: true,
        dslParams: null,
        ts: Date.now(),
        ...overrides,
    };
}

const mockStc = {
    confMin: 65,
    sigMin: 3,
    adxMin: 18,
    maxPos: 5,
    cooldownMs: 60000,
    lev: 10,
    size: 50,
    slPct: 1,
    rr: 1,
    dslMode: 'atr',
    symbols: null,
    engineMode: 'live',
};

const mockCreds = {
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    isTestnet: true,
};

describe('_executeLiveEntryCore (M1.1 Cat B — core safety machinery)', () => {
    beforeEach(() => {
        sendSignedRequest.mockReset();
        telegram.sendToUser.mockReset();
        telegram.notifyUser.mockReset();
        telegram.alertOrderFilled.mockReset();
        exchangeOps.placeEntry.mockReset();
    });

    // [2026-10-09] These blocks used to drive seven sequential sendSignedRequest
    // responses (marginType, leverage, entry, safety SL, real SL, cancel, TP) and
    // assert the atomic sequence from here. That sequence no longer lives here:
    // Task 40 routed entry placement through exchangeOps.placeEntry, which performs
    // the whole safety dance internally. The suite kept mocking binanceSigner, so
    // the real router ran and every test — including the happy path — came back
    // ENTRY_FAILED. That is why they were red, not a regression in entry.
    //
    // The sequence itself is covered where it now lives: binanceOps.test.js has
    // SL retry 3x then emergency close, emergency-close failure plus catastrophic
    // queue insert, and TP failure not blocking ok=true (70 tests, green). What is
    // left for THIS function is the translation it still owns: turning a placeEntry
    // outcome into the position state the rest of the system reads.
    describe('translating the placeEntry outcome into position state', () => {
        it('a filled entry with SL and TP becomes LIVE and carries both order ids', async () => {
            exchangeOps.placeEntry.mockResolvedValueOnce({
                ok: true, orderId: 100, slOrderId: 102, tpOrderId: 104,
                avgFillPrice: '2330', seq: 7,
            });

            const result = await serverAT._executeLiveEntryCore(makeValidLiveEntry(), mockStc, mockCreds);

            expect(result.live.status).toBe('LIVE');
            expect(result.live.slOrderId).toBe(102);
            expect(result.live.tpOrderId).toBe(104);
            expect(result.live.slPlaced).toBe(true);
            expect(result.live.mainOrderId).toBe(100);
        });

        it('a fill the router could not protect is LIVE_NO_SL, not LIVE', async () => {
            // The money-path case: we are on the exchange with no stop behind us.
            exchangeOps.placeEntry.mockResolvedValueOnce({
                ok: true, orderId: 100, slOrderId: null, tpOrderId: null, avgFillPrice: '2330',
            });

            const result = await serverAT._executeLiveEntryCore(makeValidLiveEntry(), mockStc, mockCreds);

            expect(result.live.status).toBe('LIVE_NO_SL');
            expect(result.live.slPlaced).toBe(false);
            expect(result.live.slOrderId).toBeNull();
        });

        it('a rejected entry is ENTRY_FAILED and keeps the error', async () => {
            exchangeOps.placeEntry.mockResolvedValueOnce({
                ok: false, error: { message: 'Margin is insufficient', code: -2019 },
            });

            const result = await serverAT._executeLiveEntryCore(makeValidLiveEntry(), mockStc, mockCreds);

            expect(result.live.status).toBe('ENTRY_FAILED');
            expect(result.live.error).toMatch(/Margin is insufficient/);
            expect(result.live.slOrderId).toBeNull();
        });

        it('a catastrophic result is LIVE_NO_SL and alerts the operator, never ENTRY_FAILED', async () => {
            // Catastrophic means the emergency close itself failed: there IS a
            // position on the exchange, unprotected. Reporting ENTRY_FAILED here
            // would tell the system nothing was opened, which is the dangerous lie.
            exchangeOps.placeEntry.mockResolvedValueOnce({
                ok: false, catastrophic: true, error: { message: 'emergency close failed' },
            });

            const result = await serverAT._executeLiveEntryCore(makeValidLiveEntry(), mockStc, mockCreds);

            expect(result.live.status).toBe('LIVE_NO_SL');
            expect(telegram.sendToUser).toHaveBeenCalledWith(1, expect.stringMatching(/EMERGENCY CLOSE FAILED/));
        });

        it('a router that throws is ENTRY_FAILED, not an unhandled rejection', async () => {
            exchangeOps.placeEntry.mockRejectedValueOnce(new Error('socket hang up'));

            const result = await serverAT._executeLiveEntryCore(makeValidLiveEntry(), mockStc, mockCreds);

            expect(result.live.status).toBe('ENTRY_FAILED');
            expect(result.live.error).toMatch(/socket hang up/);
        });
    });

    describe('fail-fast on safety violations (ADR-001 §3.2)', () => {
        it('throws SafetyAssertionError pre-fill if entry.sl=null with mode=live', async () => {
            const badEntry = makeValidLiveEntry({ sl: null });
            await expect(serverAT._executeLiveEntryCore(badEntry, mockStc, mockCreds))
                .rejects.toThrow(/SafetyAssertionError.*sl.*live/i);
            // No sendSignedRequest should be called — fail-fast before exchange touch
            expect(sendSignedRequest).not.toHaveBeenCalled();
        });

        it('throws if entry.symbol missing', async () => {
            const badEntry = makeValidLiveEntry({ symbol: undefined });
            await expect(serverAT._executeLiveEntryCore(badEntry, mockStc, mockCreds))
                .rejects.toThrow(/symbol/i);
        });

        it('a fill reported with no SL order id never comes back as LIVE', async () => {
            // The router says it filled but hands back no stop id. Whatever else
            // happens, this must not be recorded as a protected position.
            exchangeOps.placeEntry.mockResolvedValueOnce({
                ok: true, orderId: 100, slOrderId: null, avgFillPrice: '2330',
            });

            const result = await serverAT._executeLiveEntryCore(makeValidLiveEntry(), mockStc, mockCreds);

            expect(result.live.status).not.toBe('LIVE');
            expect(result.live.status).toMatch(/EMERGENCY_CLOSED|LIVE_NO_SL/);
        });
    });

    describe('idempotency', () => {
        it('handles entry already în-flight (LOCK_BLOCKED) gracefully', async () => {
            const entry = makeValidLiveEntry();
            // First call sets lock, second call should detect și return LOCK_BLOCKED
            // (în real flow _liveEntryLocks is module-level Set; tests need clean slate)
            sendSignedRequest
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ orderId: 100, status: 'FILLED', avgPrice: '2330', executedQty: '0.5' });

            // Two concurrent invocations on same entry
            const p1 = serverAT._executeLiveEntryCore(entry, mockStc, mockCreds);
            const p2 = serverAT._executeLiveEntryCore(entry, mockStc, mockCreds);
            const [r1, r2] = await Promise.all([p1, p2]);

            // One should succeed, the other LOCK_BLOCKED
            const blocked = [r1, r2].find(r => r && r.live && r.live.status === 'LOCK_BLOCKED');
            expect(blocked).toBeDefined();
        });
    });

    describe('global halt pre-execution gate', () => {
        it('aborts entry if isGlobalHaltActive() returns true (GLOBAL_HALT)', async () => {
            // Mock db.atGetState să returneze halt state pentru 'global:halt' key.
            // isGlobalHaltActive() reads via db.atGetState — fără mock returns null/false.
            const db = require('../../server/services/database');
            const haltSpy = jest.spyOn(db, 'atGetState').mockImplementation((key) => {
                if (key === 'global:halt') return { active: true, by: 1, ts: Date.now(), reason: 'test-halt' };
                return null;
            });

            try {
                const entry = makeValidLiveEntry();
                const result = await serverAT._executeLiveEntryCore(entry, mockStc, mockCreds);

                expect(result.live.status).toBe('GLOBAL_HALT');
                // No exchange calls — fail-fast on halt
                expect(sendSignedRequest).not.toHaveBeenCalled();
            } finally {
                haltSpy.mockRestore();
            }
        });
    });

    describe('demo mode bypass', () => {
        it('does NOT call sendSignedRequest for entry.mode=demo (demo has no exchange interaction)', async () => {
            const demoEntry = makeValidLiveEntry({ mode: 'demo' });
            const result = await serverAT._executeLiveEntryCore(demoEntry, mockStc, mockCreds);

            // Demo entries should NOT touch Binance API
            expect(sendSignedRequest).not.toHaveBeenCalled();
            // Demo path should return early or with a non-LIVE status
            expect(result.live).toBeDefined();
        });
    });

    describe('[Fix #3 2026-05-20] registerManualPosition resolves creds for live path', () => {
        // M1.9 audit found: serverAT.js:3626 passes `null` for creds when
        // registerManualPosition routes to _executeLiveEntryCore (mode='live').
        // Latent orphan risk: any future caller passing mode:'live' would have
        // sendSignedRequest fail silently with null creds → position opened on
        // exchange (if main order managed to fire elsewhere) without server
        // tracking. Fix: getExchangeCreds(userId) at the call site.

        it('calls _executeLiveEntryCore with valid creds (NOT null) when mode=live', async () => {
            // Spy on _executeLiveEntryCore to capture its arguments
            const coreSpy = jest.spyOn(serverAT, '_executeLiveEntryCore').mockResolvedValue({
                seq: 999,
                userId: 1,
                symbol: 'ETHUSDT',
                side: 'BUY',
                mode: 'live',
                live: { status: 'LIVE', slOrderId: 102, tpOrderId: 104, slPlaced: true, tpPlaced: true },
            });

            await serverAT.registerManualPosition(1, {
                symbol: 'ETHUSDT',
                side: 'BUY',
                qty: 0.5,
                leverage: 10,
                sl: 2300,
                tp: 2400,
                mode: 'live', // CRITICAL — exercises the unified live path
                entryPrice: 2330,
                source: 'manual',
            });

            // _executeLiveEntryCore must have been called with creds populated
            // from getExchangeCreds, NOT null.
            expect(coreSpy).toHaveBeenCalled();
            const callArgs = coreSpy.mock.calls[0];
            const credsArg = callArgs[2]; // 3rd argument is creds
            expect(credsArg).not.toBeNull();
            expect(credsArg).toBeDefined();
            expect(credsArg).toEqual(expect.objectContaining({
                apiKey: 'user-mock-key',
                apiSecret: 'user-mock-secret',
            }));

            coreSpy.mockRestore();
        });
    });
});
