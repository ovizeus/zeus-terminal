'use strict';

// S8.1 hard real-block — defense-in-depth guard so server AT cannot execute a
// REAL-money order unless _SRV_POS_REAL_ENABLED is STRICTLY true. Fail-closed:
// any missing/ambiguous/truthy-but-not-true flag value must BLOCK real.
// Pure decision tested here; wiring into _resolveExecutionEnv (layer 1) and
// _executeLiveEntry (layer 2) verified by code-read.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-realblock';

let realBlocked;
beforeAll(() => {
    const serverAT = require('../../server/services/serverAT');
    realBlocked = serverAT._s8realBlockTestHooks.realBlocked;
});

describe('_realBlocked — hard real-money execution block (fail-closed)', () => {
    test('REAL + flag strictly true → NOT blocked (real explicitly enabled)', () => {
        expect(realBlocked('REAL', true)).toBe(false);
    });

    test('REAL + flag false → BLOCKED', () => {
        expect(realBlocked('REAL', false)).toBe(true);
    });

    test('REAL + flag undefined → BLOCKED (fail-closed)', () => {
        expect(realBlocked('REAL', undefined)).toBe(true);
    });

    test('REAL + flag null → BLOCKED (fail-closed)', () => {
        expect(realBlocked('REAL', null)).toBe(true);
    });

    test('REAL + flag truthy-but-not-true ("true" string) → BLOCKED (strict ===)', () => {
        expect(realBlocked('REAL', 'true')).toBe(true);
    });

    test('REAL + flag truthy-but-not-true (1) → BLOCKED (strict ===)', () => {
        expect(realBlocked('REAL', 1)).toBe(true);
    });

    test('TESTNET + flag false → NOT blocked (testnet unaffected)', () => {
        expect(realBlocked('TESTNET', false)).toBe(false);
    });

    test('TESTNET + flag true → NOT blocked', () => {
        expect(realBlocked('TESTNET', true)).toBe(false);
    });

    test('DEMO + flag false → NOT blocked (demo unaffected)', () => {
        expect(realBlocked('DEMO', false)).toBe(false);
    });

    test('null env + flag false → NOT blocked (already-blocked upstream, not REAL)', () => {
        expect(realBlocked(null, false)).toBe(false);
    });
});
