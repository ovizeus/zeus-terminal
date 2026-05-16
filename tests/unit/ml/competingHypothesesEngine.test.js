'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p112-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const che = require('../../../server/services/ml/R2_cognition/competingHypothesesEngine');

const TEST_USER = 9112;
const OTHER_USER = 9113;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_hypothesis_registry WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_hypothesis_transitions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§112 Migrations 213 + 214', () => {
    test('hypothesis_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_hypothesis_registry
             (user_id, resolved_env, hypothesis_id, kind,
              posterior_score, status, invalidation_conditions_json,
              ts_created, ts_last_updated)
             VALUES (?, ?, 'HR-UNIQ', 'continuation', 0.4, 'ACTIVE', '{}', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_hypothesis_registry
             (user_id, resolved_env, hypothesis_id, kind,
              posterior_score, status, invalidation_conditions_json,
              ts_created, ts_last_updated)
             VALUES (?, ?, 'HR-UNIQ', 'distribution', 0.3, 'ACTIVE', '{}', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_hypothesis_registry
             (user_id, resolved_env, hypothesis_id, kind,
              posterior_score, status, invalidation_conditions_json,
              ts_created, ts_last_updated)
             VALUES (?, ?, 'HR-BAD', 'BOGUS', 0.5, 'ACTIVE', '{}', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK posterior_score range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_hypothesis_registry
             (user_id, resolved_env, hypothesis_id, kind,
              posterior_score, status, invalidation_conditions_json,
              ts_created, ts_last_updated)
             VALUES (?, ?, 'HR-OOR', 'continuation', 1.5, 'ACTIVE', '{}', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK transition amount_transferred >= 0', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_hypothesis_transitions
             (user_id, resolved_env, transition_id, from_hypothesis_id,
              to_hypothesis_id, evidence_summary,
              posterior_from_before, posterior_from_after,
              posterior_to_before, posterior_to_after,
              amount_transferred, ts)
             VALUES (?, ?, 'HT-BAD', 'A', 'B', 'e', 0.5, 0.5, 0.3, 0.3, -1, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§112 Constants', () => {
    test('HYPOTHESIS_KINDS has 5 entries', () => {
        expect(che.HYPOTHESIS_KINDS).toEqual([
            'continuation', 'distribution',
            'short_covering', 'liquidity_grab', 'macro_override'
        ]);
    });

    test('STATUS_VALUES has 3 entries', () => {
        expect(che.STATUS_VALUES).toEqual(['ACTIVE', 'RETIRED', 'DOMINANT']);
    });

    test('DOMINANCE_THRESHOLD > MIN_POSTERIOR_TO_KEEP', () => {
        expect(che.DOMINANCE_THRESHOLD)
            .toBeGreaterThan(che.MIN_POSTERIOR_TO_KEEP);
    });
});

describe('§112 evaluateDominance (pure)', () => {
    test('enforces NO dominant alone — only one hypothesis blocks dominance', () => {
        const r = che.evaluateDominance({
            hypotheses: [
                { hypothesisId: 'A', kind: 'continuation',
                  posteriorScore: 0.95, status: 'ACTIVE' }
            ]
        });
        expect(r.dominant).toBeNull();
        expect(r.reason).toBe('no_dominant_without_alternatives');
    });

    test('dominant with alternatives allowed', () => {
        const r = che.evaluateDominance({
            hypotheses: [
                { hypothesisId: 'A', kind: 'continuation',
                  posteriorScore: 0.70, status: 'ACTIVE' },
                { hypothesisId: 'B', kind: 'distribution',
                  posteriorScore: 0.20, status: 'ACTIVE' },
                { hypothesisId: 'C', kind: 'short_covering',
                  posteriorScore: 0.10, status: 'ACTIVE' }
            ]
        });
        expect(r.dominant).toBe('A');
    });

    test('no dominant when no hypothesis above threshold', () => {
        const r = che.evaluateDominance({
            hypotheses: [
                { hypothesisId: 'A', kind: 'continuation',
                  posteriorScore: 0.30, status: 'ACTIVE' },
                { hypothesisId: 'B', kind: 'distribution',
                  posteriorScore: 0.30, status: 'ACTIVE' }
            ]
        });
        expect(r.dominant).toBeNull();
    });
});

describe('§112 registerHypothesis', () => {
    test('persists', () => {
        const r = che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'RH-1', kind: 'continuation',
            initialPosterior: 0.4,
            invalidationConditions: { vol_spike: '>3sigma' }
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'RH-DUP', kind: 'continuation',
            initialPosterior: 0.4, invalidationConditions: {}
        });
        expect(() => che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'RH-DUP', kind: 'distribution',
            initialPosterior: 0.3, invalidationConditions: {}
        })).toThrow();
    });

    test('invalid kind throws', () => {
        expect(() => che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'RH-BAD', kind: 'BOGUS',
            initialPosterior: 0.4, invalidationConditions: {}
        })).toThrow();
    });

    test('out-of-range posterior throws', () => {
        expect(() => che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'RH-OOR', kind: 'continuation',
            initialPosterior: 1.5, invalidationConditions: {}
        })).toThrow();
    });
});

describe('§112 transferProbability', () => {
    test('atomic shift updates both posteriors', () => {
        che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'TP-A', kind: 'continuation',
            initialPosterior: 0.6, invalidationConditions: {}
        });
        che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'TP-B', kind: 'distribution',
            initialPosterior: 0.2, invalidationConditions: {}
        });
        const r = che.transferProbability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            transitionId: 'TP-T1',
            fromHypothesisId: 'TP-A', toHypothesisId: 'TP-B',
            evidenceSummary: 'volume divergence',
            amount: 0.15
        });
        expect(r.fromPosteriorAfter).toBeCloseTo(0.45);
        expect(r.toPosteriorAfter).toBeCloseTo(0.35);
    });

    test('clamps to [0,1]', () => {
        che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'TP-C-A', kind: 'continuation',
            initialPosterior: 0.1, invalidationConditions: {}
        });
        che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'TP-C-B', kind: 'distribution',
            initialPosterior: 0.9, invalidationConditions: {}
        });
        const r = che.transferProbability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            transitionId: 'TP-CT',
            fromHypothesisId: 'TP-C-A', toHypothesisId: 'TP-C-B',
            evidenceSummary: 'over-transfer',
            amount: 0.5
        });
        // From clamped to 0, To clamped to 1
        expect(r.fromPosteriorAfter).toBe(0);
        expect(r.toPosteriorAfter).toBe(1);
    });

    test('unknown hypothesis throws', () => {
        expect(() => che.transferProbability({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            transitionId: 'TP-BAD',
            fromHypothesisId: 'NOEXIST', toHypothesisId: 'NOEXIST2',
            evidenceSummary: 'e', amount: 0.1
        })).toThrow();
    });
});

describe('§112 retireWeakHypothesis', () => {
    test('marks RETIRED when below threshold', () => {
        che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'RW-1', kind: 'liquidity_grab',
            initialPosterior: 0.02, invalidationConditions: {}
        });
        const r = che.retireWeakHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'RW-1', reason: 'posterior_below_min'
        });
        expect(r.retired).toBe(true);
    });

    test('rejects retire above threshold', () => {
        che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'RW-STRONG', kind: 'continuation',
            initialPosterior: 0.4, invalidationConditions: {}
        });
        expect(() => che.retireWeakHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'RW-STRONG', reason: 'r'
        })).toThrow();
    });
});

describe('§112 getCompetingHypotheses', () => {
    test('filter by kind', () => {
        che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'GC-CONT', kind: 'continuation',
            initialPosterior: 0.5, invalidationConditions: {}
        });
        che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'GC-DIST', kind: 'distribution',
            initialPosterior: 0.3, invalidationConditions: {}
        });
        const r = che.getCompetingHypotheses({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kindFilter: 'continuation'
        });
        expect(r).toHaveLength(1);
        expect(r[0].hypothesisId).toBe('GC-CONT');
    });
});

describe('§112 isolation', () => {
    test('per (user × env) isolation', () => {
        che.registerHypothesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            hypothesisId: 'ISO-1', kind: 'continuation',
            initialPosterior: 0.5, invalidationConditions: {}
        });
        const a = che.getCompetingHypotheses({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = che.getCompetingHypotheses({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
