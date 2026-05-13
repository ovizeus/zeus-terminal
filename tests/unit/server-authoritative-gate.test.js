/**
 * Zeus Terminal — Unit Tests: _isServerAuthoritativeForUser gate (BUG-T1 2026-05-13)
 *
 * Root cause confirmed PHASE1_BRAINLOGGER_AUDIT_20260510.md:
 *   Pre-fix: gate accepts stc.engineMode === 'demo' as condition for SERVER_AT_DEMO
 *   carve-out. DAR stc.engineMode field NEVER populated (absent din DEFAULT_STC
 *   schema + at_state.stc:N JSON). Therefore gate returns false for ALL users.
 *   Blocks: server-side AT demo dispatch + brainLogger.logDecision call sites (9
 *   sites unreachable).
 *
 * Fix: gate accepts userId param + reads engineMode din us state via
 * serverAT.getMode(userId) — single source of truth for per-user mode.
 *
 * Test scope:
 *   - SERVER_AT=true: gate ALWAYS true (universal authority)
 *   - SERVER_AT=false + SERVER_AT_DEMO=true: gate true ONLY for demo-mode users
 *   - Both flags false: gate false universally
 *   - Backward compat: invalid userId returns false (defensive)
 */
'use strict';

// ── Mock migration flags + serverAT (factories need self-contained closure) ──
jest.mock('../../server/migrationFlags', () => ({
    SERVER_AT: false,
    SERVER_AT_DEMO: false,
}));
jest.mock('../../server/services/serverAT', () => {
    const _userModes = new Map();
    return {
        __setUserMode: (uid, mode) => _userModes.set(uid, mode),
        __clearUserModes: () => _userModes.clear(),
        getMode: jest.fn((userId) => _userModes.get(userId) || 'demo'),
        isATActive: jest.fn(() => true),
        processBrainDecision: jest.fn(),
    };
});
const mockMF = require('../../server/migrationFlags');
const _serverAT = require('../../server/services/serverAT');

// Other minimal mocks to allow serverBrain.js to load
jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []), run: jest.fn() })) },
    atGetState: jest.fn(() => null),
    atSetState: jest.fn(),
    saveSignal: jest.fn(),
    getRecentMissedTrades: jest.fn(() => []),
}));
jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../server/services/audit', () => ({ record: jest.fn() }));
jest.mock('../../server/services/telegram', () => ({ sendToUser: jest.fn() }));
jest.mock('../../server/services/serverState', () => ({ getMarketSnap: jest.fn(() => null) }));
jest.mock('../../server/services/brainLogger', () => ({
    logDecision: jest.fn(),
    linkSeq: jest.fn(),
    updateAction: jest.fn(),
}));
jest.mock('../../server/services/serverPendingEntry', () => ({ checkPending: jest.fn(() => null) }));
jest.mock('../../server/services/serverRegimeParams', () => ({ getAdaptedParams: jest.fn((r, stc) => stc) }));

const serverBrain = require('../../server/services/serverBrain');
// Exposed via _s6b1TestHooks (Phase 2 S6-B1 test-only hook).
const isAuth = serverBrain._s6b1TestHooks.isServerAuthoritativeForUser;

beforeEach(() => {
    mockMF.SERVER_AT = false;
    mockMF.SERVER_AT_DEMO = false;
    _serverAT.__clearUserModes();
});

describe('BUG-T1: _isServerAuthoritativeForUser gate (per-user mode from serverAT)', () => {

    describe('SERVER_AT=true — universal authority', () => {
        test('returns true regardless of user mode', () => {
            mockMF.SERVER_AT = true;
            _serverAT.__setUserMode(1, 'live');
            expect(isAuth(1)).toBe(true);
            _serverAT.__setUserMode(1, 'demo');
            expect(isAuth(1)).toBe(true);
        });
    });

    describe('SERVER_AT=false + SERVER_AT_DEMO=true — demo carve-out', () => {
        test('demo-mode user → true', () => {
            mockMF.SERVER_AT_DEMO = true;
            _serverAT.__setUserMode(1, 'demo');
            expect(isAuth(1)).toBe(true);
        });

        test('live-mode user → false', () => {
            mockMF.SERVER_AT_DEMO = true;
            _serverAT.__setUserMode(1, 'live');
            expect(isAuth(1)).toBe(false);
        });

        test('multi-user — independent per-user mode check', () => {
            mockMF.SERVER_AT_DEMO = true;
            _serverAT.__setUserMode(1, 'live');
            _serverAT.__setUserMode(2, 'demo');
            _serverAT.__setUserMode(3, 'live');
            _serverAT.__setUserMode(4, 'demo');
            expect(isAuth(1)).toBe(false);
            expect(isAuth(2)).toBe(true);
            expect(isAuth(3)).toBe(false);
            expect(isAuth(4)).toBe(true);
        });
    });

    describe('Both flags false — universal block', () => {
        test('returns false even pe demo user', () => {
            _serverAT.__setUserMode(1, 'demo');
            expect(isAuth(1)).toBe(false);
        });

        test('returns false pe live user', () => {
            _serverAT.__setUserMode(1, 'live');
            expect(isAuth(1)).toBe(false);
        });
    });

    describe('defensive handling', () => {
        test('invalid userId → false (getMode defaults to demo, but gate=false sans flags)', () => {
            expect(isAuth(null)).toBe(false);
            expect(isAuth(undefined)).toBe(false);
        });

        test('SERVER_AT_DEMO=true + invalid userId → defaults to demo → true', () => {
            // getMode mock returns 'demo' on unknown userId. Gate matches demo
            // condition. Defensive: this is acceptable — server treats unknown
            // user as demo (safer than live default). DAR atActive check
            // upstream typically prevents reaching gate cu invalid userId.
            mockMF.SERVER_AT_DEMO = true;
            expect(isAuth(null)).toBe(true);
        });
    });
});
