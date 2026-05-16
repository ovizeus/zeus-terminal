'use strict';

/**
 * OMEGA R5A Learning — distributionalRobustnessOptimization (canonical §81)
 *
 * §81 DISTRIBUTIONAL ROBUSTNESS OPTIMIZATION (DRO).
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2143-2144.
 *
 * "Optimizeaza pentru cel mai rau caz, nu pentru medie.
 *  Pe futures, robustetea in coada valoreaza mai mult decat media."
 *
 * R5A learning. DRO replaces "maximize E[reward]" with "maximize min-perf
 * across uncertainty set of plausible distributions".
 *
 * Distinct from:
 *   - §59 unifiedUtility (single-scalar expected utility maximization)
 *   - §53 adversarialMonteCarlo (post-training stress on existing model)
 * §81 = DESIGN-TIME robust optimization across uncertainty set.
 *
 * Mechanics:
 *   For each candidate params, evaluate against ALL distributions.
 *   Pick candidate with HIGHEST min-score (not highest average).
 *   Robustness premium = (mean - worst) / mean = voluntary sacrifice.
 */

const { db } = require('../../database');

const MIN_DISTRIBUTIONS_FOR_DRO = 3;
const ROBUSTNESS_PREMIUM_HIGH_THRESHOLD = 0.30;
const MIN_WORST_CASE_FLOOR = 0.0;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`distributionalRobustnessOptimization: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertSet: db.prepare(`
        INSERT INTO ml_dro_uncertainty_sets
        (user_id, resolved_env, set_id, set_name,
         distribution_configs_json, num_distributions, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getSet: db.prepare(`
        SELECT * FROM ml_dro_uncertainty_sets WHERE set_id = ?
    `),
    insertOpt: db.prepare(`
        INSERT INTO ml_dro_optimizations
        (user_id, resolved_env, optimization_id, set_id,
         candidate_params_json, worst_case_score, average_score,
         robustness_premium, recommended_params_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getOpt: db.prepare(`
        SELECT * FROM ml_dro_optimizations WHERE optimization_id = ?
    `),
    historyForUser: db.prepare(`
        SELECT * FROM ml_dro_optimizations
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── defineUncertaintySet ───────────────────────────────────────────
function defineUncertaintySet(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setId = _required(params, 'setId');
    const setName = _required(params, 'setName');
    const distributionConfigs = _required(params, 'distributionConfigs');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!Array.isArray(distributionConfigs) || distributionConfigs.length < MIN_DISTRIBUTIONS_FOR_DRO) {
        throw new Error(
            `distributionalRobustnessOptimization: require >= ${MIN_DISTRIBUTIONS_FOR_DRO} distributions`
        );
    }

    try {
        _stmts.insertSet.run(
            userId, env, setId, setName,
            JSON.stringify(distributionConfigs),
            distributionConfigs.length, ts
        );
        return { defined: true, setId, numDistributions: distributionConfigs.length };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`distributionalRobustnessOptimization: duplicate setId "${setId}"`);
        }
        throw err;
    }
}

// ── evaluateCandidateAcrossSet (pure) ──────────────────────────────
function evaluateCandidateAcrossSet(params) {
    const setId = _required(params, 'setId');
    const candidateParams = _required(params, 'candidateParams');
    const performanceFn = _required(params, 'performanceFn');

    const row = _stmts.getSet.get(setId);
    if (!row) {
        throw new Error(`distributionalRobustnessOptimization: setId "${setId}" not found`);
    }

    const distributions = JSON.parse(row.distribution_configs_json);
    const scores = [];
    for (const dist of distributions) {
        scores.push(performanceFn(candidateParams, dist));
    }

    const worstCase = Math.min(...scores);
    const average = scores.reduce((s, x) => s + x, 0) / scores.length;

    return {
        worstCaseScore: worstCase,
        averageScore: average,
        scoresPerDistribution: scores,
        numDistributions: distributions.length
    };
}

// ── computeRobustnessPremium (pure) ────────────────────────────────
function computeRobustnessPremium(params) {
    const worstCaseScore = _required(params, 'worstCaseScore');
    const averageScore = _required(params, 'averageScore');

    if (averageScore === 0) {
        return { robustnessPremium: 0, classification: 'na' };
    }

    const premium = (averageScore - worstCaseScore) / averageScore;
    const classification = premium >= ROBUSTNESS_PREMIUM_HIGH_THRESHOLD ? 'high' : 'acceptable';

    return { robustnessPremium: premium, classification };
}

// ── runDROOptimization ─────────────────────────────────────────────
function runDROOptimization(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const optimizationId = _required(params, 'optimizationId');
    const setId = _required(params, 'setId');
    const candidateParamsList = _required(params, 'candidateParamsList');
    const performanceFn = _required(params, 'performanceFn');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!Array.isArray(candidateParamsList) || candidateParamsList.length === 0) {
        throw new Error('distributionalRobustnessOptimization: candidateParamsList must be non-empty');
    }

    let bestCandidate = null;
    let bestWorstCase = -Infinity;
    let bestAverage = 0;
    let allEvaluations = [];

    for (const candidate of candidateParamsList) {
        const evalResult = evaluateCandidateAcrossSet({
            setId, candidateParams: candidate, performanceFn
        });
        allEvaluations.push({
            params: candidate,
            worstCase: evalResult.worstCaseScore,
            average: evalResult.averageScore
        });
        if (evalResult.worstCaseScore > bestWorstCase) {
            bestWorstCase = evalResult.worstCaseScore;
            bestAverage = evalResult.averageScore;
            bestCandidate = candidate;
        }
    }

    const robustness = computeRobustnessPremium({
        worstCaseScore: bestWorstCase,
        averageScore: bestAverage
    });

    try {
        _stmts.insertOpt.run(
            userId, env, optimizationId, setId,
            JSON.stringify(allEvaluations),
            bestWorstCase, bestAverage,
            robustness.robustnessPremium,
            JSON.stringify(bestCandidate),
            ts
        );
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`distributionalRobustnessOptimization: duplicate optimizationId "${optimizationId}"`);
        }
        throw err;
    }

    return {
        optimized: true,
        recommendedParams: bestCandidate,
        worstCaseScore: bestWorstCase,
        averageScore: bestAverage,
        robustnessPremium: robustness.robustnessPremium,
        classification: robustness.classification,
        belowFloor: bestWorstCase < MIN_WORST_CASE_FLOOR
    };
}

// ── recordOptimization (manual) ────────────────────────────────────
function recordOptimization(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const optimizationId = _required(params, 'optimizationId');
    const setId = _required(params, 'setId');
    const candidateParams = _required(params, 'candidateParams');
    const worstCaseScore = _required(params, 'worstCaseScore');
    const averageScore = _required(params, 'averageScore');
    const robustnessPremium = _required(params, 'robustnessPremium');
    const recommendedParams = _required(params, 'recommendedParams');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertOpt.run(
            userId, env, optimizationId, setId,
            JSON.stringify(candidateParams),
            worstCaseScore, averageScore, robustnessPremium,
            JSON.stringify(recommendedParams), ts
        );
        return { recorded: true };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`distributionalRobustnessOptimization: duplicate optimizationId`);
        }
        throw err;
    }
}

// ── getOptimization ────────────────────────────────────────────────
function getOptimization(params) {
    const optimizationId = _required(params, 'optimizationId');
    const row = _stmts.getOpt.get(optimizationId);
    if (!row) return null;
    return {
        optimizationId: row.optimization_id,
        setId: row.set_id,
        candidateParams: JSON.parse(row.candidate_params_json),
        worstCaseScore: row.worst_case_score,
        averageScore: row.average_score,
        robustnessPremium: row.robustness_premium,
        recommendedParams: JSON.parse(row.recommended_params_json),
        ts: row.ts
    };
}

// ── getDROHistory ──────────────────────────────────────────────────
function getDROHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.historyForUser.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );
}

module.exports = {
    MIN_DISTRIBUTIONS_FOR_DRO,
    ROBUSTNESS_PREMIUM_HIGH_THRESHOLD,
    MIN_WORST_CASE_FLOOR,
    defineUncertaintySet,
    evaluateCandidateAcrossSet,
    computeRobustnessPremium,
    runDROOptimization,
    recordOptimization,
    getOptimization,
    getDROHistory
};
