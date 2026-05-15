'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p54-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const xai = require('../../../server/services/ml/_crosscutting/xaiLayer');

const TEST_USER = 9054;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_xai_explanations WHERE user_id IN (?, ?)').run(TEST_USER, 9055);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§54 Migration 124', () => {
    test('ml_xai_explanations exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_xai_explanations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'user_id', 'resolved_env', 'decision_id', 'action',
            'top_factors_json', 'counterfactual_json',
            'confidence_level', 'ts'
        ]));
    });
});

describe('§54 Constants', () => {
    test('TOP_FACTORS_COUNT = 3 per spec', () => {
        expect(xai.TOP_FACTORS_COUNT).toBe(3);
    });

    test('DEFAULT_CONFIDENCE_LEVEL between 0 and 1', () => {
        expect(xai.DEFAULT_CONFIDENCE_LEVEL).toBeGreaterThan(0);
        expect(xai.DEFAULT_CONFIDENCE_LEVEL).toBeLessThan(1);
    });

    test('COUNTERFACTUAL_DIRECTIONS has 3 entries', () => {
        expect(xai.COUNTERFACTUAL_DIRECTIONS).toEqual(['increase', 'decrease', 'any']);
    });
});

describe('§54 computeXAI', () => {
    test('returns top 3 factors ordered by |shap|', () => {
        const r = xai.computeXAI({
            featureContributions: [
                { name: 'f1', shapValue: 0.1 },
                { name: 'f2', shapValue: 0.5 },
                { name: 'f3', shapValue: -0.3 },
                { name: 'f4', shapValue: 0.05 },
                { name: 'f5', shapValue: -0.4 }
            ],
            decisionScore: 0.65, decisionThreshold: 0.5
        });
        expect(r.topFactors).toHaveLength(3);
        expect(r.topFactors[0].name).toBe('f2');  // |0.5|
        expect(r.topFactors[1].name).toBe('f5');  // |0.4|
        expect(r.topFactors[2].name).toBe('f3');  // |0.3|
    });

    test('confidence interval bracketed around shap value', () => {
        const r = xai.computeXAI({
            featureContributions: [
                { name: 'f1', shapValue: 1.0, stdError: 0.1 }
            ],
            decisionScore: 0.6, decisionThreshold: 0.5
        });
        expect(r.topFactors[0].confidenceLow).toBeLessThan(1.0);
        expect(r.topFactors[0].confidenceHigh).toBeGreaterThan(1.0);
        expect(r.topFactors[0].confidenceHigh - r.topFactors[0].confidenceLow).toBeGreaterThan(0);
    });

    test('counterfactual returns direction + shift per top factor', () => {
        const r = xai.computeXAI({
            featureContributions: [
                { name: 'rsi', shapValue: 0.5, sensitivity: 0.10 },
                { name: 'vol', shapValue: 0.3, sensitivity: 0.05 }
            ],
            decisionScore: 0.65, decisionThreshold: 0.5
        });
        expect(r.counterfactual).toHaveLength(2);
        for (const cf of r.counterfactual) {
            expect(['increase', 'decrease', 'any']).toContain(cf.direction);
            expect(cf.shiftNeededToFlip).toBeGreaterThanOrEqual(0);
        }
    });

    test('positive distance → decrease direction (score above threshold)', () => {
        const r = xai.computeXAI({
            featureContributions: [
                { name: 'f1', shapValue: 1.0, sensitivity: 1.0 }
            ],
            decisionScore: 0.7, decisionThreshold: 0.5
        });
        expect(r.counterfactual[0].direction).toBe('decrease');
        expect(r.counterfactual[0].shiftNeededToFlip).toBeCloseTo(0.2);
    });

    test('negative distance → increase direction', () => {
        const r = xai.computeXAI({
            featureContributions: [
                { name: 'f1', shapValue: 1.0, sensitivity: 1.0 }
            ],
            decisionScore: 0.3, decisionThreshold: 0.5
        });
        expect(r.counterfactual[0].direction).toBe('increase');
        expect(r.counterfactual[0].shiftNeededToFlip).toBeCloseTo(0.2);
    });

    test('confidence level customizable', () => {
        const r99 = xai.computeXAI({
            featureContributions: [
                { name: 'f1', shapValue: 1.0, stdError: 0.1 }
            ],
            decisionScore: 0.6, decisionThreshold: 0.5,
            confidenceLevel: 0.99
        });
        const r90 = xai.computeXAI({
            featureContributions: [
                { name: 'f1', shapValue: 1.0, stdError: 0.1 }
            ],
            decisionScore: 0.6, decisionThreshold: 0.5,
            confidenceLevel: 0.90
        });
        // 99% CI should be wider than 90%
        const w99 = r99.topFactors[0].confidenceHigh - r99.topFactors[0].confidenceLow;
        const w90 = r90.topFactors[0].confidenceHigh - r90.topFactors[0].confidenceLow;
        expect(w99).toBeGreaterThan(w90);
    });

    test('throws on empty featureContributions', () => {
        expect(() => xai.computeXAI({
            featureContributions: [],
            decisionScore: 0.5, decisionThreshold: 0.5
        })).toThrow();
    });
});

describe('§54 recordExplanation + retrieve', () => {
    test('roundtrip persistence', () => {
        const topFactors = [
            { name: 'rsi', shapValue: 0.5, confidenceLow: 0.4, confidenceHigh: 0.6 },
            { name: 'vol', shapValue: -0.3, confidenceLow: -0.4, confidenceHigh: -0.2 }
        ];
        const counterfactual = [
            { name: 'rsi', shiftNeededToFlip: 0.2, direction: 'decrease' }
        ];
        xai.recordExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'DEC-X1',
            action: 'place_order_LONG',
            topFactors, counterfactual
        });

        const retrieved = xai.getExplanationForDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'DEC-X1'
        });
        expect(retrieved).toBeTruthy();
        expect(retrieved.action).toBe('place_order_LONG');
        expect(retrieved.topFactors).toHaveLength(2);
        expect(retrieved.counterfactual).toHaveLength(1);
    });

    test('returns null when not logged', () => {
        const r = xai.getExplanationForDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'NONEXISTENT'
        });
        expect(r).toBe(null);
    });
});

describe('§54 findCounterfactualBreakeven', () => {
    test('positive distance returns decrease direction', () => {
        const r = xai.findCounterfactualBreakeven({
            featureName: 'rsi',
            currentScore: 0.7, threshold: 0.5,
            sensitivity: 1.0
        });
        expect(r.direction).toBe('decrease');
        expect(r.shiftNeededToFlip).toBeCloseTo(0.2);
    });

    test('negative distance returns increase direction', () => {
        const r = xai.findCounterfactualBreakeven({
            featureName: 'vol',
            currentScore: 0.4, threshold: 0.5,
            sensitivity: 0.5
        });
        expect(r.direction).toBe('increase');
        expect(r.shiftNeededToFlip).toBeCloseTo(0.2);
    });

    test('zero distance returns any', () => {
        const r = xai.findCounterfactualBreakeven({
            featureName: 'f',
            currentScore: 0.5, threshold: 0.5,
            sensitivity: 1.0
        });
        expect(r.direction).toBe('any');
    });
});

describe('§54 getExplanationStats', () => {
    test('ranks most-frequent top factors', () => {
        for (let i = 0; i < 5; i++) {
            xai.recordExplanation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                decisionId: `D${i}`,
                action: 'place',
                topFactors: [
                    { name: 'rsi', shapValue: 0.5 },
                    { name: 'vol', shapValue: 0.3 }
                ]
            });
        }
        for (let i = 0; i < 2; i++) {
            xai.recordExplanation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                decisionId: `E${i}`,
                action: 'cancel',
                topFactors: [{ name: 'macro', shapValue: 0.4 }]
            });
        }
        const s = xai.getExplanationStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.explanationsCount).toBe(7);
        expect(s.topFactorsRanked[0].factor).toBe('rsi');
        expect(s.topFactorsRanked[0].count).toBe(5);
    });
});

describe('§54 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9055;
        xai.recordExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'ISO',
            action: 'place',
            topFactors: [{ name: 'f', shapValue: 0.5 }]
        });
        const r1 = xai.getExplanationForDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV, decisionId: 'ISO'
        });
        const r2 = xai.getExplanationForDecision({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, decisionId: 'ISO'
        });
        expect(r1).toBeTruthy();
        expect(r2).toBe(null);
    });
});
