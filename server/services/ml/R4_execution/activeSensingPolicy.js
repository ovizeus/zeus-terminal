'use strict';

/**
 * OMEGA R4 Execution — activeSensingPolicy (canonical §99)
 *
 * §99 ACTIVE SENSING / ADAPTIVE OBSERVABILITY ACQUISITION.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2569-2615.
 *
 * "Uneori sistemul trebuie sa decida activ daca merita sa cumpere mai multa
 *  observabilitate... expected information gain estimation... cost of
 *  observation (latency/API/compute/delay)... gating query_now/wait/skip...
 *  Merita sa consum resurse acum pentru inca o bucata de cunoastere?
 *  Active sensing NU violeaza deadline execution... cost comparat cu utilitate."
 *
 * R4 execution: cost-aware observability decisions during execution.
 * Complementary to §85 computeBudgetGovernor + §45 latencyAwareExecution.
 */

const { db } = require('../../database');

const OBSERVATION_TYPES = Object.freeze([
    'deep_book', 'venue_confirmation', 'options_refresh',
    'funding_oi_refresh', 'sentiment_refresh'
]);
const SENSING_DECISIONS = Object.freeze(['query_now', 'wait', 'skip']);

const DEFAULT_UTILITY_THRESHOLD = 1.0;
const DEFAULT_DEADLINE_BUFFER_MS = 100;
const DEFAULT_COST_WEIGHTS = Object.freeze({
    latency: 0.4, api: 0.3, compute: 0.3
});

// Type-specific base IG priors (low-confidence triggers higher expected IG)
const BASE_IG_BY_TYPE = Object.freeze({
    deep_book: 0.30,
    venue_confirmation: 0.25,
    options_refresh: 0.20,
    funding_oi_refresh: 0.18,
    sentiment_refresh: 0.10
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`activeSensingPolicy: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertQuery: db.prepare(`
        INSERT INTO ml_observability_queries
        (user_id, resolved_env, query_id, observation_type, decision,
         expected_ig, cost_estimate, utility_ratio,
         deadline_remaining_ms, reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertOutcome: db.prepare(`
        INSERT INTO ml_observability_outcomes
        (user_id, resolved_env, outcome_id, query_id,
         actual_ig, actual_cost, verdict_changed, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    aggregateByType: db.prepare(`
        SELECT q.observation_type AS observation_type,
               COUNT(o.id) AS outcomes,
               AVG(o.actual_ig) AS avg_actual_ig,
               AVG(o.actual_cost) AS avg_actual_cost,
               SUM(CASE WHEN o.verdict_changed = 1 THEN 1 ELSE 0 END) AS verdict_changes
        FROM ml_observability_queries q
        LEFT JOIN ml_observability_outcomes o
          ON o.query_id = q.query_id
          AND o.user_id = q.user_id
          AND o.resolved_env = q.resolved_env
        WHERE q.user_id = ? AND q.resolved_env = ?
        GROUP BY q.observation_type
    `),
    aggregateByTypeFiltered: db.prepare(`
        SELECT q.observation_type AS observation_type,
               COUNT(o.id) AS outcomes,
               AVG(o.actual_ig) AS avg_actual_ig,
               AVG(o.actual_cost) AS avg_actual_cost,
               SUM(CASE WHEN o.verdict_changed = 1 THEN 1 ELSE 0 END) AS verdict_changes
        FROM ml_observability_queries q
        LEFT JOIN ml_observability_outcomes o
          ON o.query_id = q.query_id
          AND o.user_id = q.user_id
          AND o.resolved_env = q.resolved_env
        WHERE q.user_id = ? AND q.resolved_env = ?
          AND q.observation_type = ?
        GROUP BY q.observation_type
    `)
};

// ── estimateInformationGain (pure) ─────────────────────────────────
// More uncertainty (1 - confidence) → higher expected IG.
function estimateInformationGain(params) {
    const observationType = _required(params, 'observationType');
    if (!OBSERVATION_TYPES.includes(observationType)) {
        throw new Error(`activeSensingPolicy: invalid observationType "${observationType}"`);
    }
    const currentConfidence = _required(params, 'currentConfidence');
    if (currentConfidence < 0 || currentConfidence > 1) {
        throw new Error('activeSensingPolicy: currentConfidence must be in [0,1]');
    }
    const base = BASE_IG_BY_TYPE[observationType];
    const uncertainty = 1 - currentConfidence;
    let ig = base * uncertainty;
    const historical = (params && params.historicalIGStats) ? params.historicalIGStats : null;
    if (historical && typeof historical.avgIG === 'number') {
        ig = 0.5 * ig + 0.5 * historical.avgIG;
    }
    return { expectedIG: ig, base, uncertainty };
}

// ── estimateObservationCost (pure) ─────────────────────────────────
// Weighted sum of normalized cost components.
function estimateObservationCost(params) {
    const latencyMs = _required(params, 'latencyMs');
    const apiUnits = _required(params, 'apiUnits');
    const computeUnits = _required(params, 'computeUnits');
    const weights = (params && params.weights) ? params.weights : DEFAULT_COST_WEIGHTS;

    if (latencyMs < 0 || apiUnits < 0 || computeUnits < 0) {
        throw new Error('activeSensingPolicy: cost components must be >= 0');
    }
    // Normalize: latency 0-1000ms, api 0-10 units, compute 0-100 units
    const latencyN  = Math.min(1, latencyMs / 1000);
    const apiN      = Math.min(1, apiUnits / 10);
    const computeN  = Math.min(1, computeUnits / 100);
    const cost =
        weights.latency * latencyN +
        weights.api * apiN +
        weights.compute * computeN;
    return { cost, components: { latencyN, apiN, computeN } };
}

// ── evaluateActiveSensingDecision (pure) ───────────────────────────
function evaluateActiveSensingDecision(params) {
    const expectedIG = _required(params, 'expectedIG');
    const cost = _required(params, 'cost');
    const deadlineRemainingMs = _required(params, 'deadlineRemainingMs');
    const utilityThreshold = (params && params.utilityThreshold !== undefined)
        ? params.utilityThreshold : DEFAULT_UTILITY_THRESHOLD;
    const deadlineBufferMs = (params && params.deadlineBufferMs !== undefined)
        ? params.deadlineBufferMs : DEFAULT_DEADLINE_BUFFER_MS;
    const observationLatencyMs = (params && params.observationLatencyMs !== undefined)
        ? params.observationLatencyMs : 0;

    let ratio;
    if (cost <= 0) ratio = Infinity;
    else ratio = expectedIG / cost;

    if (deadlineRemainingMs < deadlineBufferMs + observationLatencyMs) {
        return {
            decision: 'skip',
            ratio,
            reason: 'deadline_insufficient'
        };
    }
    if (ratio >= utilityThreshold) {
        return { decision: 'query_now', ratio, reason: 'high_utility' };
    }
    if (deadlineRemainingMs > deadlineBufferMs * 3) {
        return { decision: 'wait', ratio, reason: 'low_utility_deadline_far' };
    }
    return { decision: 'skip', ratio, reason: 'low_utility' };
}

// ── recordSensingDecision ──────────────────────────────────────────
function recordSensingDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const queryId = _required(params, 'queryId');
    const observationType = _required(params, 'observationType');
    if (!OBSERVATION_TYPES.includes(observationType)) {
        throw new Error(`activeSensingPolicy: invalid observationType "${observationType}"`);
    }
    const decision = _required(params, 'decision');
    if (!SENSING_DECISIONS.includes(decision)) {
        throw new Error(`activeSensingPolicy: invalid decision "${decision}"`);
    }
    const expectedIG = _required(params, 'expectedIG');
    const costEstimate = _required(params, 'costEstimate');
    const deadlineRemainingMs = _required(params, 'deadlineRemainingMs');
    const utilityRatio = costEstimate > 0
        ? expectedIG / costEstimate
        : (expectedIG > 0 ? Infinity : 0);
    const reason = (params && params.reason) ? params.reason : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertQuery.run(
            userId, env, queryId, observationType, decision,
            expectedIG, costEstimate, utilityRatio,
            deadlineRemainingMs, reason, ts
        );
        return { recorded: true, queryId, decision, utilityRatio };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`activeSensingPolicy: duplicate queryId "${queryId}"`);
        }
        throw err;
    }
}

// ── recordSensingOutcome ───────────────────────────────────────────
function recordSensingOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const outcomeId = _required(params, 'outcomeId');
    const queryId = _required(params, 'queryId');
    const actualIG = _required(params, 'actualIG');
    const actualCost = _required(params, 'actualCost');
    const verdictChanged = _required(params, 'verdictChanged');
    if (actualCost < 0) {
        throw new Error('activeSensingPolicy: actualCost must be >= 0');
    }
    const vc = verdictChanged ? 1 : 0;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertOutcome.run(
            userId, env, outcomeId, queryId,
            actualIG, actualCost, vc, ts
        );
        return { recorded: true, outcomeId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`activeSensingPolicy: duplicate outcomeId "${outcomeId}"`);
        }
        throw err;
    }
}

// ── getSensingStatistics ───────────────────────────────────────────
function getSensingStatistics(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const observationType = params && params.observationType;
    if (observationType && !OBSERVATION_TYPES.includes(observationType)) {
        throw new Error(`activeSensingPolicy: invalid observationType "${observationType}"`);
    }

    const rows = observationType
        ? _stmts.aggregateByTypeFiltered.all(userId, env, observationType)
        : _stmts.aggregateByType.all(userId, env);
    return rows.map(r => ({
        observationType: r.observation_type,
        outcomes: r.outcomes || 0,
        avgActualIG: r.avg_actual_ig,
        avgActualCost: r.avg_actual_cost,
        verdictChanges: r.verdict_changes || 0
    }));
}

module.exports = {
    OBSERVATION_TYPES,
    SENSING_DECISIONS,
    DEFAULT_UTILITY_THRESHOLD,
    DEFAULT_DEADLINE_BUFFER_MS,
    DEFAULT_COST_WEIGHTS,
    BASE_IG_BY_TYPE,
    estimateInformationGain,
    estimateObservationCost,
    evaluateActiveSensingDecision,
    recordSensingDecision,
    recordSensingOutcome,
    getSensingStatistics
};
