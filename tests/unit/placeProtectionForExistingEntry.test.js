/**
 * Zeus Terminal — Unit Tests: _placeProtectionForExistingEntry (BUG-T2c FIX 2026-05-14)
 *
 * Path B safety helper called by trading.js /api/order/place AFTER main order
 * placed on Binance. Places SL HARD + TP conditional on !dslParams per DSL rule.
 *
 * Coverage:
 *   - Happy path DSL ON (2): SL placed, NO TP (regula)
 *   - Happy path DSL OFF (2): SL + TP both placed
 *   - SL retry (2): transient fail recovers; all-retries → emergency close
 *   - TP retry (2): only fires DSL OFF; all-retries → emergency close
 *   - Validation (3): missing sl throws, missing creds throws, missing avgPrice throws
 *   - Edge (2): safety SL preserved if real SL fails completely, LONG vs SHORT closeSide
 *
 * Total: 13 tests.
 *
 * Refs: BUG-T2c FIX, OPEN_BUGS_PRIORITY_RANKING, SYSTEMATIC_SAFETY_AUDIT_20260510.
 */
'use strict';

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

jest.mock('@sentry/node', () => ({
    init: jest.fn(),
    captureMessage: jest.fn(),
    captureException: jest.fn(),
    withScope: jest.fn((fn) => fn({ setUser: jest.fn(), setTag: jest.fn(), setExtra: jest.fn() })),
    setUser: jest.fn(),
    setContext: jest.fn(),
}));

const serverAT = require('../../server/services/serverAT.js');
const { sendSignedRequest } = require('../../server/services/binanceSigner.js');
const telegram = require('../../server/services/telegram.js');

function makeEntry(overrides = {}) {
    return {
        userId: 1,
        seq: 99999,
        symbol: 'BTCUSDT',
        side: 'LONG',
        sl: 79000,
        tp: 82000,
        avgPrice: 80000,
        executedQty: 0.01,
        leverage: 10,
        dslParams: { atrLen: 14, atrMult: 2 },
        ...overrides,
    };
}

const mockCreds = { apiKey: 'k', apiSecret: 's', isTestnet: true };

describe('_placeProtectionForExistingEntry (BUG-T2c FIX — Path B safety)', () => {
    beforeEach(() => {
        sendSignedRequest.mockReset();
        telegram.sendToUser.mockReset();
    });

    describe('happy path — DSL ON (default)', () => {
        it('places SL on Binance, returns slOrderId, NO TP per DSL rule', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL
                .mockResolvedValueOnce({ orderId: 102 }) // real SL
                .mockResolvedValueOnce({});             // safety SL cancel

            const entry = makeEntry({ dslParams: { atrMult: 2 } });
            const result = await serverAT._placeProtectionForExistingEntry(entry, mockCreds);

            expect(result.status).toBe('LIVE');
            expect(result.slOrderId).toBe(102);
            expect(result.tpOrderId).toBeNull();
        });

        it('does not call TAKE_PROFIT_MARKET endpoint when DSL ON', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({ orderId: 101 })
                .mockResolvedValueOnce({ orderId: 102 })
                .mockResolvedValueOnce({});

            const entry = makeEntry({ dslParams: { atrMult: 2 } });
            await serverAT._placeProtectionForExistingEntry(entry, mockCreds);

            const tpCalls = sendSignedRequest.mock.calls.filter(call =>
                call[2] && call[2].type === 'TAKE_PROFIT_MARKET'
            );
            expect(tpCalls.length).toBe(0);
        });
    });

    describe('happy path — DSL OFF', () => {
        it('places SL + TP on Binance', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL
                .mockResolvedValueOnce({ orderId: 102 }) // real SL
                .mockResolvedValueOnce({})              // safety SL cancel
                .mockResolvedValueOnce({ orderId: 103 }); // TP

            const entry = makeEntry({ dslParams: null });
            const result = await serverAT._placeProtectionForExistingEntry(entry, mockCreds);

            expect(result.status).toBe('LIVE');
            expect(result.slOrderId).toBe(102);
            expect(result.tpOrderId).toBe(103);
        });

        it('TAKE_PROFIT_MARKET request goes to algo endpoint when DSL OFF', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({ orderId: 101 })
                .mockResolvedValueOnce({ orderId: 102 })
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ orderId: 103 });

            const entry = makeEntry({ dslParams: null });
            await serverAT._placeProtectionForExistingEntry(entry, mockCreds);

            const tpCalls = sendSignedRequest.mock.calls.filter(call =>
                call[2] && call[2].type === 'TAKE_PROFIT_MARKET'
            );
            expect(tpCalls.length).toBeGreaterThan(0);
        });
    });

    describe('SL retry behavior', () => {
        it('retries SL on transient failure, succeeds on retry', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL
                .mockRejectedValueOnce(new Error('rate limit')) // SL fail 1
                .mockResolvedValueOnce({ orderId: 102 }) // SL retry success
                .mockResolvedValueOnce({});             // safety SL cancel

            const entry = makeEntry();
            const result = await serverAT._placeProtectionForExistingEntry(entry, mockCreds);

            expect(result.status).toBe('LIVE');
            expect(result.slOrderId).toBe(102);
        }, 10000);

        it('triggers EMERGENCY MARKET CLOSE when all SL retries exhausted', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL placed
                .mockRejectedValueOnce(new Error('SL fail 1'))
                .mockRejectedValueOnce(new Error('SL fail 2'))
                .mockRejectedValueOnce(new Error('SL fail 3'))
                .mockResolvedValueOnce({ orderId: 999, avgPrice: '79900', status: 'FILLED' }) // emergency close
                .mockResolvedValueOnce({}); // safety SL cancel after emergency

            const entry = makeEntry();
            const result = await serverAT._placeProtectionForExistingEntry(entry, mockCreds);

            expect(result.status).toBe('EMERGENCY_CLOSED');
            expect(result.emergencyClosed).toBe(true);
            expect(result.reason).toBe('SL_ALL_RETRIES_FAILED');
        }, 10000);
    });

    describe('TP retry behavior (DSL OFF only)', () => {
        it('does NOT retry TP when DSL ON (skipped entirely)', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({ orderId: 101 })
                .mockResolvedValueOnce({ orderId: 102 })
                .mockResolvedValueOnce({});

            const entry = makeEntry({ dslParams: { atrMult: 2 } });
            await serverAT._placeProtectionForExistingEntry(entry, mockCreds);

            expect(sendSignedRequest.mock.calls.length).toBe(3);
        });

        it('triggers EMERGENCY MARKET CLOSE when all TP retries exhausted (DSL OFF)', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL
                .mockResolvedValueOnce({ orderId: 102 }) // real SL
                .mockResolvedValueOnce({})              // safety SL cancel
                .mockRejectedValueOnce(new Error('TP fail 1'))
                .mockRejectedValueOnce(new Error('TP fail 2'))
                .mockRejectedValueOnce(new Error('TP fail 3'))
                .mockResolvedValueOnce({ orderId: 999, avgPrice: '81000', status: 'FILLED' }) // emergency close FIRST
                .mockResolvedValueOnce({});             // SL cancel AFTER (cleanup post-close)

            const entry = makeEntry({ dslParams: null });
            const result = await serverAT._placeProtectionForExistingEntry(entry, mockCreds);

            expect(result.status).toBe('EMERGENCY_CLOSED');
            expect(result.reason).toBe('TP_ALL_RETRIES_FAILED');
        }, 10000);

        // [Fix #2 2026-05-20] Anti-race: SL must NOT be cancelled BEFORE
        // emergency close attempt. If emergency close fails, SL must remain
        // active as last line of defense. M1.9 audit found: at serverAT.js
        // line 3519, _cancelOrderSafe(slOrder) ran before sendSignedRequest
        // emergency close. If emergency throws, position has NO SL (cancelled)
        // AND NO TP (never placed) AND NO emergency close → unprotected.
        it('[Fix #2] preserves SL when emergency close FAILS (does NOT cancel SL before attempt)', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({ orderId: 101 }) // safety SL
                .mockResolvedValueOnce({ orderId: 102 }) // real SL placed
                .mockResolvedValueOnce({})              // safety SL cancel (after real SL)
                .mockRejectedValueOnce(new Error('TP fail 1'))
                .mockRejectedValueOnce(new Error('TP fail 2'))
                .mockRejectedValueOnce(new Error('TP fail 3'))
                .mockRejectedValueOnce(new Error('Emergency close API error')); // emergency FAILS

            const entry = makeEntry({ dslParams: null });
            const result = await serverAT._placeProtectionForExistingEntry(entry, mockCreds);

            // Critical: should return SL still alive (NOT cancelled)
            expect(result.status).toBe('LIVE_NO_TP');
            expect(result.slOrderId).toBe(102); // real SL still tracked, NOT cancelled

            // Verify _cancelOrderSafe for the real SL was NEVER called.
            // Find all sendSignedRequest calls and check that no DELETE on
            // slOrderId=102 was issued.
            const cancelCallsForRealSl = sendSignedRequest.mock.calls.filter(call => {
                const [method, path, params] = call;
                return method === 'DELETE' && params && params.orderId === 102;
            });
            expect(cancelCallsForRealSl.length).toBe(0);
        }, 10000);
    });

    describe('validation', () => {
        it('throws when entry.sl missing', async () => {
            const entry = makeEntry({ sl: null });
            await expect(serverAT._placeProtectionForExistingEntry(entry, mockCreds))
                .rejects.toThrow(/sl/i);
        });

        it('throws when creds missing', async () => {
            const entry = makeEntry();
            await expect(serverAT._placeProtectionForExistingEntry(entry, null))
                .rejects.toThrow(/cred/i);
        });

        it('throws when avgPrice missing', async () => {
            const entry = makeEntry({ avgPrice: 0 });
            await expect(serverAT._placeProtectionForExistingEntry(entry, mockCreds))
                .rejects.toThrow(/avgPrice/i);
        });
    });

    describe('edge cases', () => {
        it('uses SELL closeSide for LONG entry', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({ orderId: 101 })
                .mockResolvedValueOnce({ orderId: 102 })
                .mockResolvedValueOnce({});

            const entry = makeEntry({ side: 'LONG' });
            await serverAT._placeProtectionForExistingEntry(entry, mockCreds);

            const slCall = sendSignedRequest.mock.calls.find(call =>
                call[2] && call[2].type === 'STOP_MARKET' && call[2].clientAlgoId &&
                call[2].clientAlgoId.startsWith('PB_SL_')
            );
            expect(slCall).toBeDefined();
            expect(slCall[2].side).toBe('SELL');
        });

        it('uses BUY closeSide for SHORT entry', async () => {
            sendSignedRequest
                .mockResolvedValueOnce({ orderId: 101 })
                .mockResolvedValueOnce({ orderId: 102 })
                .mockResolvedValueOnce({});

            const entry = makeEntry({ side: 'SHORT' });
            await serverAT._placeProtectionForExistingEntry(entry, mockCreds);

            const slCall = sendSignedRequest.mock.calls.find(call =>
                call[2] && call[2].type === 'STOP_MARKET' && call[2].clientAlgoId &&
                call[2].clientAlgoId.startsWith('PB_SL_')
            );
            expect(slCall).toBeDefined();
            expect(slCall[2].side).toBe('BUY');
        });
    });
});
