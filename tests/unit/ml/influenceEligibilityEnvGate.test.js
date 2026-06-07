'use strict';

/**
 * [T0-1 2026-06-07] Regression guard for the ML influence ENV gate — the
 * staging mechanism that keeps live nudges off per-env.
 *
 * This does NOT freeze live config (it mocks the flags). It guards the
 * env→flag MAPPING (DEMO→ML_DEMO_INFLUENCE_ENABLED, TESTNET→ML_TESTNET,
 * REAL→ML_LIVE) so a future refactor can't silently cross the wires and
 * let a disabled env influence trades. The (a)+(c) staging decision turned
 * ML_TESTNET_INFLUENCE_ENABLED and ML_LIVE_INFLUENCE_ENABLED OFF; this proves
 * those envs then return 'influence_disabled_for_env' BEFORE the observation
 * gate, while DEMO (flag still ON) passes the env gate and remains
 * learning-capable.
 */

// Mock the flags: shadow on, DEMO influence on, TESTNET + REAL off (the staged state).
jest.mock('../../../server/migrationFlags', () => ({
    ML_PIPELINE_SHADOW: true,
    ML_DEMO_INFLUENCE_ENABLED: true,
    ML_TESTNET_INFLUENCE_ENABLED: false,
    ML_LIVE_INFLUENCE_ENABLED: false,
}));

// Mock bandit so DEMO reaches the obs gate without touching the DB.
jest.mock('../../../server/services/ml/_ring5/banditPosteriors', () => ({
    getPosterior: () => null, // 0 observations
}));

const elig = require('../../../server/services/ml/_ring5/influenceEligibility');

const base = (env) => ({ userId: 1, env, symbol: 'BTCUSDT', regime: 'TREND', nowTs: 1780000000000 });

describe('influenceEligibility ENV gate — staged (T0-1: TESTNET+REAL off, DEMO on)', () => {
    test('TESTNET → influence_disabled_for_env (blocked at env gate, before obs)', () => {
        const r = elig.checkEligibility(base('TESTNET'));
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('influence_disabled_for_env');
        expect(r.env).toBe('TESTNET');
    });

    test('REAL → influence_disabled_for_env (blocked at env gate, before obs)', () => {
        const r = elig.checkEligibility(base('REAL'));
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('influence_disabled_for_env');
        expect(r.env).toBe('REAL');
    });

    test('DEMO → passes env gate, falls through to obs gate (still learning-capable)', () => {
        const r = elig.checkEligibility(base('DEMO'));
        expect(r.eligible).toBe(false);
        // NOT influence_disabled_for_env — DEMO flag is on, so the gate it hits
        // is the observation gate (0 obs in this mock), proving DEMO is not
        // env-blocked and would influence once obs+version+prereg are restored.
        expect(r.reason).toBe('insufficient_observations');
    });

    test('env mapping is exact: lowercase env strings still map correctly', () => {
        expect(elig.checkEligibility(base('testnet')).reason).toBe('influence_disabled_for_env');
        expect(elig.checkEligibility(base('real')).reason).toBe('influence_disabled_for_env');
        expect(elig.checkEligibility(base('demo')).reason).toBe('insufficient_observations');
    });
});
