'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p107-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const il = require('../../../server/services/ml/R5A_learning/invarianceLayer');

const TEST_USER = 9107;
const OTHER_USER = 9108;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_invariance_tests WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_robustness_scores WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§107 Migrations 203 + 204', () => {
    test('test_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_invariance_tests
             (user_id, resolved_env, test_id, model_id, perturbation_kind,
              original_verdict, perturbed_verdict, verdict_stable, magnitude, ts)
             VALUES (?, ?, 'IT-UNIQ', 'M', 'scale', 'a', 'a', 1, 0.1, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_invariance_tests
             (user_id, resolved_env, test_id, model_id, perturbation_kind,
              original_verdict, perturbed_verdict, verdict_stable, magnitude, ts)
             VALUES (?, ?, 'IT-UNIQ', 'M2', 'resampling', 'b', 'c', 0, 0.2, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK perturbation_kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_invariance_tests
             (user_id, resolved_env, test_id, model_id, perturbation_kind,
              original_verdict, perturbed_verdict, verdict_stable, magnitude, ts)
             VALUES (?, ?, 'IT-BAD', 'M', 'BOGUS', 'a', 'a', 1, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK robustness status restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_robustness_scores
             (user_id, resolved_env, score_id, model_id, kind,
              score, sample_count, status, ts)
             VALUES (?, ?, 'RS-BAD', 'M', 'scale', 0.8, 20, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§107 Constants', () => {
    test('PERTURBATION_KINDS has 5 entries', () => {
        expect(il.PERTURBATION_KINDS).toHaveLength(5);
    });

    test('SCORE_KINDS has 6 entries', () => {
        expect(il.SCORE_KINDS).toHaveLength(6);
    });

    test('ROBUSTNESS_STATUSES has 3 entries', () => {
        expect(il.ROBUSTNESS_STATUSES).toEqual([
            'ROBUST', 'FRAGILE', 'INSUFFICIENT'
        ]);
    });
});

describe('§107 computeRobustnessScore (pure)', () => {
    test('all stable → 1.0', () => {
        const r = il.computeRobustnessScore({ stableCount: 10, totalCount: 10 });
        expect(r.score).toBe(1.0);
    });

    test('zero total → 0', () => {
        const r = il.computeRobustnessScore({ stableCount: 0, totalCount: 0 });
        expect(r.score).toBe(0);
    });

    test('stable > total throws', () => {
        expect(() => il.computeRobustnessScore({
            stableCount: 5, totalCount: 3
        })).toThrow();
    });
});

describe('§107 evaluateRobustnessStatus (pure)', () => {
    test('insufficient samples → INSUFFICIENT', () => {
        const r = il.evaluateRobustnessStatus({
            score: 0.95, sampleCount: 3
        });
        expect(r.status).toBe('INSUFFICIENT');
    });

    test('high score + enough samples → ROBUST', () => {
        const r = il.evaluateRobustnessStatus({
            score: 0.90, sampleCount: 50
        });
        expect(r.status).toBe('ROBUST');
    });

    test('low score + enough samples → FRAGILE', () => {
        const r = il.evaluateRobustnessStatus({
            score: 0.40, sampleCount: 50
        });
        expect(r.status).toBe('FRAGILE');
    });
});

describe('§107 runInvarianceTest', () => {
    test('detects stable verdict', () => {
        const r = il.runInvarianceTest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            testId: 'RT-S', modelId: 'M-1',
            perturbationKind: 'scale',
            originalVerdict: { side: 'LONG', size: 1.0 },
            perturbedVerdict: { side: 'LONG', size: 1.0 },
            magnitude: 0.05
        });
        expect(r.verdictStable).toBe(true);
    });

    test('detects unstable verdict', () => {
        const r = il.runInvarianceTest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            testId: 'RT-U', modelId: 'M-1',
            perturbationKind: 'timestamp_jitter',
            originalVerdict: 'LONG',
            perturbedVerdict: 'SHORT'
        });
        expect(r.verdictStable).toBe(false);
    });

    test('invalid perturbation_kind throws', () => {
        expect(() => il.runInvarianceTest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            testId: 'RT-BAD', modelId: 'M',
            perturbationKind: 'BOGUS',
            originalVerdict: 'A', perturbedVerdict: 'A'
        })).toThrow();
    });

    test('duplicate throws', () => {
        il.runInvarianceTest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            testId: 'RT-DUP', modelId: 'M',
            perturbationKind: 'scale',
            originalVerdict: 'A', perturbedVerdict: 'A'
        });
        expect(() => il.runInvarianceTest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            testId: 'RT-DUP', modelId: 'M',
            perturbationKind: 'scale',
            originalVerdict: 'B', perturbedVerdict: 'B'
        })).toThrow();
    });
});

describe('§107 aggregateRobustness', () => {
    function seedTests(modelId, total, stable) {
        for (let i = 0; i < total; i++) {
            il.runInvarianceTest({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                testId: `${modelId}-T-${i}`, modelId,
                perturbationKind: 'scale',
                originalVerdict: 'A',
                perturbedVerdict: i < stable ? 'A' : 'B'
            });
        }
    }

    test('ROBUST aggregate', () => {
        seedTests('AR-ROB', 20, 18);
        const r = il.aggregateRobustness({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scoreId: 'AR-S-ROB', modelId: 'AR-ROB'
        });
        expect(r.status).toBe('ROBUST');
    });

    test('FRAGILE aggregate', () => {
        seedTests('AR-FRAG', 20, 5);
        const r = il.aggregateRobustness({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scoreId: 'AR-S-FRAG', modelId: 'AR-FRAG'
        });
        expect(r.status).toBe('FRAGILE');
    });

    test('INSUFFICIENT aggregate when too few tests', () => {
        seedTests('AR-INS', 5, 5);
        const r = il.aggregateRobustness({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scoreId: 'AR-S-INS', modelId: 'AR-INS'
        });
        expect(r.status).toBe('INSUFFICIENT');
    });
});

describe('§107 getFragileModels', () => {
    test('returns only FRAGILE models', () => {
        // Robust model
        for (let i = 0; i < 20; i++) {
            il.runInvarianceTest({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                testId: `FM-R-${i}`, modelId: 'FM-R',
                perturbationKind: 'scale',
                originalVerdict: 'A', perturbedVerdict: 'A'
            });
        }
        il.aggregateRobustness({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scoreId: 'FM-S-R', modelId: 'FM-R'
        });
        // Fragile model
        for (let i = 0; i < 20; i++) {
            il.runInvarianceTest({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                testId: `FM-F-${i}`, modelId: 'FM-F',
                perturbationKind: 'scale',
                originalVerdict: 'A',
                perturbedVerdict: i < 5 ? 'A' : 'B'
            });
        }
        il.aggregateRobustness({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scoreId: 'FM-S-F', modelId: 'FM-F'
        });
        const r = il.getFragileModels({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.some(m => m.modelId === 'FM-F')).toBe(true);
        expect(r.some(m => m.modelId === 'FM-R')).toBe(false);
    });
});

describe('§107 getTestHistory', () => {
    test('returns DESC by ts', () => {
        il.runInvarianceTest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            testId: 'TH-1', modelId: 'TH-M',
            perturbationKind: 'scale',
            originalVerdict: 'A', perturbedVerdict: 'A',
            ts: 1000
        });
        il.runInvarianceTest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            testId: 'TH-2', modelId: 'TH-M',
            perturbationKind: 'scale',
            originalVerdict: 'A', perturbedVerdict: 'B',
            ts: 2000
        });
        const r = il.getTestHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, modelId: 'TH-M'
        });
        expect(r).toHaveLength(2);
        expect(r[0].testId).toBe('TH-2');
    });
});

describe('§107 isolation', () => {
    test('per (user × env) isolation', () => {
        il.runInvarianceTest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            testId: 'ISO-1', modelId: 'ISO-M',
            perturbationKind: 'scale',
            originalVerdict: 'A', perturbedVerdict: 'A'
        });
        const a = il.getTestHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, modelId: 'ISO-M'
        });
        const b = il.getTestHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, modelId: 'ISO-M'
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
