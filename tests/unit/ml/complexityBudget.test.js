'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p94-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cb = require('../../../server/services/ml/R5B_governance/complexityBudget');

const TEST_USER = 9094;
const OTHER_USER = 9095;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_complexity_registry WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_complexity_evaluations WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§94 Migrations 177 + 178', () => {
    test('feature_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_complexity_registry
             (user_id, resolved_env, feature_id, complexity_units,
              information_gain, mdl_score, status, last_evaluated, ts)
             VALUES (?, ?, 'F-UNIQ', 10, 0.5, 100, 'ACTIVE', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_complexity_registry
             (user_id, resolved_env, feature_id, complexity_units,
              information_gain, mdl_score, status, last_evaluated, ts)
             VALUES (?, ?, 'F-UNIQ', 20, 0.4, 110, 'ACTIVE', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK status restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_complexity_registry
             (user_id, resolved_env, feature_id, complexity_units,
              information_gain, mdl_score, status, last_evaluated, ts)
             VALUES (?, ?, 'F-BAD', 10, 0.5, 100, 'BOGUS', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK complexity_units >= 0', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_complexity_registry
             (user_id, resolved_env, feature_id, complexity_units,
              information_gain, mdl_score, status, last_evaluated, ts)
             VALUES (?, ?, 'F-NEG', -1, 0.5, 100, 'ACTIVE', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK decision restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_complexity_evaluations
             (user_id, resolved_env, evaluation_id, feature_id,
              marginal_ig, marginal_complexity, mdl_delta, decision, reason, ts)
             VALUES (?, ?, 'E-BAD', 'F', 0.5, 1, 0, 'BOGUS', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§94 Constants', () => {
    test('FEATURE_STATUSES has 3 entries', () => {
        expect(cb.FEATURE_STATUSES).toEqual(['ACTIVE', 'EVALUATING', 'PRUNED']);
    });

    test('EVALUATION_DECISIONS has 3 entries', () => {
        expect(cb.EVALUATION_DECISIONS).toEqual(['KEEP', 'WATCH', 'PRUNE']);
    });

    test('thresholds ordered', () => {
        expect(cb.WATCH_THRESHOLD).toBeLessThan(1.0);
        expect(cb.DEFAULT_LAMBDA).toBeGreaterThan(0);
    });
});

describe('§94 computeMDLScore (pure BIC)', () => {
    test('higher param count → higher MDL', () => {
        const a = cb.computeMDLScore({
            negLogLikelihood: 100, paramCount: 5, sampleCount: 1000
        });
        const b = cb.computeMDLScore({
            negLogLikelihood: 100, paramCount: 10, sampleCount: 1000
        });
        expect(b).toBeGreaterThan(a);
    });

    test('throws on invalid params', () => {
        expect(() => cb.computeMDLScore({
            negLogLikelihood: 0, paramCount: -1, sampleCount: 100
        })).toThrow();
    });
});

describe('§94 evaluateMarginalContribution (pure)', () => {
    test('high IG vs low cost → KEEP', () => {
        const r = cb.evaluateMarginalContribution({
            informationGain: 1.0, complexityCost: 0.5
        });
        expect(r.decision).toBe('KEEP');
    });

    test('marginal IG → WATCH', () => {
        const r = cb.evaluateMarginalContribution({
            informationGain: 0.5, complexityCost: 1.0
        });
        // ratio = 0.5 / (1.0 × 1.0) = 0.5 → boundary → WATCH (>= WATCH_THRESHOLD)
        expect(r.decision).toBe('WATCH');
    });

    test('low IG → PRUNE', () => {
        const r = cb.evaluateMarginalContribution({
            informationGain: 0.1, complexityCost: 1.0
        });
        expect(r.decision).toBe('PRUNE');
    });

    test('zero complexity → KEEP (free feature)', () => {
        const r = cb.evaluateMarginalContribution({
            informationGain: 0.01, complexityCost: 0
        });
        expect(r.decision).toBe('KEEP');
    });
});

describe('§94 registerFeature', () => {
    test('persists', () => {
        const r = cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'F-1', complexityUnits: 5,
            informationGain: 0.7
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'F-DUP', complexityUnits: 5
        });
        expect(() => cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'F-DUP', complexityUnits: 10
        })).toThrow();
    });

    test('negative complexity throws', () => {
        expect(() => cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'F-NEG', complexityUnits: -1
        })).toThrow();
    });
});

describe('§94 recordEvaluation', () => {
    test('KEEP decision keeps feature ACTIVE', () => {
        cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'F-K', complexityUnits: 5
        });
        const r = cb.recordEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            evaluationId: 'E-K', featureId: 'F-K',
            marginalIG: 1.0, marginalComplexity: 0.5
        });
        expect(r.decision).toBe('KEEP');
        expect(r.newStatus).toBe('ACTIVE');
    });

    test('PRUNE decision auto-marks feature PRUNED', () => {
        cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'F-P', complexityUnits: 10
        });
        const r = cb.recordEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            evaluationId: 'E-P', featureId: 'F-P',
            marginalIG: 0.05, marginalComplexity: 1.0
        });
        expect(r.decision).toBe('PRUNE');
        expect(r.newStatus).toBe('PRUNED');
        const active = cb.getActiveFeatures({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(active.find(f => f.featureId === 'F-P')).toBeUndefined();
    });

    test('WATCH transitions ACTIVE → EVALUATING', () => {
        cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'F-W', complexityUnits: 5
        });
        const r = cb.recordEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            evaluationId: 'E-W', featureId: 'F-W',
            marginalIG: 0.5, marginalComplexity: 1.0
        });
        expect(r.decision).toBe('WATCH');
        expect(r.newStatus).toBe('EVALUATING');
    });

    test('unregistered feature throws', () => {
        expect(() => cb.recordEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            evaluationId: 'E-MISSING', featureId: 'NOEXIST',
            marginalIG: 0.5, marginalComplexity: 1.0
        })).toThrow();
    });
});

describe('§94 pruneFeature', () => {
    test('marks PRUNED', () => {
        cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'F-MAN', complexityUnits: 5
        });
        const r = cb.pruneFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'F-MAN', reason: 'operator_decision'
        });
        expect(r.pruned).toBe(true);
        expect(r.previousStatus).toBe('ACTIVE');
    });
});

describe('§94 getActiveFeatures', () => {
    test('default returns only ACTIVE', () => {
        cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'GA-1', complexityUnits: 5
        });
        cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'GA-2', complexityUnits: 5
        });
        cb.pruneFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'GA-2'
        });
        const active = cb.getActiveFeatures({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(active).toHaveLength(1);
        expect(active[0].featureId).toBe('GA-1');
    });

    test('includeAll returns pruned too', () => {
        cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'IA-1', complexityUnits: 5
        });
        cb.pruneFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'IA-1'
        });
        const all = cb.getActiveFeatures({
            userId: TEST_USER, resolvedEnv: TEST_ENV, includeAll: true
        });
        expect(all).toHaveLength(1);
        expect(all[0].status).toBe('PRUNED');
    });
});

describe('§94 isolation', () => {
    test('per (user × env) isolation', () => {
        cb.registerFeature({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureId: 'ISO-1', complexityUnits: 5
        });
        const a = cb.getActiveFeatures({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const b = cb.getActiveFeatures({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
