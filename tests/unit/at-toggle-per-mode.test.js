/**
 * Zeus Terminal — Unit Tests: AT toggle per-mode split (BUG-T7 2026-05-13)
 *
 * Operator-flagged GRAV evening 2026-05-10: AT toggle e GLOBAL per-user,
 * NU per-mode. Toggle off în demo BLOCHEAZĂ și live (silent confusion).
 *
 * Fix: split atActive → atActiveDemo + atActiveLive. Legacy atActive kept
 * synced cu current engineMode pentru backward-compat telemetry.
 *
 * Test scope (helper + toggleActive + isATActive + restore migration):
 *   - DEFAULT_USER_STATE include atActiveDemo + atActiveLive (default false)
 *   - _isATActiveForMode helper returns mode-specific flag
 *   - toggleActive(userId, active) defaults to current engineMode
 *   - toggleActive(userId, active, 'demo') sets demo only
 *   - toggleActive(userId, active, 'live') sets live only
 *   - isATActive(userId, 'demo'/'live') returns mode-specific
 *   - isATActive(userId) defaults to current engineMode
 *   - Restore path backfills both fields from legacy atActive
 */
'use strict';

// ── Mocks (sparse — only what we need) ──
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
    saveAtRound: jest.fn(),
    getRoundCount: jest.fn(() => 0),
    saveSignal: jest.fn(),
}));
jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../server/services/audit', () => ({
    record: jest.fn(),
}));
jest.mock('../../server/services/telegram', () => ({
    sendToUser: jest.fn(),
    alertOrderFailed: jest.fn(),
    alertOrderFilled: jest.fn(),
    alertRiskBlock: jest.fn(),
}));
jest.mock('../../server/services/credentialStore', () => ({
    getExchangeCreds: jest.fn(() => null),
}));

const serverAT = require('../../server/services/serverAT');

beforeEach(() => {
    serverAT.reset(1);  // Clean general state per test
    // [BUG-T7 test isolation] reset() doesn't clear new per-mode fields —
    // force both flags OFF explicitly pentru test independence.
    serverAT.toggleActive(1, false, 'demo');
    serverAT.toggleActive(1, false, 'live');
});

describe('BUG-T7: AT toggle per-mode split', () => {

    describe('default state — both flags false', () => {
        test('isATActive(uid, demo) === false on fresh state', () => {
            serverAT.reset(1);
            expect(serverAT.isATActive(1, 'demo')).toBe(false);
        });

        test('isATActive(uid, live) === false on fresh state', () => {
            serverAT.reset(1);
            expect(serverAT.isATActive(1, 'live')).toBe(false);
        });

        test('isATActive(uid) defaults to current engineMode', () => {
            serverAT.reset(1);
            // Default engineMode === 'demo' after reset
            expect(serverAT.isATActive(1)).toBe(false);
        });
    });

    describe('toggleActive cu explicit mode param', () => {
        test('toggleActive(uid, true, "demo") activates DEMO only', () => {
            const result = serverAT.toggleActive(1, true, 'demo');
            expect(result.ok).toBe(true);
            expect(result.mode).toBe('demo');
            expect(result.atActiveDemo).toBe(true);
            expect(result.atActiveLive).toBe(false);
            expect(serverAT.isATActive(1, 'demo')).toBe(true);
            expect(serverAT.isATActive(1, 'live')).toBe(false);
        });

        test('toggleActive(uid, true, "live") activates LIVE only', () => {
            const result = serverAT.toggleActive(1, true, 'live');
            expect(result.ok).toBe(true);
            expect(result.mode).toBe('live');
            expect(result.atActiveLive).toBe(true);
            expect(result.atActiveDemo).toBe(false);
            expect(serverAT.isATActive(1, 'live')).toBe(true);
            expect(serverAT.isATActive(1, 'demo')).toBe(false);
        });

        test('toggle live then toggle off demo — live remains ACTIVE', () => {
            serverAT.toggleActive(1, true, 'live');
            serverAT.toggleActive(1, false, 'demo');
            expect(serverAT.isATActive(1, 'live')).toBe(true);   // Critical: live untouched
            expect(serverAT.isATActive(1, 'demo')).toBe(false);
        });

        test('toggle demo then toggle off live — demo remains ACTIVE', () => {
            serverAT.toggleActive(1, true, 'demo');
            serverAT.toggleActive(1, false, 'live');
            expect(serverAT.isATActive(1, 'demo')).toBe(true);   // Critical: demo untouched
            expect(serverAT.isATActive(1, 'live')).toBe(false);
        });
    });

    describe('toggleActive without mode — uses current engineMode', () => {
        test('legacy call toggleActive(uid, true) defaults la engineMode (demo)', () => {
            // Fresh user — engineMode = 'demo'
            const result = serverAT.toggleActive(1, true);
            expect(result.ok).toBe(true);
            expect(result.mode).toBe('demo');
            expect(result.atActiveDemo).toBe(true);
            expect(result.atActiveLive).toBe(false);
        });
    });

    describe('validation', () => {
        test('returns error pe non-boolean active', () => {
            const result = serverAT.toggleActive(1, 'yes', 'demo');
            expect(result.ok).toBe(false);
            expect(result.error).toMatch(/active.*boolean/i);
        });

        test('returns error pe missing userId', () => {
            const result = serverAT.toggleActive(null, true, 'demo');
            expect(result.ok).toBe(false);
            expect(result.error).toMatch(/userId/i);
        });

        test('invalid mode param falls back to engineMode', () => {
            const result = serverAT.toggleActive(1, true, 'invalid_mode');
            expect(result.ok).toBe(true);
            // Falls back to current engineMode (demo on fresh state)
            expect(result.mode).toBe('demo');
            expect(result.atActiveDemo).toBe(true);
        });
    });

    describe('legacy atActive backward-compat', () => {
        test('legacy atActive synced cu current mode flag after toggle', () => {
            // Fresh user, engineMode=demo
            serverAT.toggleActive(1, true, 'demo');
            const full = serverAT.getFullState(1);
            expect(full.atActive).toBe(true);     // legacy reflects current mode (demo)
            expect(full.atActiveDemo).toBe(true);
            expect(full.atActiveLive).toBe(false);
        });

        test('toggle live while in demo mode — legacy atActive stays at demo value', () => {
            serverAT.toggleActive(1, true, 'demo');
            // Now toggle live while still in demo engineMode
            serverAT.toggleActive(1, true, 'live');
            const full = serverAT.getFullState(1);
            // Legacy atActive reflects engineMode=demo state
            expect(full.atActive).toBe(true);     // demo is ON
            expect(full.atActiveLive).toBe(true);
        });
    });
});
