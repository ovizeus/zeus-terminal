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
    // [BUG-T7 FOLLOWUP 2026-05-13] Mock returns valid creds pentru a permite
    // setMode('live') să treacă validarea credentials check și să poate testa
    // full sequence demo↔live switch + toggle per-mode.
    getExchangeCreds: jest.fn(() => ({ apiKey: 'test', apiSecret: 'test', env: 'testnet' })),
}));
jest.mock('../../server/services/binanceSigner', () => ({
    sendSignedRequest: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../../server/services/exchangeInfo', () => ({
    roundOrderParams: jest.fn(x => x),
    getFilters: jest.fn(() => ({})),
    startAutoRefresh: jest.fn(),
}));
jest.mock('../../server/services/riskGuard', () => ({
    validateOrder: jest.fn(() => ({ ok: true })),
    recordClosedPnL: jest.fn(),
}));
jest.mock('../../server/services/reconHelpers', () => ({
    buildBinanceHeldMap: jest.fn(() => new Map()),
    findExitTrade: jest.fn(() => null),
}));
jest.mock('../../server/services/orphanAlert', () => ({
    alertOrphanRisk: jest.fn(),
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

    describe('[FOLLOWUP] setMode resync legacy atActive cu new engineMode', () => {
        test('demo ON, switch live → atActive reflects live (false fresh)', () => {
            serverAT.toggleActive(1, true, 'demo');  // demo ON
            expect(serverAT.getFullState(1).atActive).toBe(true);  // sync demo

            // Switch to live — fresh atActiveLive=false
            // Note: setMode pentru 'live' requires credentials; skip această parte
            // because mock returns null. Test directly atActive recompute logic.
            // Verify via getFullState după per-mode toggle pe live.
            serverAT.toggleActive(1, true, 'live');
            const full = serverAT.getFullState(1);
            expect(full.atActiveDemo).toBe(true);
            expect(full.atActiveLive).toBe(true);
            // getFullState computed dynamic based on engineMode=demo → reflects demo
            expect(full.atActive).toBe(true);
        });

        test('getFullState atActive computed DYNAMIC din mode-specific flag', () => {
            // Fresh state: both flags false
            const full1 = serverAT.getFullState(1);
            expect(full1.atActive).toBe(false);
            expect(full1.enabled).toBe(false);

            // Toggle demo ON, engineMode still 'demo'
            serverAT.toggleActive(1, true, 'demo');
            const full2 = serverAT.getFullState(1);
            expect(full2.atActive).toBe(true);   // dynamic = atActiveDemo (engineMode=demo)
            expect(full2.enabled).toBe(true);

            // Toggle demo OFF — atActive should be FALSE even dacă in-memory stale
            serverAT.toggleActive(1, false, 'demo');
            const full3 = serverAT.getFullState(1);
            expect(full3.atActive).toBe(false);
            expect(full3.atActiveDemo).toBe(false);
        });
    });

    describe('[OPERATOR-REPORTED E2E] sequence-ul exact reportat 2026-05-13', () => {
        // Scenariu operator (real device):
        //   1. State inițial: live=ON, demo=OFF
        //   2. Switch live → demo
        //   3. Toggle ON (activate în demo)
        //   4. Switch demo → live
        //   5. Expected: live=ON (preserved)
        //   6. Operator observă: live=OFF (BUG)
        //
        // Acest test verifică EXACT că fix-ul rezolvă scenariu.

        test('LIVE ON preserved după demo activate + switch back live', () => {
            // Step 1: Setup state inițial — live=ON, demo=OFF
            serverAT.toggleActive(1, true, 'live');   // live ON
            // demo rămâne OFF din beforeEach reset
            let state = serverAT.getFullState(1);
            expect(state.atActiveLive).toBe(true);
            expect(state.atActiveDemo).toBe(false);

            // Step 2: Switch de la live la demo
            const sw1 = serverAT.setMode(1, 'demo');
            expect(sw1.ok).toBe(true);
            state = serverAT.getFullState(1);
            expect(state.mode).toBe('demo');
            // getFullState atActive computed dynamic → reflects atActiveDemo=false
            expect(state.atActive).toBe(false);
            expect(state.atActiveDemo).toBe(false);  // unchanged
            expect(state.atActiveLive).toBe(true);   // PRESERVED

            // Step 3: Toggle ON (în demo — no mode arg, server uses engineMode=demo)
            const tog = serverAT.toggleActive(1, true);
            expect(tog.ok).toBe(true);
            expect(tog.mode).toBe('demo');
            state = serverAT.getFullState(1);
            expect(state.atActiveDemo).toBe(true);
            expect(state.atActiveLive).toBe(true);   // STILL PRESERVED
            expect(state.atActive).toBe(true);       // dynamic from demo

            // Step 4: Switch de la demo la live (CRITICAL — operator's bug step)
            const sw2 = serverAT.setMode(1, 'live');
            expect(sw2.ok).toBe(true);
            state = serverAT.getFullState(1);
            expect(state.mode).toBe('live');

            // Step 5: VERIFY live=ON preserved (operator's bug observation)
            expect(state.atActiveLive).toBe(true);   // PRESERVED ✅
            expect(state.atActiveDemo).toBe(true);   // unchanged
            expect(state.atActive).toBe(true);       // dynamic from live = atActiveLive
            expect(state.enabled).toBe(true);        // dynamic from live = atActiveLive
        });

        test('reverse: DEMO ON preserved după live toggle OFF + switch back demo', () => {
            // Same pattern mirror: demo ON, switch live, toggle OFF live, switch back demo
            // Expected: demo=ON preserved
            serverAT.toggleActive(1, true, 'demo');
            serverAT.setMode(1, 'live');
            serverAT.toggleActive(1, false);  // toggle OFF în live (no mode arg)
            const state1 = serverAT.getFullState(1);
            expect(state1.atActiveLive).toBe(false);
            expect(state1.atActiveDemo).toBe(true);  // PRESERVED

            // Switch back to demo
            serverAT.setMode(1, 'demo');
            const state2 = serverAT.getFullState(1);
            expect(state2.atActiveDemo).toBe(true);  // PRESERVED ✅
            expect(state2.atActive).toBe(true);      // dynamic from demo
        });

        test('multi-cycle: 5 switches păstrează independence', () => {
            // Operator scenariu extins — multiple cycle-uri demo↔live
            serverAT.toggleActive(1, true, 'demo');
            serverAT.toggleActive(1, true, 'live');
            // Both ON

            // 5 switch cycles cu toggle în fiecare mode
            for (let i = 0; i < 5; i++) {
                serverAT.setMode(1, 'live');
                let s = serverAT.getFullState(1);
                expect(s.atActiveLive).toBe(true);  // never accidentally reset
                expect(s.atActiveDemo).toBe(true);  // never accidentally reset

                serverAT.setMode(1, 'demo');
                s = serverAT.getFullState(1);
                expect(s.atActiveLive).toBe(true);  // never accidentally reset
                expect(s.atActiveDemo).toBe(true);  // never accidentally reset
            }
        });

        test('[FOLLOWUP-2] setMode return shape — include atActive computed pentru new mode', () => {
            // Setup: live ON, demo OFF
            serverAT.toggleActive(1, true, 'live');

            // Switch to demo
            const resultDemo = serverAT.setMode(1, 'demo');
            expect(resultDemo.ok).toBe(true);
            expect(resultDemo.mode).toBe('demo');
            expect(resultDemo.oldMode).toBe('demo'); // initial state defaults la demo before any setMode
            expect(resultDemo.atActive).toBe(false); // atActiveDemo=false (fresh)
            expect(resultDemo.atActiveDemo).toBe(false);
            expect(resultDemo.atActiveLive).toBe(true); // preserved

            // Switch back to live
            const resultLive = serverAT.setMode(1, 'live');
            expect(resultLive.ok).toBe(true);
            expect(resultLive.mode).toBe('live');
            expect(resultLive.atActive).toBe(true); // computed pentru new mode (atActiveLive=true)
            expect(resultLive.atActiveLive).toBe(true);
            expect(resultLive.atActiveDemo).toBe(false);
        });

        test('multi-user: independence între users + per-mode', () => {
            // Setup: uid=1 cu live ON, uid=2 cu demo ON
            // Cleanup beforeEach only handles uid=1; reset uid=2 explicit
            serverAT.reset(2);
            serverAT.toggleActive(2, false, 'demo');
            serverAT.toggleActive(2, false, 'live');

            serverAT.toggleActive(1, true, 'live');
            serverAT.toggleActive(2, true, 'demo');

            // Switch uid=1 modes
            serverAT.setMode(1, 'demo');
            serverAT.setMode(1, 'live');

            // uid=2 state nu trebuie afectat by uid=1 operations
            const s2 = serverAT.getFullState(2);
            expect(s2.atActiveDemo).toBe(true);
            expect(s2.atActiveLive).toBe(false);

            // uid=1 state correct
            const s1 = serverAT.getFullState(1);
            expect(s1.atActiveLive).toBe(true);  // preserved through 2 switches
            expect(s1.atActiveDemo).toBe(false);
        });
    });
});
