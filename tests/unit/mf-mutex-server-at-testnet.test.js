'use strict';

// Task C — Mutex SERVER_AT_TESTNET vs SERVER_AT
// _validateMutex must reject configurations where TESTNET carve-out coexists
// with the full SERVER_AT flag (carve-out is redundant + confusing).
// Uses _s6b0TestHooks.validateMutex to avoid disk writes.

const MF = require('../../server/migrationFlags');
const validateMutex = MF._s6b0TestHooks.validateMutex;

// Baseline safe state: client owns everything, server flags all false.
const SAFE = {
    SERVER_AT: false,
    SERVER_AT_TESTNET: false,
    SERVER_AT_DEMO: false,
    SERVER_BRAIN: false,
    SERVER_BRAIN_DEMO: false,
    CLIENT_AT: true,
    CLIENT_BRAIN: true,
    BYBIT_TESTNET_ENABLED: false,
    BYBIT_LIVE_ENABLED: false,
    BYBIT_DRY_RUN_ONLY: true,
};

describe('migrationFlags._validateMutex — SERVER_AT_TESTNET vs SERVER_AT', () => {
    test('SAFE baseline passes', () => {
        const v = validateMutex(SAFE);
        expect(v.ok).toBe(true);
        expect(v.violations).toEqual([]);
    });

    test('SERVER_AT_TESTNET && SERVER_AT both true is rejected', () => {
        const f = Object.assign({}, SAFE, {
            CLIENT_AT: false, // required to satisfy SERVER_AT mutex
            SERVER_AT: true,
            SERVER_AT_TESTNET: true,
        });
        const v = validateMutex(f);
        expect(v.ok).toBe(false);
        expect(v.violations.some(m => /SERVER_AT_TESTNET && SERVER_AT/.test(m))).toBe(true);
    });

    test('SERVER_AT_TESTNET alone is allowed', () => {
        const f = Object.assign({}, SAFE, {
            CLIENT_AT: false,
            SERVER_AT_TESTNET: true,
        });
        const v = validateMutex(f);
        expect(v.ok).toBe(true);
    });

    test('SERVER_AT alone (no TESTNET) is allowed', () => {
        const f = Object.assign({}, SAFE, {
            CLIENT_AT: false,
            SERVER_AT: true,
        });
        const v = validateMutex(f);
        expect(v.ok).toBe(true);
    });

    test('both TESTNET + DEMO with full SERVER_AT triggers two violations', () => {
        const f = Object.assign({}, SAFE, {
            CLIENT_AT: false,
            SERVER_AT: true,
            SERVER_AT_TESTNET: true,
            SERVER_AT_DEMO: true,
        });
        const v = validateMutex(f);
        expect(v.ok).toBe(false);
        // Both SERVER_AT_DEMO and SERVER_AT_TESTNET violations should fire
        expect(v.violations.some(m => /SERVER_AT_DEMO && SERVER_AT/.test(m))).toBe(true);
        expect(v.violations.some(m => /SERVER_AT_TESTNET && SERVER_AT/.test(m))).toBe(true);
    });
});
