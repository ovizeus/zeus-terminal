'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p114-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cl = require('../../../server/services/ml/R5A_learning/conceptLibrary');

const TEST_USER = 9114;
const OTHER_USER = 9115;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_concepts WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_concept_observations WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§114 Migrations 217 + 218', () => {
    test('concept_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_concepts
             (user_id, resolved_env, concept_id, label, description,
              support_count, utility_score, confidence, status,
              parent_concept_id, ts_created, ts_last_updated)
             VALUES (?, ?, 'C-UNIQ', 'exhausted_breakout', 'd', 0, 0.3, 0.5, 'ACTIVE', NULL, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_concepts
             (user_id, resolved_env, concept_id, label, description,
              support_count, utility_score, confidence, status,
              parent_concept_id, ts_created, ts_last_updated)
             VALUES (?, ?, 'C-UNIQ', 'fragile_squeeze', 'd2', 0, 0.4, 0.5, 'ACTIVE', NULL, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK status restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_concepts
             (user_id, resolved_env, concept_id, label, description,
              support_count, utility_score, confidence, status,
              parent_concept_id, ts_created, ts_last_updated)
             VALUES (?, ?, 'C-BAD', 'x', 'd', 0, 0, 0.5, 'BOGUS', NULL, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK utility_score range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_concepts
             (user_id, resolved_env, concept_id, label, description,
              support_count, utility_score, confidence, status,
              parent_concept_id, ts_created, ts_last_updated)
             VALUES (?, ?, 'C-OOR', 'x', 'd', 0, 1.5, 0.5, 'ACTIVE', NULL, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK decision_relevance range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_concept_observations
             (user_id, resolved_env, observation_id, concept_id,
              market_state_json, outcome, decision_relevance, ts)
             VALUES (?, ?, 'O-BAD', 'C', '{}', 'win', 1.5, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§114 Constants', () => {
    test('CANONICAL_LABELS has 5 entries', () => {
        expect(cl.CANONICAL_LABELS).toEqual([
            'exhausted_breakout', 'fragile_squeeze',
            'trapped_continuation', 'macro_opposed_trend',
            'silent_distribution'
        ]);
    });

    test('CONCEPT_STATUSES has 4 entries', () => {
        expect(cl.CONCEPT_STATUSES).toEqual([
            'ACTIVE', 'MERGED', 'SPLIT', 'RETIRED'
        ]);
    });

    test('MIN_SUPPORT_FOR_ACTIVE positive', () => {
        expect(cl.MIN_SUPPORT_FOR_ACTIVE).toBeGreaterThan(0);
    });

    test('MIN_UTILITY_TO_KEEP in (0,1)', () => {
        expect(cl.MIN_UTILITY_TO_KEEP).toBeGreaterThan(0);
        expect(cl.MIN_UTILITY_TO_KEEP).toBeLessThan(1);
    });
});

describe('§114 computeConceptUtility (pure)', () => {
    test('utility = avg(relevance) × confidence', () => {
        const r = cl.computeConceptUtility({
            observations: [
                { decisionRelevance: 0.8 },
                { decisionRelevance: 0.6 },
                { decisionRelevance: 1.0 }
            ],
            confidence: 0.5
        });
        // avg = 0.8; utility = 0.8 × 0.5 = 0.4
        expect(r.utility).toBeCloseTo(0.4);
    });

    test('zero observations → 0', () => {
        const r = cl.computeConceptUtility({
            observations: [], confidence: 0.9
        });
        expect(r.utility).toBe(0);
    });

    test('zero confidence → 0', () => {
        const r = cl.computeConceptUtility({
            observations: [{ decisionRelevance: 1.0 }],
            confidence: 0
        });
        expect(r.utility).toBe(0);
    });
});

describe('§114 registerConcept', () => {
    test('persists', () => {
        const r = cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'RC-1', label: 'exhausted_breakout',
            description: 'breakout that fails immediately after print',
            initialConfidence: 0.7
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'RC-DUP', label: 'x', description: 'd',
            initialConfidence: 0.5
        });
        expect(() => cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'RC-DUP', label: 'y', description: 'd2',
            initialConfidence: 0.5
        })).toThrow();
    });

    test('invalid confidence throws', () => {
        expect(() => cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'RC-BAD', label: 'x', description: 'd',
            initialConfidence: 1.5
        })).toThrow();
    });
});

describe('§114 recordObservation', () => {
    test('auto-increments support + updates utility', () => {
        cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'RO-1', label: 'fragile_squeeze',
            description: 'd', initialConfidence: 0.6
        });
        const r = cl.recordObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observationId: 'RO-O1', conceptId: 'RO-1',
            marketState: { regime: 'squeeze' },
            outcome: 'win', decisionRelevance: 0.7
        });
        expect(r.recorded).toBe(true);
        expect(r.newSupportCount).toBe(1);
    });

    test('invalid relevance throws', () => {
        expect(() => cl.recordObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observationId: 'RO-BAD', conceptId: 'C',
            marketState: {}, outcome: 'win',
            decisionRelevance: 1.5
        })).toThrow();
    });

    test('unknown concept throws', () => {
        expect(() => cl.recordObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observationId: 'RO-NOEXIST', conceptId: 'NOEXIST',
            marketState: {}, outcome: 'win',
            decisionRelevance: 0.5
        })).toThrow();
    });
});

describe('§114 mergeConcepts', () => {
    test('marks sources MERGED + creates merged concept', () => {
        cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'MC-A', label: 'x', description: 'a',
            initialConfidence: 0.6
        });
        cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'MC-B', label: 'y', description: 'b',
            initialConfidence: 0.5
        });
        const r = cl.mergeConcepts({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sourceConceptIds: ['MC-A', 'MC-B'],
            mergedConceptId: 'MC-MERGED',
            mergedLabel: 'merged_concept',
            mergedDescription: 'a+b combined'
        });
        expect(r.merged).toBe(true);

        const active = cl.getActiveConcepts({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(active.find(c => c.conceptId === 'MC-MERGED')).toBeTruthy();
        expect(active.find(c => c.conceptId === 'MC-A')).toBeUndefined();
    });

    test('empty sources throws', () => {
        expect(() => cl.mergeConcepts({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sourceConceptIds: [],
            mergedConceptId: 'MC-EMPTY',
            mergedLabel: 'x', mergedDescription: 'd'
        })).toThrow();
    });
});

describe('§114 retireConcept', () => {
    test('retires when below support threshold', () => {
        cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'RT-LOW', label: 'x', description: 'd',
            initialConfidence: 0.5
        });
        const r = cl.retireConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'RT-LOW', reason: 'insufficient_support'
        });
        expect(r.retired).toBe(true);
    });

    test('rejects retire when strong (high support + utility)', () => {
        cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'RT-STRONG', label: 'x', description: 'd',
            initialConfidence: 0.9
        });
        // Add many high-utility observations
        for (let i = 0; i < 15; i++) {
            cl.recordObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                observationId: `RT-S-O${i}`, conceptId: 'RT-STRONG',
                marketState: {}, outcome: 'win',
                decisionRelevance: 0.9
            });
        }
        expect(() => cl.retireConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'RT-STRONG', reason: 'r'
        })).toThrow();
    });
});

describe('§114 getActiveConcepts', () => {
    test('filter by minUtility', () => {
        cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'GA-LOW', label: 'x', description: 'd',
            initialConfidence: 0.1
        });
        cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'GA-HIGH', label: 'y', description: 'd',
            initialConfidence: 0.9
        });
        for (let i = 0; i < 10; i++) {
            cl.recordObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                observationId: `GA-O${i}`, conceptId: 'GA-HIGH',
                marketState: {}, outcome: 'win', decisionRelevance: 0.9
            });
        }
        const r = cl.getActiveConcepts({
            userId: TEST_USER, resolvedEnv: TEST_ENV, minUtility: 0.5
        });
        expect(r.find(c => c.conceptId === 'GA-HIGH')).toBeTruthy();
        expect(r.find(c => c.conceptId === 'GA-LOW')).toBeUndefined();
    });
});

describe('§114 isolation', () => {
    test('per (user × env) isolation', () => {
        cl.registerConcept({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conceptId: 'ISO-1', label: 'x', description: 'd',
            initialConfidence: 0.5
        });
        const a = cl.getActiveConcepts({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = cl.getActiveConcepts({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
