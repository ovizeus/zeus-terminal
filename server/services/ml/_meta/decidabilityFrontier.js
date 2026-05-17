'use strict';

/**
 * OMEGA §191 — DECIDABILITY FRONTIER / COERCION-OF-VERDICT DETECTOR.
 * Canonical PDF lines 6210-6262.
 */

const { db } = require('../../database');

const DECIDABILITY_CATEGORIES = Object.freeze([
    'decidable_now',
    'decidable_with_more_sensing',
    'decidable_only_with_ontology_change',
    'not_responsibly_decidable_in_current_frame'
]);
const ESCALATION_OPTIONS = Object.freeze([
    'act', 'wait', 'reframe_question',
    'active_sensing', 'shadow_only', 'observer'
]);

const DECIDABILITY_FACTORS = Object.freeze([
    'evidenceAvailable', 'ontologyAvailable',
    'computeAvailable', 'timeAvailable', 'authorityAvailable'
]);

const DECIDABILITY_THRESHOLDS = Object.freeze({
    decidable_now: 0.75,           // all factors high
    decidable_with_more_sensing: 0.55,  // evidence/sensing gap
    decidable_only_with_ontology_change: 0.30
});

const COERCION_THRESHOLD = 0.30;  // below = coercion if verdict produced

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§191 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§191 invalid env: ${env}`);
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§191 ${name} must be in [0,1]`);
    }
}

function computeDecidabilityScore(params) {
    const factors = _required(params, 'factors');
    let sum = 0;
    for (const f of DECIDABILITY_FACTORS) {
        if (factors[f] === undefined) throw new Error(`§191 missing factor: ${f}`);
        _requireRange01(f, factors[f]);
        sum += factors[f];
    }
    return { decidabilityScore: Math.max(0, Math.min(1, sum / DECIDABILITY_FACTORS.length)) };
}

function classifyDecidability(params) {
    const score = _required(params, 'decidabilityScore');
    const factors = _required(params, 'factors');
    _requireRange01('decidabilityScore', score);
    // High overall → decidable_now
    if (score >= DECIDABILITY_THRESHOLDS.decidable_now) {
        return { category: 'decidable_now' };
    }
    // Catastrophic overall (factors all low) → not_responsibly_decidable
    // BEFORE specific weakness checks (when everything is broken, ontology
    // patch alone won't fix it)
    if (score < DECIDABILITY_THRESHOLDS.decidable_only_with_ontology_change) {
        return { category: 'not_responsibly_decidable_in_current_frame' };
    }
    // Specific weakness: ontology is the bottleneck (others ok-ish)
    if (factors.ontologyAvailable < 0.30) {
        return { category: 'decidable_only_with_ontology_change' };
    }
    // Specific weakness: evidence is the bottleneck
    if (score >= DECIDABILITY_THRESHOLDS.decidable_with_more_sensing
        && factors.evidenceAvailable < 0.50) {
        return { category: 'decidable_with_more_sensing' };
    }
    return { category: 'decidable_with_more_sensing' };
}

function recommendEscalation(params) {
    const category = _required(params, 'category');
    if (!DECIDABILITY_CATEGORIES.includes(category)) {
        throw new Error(`§191 invalid category: ${category}`);
    }
    const map = {
        decidable_now: 'act',
        decidable_with_more_sensing: 'active_sensing',
        decidable_only_with_ontology_change: 'reframe_question',
        not_responsibly_decidable_in_current_frame: 'observer'
    };
    return { escalation: map[category] };
}

function detectCoercion(params) {
    const decidabilityScore = _required(params, 'decidabilityScore');
    const forcedVerdict = _required(params, 'forcedVerdict');  // bool
    _requireRange01('decidabilityScore', decidabilityScore);
    // Coercion when system produces verdict despite low decidability
    return {
        coercionDetected: (forcedVerdict && decidabilityScore < COERCION_THRESHOLD) ? 1 : 0
    };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_decidability_assessments (
            user_id, resolved_env, assessment_id, question_label,
            evidence_available, ontology_available, compute_available,
            time_available, authority_available, decidability_score,
            decidability_category, recommended_escalation,
            coercion_detected, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_decidability_assessments WHERE assessment_id = ?`),
    selectAllRecent: db.prepare(`
        SELECT id, assessment_id AS assessmentId, question_label AS questionLabel,
               decidability_score AS decidabilityScore,
               decidability_category AS decidabilityCategory,
               recommended_escalation AS recommendedEscalation,
               coercion_detected AS coercionDetected, ts
        FROM ml_decidability_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByCategory: db.prepare(`
        SELECT id, assessment_id AS assessmentId, question_label AS questionLabel,
               decidability_score AS decidabilityScore,
               decidability_category AS decidabilityCategory,
               recommended_escalation AS recommendedEscalation,
               coercion_detected AS coercionDetected, ts
        FROM ml_decidability_assessments
        WHERE user_id = ? AND resolved_env = ? AND decidability_category = ?
        ORDER BY ts DESC
    `)
};

function recordDecidabilityAssessment(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const assessmentId = _required(params, 'assessmentId');
    const questionLabel = _required(params, 'questionLabel');
    const factors = _required(params, 'factors');
    const forcedVerdict = params.forcedVerdict === true;
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectById.get(assessmentId)) {
        throw new Error(`§191 duplicate assessmentId: ${assessmentId}`);
    }

    const { decidabilityScore } = computeDecidabilityScore({ factors });
    const { category } = classifyDecidability({ decidabilityScore, factors });
    const { escalation } = recommendEscalation({ category });
    const { coercionDetected } = detectCoercion({ decidabilityScore, forcedVerdict });

    _stmts.insert.run(
        userId, resolvedEnv, assessmentId, questionLabel,
        factors.evidenceAvailable, factors.ontologyAvailable,
        factors.computeAvailable, factors.timeAvailable,
        factors.authorityAvailable, decidabilityScore,
        category, escalation, coercionDetected, reasoning, ts
    );

    return {
        recorded: true, assessmentId, questionLabel,
        decidabilityScore, decidabilityCategory: category,
        recommendedEscalation: escalation, coercionDetected
    };
}

function getRecentAssessments(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const category = params.decidabilityCategory;
    if (category !== undefined && !DECIDABILITY_CATEGORIES.includes(category)) {
        throw new Error(`§191 invalid category filter`);
    }
    return category
        ? _stmts.selectByCategory.all(userId, resolvedEnv, category)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

module.exports = {
    DECIDABILITY_CATEGORIES,
    ESCALATION_OPTIONS,
    DECIDABILITY_FACTORS,
    DECIDABILITY_THRESHOLDS,
    COERCION_THRESHOLD,
    computeDecidabilityScore,
    classifyDecidability,
    recommendEscalation,
    detectCoercion,
    recordDecidabilityAssessment,
    getRecentAssessments
};
