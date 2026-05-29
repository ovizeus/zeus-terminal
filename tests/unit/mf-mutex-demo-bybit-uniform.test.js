'use strict';

// [P6] Uniform-mode mutex revision. Demo execution is SIMULATED (mode==='demo' →
// registerManualPosition, _entryCreds=null → no real exchange order), so it does
// NOT conflict with a real Bybit env at the exchange level. The
// SERVER_AT_DEMO && BYBIT_*_ENABLED mutexes are therefore lifted; the genuine
// Bybit-env safety mutexes (testnet⊕live, live⊕dry-run) are KEPT.

const MF = require('../../server/migrationFlags');
const validateMutex = MF._s6b0TestHooks.validateMutex;

const SAFE = {
    SERVER_AT: false, SERVER_AT_TESTNET: false, SERVER_AT_DEMO: false,
    SERVER_BRAIN: false, SERVER_BRAIN_DEMO: false,
    CLIENT_AT: true, CLIENT_BRAIN: true,
    BYBIT_TESTNET_ENABLED: false, BYBIT_LIVE_ENABLED: false, BYBIT_DRY_RUN_ONLY: true,
};

describe('[P6] uniform-mode mutex — demo coexists with a real Bybit env', () => {
    test('SERVER_AT_DEMO + BYBIT_TESTNET_ENABLED is now ALLOWED', () => {
        const f = Object.assign({}, SAFE, { SERVER_AT_DEMO: true, BYBIT_TESTNET_ENABLED: true });
        const v = validateMutex(f);
        expect(v.ok).toBe(true);
        expect(v.violations).toEqual([]);
    });

    test('SERVER_AT_DEMO + BYBIT_LIVE_ENABLED (dry-run off) is now ALLOWED', () => {
        const f = Object.assign({}, SAFE, {
            SERVER_AT_DEMO: true, BYBIT_LIVE_ENABLED: true, BYBIT_DRY_RUN_ONLY: false,
        });
        const v = validateMutex(f);
        expect(v.ok).toBe(true);
    });

    // ─── KEPT mutexes (real Bybit-env safety) must still fire ───
    test('BYBIT_TESTNET_ENABLED && BYBIT_LIVE_ENABLED still rejected', () => {
        const f = Object.assign({}, SAFE, {
            BYBIT_TESTNET_ENABLED: true, BYBIT_LIVE_ENABLED: true, BYBIT_DRY_RUN_ONLY: false,
        });
        const v = validateMutex(f);
        expect(v.ok).toBe(false);
        expect(v.violations.some(m => /BYBIT_TESTNET_ENABLED && BYBIT_LIVE_ENABLED/.test(m))).toBe(true);
    });

    test('BYBIT_LIVE_ENABLED && BYBIT_DRY_RUN_ONLY still rejected', () => {
        const f = Object.assign({}, SAFE, { BYBIT_LIVE_ENABLED: true, BYBIT_DRY_RUN_ONLY: true });
        const v = validateMutex(f);
        expect(v.ok).toBe(false);
        expect(v.violations.some(m => /BYBIT_LIVE_ENABLED && BYBIT_DRY_RUN_ONLY/.test(m))).toBe(true);
    });

    test('SERVER_AT_DEMO && SERVER_AT (redundancy ratchet) still rejected', () => {
        const f = Object.assign({}, SAFE, { CLIENT_AT: false, SERVER_AT: true, SERVER_AT_DEMO: true });
        const v = validateMutex(f);
        expect(v.ok).toBe(false);
        expect(v.violations.some(m => /SERVER_AT_DEMO && SERVER_AT/.test(m))).toBe(true);
    });
});
