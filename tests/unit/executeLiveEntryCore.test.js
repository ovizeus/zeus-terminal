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
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []), run: jest.fn() })) },
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
}));

jest.mock('../../server/services/binanceSigner', () => ({
    sendSignedRequest: jest.fn(),
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

// ── Import target module ──
const serverAT = require('../../server/services/serverAT.js');
const { sendSignedRequest } = require('../../server/services/binanceSigner.js');
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
    });

    describe('happy path — full atomic SL+TP placement', () => {
        it('places main order, safety SL, real SL, TP în correct sequence', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({}) // marginType
                .mockResolvedValueOnce({}) // leverage
                .mockResolvedValueOnce({ orderId: 100, status: 'FILLED', avgPrice: '2330', executedQty: '0.5' }) // main entry
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL @ 15% OTM
                .mockResolvedValueOnce({ orderId: 102 }) // real SL @ user-specified
                .mockResolvedValueOnce({}) // safety SL cancel
                .mockResolvedValueOnce({ orderId: 104 }); // TP

            const entry = makeValidLiveEntry();
            const result = await serverAT._executeLiveEntryCore(entry, mockStc, mockCreds);

            expect(result).toBeDefined();
            expect(result.live).toBeDefined();
            expect(result.live.slOrderId).toBe(102);
            expect(result.live.tpOrderId).toBe(104);
            expect(result.live.status).toBe('LIVE');
            expect(result.live.slPlaced).toBe(true);
            expect(result.live.tpPlaced).toBe(true);
        });
    });

    describe('SL retry behavior', () => {
        it('retries SL placement 3x on transient failure', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({}) // marginType
                .mockResolvedValueOnce({}) // leverage
                .mockResolvedValueOnce({ orderId: 100, status: 'FILLED', avgPrice: '2330', executedQty: '0.5' }) // main
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL
                .mockRejectedValueOnce(new Error('rate limit')) // SL attempt 1 fail
                .mockRejectedValueOnce(new Error('temporary network')) // SL attempt 2 fail
                .mockResolvedValueOnce({ orderId: 102 }) // SL attempt 3 success
                .mockResolvedValueOnce({}) // safety SL cancel
                .mockResolvedValueOnce({ orderId: 104 }); // TP

            const entry = makeValidLiveEntry();
            const result = await serverAT._executeLiveEntryCore(entry, mockStc, mockCreds);

            expect(result.live.slOrderId).toBe(102);
            expect(result.live.status).toBe('LIVE');
        });

        it('triggers EMERGENCY MARKET CLOSE if all 3 SL retries exhausted', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({}) // marginType
                .mockResolvedValueOnce({}) // leverage
                .mockResolvedValueOnce({ orderId: 100, status: 'FILLED', avgPrice: '2330', executedQty: '0.5' }) // main
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL placed
                .mockRejectedValueOnce(new Error('SL fail 1')) // SL 1
                .mockRejectedValueOnce(new Error('SL fail 2')) // SL 2
                .mockRejectedValueOnce(new Error('SL fail 3')) // SL 3
                .mockResolvedValueOnce({ orderId: 110, status: 'FILLED', avgPrice: '2329.50' }); // emergency MARKET close

            const entry = makeValidLiveEntry();
            const result = await serverAT._executeLiveEntryCore(entry, mockStc, mockCreds);

            expect(result.live.status).toBe('EMERGENCY_CLOSED');
            expect(result.live.slOrderId).toBeNull();
            // Sentry fatal + Telegram alert verified separately via mock spies
        });

        it('preserves safety SL active if emergency close itself fails', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({}) // marginType
                .mockResolvedValueOnce({}) // leverage
                .mockResolvedValueOnce({ orderId: 100, status: 'FILLED', avgPrice: '2330', executedQty: '0.5' }) // main
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL placed
                .mockRejectedValueOnce(new Error('SL fail')) // SL 1
                .mockRejectedValueOnce(new Error('SL fail')) // SL 2
                .mockRejectedValueOnce(new Error('SL fail')) // SL 3
                .mockRejectedValueOnce(new Error('emergency close fail')); // emergency MARKET close fails

            const entry = makeValidLiveEntry();
            const result = await serverAT._executeLiveEntryCore(entry, mockStc, mockCreds);

            // Safety SL NOT cancelled (15% OTM still on exchange as backstop)
            expect(result.live.status).toBe('LIVE_NO_SL');
            // Telegram critical alert dispatched
            expect(telegram.sendToUser).toHaveBeenCalledWith(
                1,
                expect.stringMatching(/EMERGENCY CLOSE FAILED|UNPROTECTED/i)
            );
        });
    });

    describe('TP retry behavior', () => {
        it('skips TP placement when dslParams set (DSL manages exit)', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({}) // marginType
                .mockResolvedValueOnce({}) // leverage
                .mockResolvedValueOnce({ orderId: 100, status: 'FILLED', avgPrice: '2330', executedQty: '0.5' })
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL
                .mockResolvedValueOnce({ orderId: 102 }) // real SL
                .mockResolvedValueOnce({}); // safety SL cancel

            const entryDsl = makeValidLiveEntry({ dslParams: { openDslPct: 0.6 } });
            const result = await serverAT._executeLiveEntryCore(entryDsl, mockStc, mockCreds);

            expect(result.live.slOrderId).toBe(102);
            expect(result.live.tpOrderId).toBeNull();
            expect(result.live.tpPlaced).toBe(false);
            // NO 7th sendSignedRequest call for TP order
            expect(sendSignedRequest).toHaveBeenCalledTimes(6);
        });

        it('triggers TP emergency close if all retries fail and no DSL', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({}) // marginType
                .mockResolvedValueOnce({}) // leverage
                .mockResolvedValueOnce({ orderId: 100, status: 'FILLED', avgPrice: '2330', executedQty: '0.5' })
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL
                .mockResolvedValueOnce({ orderId: 102 }) // real SL
                .mockResolvedValueOnce({}) // safety cancel
                .mockRejectedValueOnce(new Error('TP fail 1'))
                .mockRejectedValueOnce(new Error('TP fail 2'))
                .mockRejectedValueOnce(new Error('TP fail 3'))
                .mockResolvedValueOnce({ orderId: 200, status: 'FILLED', avgPrice: '2330' }); // emergency close

            const entry = makeValidLiveEntry({ dslParams: null });
            const result = await serverAT._executeLiveEntryCore(entry, mockStc, mockCreds);

            expect(result.live.status).toBe('EMERGENCY_CLOSED');
            expect(result.live.tpPlaced).toBe(false);
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

        it('throws SafetyAssertionError post-fill if SL slOrderId null despite happy paths', async () => {
            // Edge case: imagine sendSignedRequest succeeds dar returns no orderId
            sendSignedRequest
                .mockResolvedValueOnce({}) // marginType
                .mockResolvedValueOnce({}) // leverage
                .mockResolvedValueOnce({ orderId: 100, status: 'FILLED', avgPrice: '2330', executedQty: '0.5' }) // main
                .mockResolvedValueOnce({ /* safety SL with no orderId */ })
                .mockResolvedValueOnce({ /* real SL with no orderId */ });

            const entry = makeValidLiveEntry();
            // Post-fill hard assertion catches this edge case + triggers emergency
            const result = await serverAT._executeLiveEntryCore(entry, mockStc, mockCreds);
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
});
