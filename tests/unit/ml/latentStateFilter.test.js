'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p105-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const lsf = require('../../../server/services/ml/R2_cognition/latentStateFilter');

const TEST_USER = 9105;
const OTHER_USER = 9106;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_latent_states WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_belief_updates WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§105 Migrations 199 + 200', () => {
    test('state_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_latent_states
             (user_id, resolved_env, state_id, kind, belief_value,
              confidence, inference_tier, supporting_sources_json, ts)
             VALUES (?, ?, 'LS-UNIQ', 'inventory_pressure', 0.6, 0.5, 'inference', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_latent_states
             (user_id, resolved_env, state_id, kind, belief_value,
              confidence, inference_tier, supporting_sources_json, ts)
             VALUES (?, ?, 'LS-UNIQ', 'squeeze_pressure', 0.4, 0.4, 'inference', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK belief_value range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_latent_states
             (user_id, resolved_env, state_id, kind, belief_value,
              confidence, inference_tier, supporting_sources_json, ts)
             VALUES (?, ?, 'LS-OOR', 'inventory_pressure', 1.5, 0.5, 'inference', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK inference_tier restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_latent_states
             (user_id, resolved_env, state_id, kind, belief_value,
              confidence, inference_tier, supporting_sources_json, ts)
             VALUES (?, ?, 'LS-TIER', 'inventory_pressure', 0.5, 0.5, 'BOGUS', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§105 Constants', () => {
    test('LATENT_KINDS has 6 entries', () => {
        expect(lsf.LATENT_KINDS).toHaveLength(6);
    });

    test('INFERENCE_TIERS has 4 entries', () => {
        expect(lsf.INFERENCE_TIERS).toEqual([
            'direct_observation', 'inference',
            'weak_hypothesis', 'strong_hypothesis'
        ]);
    });

    test('direct_observation has highest tier trust prior', () => {
        expect(lsf.TIER_TRUST_PRIOR.direct_observation)
            .toBeGreaterThan(lsf.TIER_TRUST_PRIOR.strong_hypothesis);
        expect(lsf.TIER_TRUST_PRIOR.strong_hypothesis)
            .toBeGreaterThan(lsf.TIER_TRUST_PRIOR.weak_hypothesis);
    });
});

describe('§105 computeBayesianPosterior (pure)', () => {
    test('likelihood=0.5 → posterior=prior', () => {
        const r = lsf.computeBayesianPosterior({
            prior: 0.3, likelihood: 0.5
        });
        expect(r.posterior).toBeCloseTo(0.3);
    });

    test('high likelihood pushes belief up', () => {
        const r = lsf.computeBayesianPosterior({
            prior: 0.3, likelihood: 0.9
        });
        expect(r.posterior).toBeGreaterThan(0.3);
    });

    test('low likelihood pushes belief down', () => {
        const r = lsf.computeBayesianPosterior({
            prior: 0.7, likelihood: 0.1
        });
        expect(r.posterior).toBeLessThan(0.7);
    });

    test('out-of-range throws', () => {
        expect(() => lsf.computeBayesianPosterior({
            prior: 1.5, likelihood: 0.5
        })).toThrow();
    });
});

describe('§105 canVetoHardConstraint (pure)', () => {
    test('inference tier cannot veto regardless of confidence', () => {
        const r = lsf.canVetoHardConstraint({
            inferenceTier: 'inference', confidence: 0.99
        });
        expect(r.canVeto).toBe(false);
    });

    test('direct_observation with high confidence allowed', () => {
        const r = lsf.canVetoHardConstraint({
            inferenceTier: 'direct_observation', confidence: 0.95
        });
        expect(r.canVeto).toBe(true);
    });

    test('direct_observation with low confidence denied', () => {
        const r = lsf.canVetoHardConstraint({
            inferenceTier: 'direct_observation', confidence: 0.5
        });
        expect(r.canVeto).toBe(false);
    });
});

describe('§105 registerLatentState', () => {
    test('persists', () => {
        const r = lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'RS-1', kind: 'inventory_pressure',
            initialBelief: 0.4, confidence: 0.5,
            inferenceTier: 'inference'
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'RS-DUP', kind: 'inventory_pressure',
            initialBelief: 0.4, confidence: 0.5,
            inferenceTier: 'inference'
        });
        expect(() => lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'RS-DUP', kind: 'squeeze_pressure',
            initialBelief: 0.7, confidence: 0.4,
            inferenceTier: 'inference'
        })).toThrow();
    });

    test('invalid kind throws', () => {
        expect(() => lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'RS-BAD', kind: 'BOGUS',
            initialBelief: 0.4, confidence: 0.5,
            inferenceTier: 'inference'
        })).toThrow();
    });

    test('belief out of range throws', () => {
        expect(() => lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'RS-OOR', kind: 'inventory_pressure',
            initialBelief: 1.5, confidence: 0.5,
            inferenceTier: 'inference'
        })).toThrow();
    });
});

describe('§105 updateBelief', () => {
    test('high likelihood increases posterior + bumps confidence', () => {
        lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'UB-1', kind: 'inventory_pressure',
            initialBelief: 0.3, confidence: 0.4,
            inferenceTier: 'inference'
        });
        const r = lsf.updateBelief({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            updateId: 'UB-U1', stateId: 'UB-1',
            likelihood: 0.9
        });
        expect(r.posterior).toBeGreaterThan(0.3);
        expect(r.newConfidence).toBeGreaterThan(0.4);
    });

    test('unknown state throws', () => {
        expect(() => lsf.updateBelief({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            updateId: 'UB-BAD', stateId: 'NOEXIST',
            likelihood: 0.5
        })).toThrow();
    });
});

describe('§105 getActiveBeliefs', () => {
    test('filter by minConfidence', () => {
        lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'AB-HI', kind: 'inventory_pressure',
            initialBelief: 0.6, confidence: 0.8,
            inferenceTier: 'direct_observation'
        });
        lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'AB-LO', kind: 'inventory_pressure',
            initialBelief: 0.5, confidence: 0.10,
            inferenceTier: 'weak_hypothesis'
        });
        const r = lsf.getActiveBeliefs({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            minConfidence: 0.30
        });
        expect(r).toHaveLength(1);
        expect(r[0].stateId).toBe('AB-HI');
    });

    test('filter by kind', () => {
        lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'AB-INV', kind: 'inventory_pressure',
            initialBelief: 0.5, confidence: 0.6,
            inferenceTier: 'inference'
        });
        lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'AB-CRD', kind: 'crowd_fragility',
            initialBelief: 0.5, confidence: 0.6,
            inferenceTier: 'inference'
        });
        const r = lsf.getActiveBeliefs({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kind: 'inventory_pressure', minConfidence: 0
        });
        expect(r).toHaveLength(1);
        expect(r[0].stateId).toBe('AB-INV');
    });
});

describe('§105 getBeliefHistory', () => {
    test('returns updates DESC', () => {
        lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'BH-1', kind: 'squeeze_pressure',
            initialBelief: 0.3, confidence: 0.4,
            inferenceTier: 'inference'
        });
        lsf.updateBelief({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            updateId: 'BH-U1', stateId: 'BH-1', likelihood: 0.7, ts: 1000
        });
        lsf.updateBelief({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            updateId: 'BH-U2', stateId: 'BH-1', likelihood: 0.8, ts: 2000
        });
        const r = lsf.getBeliefHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, stateId: 'BH-1'
        });
        expect(r).toHaveLength(2);
        expect(r[0].updateId).toBe('BH-U2');
    });
});

describe('§105 isolation', () => {
    test('per (user × env) isolation', () => {
        lsf.registerLatentState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            stateId: 'ISO-1', kind: 'inventory_pressure',
            initialBelief: 0.5, confidence: 0.6,
            inferenceTier: 'inference'
        });
        const a = lsf.getActiveBeliefs({
            userId: TEST_USER, resolvedEnv: TEST_ENV, minConfidence: 0
        });
        const b = lsf.getActiveBeliefs({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, minConfidence: 0
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
