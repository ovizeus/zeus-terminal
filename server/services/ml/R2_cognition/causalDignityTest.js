'use strict';

/**
 * OMEGA Wave 3 §178 — CAUSAL DIGNITY TEST / DOES-EXPLANATION-RESPECT-WORLD.
 *
 * Canonical PDF §178 (ml_brain_canonic.txt lines 5792-5832).
 *
 * "explicatia mea chiar respecta felul in care pare sa functioneze lumea
 *  sau doar exploateaza o scurtatura?"
 *
 * 5 canonical dignity criteria (PDF lines 5807-5811):
 *   mechanicalRealism           — explanation has real mechanism
 *   interRegimeStability        — survives different market regimes
 *   transferability             — generalizes across instruments/timeframes
 *   interventionSupportability  — can support causal interventions
 *   causalStructureCompatibility — coherent with rest of causal model
 *
 * 3 canonical classifications (PDF lines 5813-5815):
 *   explanation_works                   — predictive, dignity middle
 *   explanation_respects_mechanism      — predictive + high dignity
 *   explanation_is_exploitative_shortcut — high predictive + low dignity
 *
 * 3 use tiers (per PDF rule 5826):
 *   heuristic_only          — for shortcuts; never as foundation
 *   local_application       — middle dignity; ok for local use
 *   ontological_foundation  — high dignity; safe as fundamental belief
 *
 * Per canonical rule 5825: "puterea predictiva singura NU garanteaza
 * demnitate cauzala." Per rule 5827: theses must pass minimum dignity
 * for important applications.
 *
 * Plasare R2_cognition pentru integrare cu structuralCausalModel,
 * interventionalReasoning, narrativeCoherence, attribution.
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const DIGNITY_CRITERIA = Object.freeze([
    'mechanicalRealism', 'interRegimeStability',
    'transferability', 'interventionSupportability',
    'causalStructureCompatibility'
]);
const CLASSIFICATIONS = Object.freeze([
    'explanation_works',
    'explanation_respects_mechanism',
    'explanation_is_exploitative_shortcut'
]);
const USE_TIERS = Object.freeze([
    'heuristic_only', 'local_application', 'ontological_foundation'
]);

const DIGNITY_THRESHOLDS = Object.freeze({
    foundation: 0.70,
    local: 0.40
});

const SHORTCUT_DETECTION_THRESHOLDS = Object.freeze({
    minPredictive: 0.65,  // high predictive
    maxDignity: 0.30      // low dignity
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§178 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§178 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§178 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeDignityScore(params) {
    const criteria = _required(params, 'criteria');
    let sum = 0;
    for (const c of DIGNITY_CRITERIA) {
        if (criteria[c] === undefined || criteria[c] === null) {
            throw new Error(`§178 missing criterion: ${c}`);
        }
        _requireRange01(c, criteria[c]);
        sum += criteria[c];
    }
    return { dignityScore: Math.max(0, Math.min(1, sum / DIGNITY_CRITERIA.length)) };
}

function classifyExplanation(params) {
    const predictiveAccuracy = _required(params, 'predictiveAccuracy');
    const dignityScore = _required(params, 'dignityScore');
    _requireRange01('predictiveAccuracy', predictiveAccuracy);
    _requireRange01('dignityScore', dignityScore);
    // Shortcut: high predictive accuracy AND low dignity
    if (predictiveAccuracy >= SHORTCUT_DETECTION_THRESHOLDS.minPredictive
        && dignityScore <= SHORTCUT_DETECTION_THRESHOLDS.maxDignity) {
        return { classification: 'explanation_is_exploitative_shortcut' };
    }
    // Respects mechanism: high dignity
    if (dignityScore >= DIGNITY_THRESHOLDS.foundation) {
        return { classification: 'explanation_respects_mechanism' };
    }
    // Otherwise: works (could be middling or weak overall)
    return { classification: 'explanation_works' };
}

function recommendUseTier(params) {
    const dignityScore = _required(params, 'dignityScore');
    const classification = _required(params, 'classification');
    _requireRange01('dignityScore', dignityScore);
    if (!CLASSIFICATIONS.includes(classification)) {
        throw new Error(`§178 invalid classification: ${classification}`);
    }
    // PDF rule 5826: shortcut explanations cannot rise above heuristic_only
    if (classification === 'explanation_is_exploitative_shortcut') {
        return { useTier: 'heuristic_only' };
    }
    if (dignityScore >= DIGNITY_THRESHOLDS.foundation) {
        return { useTier: 'ontological_foundation' };
    }
    if (dignityScore >= DIGNITY_THRESHOLDS.local) {
        return { useTier: 'local_application' };
    }
    return { useTier: 'heuristic_only' };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertEval: db.prepare(`
        INSERT INTO ml_causal_dignity_evaluations (
            user_id, resolved_env, evaluation_id, explanation_label,
            predictive_accuracy, mechanical_realism, inter_regime_stability,
            transferability, intervention_supportability,
            causal_structure_compatibility, composite_dignity_score,
            classification, allowed_use_tier, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectEval: db.prepare(`
        SELECT id, evaluation_id AS evaluationId,
               explanation_label AS explanationLabel,
               predictive_accuracy AS predictiveAccuracy,
               mechanical_realism AS mechanicalRealism,
               inter_regime_stability AS interRegimeStability,
               transferability,
               intervention_supportability AS interventionSupportability,
               causal_structure_compatibility AS causalStructureCompatibility,
               composite_dignity_score AS compositeDignityScore,
               classification,
               allowed_use_tier AS allowedUseTier,
               reasoning, ts
        FROM ml_causal_dignity_evaluations
        WHERE evaluation_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, evaluation_id AS evaluationId,
               explanation_label AS explanationLabel,
               composite_dignity_score AS compositeDignityScore,
               classification,
               allowed_use_tier AS allowedUseTier, ts
        FROM ml_causal_dignity_evaluations
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByClassification: db.prepare(`
        SELECT id, evaluation_id AS evaluationId,
               explanation_label AS explanationLabel,
               composite_dignity_score AS compositeDignityScore,
               classification,
               allowed_use_tier AS allowedUseTier, ts
        FROM ml_causal_dignity_evaluations
        WHERE user_id = ? AND resolved_env = ? AND classification = ?
        ORDER BY ts DESC
    `),
    countByClassification: db.prepare(`
        SELECT classification, COUNT(*) AS count
        FROM ml_causal_dignity_evaluations
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY classification
    `)
};

function recordCausalDignityEvaluation(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const evaluationId = _required(params, 'evaluationId');
    const explanationLabel = _required(params, 'explanationLabel');
    const predictiveAccuracy = _required(params, 'predictiveAccuracy');
    const criteria = _required(params, 'criteria');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    _requireRange01('predictiveAccuracy', predictiveAccuracy);
    if (_stmts.selectEval.get(evaluationId)) {
        throw new Error(`§178 duplicate evaluationId: ${evaluationId}`);
    }

    const { dignityScore } = computeDignityScore({ criteria });
    const { classification } = classifyExplanation({
        predictiveAccuracy, dignityScore
    });
    const { useTier: allowedUseTier } = recommendUseTier({
        dignityScore, classification
    });

    _stmts.insertEval.run(
        userId, resolvedEnv, evaluationId, explanationLabel,
        predictiveAccuracy,
        criteria.mechanicalRealism, criteria.interRegimeStability,
        criteria.transferability, criteria.interventionSupportability,
        criteria.causalStructureCompatibility,
        dignityScore, classification, allowedUseTier, reasoning, ts
    );

    return {
        recorded: true,
        evaluationId, explanationLabel,
        compositeDignityScore: dignityScore,
        classification, allowedUseTier
    };
}

function getRecentEvaluations(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const classification = params.classification;
    if (classification !== undefined && !CLASSIFICATIONS.includes(classification)) {
        throw new Error(`§178 invalid classification filter: ${classification}`);
    }
    return classification
        ? _stmts.selectByClassification.all(userId, resolvedEnv, classification)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function getStatsByClassification(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByClassification.all(userId, resolvedEnv, sinceTs);
    const stats = {
        explanation_works: 0,
        explanation_respects_mechanism: 0,
        explanation_is_exploitative_shortcut: 0,
        totalCount: 0
    };
    for (const r of rows) {
        stats[r.classification] = r.count;
        stats.totalCount += r.count;
    }
    return stats;
}

module.exports = {
    // constants
    DIGNITY_CRITERIA,
    CLASSIFICATIONS,
    USE_TIERS,
    DIGNITY_THRESHOLDS,
    SHORTCUT_DETECTION_THRESHOLDS,
    // pure
    computeDignityScore,
    classifyExplanation,
    recommendUseTier,
    // DB
    recordCausalDignityEvaluation,
    getRecentEvaluations,
    getStatsByClassification
};

// FILE END §178 causalDignityTest.js
