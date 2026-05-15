'use strict';

/**
 * OMEGA cross-cutting — xaiLayer (canonical §54)
 *
 * §54 XAI LAYER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 1588.
 *
 * "Expune top-3 factori, interval de incredere, contra-factual
 *  'ce ar fi trebuit sa se schimbe ca sa nu iau trade-ul'."
 *
 * Cross-cutting. Complement §25 explainability (generic SHAP-style
 * exposure). §54 adds:
 *   - confidence intervals per factor
 *   - per-factor counterfactual: shift needed to flip decision
 */

const { db } = require('../../database');

const TOP_FACTORS_COUNT = 3;
const DEFAULT_CONFIDENCE_LEVEL = 0.90;
const COUNTERFACTUAL_DIRECTIONS = Object.freeze(['increase', 'decrease', 'any']);

// z-score for 90% confidence two-sided ≈ 1.645
function _zForConfidence(level) {
    // Approximate; common levels precomputed.
    if (level === 0.99) return 2.576;
    if (level === 0.95) return 1.96;
    if (level === 0.90) return 1.645;
    if (level === 0.80) return 1.282;
    return 1.96;
}

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`xaiLayer: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertExplanation: db.prepare(`
        INSERT INTO ml_xai_explanations
        (user_id, resolved_env, decision_id, action,
         top_factors_json, counterfactual_json,
         confidence_level, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getForDecision: db.prepare(`
        SELECT * FROM ml_xai_explanations
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts DESC, id DESC
        LIMIT 1
    `),
    statsForUser: db.prepare(`
        SELECT * FROM ml_xai_explanations
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
    `)
};

// ── computeXAI ─────────────────────────────────────────────────────
// Inputs:
//   featureContributions: [{name, shapValue, stdError?, sensitivity?}, ...]
//   decisionScore: current model score
//   decisionThreshold: threshold above which trade is taken (e.g. 0.5)
//   confidenceLevel: optional (default 0.90)
function computeXAI(params) {
    const featureContributions = _required(params, 'featureContributions');
    const decisionScore = _required(params, 'decisionScore');
    const decisionThreshold = _required(params, 'decisionThreshold');
    const confidenceLevel = (params && params.confidenceLevel)
        ? params.confidenceLevel : DEFAULT_CONFIDENCE_LEVEL;

    if (!Array.isArray(featureContributions) || featureContributions.length === 0) {
        throw new Error('xaiLayer: featureContributions must be non-empty array');
    }

    const z = _zForConfidence(confidenceLevel);

    // Sort by absolute shap value desc
    const sorted = featureContributions.slice().sort(
        (a, b) => Math.abs(b.shapValue) - Math.abs(a.shapValue)
    );

    const topFactors = sorted.slice(0, TOP_FACTORS_COUNT).map(f => {
        const stdError = (f.stdError !== undefined) ? f.stdError : Math.abs(f.shapValue) * 0.10;
        return {
            name: f.name,
            shapValue: f.shapValue,
            confidenceLow: f.shapValue - z * stdError,
            confidenceHigh: f.shapValue + z * stdError
        };
    });

    // Distance from threshold (signed).
    const distance = decisionScore - decisionThreshold;

    // Counterfactual per top factor: what shift in this factor would flip decision?
    const counterfactual = topFactors.map(f => {
        const orig = sorted.find(x => x.name === f.name);
        const sensitivity = (orig && orig.sensitivity !== undefined) ? orig.sensitivity : 1;
        // shift_needed = distance / sensitivity (heuristic linear approximation)
        const shiftNeeded = sensitivity !== 0 ? distance / sensitivity : Infinity;
        let direction;
        if (shiftNeeded > 0) direction = 'decrease';   // need feature lower to lower score below threshold
        else if (shiftNeeded < 0) direction = 'increase';
        else direction = 'any';

        return {
            name: f.name,
            shiftNeededToFlip: Math.abs(shiftNeeded),
            direction
        };
    });

    return {
        topFactors,
        counterfactual,
        decisionScore,
        decisionThreshold,
        distance,
        confidenceLevel
    };
}

// ── recordExplanation ──────────────────────────────────────────────
function recordExplanation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const action = _required(params, 'action');
    const topFactors = _required(params, 'topFactors');
    const counterfactual = (params && params.counterfactual) ? params.counterfactual : null;
    const confidenceLevel = (params && params.confidenceLevel)
        ? params.confidenceLevel : DEFAULT_CONFIDENCE_LEVEL;
    const ts = (params && params.ts) ? params.ts : Date.now();

    _stmts.insertExplanation.run(
        userId, env, decisionId, action,
        JSON.stringify(topFactors),
        counterfactual ? JSON.stringify(counterfactual) : null,
        confidenceLevel, ts
    );

    return { recorded: true };
}

// ── getExplanationForDecision ──────────────────────────────────────
function getExplanationForDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const row = _stmts.getForDecision.get(userId, env, decisionId);
    if (!row) return null;
    return {
        decisionId: row.decision_id,
        action: row.action,
        topFactors: JSON.parse(row.top_factors_json),
        counterfactual: row.counterfactual_json ? JSON.parse(row.counterfactual_json) : null,
        confidenceLevel: row.confidence_level,
        ts: row.ts
    };
}

// ── findCounterfactualBreakeven ────────────────────────────────────
function findCounterfactualBreakeven(params) {
    const featureName = _required(params, 'featureName');
    const currentScore = _required(params, 'currentScore');
    const threshold = _required(params, 'threshold');
    const sensitivity = _required(params, 'sensitivity');

    const distance = currentScore - threshold;
    const shiftNeeded = sensitivity !== 0 ? distance / sensitivity : Infinity;
    let direction;
    if (shiftNeeded > 0) direction = 'decrease';
    else if (shiftNeeded < 0) direction = 'increase';
    else direction = 'any';

    return {
        featureName,
        shiftNeededToFlip: Math.abs(shiftNeeded),
        direction,
        currentScore,
        threshold,
        distance
    };
}

// ── getExplanationStats ────────────────────────────────────────────
function getExplanationStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.statsForUser.all(userId, env, since);

    const factorCounts = {};
    for (const row of rows) {
        try {
            const factors = JSON.parse(row.top_factors_json);
            for (const f of factors) {
                if (!factorCounts[f.name]) factorCounts[f.name] = 0;
                factorCounts[f.name]++;
            }
        } catch (_) {}
    }

    const ranked = Object.entries(factorCounts)
        .map(([name, count]) => ({ factor: name, count }))
        .sort((a, b) => b.count - a.count);

    return {
        explanationsCount: rows.length,
        topFactorsRanked: ranked
    };
}

module.exports = {
    TOP_FACTORS_COUNT,
    DEFAULT_CONFIDENCE_LEVEL,
    COUNTERFACTUAL_DIRECTIONS,
    computeXAI,
    recordExplanation,
    getExplanationForDecision,
    findCounterfactualBreakeven,
    getExplanationStats
};
