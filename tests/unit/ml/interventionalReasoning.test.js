'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p74-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ir = require('../../../server/services/ml/R2_cognition/interventionalReasoning');

const TEST_USER = 9074;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_intervention_predictions WHERE user_id IN (?, ?)').run(TEST_USER, 9075);
    db.prepare('DELETE FROM ml_intervention_outcomes WHERE user_id IN (?, ?)').run(TEST_USER, 9075);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§74 Migrations 139 + 140', () => {
    test('ml_intervention_predictions exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_intervention_predictions)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'intervention_id', 'action_type', 'size',
            'baseline_state_json', 'predicted_price_perturbation_bps',
            'predicted_queue_shift', 'predicted_signal_emission',
            'predicted_second_order_risk'
        ]));
    });

    test('intervention_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_intervention_predictions
             (user_id, resolved_env, intervention_id, action_type, size,
              predicted_price_perturbation_bps, predicted_queue_shift,
              predicted_signal_emission, predicted_second_order_risk, ts)
             VALUES (?, ?, 'I-UNIQ', 'market_buy', 1, 5, 0.1, 1, 0.2, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_intervention_predictions
             (user_id, resolved_env, intervention_id, action_type, size,
              predicted_price_perturbation_bps, predicted_queue_shift,
              predicted_signal_emission, predicted_second_order_risk, ts)
             VALUES (?, ?, 'I-UNIQ', 'market_buy', 1, 5, 0.1, 1, 0.2, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK action_type restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_intervention_predictions
             (user_id, resolved_env, intervention_id, action_type, size,
              predicted_price_perturbation_bps, predicted_queue_shift,
              predicted_signal_emission, predicted_second_order_risk, ts)
             VALUES (?, ?, 'I-BAD', 'BOGUS', 1, 5, 0.1, 1, 0.2, ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });
});

describe('§74 Constants', () => {
    test('ACTION_TYPES has 4 entries', () => {
        expect(ir.ACTION_TYPES).toEqual([
            'market_buy', 'market_sell', 'limit_buy', 'limit_sell'
        ]);
    });

    test('LIQUIDITY_LEVELS has 4 entries', () => {
        expect(ir.LIQUIDITY_LEVELS).toEqual(['high', 'medium', 'low', 'very_low']);
    });

    test('risk thresholds ordered', () => {
        expect(ir.SECOND_ORDER_RISK_THRESHOLD_HIGH).toBeLessThan(
            ir.SECOND_ORDER_RISK_THRESHOLD_CRITICAL
        );
    });
});

describe('§74 predictIntervention', () => {
    test('market_buy small size + high liquidity → low perturbation', () => {
        const r = ir.predictIntervention({
            actionType: 'market_buy', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'high', topBookSize: 5000 }
        });
        expect(r.predictedPricePerturbationBps).toBeGreaterThan(0);
        expect(r.predictedQueueShift).toBeLessThan(0.5);
    });

    test('large size + low liquidity → higher perturbation', () => {
        const small = ir.predictIntervention({
            actionType: 'market_buy', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'high', topBookSize: 5000 }
        });
        const large = ir.predictIntervention({
            actionType: 'market_buy', size: 50,
            baselineState: { marketDepth: 1000, liquidityLevel: 'very_low', topBookSize: 5000 }
        });
        expect(large.predictedPricePerturbationBps).toBeGreaterThan(
            small.predictedPricePerturbationBps
        );
        expect(large.predictedSecondOrderRisk).toBeGreaterThan(
            small.predictedSecondOrderRisk
        );
    });

    test('limit orders have lower signal emission than market', () => {
        const market = ir.predictIntervention({
            actionType: 'market_buy', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium', topBookSize: 5000 }
        });
        const limit = ir.predictIntervention({
            actionType: 'limit_buy', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium', topBookSize: 5000 }
        });
        expect(limit.predictedSignalEmission).toBeLessThan(market.predictedSignalEmission);
    });

    test('high risk → recommends splits + frontrun warning', () => {
        const r = ir.predictIntervention({
            actionType: 'market_buy', size: 200,
            baselineState: { marketDepth: 100, liquidityLevel: 'very_low', topBookSize: 200 }
        });
        expect(r.predictedSecondOrderRisk).toBeGreaterThan(0.7);
        expect(r.predictedSecondOrderReaction.likelyFrontRun).toBe(true);
        expect(r.predictedSecondOrderReaction.recommendedSplits).toBeGreaterThan(1);
    });

    test('throws on invalid actionType', () => {
        expect(() => ir.predictIntervention({
            actionType: 'BOGUS', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium' }
        })).toThrow();
    });

    test('throws on non-positive size', () => {
        expect(() => ir.predictIntervention({
            actionType: 'market_buy', size: 0,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium' }
        })).toThrow();
    });

    test('throws on invalid liquidity', () => {
        expect(() => ir.predictIntervention({
            actionType: 'market_buy', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'BOGUS' }
        })).toThrow();
    });
});

describe('§74 recordIntervention + recordOutcome', () => {
    test('persists prediction + outcome with prediction error', () => {
        const pred = ir.predictIntervention({
            actionType: 'market_buy', size: 5,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium', topBookSize: 5000 }
        });
        ir.recordIntervention({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            interventionId: 'I-001',
            actionType: 'market_buy', size: 5,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium', topBookSize: 5000 },
            prediction: pred
        });
        const r = ir.recordOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            interventionId: 'I-001',
            actualPricePerturbationBps: pred.predictedPricePerturbationBps * 1.1,
            actualQueueShift: pred.predictedQueueShift * 1.05,
            actualReactionScore: pred.predictedSecondOrderRisk * 1.0
        });
        expect(r.predictionError).toBeLessThan(0.5);  // small error
    });

    test('duplicate intervention throws', () => {
        const pred = ir.predictIntervention({
            actionType: 'market_buy', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium', topBookSize: 5000 }
        });
        ir.recordIntervention({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            interventionId: 'I-DUP',
            actionType: 'market_buy', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium' },
            prediction: pred
        });
        expect(() => ir.recordIntervention({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            interventionId: 'I-DUP',
            actionType: 'market_buy', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium' },
            prediction: pred
        })).toThrow(/duplicate/i);
    });

    test('recordOutcome throws when prediction missing', () => {
        expect(() => ir.recordOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            interventionId: 'NONEXISTENT',
            actualPricePerturbationBps: 5,
            actualQueueShift: 0.1,
            actualReactionScore: 0.3
        })).toThrow();
    });
});

describe('§74 getPredictionAccuracy', () => {
    test('aggregates samples + avg error', () => {
        for (let i = 0; i < 3; i++) {
            const pred = ir.predictIntervention({
                actionType: 'market_buy', size: 5,
                baselineState: { marketDepth: 1000, liquidityLevel: 'medium', topBookSize: 5000 }
            });
            ir.recordIntervention({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                interventionId: `IACC-${i}`,
                actionType: 'market_buy', size: 5,
                baselineState: { marketDepth: 1000, liquidityLevel: 'medium', topBookSize: 5000 },
                prediction: pred
            });
            ir.recordOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                interventionId: `IACC-${i}`,
                actualPricePerturbationBps: pred.predictedPricePerturbationBps,
                actualQueueShift: pred.predictedQueueShift,
                actualReactionScore: pred.predictedSecondOrderRisk
            });
        }
        const r = ir.getPredictionAccuracy({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.samples).toBe(3);
        expect(r.avgPredictionError).toBeCloseTo(0, 1);
    });
});

describe('§74 assessSecondOrderRisk (pure)', () => {
    test('low risk for small size + high liquidity', () => {
        const r = ir.assessSecondOrderRisk({
            size: 1, marketDepth: 10000, liquidityLevel: 'high'
        });
        expect(r.classification).toBe('low');
    });

    test('critical risk for large size + very_low liquidity', () => {
        const r = ir.assessSecondOrderRisk({
            size: 1000, marketDepth: 1000, liquidityLevel: 'very_low'
        });
        expect(r.classification).toBe('critical');
    });

    test('throws on invalid liquidity', () => {
        expect(() => ir.assessSecondOrderRisk({
            size: 1, marketDepth: 1000, liquidityLevel: 'BOGUS'
        })).toThrow();
    });
});

describe('§74 getInterventionHistory + getInterventionOutcome', () => {
    test('history filterable by action type', () => {
        for (let i = 0; i < 2; i++) {
            const pred = ir.predictIntervention({
                actionType: 'market_buy', size: 1,
                baselineState: { marketDepth: 1000, liquidityLevel: 'medium' }
            });
            ir.recordIntervention({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                interventionId: `H-BUY-${i}`,
                actionType: 'market_buy', size: 1,
                baselineState: { marketDepth: 1000, liquidityLevel: 'medium' },
                prediction: pred
            });
        }
        const pred = ir.predictIntervention({
            actionType: 'market_sell', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium' }
        });
        ir.recordIntervention({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            interventionId: 'H-SELL-1',
            actionType: 'market_sell', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium' },
            prediction: pred
        });
        const buys = ir.getInterventionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, actionType: 'market_buy'
        });
        expect(buys).toHaveLength(2);
    });
});

describe('§74 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9075;
        const pred = ir.predictIntervention({
            actionType: 'market_buy', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium' }
        });
        ir.recordIntervention({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            interventionId: 'I-ISO',
            actionType: 'market_buy', size: 1,
            baselineState: { marketDepth: 1000, liquidityLevel: 'medium' },
            prediction: pred
        });
        const h1 = ir.getInterventionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const h2 = ir.getInterventionHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(h1.length).toBe(1);
        expect(h2.length).toBe(0);
    });
});
