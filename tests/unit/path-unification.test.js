/**
 * Zeus Terminal — Integration Tests: Path A/B unification (M1.1 Cat C)
 *
 * TDD failing-first per `_review/audit/TEST_SCAFFOLDING_M1_20260510.md` §5.
 *
 * Validates că post-M1 refactor:
 *   1. `registerManualPosition()` for live mode delegates la `_executeLiveEntryCore`
 *      (eliminates Path B local-only behavior — exchange-side SL placed)
 *   2. `registerManualPosition()` for demo mode preserves zero exchange interaction
 *   3. `_syncExternalPosition()` NEW function handles genuine external positions
 *      (recon-discovered Binance positions Zeus didn't open) without SL placement
 *   4. Feature flag `LIVE_ENTRY_UNIFIED` în migrationFlags.js controls dual-path
 *      burn-in: false=old Path B behavior, true=new unified behavior
 *
 * Status: ALL tests initially FAIL — target functions don't exist yet:
 *   - `_executeLiveEntryCore` (extracted din _executeLiveEntry la M1.2)
 *   - `_syncExternalPosition` (new function la M1.2)
 *   - `MF.LIVE_ENTRY_UNIFIED` flag (added la migrationFlags.js la M1.2)
 *
 * Coverage targets (per scaffolding §5):
 *   - Live mode delegation: 3 tests
 *   - Demo mode preservation: 1 test
 *   - _syncExternalPosition: 2 tests
 *   - Feature flag burn-in: 2 tests
 *
 * Total: 8 tests (target band 6-8).
 *
 * Refs:
 * - ADR-001 §3.3 Migration architecture
 * - TEST_SCAFFOLDING_M1 §5 Cat C spec
 * - MILESTONES_M1-M8 §M1 acceptance criteria M1.1, M1.2, M1.3, M1.6
 */
'use strict';

// ── Mocks (sparse — DB + exchange + alerts) ──
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

// [M1.2 Cat C] Mock exchangeInfo să returneze valid stub filters — bypassa
// _alignQtyToLotSize LOT_SIZE_ALIGN_REJECTED în test environment fără real
// filter cache. Routing tests verifică flow integration, NU alignment logic.
jest.mock('../../server/services/exchangeInfo', () => ({
    roundOrderParams: jest.fn((sym, qty) => ({ quantity: parseFloat(qty), price: 0 })),
    getFilters: jest.fn(() => ({ stepSize: '0.001', tickSize: '0.01', minQty: '0.001' })),
}));

const serverAT = require('../../server/services/serverAT.js');
const MF = require('../../server/migrationFlags.js');
const { sendSignedRequest } = require('../../server/services/binanceSigner.js');
const logger = require('../../server/services/logger.js');

// ── Test fixtures ──
const validLiveEntry = {
    symbol: 'ETHUSDT',
    side: 'BUY',
    entryPrice: 2330,
    qty: 0.5,
    leverage: 10,
    sl: 2300,
    tp: 2400,
    mode: 'live',
    source: 'auto',
};
const validDemoEntry = { ...validLiveEntry, mode: 'demo' };

const validExternalSyncEntry = {
    userId: 1,
    symbol: 'ETHUSDT',
    side: 'LONG',
    entryPrice: 2330,
    qty: 0.5,
    source: 'external',
};

describe('Path unification — Path B → Path A delegation (M1.1 Cat C)', () => {
    beforeEach(() => {
        sendSignedRequest.mockReset();
    });

    describe('registerManualPosition for live mode (post-refactor delegation)', () => {
        it('rejects sl=null with SafetyAssertionError (Path B hard fail)', async () => {
            const result = await serverAT.registerManualPosition(1, {
                ...validLiveEntry,
                sl: null,
            });
            expect(result.ok).toBe(false);
            expect(result.error).toMatch(/SafetyAssertionError|sl.*required|missing.*sl/i);
        });

        it('delegates to _executeLiveEntryCore for live valid entry', async () => {
            // Mock _executeLiveEntryCore să return live state cu slOrderId.
            // Required: registerManualPosition is async, awaits _executeLiveEntryCore.
            const spy = jest.spyOn(serverAT, '_executeLiveEntryCore').mockResolvedValue({
                ...validLiveEntry,
                userId: 1, side: 'LONG', mode: 'live',
                live: { status: 'LIVE', slOrderId: 999, tpOrderId: 998, slPlaced: true, tpPlaced: true },
            });
            try {
                await serverAT.registerManualPosition(1, validLiveEntry);
                expect(spy).toHaveBeenCalled();
            } finally {
                spy.mockRestore();
            }
        });

        it('post-M1 populates result.live.slOrderId (currently null pe Path B unsafe)', async () => {
            // PRE-M1: registerManualPosition stochează sl local DAR NU place SL pe Binance →
            //         result.live.slOrderId = null (Path B unsafe — 97.6% incident root cause).
            // POST-M1: delegates to _executeLiveEntryCore care places real SL via Binance →
            //         result.live.slOrderId populated cu Binance orderId.
            const spy = jest.spyOn(serverAT, '_executeLiveEntryCore').mockResolvedValue({
                ...validLiveEntry,
                userId: 1, side: 'LONG', mode: 'live',
                live: { status: 'LIVE', slOrderId: 12345, tpOrderId: 67890, slPlaced: true, tpPlaced: true },
            });
            try {
                const result = await serverAT.registerManualPosition(1, validLiveEntry);
                expect(result.ok).toBe(true);
                expect(result.live).toBeDefined();
                // Critical: live entry must have slOrderId populated post-M1 (proven SL placement)
                expect(result.live.slOrderId).toBe(12345);
                // Backward compat: seq still returned
                expect(typeof result.seq).toBe('number');
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe('registerManualPosition for demo mode (preserved behavior)', () => {
        it('post-M1 demo entries route through _buildEntryFromOrderPlace helper', async () => {
            // POST-M1: demo path also routes through _buildEntryFromOrderPlace for
            //         consistent entry shape (skipping only exchange interaction).
            const spy = jest.spyOn(serverAT, '_buildEntryFromOrderPlace');
            try {
                await serverAT.registerManualPosition(1, validDemoEntry);
                expect(spy).toHaveBeenCalled();
                // Demo path STILL zero exchange interaction (preserved behavior)
                expect(sendSignedRequest).not.toHaveBeenCalled();
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe('_syncExternalPosition (NEW function for recon-discovered external positions)', () => {
        it('registers external position without SL placement (source=external)', () => {
            // Function doesn't exist yet — TDD RED catches "_syncExternalPosition is not a function"
            const result = serverAT._syncExternalPosition(validExternalSyncEntry);
            expect(result.ok).toBe(true);
            expect(result.seq).toBeDefined();
            // External positions don't trigger SL placement — explicit "pre-existing on exchange" semantics
            expect(sendSignedRequest).not.toHaveBeenCalled();
            // Warning logged about external position lacking exchange-tracked SL
            expect(result.warning).toMatch(/no SL placement|external/i);
        });

        it('logs warning when external position lacks SL on exchange', () => {
            const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
            try {
                serverAT._syncExternalPosition(validExternalSyncEntry);
                expect(loggerSpy).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.stringMatching(/external position|no SL|unprotected/i)
                );
            } finally {
                loggerSpy.mockRestore();
            }
        });
    });

    describe('feature flag LIVE_ENTRY_UNIFIED burn-in', () => {
        it('uses LEGACY Path B behavior când LIVE_ENTRY_UNIFIED=false (emergency rollback)', async () => {
            const origFlag = MF.LIVE_ENTRY_UNIFIED;
            try {
                Object.defineProperty(MF, 'LIVE_ENTRY_UNIFIED', {
                    get() { return false; },
                    configurable: true,
                });
                // With flag OFF: legacy Path B silently accepts sl=null pentru emergency rollback
                const result = await serverAT.registerManualPosition(1, {
                    ...validLiveEntry,
                    sl: null,
                });
                // Legacy behavior: silent acceptance — returns ok=true even fără SL
                expect(result.ok).toBe(true);
            } finally {
                if (origFlag !== undefined) {
                    Object.defineProperty(MF, 'LIVE_ENTRY_UNIFIED', {
                        value: origFlag, configurable: true, writable: true,
                    });
                }
            }
        });

        it('uses UNIFIED safe behavior când LIVE_ENTRY_UNIFIED=true (default post-M1.2)', async () => {
            const origFlag = MF.LIVE_ENTRY_UNIFIED;
            try {
                Object.defineProperty(MF, 'LIVE_ENTRY_UNIFIED', {
                    get() { return true; },
                    configurable: true,
                });
                // With flag ON, sl=null MUST be rejected cu SafetyAssertionError
                const result = await serverAT.registerManualPosition(1, {
                    ...validLiveEntry,
                    sl: null,
                });
                expect(result.ok).toBe(false);
                expect(result.error).toMatch(/SafetyAssertionError|sl.*required/i);
            } finally {
                if (origFlag !== undefined) {
                    Object.defineProperty(MF, 'LIVE_ENTRY_UNIFIED', {
                        value: origFlag, configurable: true, writable: true,
                    });
                }
            }
        });
    });
});
