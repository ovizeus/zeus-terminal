'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p69-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ood = require('../../../server/services/ml/R3A_safety/oodNoveltyGate');

const TEST_USER = 9069;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_ood_manifold WHERE user_id IN (?, ?)').run(TEST_USER, 9070);
    db.prepare('DELETE FROM ml_ood_decisions WHERE user_id IN (?, ?)').run(TEST_USER, 9070);
}

function seedManifold(dim, n) {
    for (let i = 0; i < n; i++) {
        ood.addReferencePoint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimension: dim,
            point: [i / 100, (i % 10) / 10, (i % 5) / 5]
        });
    }
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§69 Migrations 129 + 130', () => {
    test('ml_ood_manifold exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_ood_manifold)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'user_id', 'resolved_env', 'dimension',
            'reference_points_json', 'n_samples', 'last_updated'
        ]));
    });

    test('UNIQUE per (user, env, dimension)', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_ood_manifold
             (user_id, resolved_env, dimension, reference_points_json,
              n_samples, last_updated)
             VALUES (?, ?, 'feature_vector', '[]', 0, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_ood_manifold
             (user_id, resolved_env, dimension, reference_points_json,
              n_samples, last_updated)
             VALUES (?, ?, 'feature_vector', '[]', 0, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK dimension restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_ood_manifold
             (user_id, resolved_env, dimension, reference_points_json,
              n_samples, last_updated)
             VALUES (?, ?, 'BOGUS', '[]', 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK classification + action restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_ood_decisions
             (user_id, resolved_env, decision_id, novelty_score,
              dimension_scores_json, classification, action, ts)
             VALUES (?, ?, 'D', 0, '{}', 'BOGUS', 'observer', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
        expect(() => db.prepare(
            `INSERT INTO ml_ood_decisions
             (user_id, resolved_env, decision_id, novelty_score,
              dimension_scores_json, classification, action, ts)
             VALUES (?, ?, 'D2', 0, '{}', 'new_valid', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§69 Constants', () => {
    test('OOD_DIMENSIONS has 5 entries', () => {
        expect(ood.OOD_DIMENSIONS).toHaveLength(5);
        expect(ood.OOD_DIMENSIONS).toEqual(expect.arrayContaining([
            'feature_vector', 'regime_state', 'microstructure_state',
            'macro_context', 'portfolio_state'
        ]));
    });

    test('NOVELTY_CLASSIFICATIONS has 4 entries', () => {
        expect(ood.NOVELTY_CLASSIFICATIONS).toEqual([
            'drift_slow', 'local_outlier', 'new_valid', 'dangerous_unseen'
        ]);
    });

    test('OOD_ACTIONS has 4 entries', () => {
        expect(ood.OOD_ACTIONS).toEqual([
            'continue_normal', 'reduce_size', 'observer', 'alert'
        ]);
    });

    test('thresholds ordered', () => {
        expect(ood.NOVELTY_THRESHOLD_LOCAL_OUTLIER).toBeLessThan(ood.NOVELTY_THRESHOLD_NEW_VALID);
        expect(ood.NOVELTY_THRESHOLD_NEW_VALID).toBeLessThan(ood.NOVELTY_THRESHOLD_DANGEROUS);
    });
});

describe('§69 addReferencePoint', () => {
    test('persists incrementally', () => {
        ood.addReferencePoint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimension: 'feature_vector', point: [0.1, 0.2]
        });
        ood.addReferencePoint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimension: 'feature_vector', point: [0.3, 0.4]
        });
        const size = ood.getManifoldSize({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimension: 'feature_vector'
        });
        expect(size).toBe(2);
    });

    test('throws on invalid dimension', () => {
        expect(() => ood.addReferencePoint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimension: 'BOGUS', point: [0.1]
        })).toThrow();
    });

    test('throws on empty point', () => {
        expect(() => ood.addReferencePoint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimension: 'feature_vector', point: []
        })).toThrow();
    });
});

describe('§69 computeNoveltyScore', () => {
    test('insufficient manifold returns Infinity', () => {
        seedManifold('feature_vector', 5);
        const r = ood.computeNoveltyScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimension: 'feature_vector', queryPoint: [0.5, 0.5, 0.5]
        });
        expect(r.score).toBe(Infinity);
        expect(r.sufficient).toBe(false);
    });

    test('identical to existing point → score ~0', () => {
        seedManifold('feature_vector', 60);
        const r = ood.computeNoveltyScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimension: 'feature_vector',
            queryPoint: [0.0, 0.0, 0.0]  // matches i=0
        });
        expect(r.sufficient).toBe(true);
        expect(r.score).toBeCloseTo(0);
    });

    test('far point → high score', () => {
        seedManifold('feature_vector', 60);
        const r = ood.computeNoveltyScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimension: 'feature_vector',
            queryPoint: [100, 100, 100]
        });
        expect(r.score).toBeGreaterThan(1);
    });
});

describe('§69 classifyNoveltyScore', () => {
    test('low → new_valid + continue_normal', () => {
        const r = ood.classifyNoveltyScore(0.1);
        expect(r.classification).toBe('new_valid');
        expect(r.action).toBe('continue_normal');
    });

    test('mid-low → local_outlier + reduce_size', () => {
        const r = ood.classifyNoveltyScore(0.7);
        expect(r.classification).toBe('local_outlier');
        expect(r.action).toBe('reduce_size');
    });

    test('mid-high → drift_slow + observer', () => {
        const r = ood.classifyNoveltyScore(1.5);
        expect(r.classification).toBe('drift_slow');
        expect(r.action).toBe('observer');
    });

    test('high → dangerous_unseen + alert', () => {
        const r = ood.classifyNoveltyScore(5.0);
        expect(r.classification).toBe('dangerous_unseen');
        expect(r.action).toBe('alert');
    });
});

describe('§69 evaluateDecisionNovelty', () => {
    test('all dims sufficient + low → new_valid', () => {
        for (const d of ood.OOD_DIMENSIONS) seedManifold(d, 60);
        const r = ood.evaluateDecisionNovelty({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryPoints: {
                feature_vector: [0.0, 0.0, 0.0],
                regime_state: [0.0, 0.0, 0.0],
                microstructure_state: [0.0, 0.0, 0.0],
                macro_context: [0.0, 0.0, 0.0],
                portfolio_state: [0.0, 0.0, 0.0]
            }
        });
        expect(r.classification).toBe('new_valid');
        expect(r.action).toBe('continue_normal');
    });

    test('insufficient manifold → dangerous_unseen + alert', () => {
        const r = ood.evaluateDecisionNovelty({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryPoints: {
                feature_vector: [0.5, 0.5],
                regime_state: [0.5]
            }
        });
        expect(r.classification).toBe('dangerous_unseen');
        expect(r.action).toBe('alert');
        expect(r.reason).toMatch(/insufficient/i);
    });

    test('far query → dangerous_unseen', () => {
        for (const d of ood.OOD_DIMENSIONS) seedManifold(d, 60);
        const r = ood.evaluateDecisionNovelty({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryPoints: {
                feature_vector: [50, 50, 50],
                regime_state: [50, 50, 50],
                microstructure_state: [50, 50, 50],
                macro_context: [50, 50, 50],
                portfolio_state: [50, 50, 50]
            }
        });
        expect(r.classification).toBe('dangerous_unseen');
        expect(r.action).toBe('alert');
    });
});

describe('§69 recordOODEvaluation', () => {
    test('persists', () => {
        ood.recordOODEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-001', noveltyScore: 0.3,
            dimensionScores: { feature_vector: 0.3 },
            classification: 'new_valid', action: 'continue_normal'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_ood_decisions WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
    });

    test('handles Infinity score (coerced)', () => {
        ood.recordOODEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-INF', noveltyScore: Infinity,
            dimensionScores: {},
            classification: 'dangerous_unseen', action: 'alert'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_ood_decisions WHERE decision_id = 'D-INF'`
        ).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].novelty_score).toBeGreaterThan(0);
    });

    test('throws on invalid classification', () => {
        expect(() => ood.recordOODEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-BAD', noveltyScore: 0.1,
            dimensionScores: {},
            classification: 'BOGUS', action: 'continue_normal'
        })).toThrow();
    });

    test('throws on invalid action', () => {
        expect(() => ood.recordOODEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-BAD2', noveltyScore: 0.1,
            dimensionScores: {},
            classification: 'new_valid', action: 'BOGUS'
        })).toThrow();
    });
});

describe('§69 getOODHistory + manifold size', () => {
    test('history filterable by classification', () => {
        ood.recordOODEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'H1', noveltyScore: 0.1,
            dimensionScores: {},
            classification: 'new_valid', action: 'continue_normal'
        });
        ood.recordOODEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'H2', noveltyScore: 5,
            dimensionScores: {},
            classification: 'dangerous_unseen', action: 'alert'
        });
        const danger = ood.getOODHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            classification: 'dangerous_unseen'
        });
        expect(danger).toHaveLength(1);
    });
});

describe('§69 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9070;
        ood.addReferencePoint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimension: 'feature_vector', point: [0.1, 0.2]
        });
        const size1 = ood.getManifoldSize({
            userId: TEST_USER, resolvedEnv: TEST_ENV, dimension: 'feature_vector'
        });
        const size2 = ood.getManifoldSize({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, dimension: 'feature_vector'
        });
        expect(size1).toBe(1);
        expect(size2).toBe(0);
    });
});
