'use strict';

/**
 * OMEGA R2 Cognition — interventionalReasoning (canonical §74)
 *
 * §74 INTERVENTIONAL REASONING (do-calculus).
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1978-1979.
 *
 * "Daca plasez market buy X, cum perturbez pretul, cum schimb queue-ul,
 *  ce semnale emit + cum vor reactiona ceilalti?
 *  A actiona inseamna a schimba mediul in care actionezi."
 *
 * R2 cognition do-calculus extension. Complement to:
 *   - §23 transactionCostAnalyzer (first-order slippage cost)
 *   - §40 structuralCausalModel (observation-only causal chains)
 * §74 adds: predict environment reaction TO our action (intervention).
 *
 * Second-order chain:
 *   our action → price perturbation
 *              → queue shift
 *              → signal emission to other participants
 *              → their reaction
 *              → market state changes AFTER our execution
 */

const { db } = require('../../database');

const ACTION_TYPES = Object.freeze([
    'market_buy', 'market_sell', 'limit_buy', 'limit_sell'
]);
const LIQUIDITY_LEVELS = Object.freeze(['high', 'medium', 'low', 'very_low']);

const SECOND_ORDER_RISK_THRESHOLD_HIGH = 0.70;
const SECOND_ORDER_RISK_THRESHOLD_CRITICAL = 0.90;

const LIQUIDITY_SCORE_MAP = Object.freeze({
    high: 1.0, medium: 0.5, low: 0.20, very_low: 0.05
});

const IMPACT_COEFFICIENT_BY_ACTION = Object.freeze({
    market_buy: 1.0,
    market_sell: 1.0,
    limit_buy: 0.30,    // limit orders have lower immediate price impact
    limit_sell: 0.30
});

const SIGNAL_EMISSION_BY_ACTION = Object.freeze({
    market_buy: 1.0,
    market_sell: 1.0,
    limit_buy: 0.50,    // limit orders less visible
    limit_sell: 0.50
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`interventionalReasoning: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertPrediction: db.prepare(`
        INSERT INTO ml_intervention_predictions
        (user_id, resolved_env, intervention_id, action_type, size,
         baseline_state_json, predicted_price_perturbation_bps,
         predicted_queue_shift, predicted_signal_emission,
         predicted_second_order_risk, predicted_second_order_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getPrediction: db.prepare(`
        SELECT * FROM ml_intervention_predictions
        WHERE intervention_id = ?
    `),
    insertOutcome: db.prepare(`
        INSERT INTO ml_intervention_outcomes
        (user_id, resolved_env, intervention_id,
         actual_price_perturbation_bps, actual_queue_shift,
         actual_reaction_score, prediction_error_score, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getOutcome: db.prepare(`
        SELECT * FROM ml_intervention_outcomes
        WHERE intervention_id = ?
        ORDER BY ts DESC, id DESC
        LIMIT 1
    `),
    accuracyStats: db.prepare(`
        SELECT AVG(o.prediction_error_score) AS avg_error,
               COUNT(*) AS samples
        FROM ml_intervention_outcomes o
        JOIN ml_intervention_predictions p ON p.intervention_id = o.intervention_id
        WHERE o.user_id = ? AND o.resolved_env = ?
          AND (? = '' OR p.action_type = ?)
          AND o.ts >= ?
    `),
    history: db.prepare(`
        SELECT * FROM ml_intervention_predictions
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR action_type = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── predictIntervention ────────────────────────────────────────────
function predictIntervention(params) {
    const actionType = _required(params, 'actionType');
    const size = _required(params, 'size');
    const baselineState = _required(params, 'baselineState');

    if (!ACTION_TYPES.includes(actionType)) {
        throw new Error(`interventionalReasoning: invalid actionType "${actionType}"`);
    }
    if (typeof size !== 'number' || size <= 0) {
        throw new Error('interventionalReasoning: size must be positive');
    }

    const marketDepth = baselineState.marketDepth || 1000;
    const liquidityLevel = baselineState.liquidityLevel || 'medium';
    const topBookSize = baselineState.topBookSize || marketDepth * 5;

    if (!LIQUIDITY_LEVELS.includes(liquidityLevel)) {
        throw new Error(`interventionalReasoning: invalid liquidityLevel "${liquidityLevel}"`);
    }

    const impactCoeff = IMPACT_COEFFICIENT_BY_ACTION[actionType];
    const signalEmission = SIGNAL_EMISSION_BY_ACTION[actionType];
    const liquidityScore = LIQUIDITY_SCORE_MAP[liquidityLevel];

    // Price perturbation in bps: (size / depth) × impact × 10000 / liquidity_score
    const sizeRatio = size / marketDepth;
    const pricePerturbBps = sizeRatio * impactCoeff * 10000 * (1 / Math.max(liquidityScore, 0.05));

    // Queue shift: fraction of top-of-book consumed
    const queueShift = Math.min(1.0, size / topBookSize);

    // Second-order risk: how much our presence is visible & exploitable
    const secondOrderRisk = Math.min(1.0,
        (sizeRatio * signalEmission * (1 / Math.max(liquidityScore, 0.05))) / 10
    );

    const secondOrderReaction = {
        likelyFrontRun: secondOrderRisk > SECOND_ORDER_RISK_THRESHOLD_HIGH,
        expectedAdverseSelectionBps: secondOrderRisk * 20,
        recommendedSplits: secondOrderRisk > SECOND_ORDER_RISK_THRESHOLD_HIGH
            ? Math.ceil(secondOrderRisk * 10) : 1
    };

    return {
        predictedPricePerturbationBps: pricePerturbBps,
        predictedQueueShift: queueShift,
        predictedSignalEmission: signalEmission,
        predictedSecondOrderRisk: secondOrderRisk,
        predictedSecondOrderReaction: secondOrderReaction
    };
}

// ── recordIntervention ─────────────────────────────────────────────
function recordIntervention(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const interventionId = _required(params, 'interventionId');
    const actionType = _required(params, 'actionType');
    const size = _required(params, 'size');
    const baselineState = _required(params, 'baselineState');
    const prediction = _required(params, 'prediction');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertPrediction.run(
            userId, env, interventionId, actionType, size,
            JSON.stringify(baselineState),
            prediction.predictedPricePerturbationBps,
            prediction.predictedQueueShift,
            prediction.predictedSignalEmission,
            prediction.predictedSecondOrderRisk,
            JSON.stringify(prediction.predictedSecondOrderReaction || null),
            ts
        );
        return { recorded: true, interventionId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`interventionalReasoning: duplicate interventionId "${interventionId}"`);
        }
        throw err;
    }
}

// ── recordOutcome ──────────────────────────────────────────────────
function recordOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const interventionId = _required(params, 'interventionId');
    const actualPricePerturbationBps = _required(params, 'actualPricePerturbationBps');
    const actualQueueShift = _required(params, 'actualQueueShift');
    const actualReactionScore = _required(params, 'actualReactionScore');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const pred = _stmts.getPrediction.get(interventionId);
    if (!pred) {
        throw new Error(`interventionalReasoning: prediction "${interventionId}" not found`);
    }

    // Prediction error = avg abs relative error across 3 dimensions
    const priceErr = Math.abs(actualPricePerturbationBps - pred.predicted_price_perturbation_bps) /
                     Math.max(Math.abs(pred.predicted_price_perturbation_bps), 1);
    const queueErr = Math.abs(actualQueueShift - pred.predicted_queue_shift) /
                     Math.max(pred.predicted_queue_shift, 0.01);
    const reactionErr = Math.abs(actualReactionScore - pred.predicted_second_order_risk) /
                        Math.max(pred.predicted_second_order_risk, 0.01);
    const predictionError = (priceErr + queueErr + reactionErr) / 3;

    _stmts.insertOutcome.run(
        userId, env, interventionId,
        actualPricePerturbationBps, actualQueueShift,
        actualReactionScore, predictionError, ts
    );

    return { recorded: true, predictionError };
}

// ── getPredictionAccuracy ──────────────────────────────────────────
function getPredictionAccuracy(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const actionType = (params && params.actionType) ? params.actionType : '';
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const row = _stmts.accuracyStats.get(
        userId, env,
        actionType, actionType,
        since
    );
    return {
        samples: row ? row.samples : 0,
        avgPredictionError: row && row.avg_error !== null ? row.avg_error : 0
    };
}

// ── assessSecondOrderRisk (pure) ───────────────────────────────────
function assessSecondOrderRisk(params) {
    const size = _required(params, 'size');
    const marketDepth = _required(params, 'marketDepth');
    const liquidityLevel = _required(params, 'liquidityLevel');

    if (!LIQUIDITY_LEVELS.includes(liquidityLevel)) {
        throw new Error(`interventionalReasoning: invalid liquidityLevel "${liquidityLevel}"`);
    }

    const liquidityScore = LIQUIDITY_SCORE_MAP[liquidityLevel];
    const sizeRatio = size / marketDepth;
    const risk = Math.min(1.0, sizeRatio / Math.max(liquidityScore, 0.05));

    let classification;
    if (risk >= SECOND_ORDER_RISK_THRESHOLD_CRITICAL) classification = 'critical';
    else if (risk >= SECOND_ORDER_RISK_THRESHOLD_HIGH) classification = 'high';
    else if (risk >= 0.30) classification = 'medium';
    else classification = 'low';

    return { riskScore: risk, classification };
}

// ── getInterventionHistory ─────────────────────────────────────────
function getInterventionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const actionType = (params && params.actionType) ? params.actionType : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.history.all(
        userId, env,
        actionType, actionType,
        since > 0 ? 1 : 0, since,
        limit
    );
}

// ── getInterventionOutcome ─────────────────────────────────────────
function getInterventionOutcome(params) {
    const interventionId = _required(params, 'interventionId');
    const row = _stmts.getOutcome.get(interventionId);
    return row || null;
}

module.exports = {
    ACTION_TYPES,
    LIQUIDITY_LEVELS,
    SECOND_ORDER_RISK_THRESHOLD_HIGH,
    SECOND_ORDER_RISK_THRESHOLD_CRITICAL,
    predictIntervention,
    recordIntervention,
    recordOutcome,
    getPredictionAccuracy,
    assessSecondOrderRisk,
    getInterventionHistory,
    getInterventionOutcome
};
