'use strict';

/**
 * OMEGA R2 Cognition — gameTheoryMicrostructure (canonical §84)
 *
 * §84 GAME THEORY APLICATA MICROSTRUCTURII — modelarea adversarilor
 * ca agenti rationali.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2149-2150.
 *
 * "Nu statistica — rationament strategic. Diferit: NU 'ce s-a intamplat'
 *  ci 'ce va face un agent rational cu obiective cunoscute'."
 *
 * R2 cognition. Models 5 agent types with explicit objective functions.
 * Predicts response to scenarios via rational-agent reasoning.
 *
 * Distinct from:
 *   - §62 adversarialMarketAwareness (defensive — randomize own pattern)
 *   - §31 smartMoneyDetector (observation only)
 * §84 = ACTIVE prediction of agent behavior.
 */

const { db } = require('../../database');

const AGENT_TYPES = Object.freeze([
    'market_maker', 'liquidation_engine', 'whale', 'arb_bot', 'retail'
]);
const PREDICTED_ACTIONS = Object.freeze([
    'widen_spread', 'withdraw_liquidity', 'execute_market',
    'accumulate', 'distribute', 'no_action'
]);
const MIN_CONFIDENCE_FOR_PREDICTION = 0.40;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`gameTheoryMicrostructure: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertAgent: db.prepare(`
        INSERT INTO ml_agent_models
        (user_id, resolved_env, agent_id, agent_type,
         objective_function_json, decision_parameters_json, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getAgent: db.prepare(`
        SELECT * FROM ml_agent_models WHERE agent_id = ?
    `),
    insertPrediction: db.prepare(`
        INSERT INTO ml_game_predictions
        (user_id, resolved_env, prediction_id, agent_id, scenario_json,
         predicted_action, confidence, expected_impact_bps,
         time_horizon_seconds, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updatePrediction: db.prepare(`
        UPDATE ml_game_predictions
        SET actual_action = ?, actual_impact_bps = ?, validated = 1
        WHERE prediction_id = ?
    `),
    getPrediction: db.prepare(`
        SELECT * FROM ml_game_predictions WHERE prediction_id = ?
    `),
    accuracyStats: db.prepare(`
        SELECT m.agent_type,
               COUNT(*) AS samples,
               SUM(CASE WHEN p.actual_action = p.predicted_action THEN 1 ELSE 0 END) AS correct
        FROM ml_game_predictions p
        JOIN ml_agent_models m ON m.agent_id = p.agent_id
        WHERE p.user_id = ? AND p.resolved_env = ?
          AND p.validated = 1
          AND (? = '' OR m.agent_type = ?)
          AND p.ts >= ?
        GROUP BY m.agent_type
    `)
};

// ── _predictByType (internal heuristics per spec) ──────────────────
function _predictByType(agentType, scenario, decisionParams) {
    if (agentType === 'market_maker') {
        const inventoryRisk = scenario.inventoryRisk || 0;
        const volatility = scenario.volatility || 0;
        if (inventoryRisk >= 0.70) {
            return {
                action: 'withdraw_liquidity',
                confidence: 0.75,
                impactBps: 5 + volatility * 10,
                timeHorizonSec: 30
            };
        }
        if (inventoryRisk >= 0.40 || volatility >= 0.60) {
            return {
                action: 'widen_spread',
                confidence: 0.70,
                impactBps: 2 + volatility * 5,
                timeHorizonSec: 60
            };
        }
        return {
            action: 'no_action', confidence: 0.55,
            impactBps: 0, timeHorizonSec: 120
        };
    }

    if (agentType === 'liquidation_engine') {
        const clusterSize = scenario.clusterSizeUSD || 0;  // millions
        if (clusterSize >= 1) {
            // 5bps per $1M cluster, capped
            const impact = Math.min(50, clusterSize * 5);
            return {
                action: 'execute_market', confidence: 0.85,
                impactBps: impact, timeHorizonSec: 30
            };
        }
        return {
            action: 'no_action', confidence: 0.50,
            impactBps: 0, timeHorizonSec: 60
        };
    }

    if (agentType === 'whale') {
        const accumulationSignal = scenario.accumulationSignal || 0;
        if (accumulationSignal >= 0.60) {
            return {
                action: 'accumulate', confidence: 0.65,
                impactBps: 3, timeHorizonSec: 3600   // over an hour
            };
        }
        return {
            action: 'no_action', confidence: 0.45,
            impactBps: 0, timeHorizonSec: 1800
        };
    }

    if (agentType === 'arb_bot') {
        const crossVenueDivBps = scenario.crossVenueDivBps || 0;
        if (Math.abs(crossVenueDivBps) >= 5) {
            return {
                action: 'execute_market', confidence: 0.90,
                impactBps: Math.abs(crossVenueDivBps) * 0.5,
                timeHorizonSec: 5   // fast
            };
        }
        return {
            action: 'no_action', confidence: 0.50,
            impactBps: 0, timeHorizonSec: 30
        };
    }

    if (agentType === 'retail') {
        const fundingExtreme = scenario.fundingExtreme || false;
        if (fundingExtreme) {
            return {
                action: 'distribute', confidence: 0.55,
                impactBps: 8, timeHorizonSec: 1800
            };
        }
        return {
            action: 'no_action', confidence: 0.40,
            impactBps: 0, timeHorizonSec: 3600
        };
    }

    return {
        action: 'no_action', confidence: 0.30,
        impactBps: 0, timeHorizonSec: 60
    };
}

// ── defineAgent ────────────────────────────────────────────────────
function defineAgent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const agentId = _required(params, 'agentId');
    const agentType = _required(params, 'agentType');
    const objectiveFunction = _required(params, 'objectiveFunction');
    const decisionParameters = (params && params.decisionParameters)
        ? params.decisionParameters : {};
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!AGENT_TYPES.includes(agentType)) {
        throw new Error(`gameTheoryMicrostructure: invalid agentType "${agentType}"`);
    }

    try {
        _stmts.insertAgent.run(
            userId, env, agentId, agentType,
            JSON.stringify(objectiveFunction),
            JSON.stringify(decisionParameters), ts
        );
        return { defined: true, agentId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`gameTheoryMicrostructure: duplicate agentId "${agentId}"`);
        }
        throw err;
    }
}

// ── predictAgentBehavior ───────────────────────────────────────────
function predictAgentBehavior(params) {
    const agentId = _required(params, 'agentId');
    const scenario = _required(params, 'scenario');

    const agent = _stmts.getAgent.get(agentId);
    if (!agent) {
        throw new Error(`gameTheoryMicrostructure: agent "${agentId}" not found`);
    }

    const decisionParams = JSON.parse(agent.decision_parameters_json);
    const prediction = _predictByType(agent.agent_type, scenario, decisionParams);

    return {
        agentId,
        agentType: agent.agent_type,
        scenario,
        predictedAction: prediction.action,
        confidence: prediction.confidence,
        expectedImpactBps: prediction.impactBps,
        timeHorizonSeconds: prediction.timeHorizonSec,
        actionable: prediction.confidence >= MIN_CONFIDENCE_FOR_PREDICTION
    };
}

// ── recordPrediction ───────────────────────────────────────────────
function recordPrediction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const predictionId = _required(params, 'predictionId');
    const agentId = _required(params, 'agentId');
    const scenario = _required(params, 'scenario');
    const predictedAction = _required(params, 'predictedAction');
    const confidence = _required(params, 'confidence');
    const expectedImpactBps = _required(params, 'expectedImpactBps');
    const timeHorizonSeconds = _required(params, 'timeHorizonSeconds');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!PREDICTED_ACTIONS.includes(predictedAction)) {
        throw new Error(`gameTheoryMicrostructure: invalid predictedAction "${predictedAction}"`);
    }

    try {
        _stmts.insertPrediction.run(
            userId, env, predictionId, agentId,
            JSON.stringify(scenario), predictedAction,
            confidence, expectedImpactBps, timeHorizonSeconds, ts
        );
        return { recorded: true };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`gameTheoryMicrostructure: duplicate predictionId "${predictionId}"`);
        }
        throw err;
    }
}

// ── validatePrediction ─────────────────────────────────────────────
function validatePrediction(params) {
    const predictionId = _required(params, 'predictionId');
    const actualAction = _required(params, 'actualAction');
    const actualImpactBps = (params && typeof params.actualImpactBps === 'number')
        ? params.actualImpactBps : 0;

    const row = _stmts.getPrediction.get(predictionId);
    if (!row) {
        throw new Error(`gameTheoryMicrostructure: prediction "${predictionId}" not found`);
    }
    if (!PREDICTED_ACTIONS.includes(actualAction)) {
        throw new Error(`gameTheoryMicrostructure: invalid actualAction "${actualAction}"`);
    }

    _stmts.updatePrediction.run(actualAction, actualImpactBps, predictionId);

    return {
        validated: true,
        correctAction: row.predicted_action === actualAction,
        impactError: Math.abs(actualImpactBps - row.expected_impact_bps)
    };
}

// ── getAgentModel ──────────────────────────────────────────────────
function getAgentModel(params) {
    const agentId = _required(params, 'agentId');
    const row = _stmts.getAgent.get(agentId);
    if (!row) return null;
    return {
        agentId: row.agent_id,
        agentType: row.agent_type,
        objectiveFunction: JSON.parse(row.objective_function_json),
        decisionParameters: JSON.parse(row.decision_parameters_json),
        lastUpdated: row.last_updated
    };
}

// ── getPredictionAccuracy ──────────────────────────────────────────
function getPredictionAccuracy(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const agentType = (params && params.agentType) ? params.agentType : '';
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.accuracyStats.all(
        userId, env, agentType, agentType, since
    );
    return rows.map(r => ({
        agentType: r.agent_type,
        samples: r.samples,
        correct: r.correct,
        accuracy: r.samples > 0 ? r.correct / r.samples : 0
    }));
}

module.exports = {
    AGENT_TYPES,
    PREDICTED_ACTIONS,
    MIN_CONFIDENCE_FOR_PREDICTION,
    defineAgent,
    predictAgentBehavior,
    recordPrediction,
    validatePrediction,
    getAgentModel,
    getPredictionAccuracy
};
