'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p82-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cg = require('../../../server/services/ml/R2_cognition/compositionalGeneralization');

const TEST_USER = 9082;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_condition_components WHERE user_id IN (?, ?)').run(TEST_USER, 9083);
    db.prepare('DELETE FROM ml_compositional_predictions WHERE user_id IN (?, ?)').run(TEST_USER, 9083);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§82 Migrations 153 + 154', () => {
    test('condition_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_condition_components
             (user_id, resolved_env, condition_id, name,
              atomic_features_json, known_outcomes_json, ts)
             VALUES (?, ?, 'C-UNIQ', 'test', '{}', '{}', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_condition_components
             (user_id, resolved_env, condition_id, name,
              atomic_features_json, known_outcomes_json, ts)
             VALUES (?, ?, 'C-UNIQ', 'dup', '{}', '{}', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK interaction_rule restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_compositional_predictions
             (user_id, resolved_env, prediction_id, components_used_json,
              interaction_rule, interaction_score, predicted_outcome_json,
              confidence, ts)
             VALUES (?, ?, 'P-BAD', '[]', 'BOGUS', 0.5, '{}', 0.5, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§82 Constants', () => {
    test('INTERACTION_RULES has 4 entries', () => {
        expect(cg.INTERACTION_RULES).toEqual([
            'additive', 'multiplicative', 'min', 'max'
        ]);
    });

    test('MIN_COMPONENTS_FOR_COMPOSITION >= 2', () => {
        expect(cg.MIN_COMPONENTS_FOR_COMPOSITION).toBeGreaterThanOrEqual(2);
    });

    test('COMPONENT_MATCH_THRESHOLD in (0,1)', () => {
        expect(cg.COMPONENT_MATCH_THRESHOLD).toBeGreaterThan(0);
        expect(cg.COMPONENT_MATCH_THRESHOLD).toBeLessThan(1);
    });
});

describe('§82 registerCondition', () => {
    test('persists', () => {
        const r = cg.registerCondition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conditionId: 'COND-1', name: 'trend_up',
            atomicFeatures: { trend: 1.0, vol: 0.5 },
            knownOutcomes: { expectedReturn: 0.05 }
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        cg.registerCondition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conditionId: 'COND-DUP', name: 'x',
            atomicFeatures: {}, knownOutcomes: {}
        });
        expect(() => cg.registerCondition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conditionId: 'COND-DUP', name: 'x',
            atomicFeatures: {}, knownOutcomes: {}
        })).toThrow();
    });
});

describe('§82 decomposeNovelCase', () => {
    beforeEach(() => {
        cg.registerCondition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conditionId: 'TREND', name: 'trend_up',
            atomicFeatures: { trend: 1.0, range: 0 },
            knownOutcomes: { expectedReturn: 0.05 }
        });
        cg.registerCondition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conditionId: 'FUNDING', name: 'funding_extreme',
            atomicFeatures: { funding: 1.0, vol: 0 },
            knownOutcomes: { expectedReturn: -0.03 }
        });
    });

    test('finds matching components from observation', () => {
        const r = cg.decomposeNovelCase({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observedFeatures: { trend: 0.8, funding: 0.9 }
        });
        expect(r.matches.length).toBeGreaterThan(0);
    });

    test('no matches below threshold', () => {
        const r = cg.decomposeNovelCase({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observedFeatures: { unknown_feature: 1.0 }
        });
        expect(r.matches.length).toBe(0);
    });

    test('sorted by match score desc', () => {
        const r = cg.decomposeNovelCase({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observedFeatures: { trend: 1.0, funding: 0.5 }
        });
        if (r.matches.length > 1) {
            expect(r.matches[0].matchScore).toBeGreaterThanOrEqual(r.matches[1].matchScore);
        }
    });
});

describe('§82 predictCompositional', () => {
    const components = [
        { conditionId: 'A', knownOutcomes: { expectedReturn: 0.05 }, matchScore: 0.9 },
        { conditionId: 'B', knownOutcomes: { expectedReturn: -0.03 }, matchScore: 0.8 }
    ];

    test('additive sums outcomes', () => {
        const r = cg.predictCompositional({
            components, interactionRule: 'additive'
        });
        expect(r.predictedOutcome.expectedReturn).toBeCloseTo(0.02);
    });

    test('multiplicative multiplies', () => {
        const r = cg.predictCompositional({
            components: [
                { knownOutcomes: { expectedReturn: 0.5 }, matchScore: 1 },
                { knownOutcomes: { expectedReturn: 0.5 }, matchScore: 1 }
            ],
            interactionRule: 'multiplicative'
        });
        expect(r.predictedOutcome.expectedReturn).toBeCloseTo(0.25);
    });

    test('min takes lowest', () => {
        const r = cg.predictCompositional({
            components, interactionRule: 'min'
        });
        expect(r.predictedOutcome.expectedReturn).toBe(-0.03);
    });

    test('max takes highest', () => {
        const r = cg.predictCompositional({
            components, interactionRule: 'max'
        });
        expect(r.predictedOutcome.expectedReturn).toBe(0.05);
    });

    test('confidence compounds match scores', () => {
        const r = cg.predictCompositional({
            components, interactionRule: 'additive'
        });
        expect(r.confidence).toBeCloseTo(0.72);  // 0.9 × 0.8
    });

    test('throws if insufficient components', () => {
        expect(() => cg.predictCompositional({
            components: [components[0]],
            interactionRule: 'additive'
        })).toThrow();
    });

    test('throws on invalid rule', () => {
        expect(() => cg.predictCompositional({
            components, interactionRule: 'BOGUS'
        })).toThrow();
    });
});

describe('§82 recordPrediction + validatePrediction', () => {
    test('records + validates with error', () => {
        cg.recordPrediction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            predictionId: 'P-1',
            components: [{ id: 'A' }, { id: 'B' }],
            interactionRule: 'additive', interactionScore: 0.8,
            predictedOutcome: { expectedReturn: 0.05 },
            confidence: 0.8
        });
        const r = cg.validatePrediction({
            predictionId: 'P-1',
            actualOutcome: { expectedReturn: 0.04 }
        });
        expect(r.validated).toBe(true);
        expect(r.predictionError).toBeGreaterThanOrEqual(0);
    });

    test('throws on missing prediction', () => {
        expect(() => cg.validatePrediction({
            predictionId: 'NONEXISTENT',
            actualOutcome: { x: 1 }
        })).toThrow();
    });

    test('duplicate predictionId throws', () => {
        cg.recordPrediction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            predictionId: 'P-DUP',
            components: [{ id: 'A' }, { id: 'B' }],
            interactionRule: 'additive', interactionScore: 0.8,
            predictedOutcome: {}, confidence: 0.8
        });
        expect(() => cg.recordPrediction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            predictionId: 'P-DUP',
            components: [{ id: 'A' }, { id: 'B' }],
            interactionRule: 'additive', interactionScore: 0.8,
            predictedOutcome: {}, confidence: 0.8
        })).toThrow();
    });
});

describe('§82 getCompositionStats', () => {
    test('aggregates by rule', () => {
        cg.recordPrediction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            predictionId: 'P-S1',
            components: [{}, {}],
            interactionRule: 'additive', interactionScore: 0.8,
            predictedOutcome: {}, confidence: 0.7
        });
        cg.recordPrediction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            predictionId: 'P-S2',
            components: [{}, {}],
            interactionRule: 'min', interactionScore: 0.6,
            predictedOutcome: {}, confidence: 0.5
        });
        const s = cg.getCompositionStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.total).toBe(2);
    });
});

describe('§82 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9083;
        cg.registerCondition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            conditionId: 'COND-ISO', name: 'iso',
            atomicFeatures: { x: 1 }, knownOutcomes: {}
        });
        const r1 = cg.decomposeNovelCase({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observedFeatures: { x: 1 }
        });
        const r2 = cg.decomposeNovelCase({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            observedFeatures: { x: 1 }
        });
        expect(r1.matches.length).toBe(1);
        expect(r2.matches.length).toBe(0);
    });
});
