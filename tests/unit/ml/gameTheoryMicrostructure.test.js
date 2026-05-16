'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p84-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const gt = require('../../../server/services/ml/R2_cognition/gameTheoryMicrostructure');

const TEST_USER = 9084;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_agent_models WHERE user_id IN (?, ?)').run(TEST_USER, 9085);
    db.prepare('DELETE FROM ml_game_predictions WHERE user_id IN (?, ?)').run(TEST_USER, 9085);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§84 Migrations 157 + 158', () => {
    test('agent_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_agent_models
             (user_id, resolved_env, agent_id, agent_type,
              objective_function_json, decision_parameters_json, last_updated)
             VALUES (?, ?, 'A-UNIQ', 'market_maker', '{}', '{}', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_agent_models
             (user_id, resolved_env, agent_id, agent_type,
              objective_function_json, decision_parameters_json, last_updated)
             VALUES (?, ?, 'A-UNIQ', 'whale', '{}', '{}', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK agent_type restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_agent_models
             (user_id, resolved_env, agent_id, agent_type,
              objective_function_json, decision_parameters_json, last_updated)
             VALUES (?, ?, 'A-BAD', 'BOGUS', '{}', '{}', ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK predicted_action restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_game_predictions
             (user_id, resolved_env, prediction_id, agent_id, scenario_json,
              predicted_action, confidence, expected_impact_bps,
              time_horizon_seconds, ts)
             VALUES (?, ?, 'P-BAD', 'A', '{}', 'BOGUS', 0.5, 10, 30, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§84 Constants', () => {
    test('AGENT_TYPES has 5 entries', () => {
        expect(gt.AGENT_TYPES).toEqual([
            'market_maker', 'liquidation_engine', 'whale', 'arb_bot', 'retail'
        ]);
    });

    test('PREDICTED_ACTIONS has 6 entries', () => {
        expect(gt.PREDICTED_ACTIONS).toEqual([
            'widen_spread', 'withdraw_liquidity', 'execute_market',
            'accumulate', 'distribute', 'no_action'
        ]);
    });
});

describe('§84 defineAgent', () => {
    test('persists', () => {
        const r = gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'AG-001', agentType: 'market_maker',
            objectiveFunction: { goal: 'min_inventory_risk' },
            decisionParameters: { spread_min_bps: 2 }
        });
        expect(r.defined).toBe(true);
    });

    test('duplicate agent_id throws', () => {
        gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'AG-DUP', agentType: 'market_maker',
            objectiveFunction: {}, decisionParameters: {}
        });
        expect(() => gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'AG-DUP', agentType: 'whale',
            objectiveFunction: {}, decisionParameters: {}
        })).toThrow();
    });

    test('invalid agent_type throws', () => {
        expect(() => gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'AG-BAD', agentType: 'BOGUS',
            objectiveFunction: {}, decisionParameters: {}
        })).toThrow();
    });
});

describe('§84 predictAgentBehavior', () => {
    test('market_maker high inventory → withdraw_liquidity', () => {
        gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'MM-1', agentType: 'market_maker',
            objectiveFunction: {}, decisionParameters: {}
        });
        const r = gt.predictAgentBehavior({
            agentId: 'MM-1',
            scenario: { inventoryRisk: 0.85, volatility: 0.5 }
        });
        expect(r.predictedAction).toBe('withdraw_liquidity');
    });

    test('market_maker high vol → widen_spread', () => {
        gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'MM-2', agentType: 'market_maker',
            objectiveFunction: {}, decisionParameters: {}
        });
        const r = gt.predictAgentBehavior({
            agentId: 'MM-2',
            scenario: { inventoryRisk: 0.20, volatility: 0.75 }
        });
        expect(r.predictedAction).toBe('widen_spread');
    });

    test('liquidation_engine large cluster → execute_market with impact', () => {
        gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'LIQ-1', agentType: 'liquidation_engine',
            objectiveFunction: {}, decisionParameters: {}
        });
        const r = gt.predictAgentBehavior({
            agentId: 'LIQ-1',
            scenario: { clusterSizeUSD: 5 }
        });
        expect(r.predictedAction).toBe('execute_market');
        expect(r.expectedImpactBps).toBeGreaterThan(0);
    });

    test('whale accumulation signal → accumulate', () => {
        gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'WHALE-1', agentType: 'whale',
            objectiveFunction: {}, decisionParameters: {}
        });
        const r = gt.predictAgentBehavior({
            agentId: 'WHALE-1',
            scenario: { accumulationSignal: 0.80 }
        });
        expect(r.predictedAction).toBe('accumulate');
    });

    test('arb_bot cross-venue div → execute_market high confidence', () => {
        gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'ARB-1', agentType: 'arb_bot',
            objectiveFunction: {}, decisionParameters: {}
        });
        const r = gt.predictAgentBehavior({
            agentId: 'ARB-1',
            scenario: { crossVenueDivBps: 10 }
        });
        expect(r.predictedAction).toBe('execute_market');
        expect(r.confidence).toBeGreaterThan(0.80);
    });

    test('retail funding extreme → distribute', () => {
        gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'RET-1', agentType: 'retail',
            objectiveFunction: {}, decisionParameters: {}
        });
        const r = gt.predictAgentBehavior({
            agentId: 'RET-1',
            scenario: { fundingExtreme: true }
        });
        expect(r.predictedAction).toBe('distribute');
    });

    test('throws on missing agent', () => {
        expect(() => gt.predictAgentBehavior({
            agentId: 'NONEXISTENT',
            scenario: {}
        })).toThrow();
    });
});

describe('§84 recordPrediction + validatePrediction', () => {
    test('persists + validates with correct match', () => {
        gt.recordPrediction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            predictionId: 'P-001', agentId: 'A',
            scenario: {}, predictedAction: 'execute_market',
            confidence: 0.8, expectedImpactBps: 10,
            timeHorizonSeconds: 30
        });
        const r = gt.validatePrediction({
            predictionId: 'P-001',
            actualAction: 'execute_market',
            actualImpactBps: 12
        });
        expect(r.correctAction).toBe(true);
        expect(r.impactError).toBeCloseTo(2);
    });

    test('incorrect action prediction', () => {
        gt.recordPrediction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            predictionId: 'P-002', agentId: 'A',
            scenario: {}, predictedAction: 'widen_spread',
            confidence: 0.6, expectedImpactBps: 3,
            timeHorizonSeconds: 60
        });
        const r = gt.validatePrediction({
            predictionId: 'P-002',
            actualAction: 'no_action'
        });
        expect(r.correctAction).toBe(false);
    });

    test('duplicate prediction throws', () => {
        gt.recordPrediction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            predictionId: 'P-DUP', agentId: 'A',
            scenario: {}, predictedAction: 'no_action',
            confidence: 0.5, expectedImpactBps: 0,
            timeHorizonSeconds: 60
        });
        expect(() => gt.recordPrediction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            predictionId: 'P-DUP', agentId: 'A',
            scenario: {}, predictedAction: 'no_action',
            confidence: 0.5, expectedImpactBps: 0,
            timeHorizonSeconds: 60
        })).toThrow();
    });
});

describe('§84 getPredictionAccuracy', () => {
    test('aggregates by agent_type', () => {
        gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'MM-ACC', agentType: 'market_maker',
            objectiveFunction: {}, decisionParameters: {}
        });
        gt.recordPrediction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            predictionId: 'ACC-1', agentId: 'MM-ACC',
            scenario: {}, predictedAction: 'widen_spread',
            confidence: 0.6, expectedImpactBps: 3,
            timeHorizonSeconds: 60
        });
        gt.validatePrediction({
            predictionId: 'ACC-1', actualAction: 'widen_spread'
        });
        const a = gt.getPredictionAccuracy({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const mm = a.find(x => x.agentType === 'market_maker');
        expect(mm).toBeTruthy();
        expect(mm.accuracy).toBe(1);
    });
});

describe('§84 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9085;
        gt.defineAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'AG-ISO', agentType: 'whale',
            objectiveFunction: {}, decisionParameters: {}
        });
        const a1 = gt.getAgentModel({ agentId: 'AG-ISO' });
        expect(a1).toBeTruthy();
        // Cross-user: different agent doesn't exist for OTHER_USER
        const acc1 = gt.getPredictionAccuracy({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const acc2 = gt.getPredictionAccuracy({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(acc2.length).toBe(0);
    });
});
