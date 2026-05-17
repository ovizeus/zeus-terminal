'use strict';

/**
 * OMEGA Wave 3 §181 — COSMIC LOCALITY CHECK / DO-NOT-UNIVERSALIZE-THE-PARISH.
 *
 * Canonical PDF §181 (ml_brain_canonic.txt lines 5929-5976).
 *
 * "descoperirea mea este un adevar mare sau doar un adevar de cartier?"
 *
 * 7 canonical scope tags (PDF lines 5944-5951), ordered narrow → broad:
 *   local | regime_bound | asset_bound | venue_bound | session_bound |
 *   likely_general | unknown_scope (uncertain — special, not ordered)
 *
 * Per PDF rules 5970-5973:
 * - nicio regula nu primește scope universal fără teste cross-context
 * - idei noi pornesc cu scope mic implicit
 * - extinderea scopului trebuie CÂȘTIGATĂ, nu presupusă
 *
 * Algorithm:
 *   portability_score = supporting / tested
 *   evidenced_generality = portability * confidence(testedCount)
 *     where confidence approaches 1.0 as count approaches/exceeds MIN_TESTED_FOR_GENERAL
 *   universalization_penalty = max(0, claimed - evidenced)
 *   recommended_scope from (portability, testedCount):
 *     - 0 tested → unknown_scope
 *     - high portability + sufficient tested → likely_general
 *     - moderate → asset/regime/session_bound based on declared
 *     - low → narrow back to local
 *
 * Plasare R2_cognition pentru integrare cu concept library, competence
 * map, ontology revision.
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const SCOPE_TAGS = Object.freeze([
    'local', 'regime_bound', 'asset_bound',
    'venue_bound', 'session_bound',
    'likely_general', 'unknown_scope'
]);

// Breadth ordering — narrow (low number) to broad (high number).
// unknown_scope = -1 (special, not on the ladder).
const SCOPE_BREADTH_MAP = Object.freeze({
    unknown_scope: -1,
    local: 0,
    session_bound: 1,
    venue_bound: 2,
    asset_bound: 3,
    regime_bound: 4,
    likely_general: 5
});

const MIN_TESTED_FOR_GENERAL = 10;
const PORTABILITY_THRESHOLD_GENERAL = 0.80;
const UNIVERSALIZATION_PENALTY_THRESHOLD = 0.30;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§181 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§181 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§181 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computePortabilityScore(params) {
    const supporting = _required(params, 'supportingContextsCount');
    const tested = _required(params, 'testedContextsCount');
    if (typeof supporting !== 'number' || supporting < 0) {
        throw new Error('§181 supportingContextsCount must be non-negative');
    }
    if (typeof tested !== 'number' || tested < 0) {
        throw new Error('§181 testedContextsCount must be non-negative');
    }
    if (supporting > tested) {
        throw new Error(`§181 supporting (${supporting}) exceeds tested (${tested})`);
    }
    if (tested === 0) return { portabilityScore: 0 };
    return { portabilityScore: supporting / tested };
}

function computeEvidencedGenerality(params) {
    const portability = _required(params, 'portabilityScore');
    const tested = _required(params, 'testedContextsCount');
    _requireRange01('portabilityScore', portability);
    if (typeof tested !== 'number' || tested < 0) {
        throw new Error('§181 testedContextsCount must be non-negative');
    }
    // Confidence factor: linear ramp to 1.0 at MIN_TESTED_FOR_GENERAL
    const confidence = Math.min(1, tested / MIN_TESTED_FOR_GENERAL);
    const evidenced = portability * confidence;
    return { evidencedGenerality: Math.max(0, Math.min(1, evidenced)) };
}

function computeUniversalizationPenalty(params) {
    const claimed = _required(params, 'claimedGenerality');
    const evidenced = _required(params, 'evidencedGenerality');
    _requireRange01('claimedGenerality', claimed);
    _requireRange01('evidencedGenerality', evidenced);
    const gap = Math.max(0, claimed - evidenced);
    return { universalizationPenalty: Math.max(0, Math.min(1, gap)) };
}

function classifyRecommendedScope(params) {
    const portability = _required(params, 'portabilityScore');
    const tested = _required(params, 'testedContextsCount');
    const declaredScope = _required(params, 'declaredScope');
    _requireRange01('portabilityScore', portability);
    if (typeof tested !== 'number' || tested < 0) {
        throw new Error('§181 testedContextsCount must be non-negative');
    }
    if (!SCOPE_TAGS.includes(declaredScope)) {
        throw new Error(`§181 invalid declaredScope: ${declaredScope}`);
    }
    // Zero tested → unknown_scope (no evidence)
    if (tested === 0) {
        return { recommendedScope: 'unknown_scope' };
    }
    // High portability + sufficient tested → likely_general
    if (portability >= PORTABILITY_THRESHOLD_GENERAL
        && tested >= MIN_TESTED_FOR_GENERAL) {
        return { recommendedScope: 'likely_general' };
    }
    // Low portability → must narrow to local
    if (portability < 0.30) {
        return { recommendedScope: 'local' };
    }
    // Moderate evidence → preserve declared scope if narrower than
    // likely_general (per rule "extinderea scopului trebuie CÂȘTIGATĂ")
    if (declaredScope === 'likely_general') {
        // Demote to asset_bound (middle tier) since not yet earned
        return { recommendedScope: 'asset_bound' };
    }
    return { recommendedScope: declaredScope };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertAssessment: db.prepare(`
        INSERT INTO ml_locality_assessments (
            user_id, resolved_env, assessment_id, thesis_label, declared_scope,
            tested_contexts_count, supporting_contexts_count,
            portability_score, claimed_generality, evidenced_generality,
            universalization_penalty, recommended_scope, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectAssessment: db.prepare(`
        SELECT id, assessment_id AS assessmentId, thesis_label AS thesisLabel,
               declared_scope AS declaredScope,
               tested_contexts_count AS testedContextsCount,
               supporting_contexts_count AS supportingContextsCount,
               portability_score AS portabilityScore,
               claimed_generality AS claimedGenerality,
               evidenced_generality AS evidencedGenerality,
               universalization_penalty AS universalizationPenalty,
               recommended_scope AS recommendedScope,
               reasoning, ts
        FROM ml_locality_assessments
        WHERE assessment_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, assessment_id AS assessmentId, thesis_label AS thesisLabel,
               declared_scope AS declaredScope,
               tested_contexts_count AS testedContextsCount,
               supporting_contexts_count AS supportingContextsCount,
               portability_score AS portabilityScore,
               evidenced_generality AS evidencedGenerality,
               universalization_penalty AS universalizationPenalty,
               recommended_scope AS recommendedScope, ts
        FROM ml_locality_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByRecommendedScope: db.prepare(`
        SELECT id, assessment_id AS assessmentId, thesis_label AS thesisLabel,
               declared_scope AS declaredScope,
               tested_contexts_count AS testedContextsCount,
               supporting_contexts_count AS supportingContextsCount,
               portability_score AS portabilityScore,
               evidenced_generality AS evidencedGenerality,
               universalization_penalty AS universalizationPenalty,
               recommended_scope AS recommendedScope, ts
        FROM ml_locality_assessments
        WHERE user_id = ? AND resolved_env = ? AND recommended_scope = ?
        ORDER BY ts DESC
    `),
    countByScope: db.prepare(`
        SELECT recommended_scope AS recommendedScope, COUNT(*) AS count
        FROM ml_locality_assessments
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY recommended_scope
    `)
};

function recordLocalityAssessment(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const assessmentId = _required(params, 'assessmentId');
    const thesisLabel = _required(params, 'thesisLabel');
    const declaredScope = _required(params, 'declaredScope');
    const testedContextsCount = _required(params, 'testedContextsCount');
    const supportingContextsCount = _required(params, 'supportingContextsCount');
    const claimedGenerality = _required(params, 'claimedGenerality');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!SCOPE_TAGS.includes(declaredScope)) {
        throw new Error(`§181 invalid declaredScope: ${declaredScope}`);
    }
    _requireRange01('claimedGenerality', claimedGenerality);
    if (_stmts.selectAssessment.get(assessmentId)) {
        throw new Error(`§181 duplicate assessmentId: ${assessmentId}`);
    }

    const { portabilityScore } = computePortabilityScore({
        supportingContextsCount, testedContextsCount
    });
    const { evidencedGenerality } = computeEvidencedGenerality({
        portabilityScore, testedContextsCount
    });
    const { universalizationPenalty } = computeUniversalizationPenalty({
        claimedGenerality, evidencedGenerality
    });
    const { recommendedScope } = classifyRecommendedScope({
        portabilityScore, testedContextsCount, declaredScope
    });

    _stmts.insertAssessment.run(
        userId, resolvedEnv, assessmentId, thesisLabel, declaredScope,
        testedContextsCount, supportingContextsCount,
        portabilityScore, claimedGenerality, evidencedGenerality,
        universalizationPenalty, recommendedScope, reasoning, ts
    );

    return {
        recorded: true,
        assessmentId, thesisLabel,
        portabilityScore, evidencedGenerality,
        universalizationPenalty, recommendedScope
    };
}

function getRecentAssessments(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const recommendedScope = params.recommendedScope;
    if (recommendedScope !== undefined && !SCOPE_TAGS.includes(recommendedScope)) {
        throw new Error(`§181 invalid recommendedScope filter: ${recommendedScope}`);
    }
    return recommendedScope
        ? _stmts.selectByRecommendedScope.all(userId, resolvedEnv, recommendedScope)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function getStatsByScope(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByScope.all(userId, resolvedEnv, sinceTs);
    const stats = {
        local: 0, regime_bound: 0, asset_bound: 0, venue_bound: 0,
        session_bound: 0, likely_general: 0, unknown_scope: 0,
        totalCount: 0
    };
    for (const r of rows) {
        stats[r.recommendedScope] = r.count;
        stats.totalCount += r.count;
    }
    return stats;
}

module.exports = {
    // constants
    SCOPE_TAGS,
    SCOPE_BREADTH_MAP,
    MIN_TESTED_FOR_GENERAL,
    PORTABILITY_THRESHOLD_GENERAL,
    UNIVERSALIZATION_PENALTY_THRESHOLD,
    // pure
    computePortabilityScore,
    computeEvidencedGenerality,
    computeUniversalizationPenalty,
    classifyRecommendedScope,
    // DB
    recordLocalityAssessment,
    getRecentAssessments,
    getStatsByScope
};

// FILE END §181 cosmicLocalityCheck.js
