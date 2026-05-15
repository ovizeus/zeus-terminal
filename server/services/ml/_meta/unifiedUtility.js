'use strict';

/**
 * OMEGA meta — unifiedUtility (canonical §59)
 *
 * §59 UNIFIED OBJECTIVE / UTILITY FUNCTION.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1667-1685.
 *
 * "Scorurile sunt ingrediente. Utility function este verdictul."
 *
 * Single-scalar "verdict final" that maximizes net utility (NOT win rate /
 * raw score). Allows apples-to-apples comparison between two seemingly
 * good decisions.
 *
 * Formula:
 *   totalUtility = expectancy_after_costs
 *                - tail_risk_penalty
 *                - turnover_penalty
 *                - latency_penalty
 *                - concentration_penalty
 *                - crowding_penalty
 *
 * Each penalty = weight × magnitude. Weights tunable by operator.
 */

const { db } = require('../../database');

const UTILITY_COMPONENTS = Object.freeze([
    'expectancy', 'tailRisk', 'turnover', 'latency', 'concentration', 'crowding'
]);

const DEFAULT_WEIGHTS = Object.freeze({
    tailRisk: 1.5,
    turnover: 0.3,
    latency: 0.5,
    concentration: 1.0,
    crowding: 0.8
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`unifiedUtility: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertEval: db.prepare(`
        INSERT INTO ml_utility_evaluations
        (user_id, resolved_env, decision_id,
         expectancy_after_costs, tail_risk_penalty, turnover_penalty,
         latency_penalty, concentration_penalty, crowding_penalty,
         total_utility, weights_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    utilityTrend: db.prepare(`
        SELECT COUNT(*) AS samples,
               AVG(total_utility) AS avg_utility,
               AVG(expectancy_after_costs) AS avg_expectancy,
               AVG(tail_risk_penalty) AS avg_tail,
               AVG(turnover_penalty) AS avg_turnover,
               AVG(latency_penalty) AS avg_latency,
               AVG(concentration_penalty) AS avg_conc,
               AVG(crowding_penalty) AS avg_crowd
        FROM ml_utility_evaluations
        WHERE user_id = ? AND resolved_env = ?
          AND ts >= ?
    `)
};

// ── getDefaultWeights ──────────────────────────────────────────────
function getDefaultWeights() {
    return Object.assign({}, DEFAULT_WEIGHTS);
}

// ── computeUtility ─────────────────────────────────────────────────
// Inputs (all optional except expectancy):
//   expectancy            net expected PnL (post commissions/spread)
//   tailRiskBps           max-loss tail estimate in bps (>0)
//   turnover              turnover ratio (e.g. trades/hr)
//   latencyMs             feed-to-decision latency in ms
//   concentrationScore    0..1 (1 = max concentration penalty)
//   crowdingScore         0..1 (1 = max crowding penalty)
//   baseSize              optional position size for absolute-magnitude scaling
//   weights               override weights (defaults to DEFAULT_WEIGHTS)
function computeUtility(params) {
    const expectancy = _required(params, 'expectancy');
    const weights = (params && params.weights)
        ? Object.assign({}, DEFAULT_WEIGHTS, params.weights)
        : Object.assign({}, DEFAULT_WEIGHTS);
    const baseSize = (params && typeof params.baseSize === 'number') ? params.baseSize : 1;

    const tailRiskBps = (params && typeof params.tailRiskBps === 'number') ? params.tailRiskBps : 0;
    const turnover = (params && typeof params.turnover === 'number') ? params.turnover : 0;
    const latencyMs = (params && typeof params.latencyMs === 'number') ? params.latencyMs : 0;
    const concScore = (params && typeof params.concentrationScore === 'number')
        ? params.concentrationScore : 0;
    const crowdingScore = (params && typeof params.crowdingScore === 'number')
        ? params.crowdingScore : 0;

    // Penalty calculations — all positive numbers subtracted from expectancy.
    const tailRiskPenalty = weights.tailRisk * (tailRiskBps / 10000) * baseSize;
    const turnoverPenalty = weights.turnover * turnover;
    const latencyPenalty = weights.latency * (latencyMs / 1000);  // per-second penalty
    const concentrationPenalty = weights.concentration * concScore;
    const crowdingPenalty = weights.crowding * crowdingScore;

    const totalUtility = expectancy
        - tailRiskPenalty
        - turnoverPenalty
        - latencyPenalty
        - concentrationPenalty
        - crowdingPenalty;

    return {
        totalUtility,
        components: {
            expectancy,
            tailRiskPenalty,
            turnoverPenalty,
            latencyPenalty,
            concentrationPenalty,
            crowdingPenalty
        },
        weights
    };
}

// ── compareDecisions ───────────────────────────────────────────────
function compareDecisions(params) {
    const decisionA = _required(params, 'decisionA');
    const decisionB = _required(params, 'decisionB');
    const weights = (params && params.weights) ? params.weights : null;

    const uA = computeUtility(Object.assign({}, decisionA, weights ? { weights } : {}));
    const uB = computeUtility(Object.assign({}, decisionB, weights ? { weights } : {}));

    const EPSILON = 1e-9;
    let verdict;
    if (Math.abs(uA.totalUtility - uB.totalUtility) < EPSILON) verdict = 'tie';
    else if (uA.totalUtility > uB.totalUtility) verdict = 'A';
    else verdict = 'B';

    return {
        verdict,
        utilityA: uA.totalUtility,
        utilityB: uB.totalUtility,
        diff: uA.totalUtility - uB.totalUtility
    };
}

// ── recordEvaluation ───────────────────────────────────────────────
function recordEvaluation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const utilityResult = _required(params, 'utilityResult');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const c = utilityResult.components;
    _stmts.insertEval.run(
        userId, env, decisionId,
        c.expectancy, c.tailRiskPenalty, c.turnoverPenalty,
        c.latencyPenalty, c.concentrationPenalty, c.crowdingPenalty,
        utilityResult.totalUtility,
        JSON.stringify(utilityResult.weights),
        ts
    );

    return { recorded: true };
}

// ── getUtilityTrend ────────────────────────────────────────────────
function getUtilityTrend(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const row = _stmts.utilityTrend.get(userId, env, since);

    return {
        samples: row.samples || 0,
        avgUtility: row.avg_utility || 0,
        avgExpectancy: row.avg_expectancy || 0,
        avgTailPenalty: row.avg_tail || 0,
        avgTurnoverPenalty: row.avg_turnover || 0,
        avgLatencyPenalty: row.avg_latency || 0,
        avgConcentrationPenalty: row.avg_conc || 0,
        avgCrowdingPenalty: row.avg_crowd || 0
    };
}

module.exports = {
    UTILITY_COMPONENTS,
    DEFAULT_WEIGHTS,
    getDefaultWeights,
    computeUtility,
    compareDecisions,
    recordEvaluation,
    getUtilityTrend
};
