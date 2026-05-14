/**
 * Zeus Terminal — E2E Tests: Recon external position sync (M1.1 Cat D part 2/2)
 *
 * TDD failing-first per `_review/audit/TEST_SCAFFOLDING_M1_20260510.md` §6.
 *
 * Validates flow recon-detected external position (Binance has poziție pe care
 * Zeus NU a deschis-o — e.g., operator opened manual pe Binance UI direct).
 * Post-M1: recon detects → calls `_syncExternalPosition()` instead of treating
 * ca PHANTOM. Critical pentru BUG-T2c — distinguish "external sync needed"
 * de "orphan detected".
 *
 * Setup: invokes `_runReconciliation()` direct (NU via HTTP — recon e internal
 * scheduled cron). Mocks Binance positionRisk + spy on _syncExternalPosition
 * pentru verification.
 *
 * Status: ALL tests initially FAIL — `_syncExternalPosition()` doesn't exist
 * yet (added la M1.2). Recon currently flags ALL un-tracked positions ca
 * PHANTOM, including fresh externals.
 *
 * Coverage targets (per scaffolding §6 P2):
 *   - External detected → _syncExternalPosition called: 1 test
 *   - Fresh external NU treated ca PHANTOM: 1 test
 *
 * Total: 2 tests (target band 2).
 *
 * Refs:
 * - ADR-001 §3.3 Migration architecture (_syncExternalPosition new function)
 * - TEST_SCAFFOLDING_M1 §6 Cat D recon spec
 * - BUG-T2 + BUG-T2c (RECON_PHANTOM root cause)
 * - SYSTEMATIC_SAFETY_AUDIT_20260510 §3.5 recon resilience requirements
 */
'use strict';

// ── Mocks ──
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
    getAllActiveLiveCredentials: jest.fn(() => []),
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

describe('Recon external position sync (M1.1 Cat D)', () => {
    beforeEach(() => {
        sendSignedRequest.mockReset();
    });

    it('detects external position și registers via _syncExternalPosition (NU PHANTOM)', async () => {
        // Mock Binance positionRisk returning ETHUSDT LONG that Zeus didn't open
        // (positionAmt != 0 + entryPrice > 0 → live position pe Binance)
        sendSignedRequest.mockResolvedValueOnce([
            {
                symbol: 'ETHUSDT',
                positionAmt: '0.5',
                entryPrice: '2330',
                positionSide: 'LONG',
                markPrice: '2335',
                unRealizedProfit: '2.5',
            },
            // Other symbols zero
            { symbol: 'BTCUSDT', positionAmt: '0', entryPrice: '0', positionSide: 'LONG' },
        ]);

        // Spy on _syncExternalPosition — function doesn't exist yet, will throw "not a function"
        const spyExternal = jest.spyOn(serverAT, '_syncExternalPosition');

        try {
            await serverAT._runReconciliation(false);
            // External position should have routed la _syncExternalPosition
            expect(spyExternal).toHaveBeenCalledWith(
                expect.objectContaining({
                    symbol: 'ETHUSDT',
                    side: 'LONG',
                    source: 'external',
                })
            );
        } finally {
            spyExternal.mockRestore();
        }
    });

    it('does NOT mark fresh external position ca PHANTOM (avoids BUG-T2c false-positive)', async () => {
        // Fresh external (just opened manual on Binance, recon detects sub 60s)
        sendSignedRequest.mockResolvedValueOnce([
            {
                symbol: 'ETHUSDT',
                positionAmt: '0.5',
                entryPrice: '2330',
                positionSide: 'LONG',
                markPrice: '2335',
            },
        ]);

        // Spy pe audit logger pentru SAT_RECON_PHANTOM action
        const db = require('../../server/services/database.js');
        const auditSpy = jest.spyOn(db, 'auditLog');
        // Spy pe _syncExternalPosition pentru positive path verification
        const externalSpy = jest.spyOn(serverAT, '_syncExternalPosition');

        try {
            await serverAT._runReconciliation(false);
            // Critical positive assertion: external position MUST be routed
            // through _syncExternalPosition (post-M1 path). Test FAILS în RED
            // dacă function doesn't exist (TypeError pe spyOn).
            expect(externalSpy).toHaveBeenCalled();
            // Critical negative assertion: SAT_RECON_PHANTOM should NOT fire
            // pentru external (post-M1: source='external' classification
            // distinguishes from orphan, avoiding BUG-T2c false-positive).
            const phantomCalls = auditSpy.mock.calls.filter(args =>
                args[1] === 'SAT_RECON_PHANTOM'
            );
            expect(phantomCalls.length).toBe(0);
        } finally {
            auditSpy.mockRestore();
            externalSpy.mockRestore();
        }
    });
});
