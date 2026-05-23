'use strict';

/**
 * OMEGA Wave 3 §189 — SELF-WORLD BOUNDARY INTEGRITY / ENDOGENEITY SEPARATION.
 *
 * Canonical PDF §189 (ml_brain_canonic.txt lines 6093-6151).
 *
 * "s-a schimbat lumea sau m-am schimbat eu?"
 *
 * 4 attribution categories (PDF 6125-6129):
 *   world_moved          — external dominant
 *   i_moved              — internal dominant
 *   both_moved           — both magnitudes high (mixed signal — conservative)
 *   unclear_attribution  — neither dominant (conservative required)
 *
 * Internal sources tracked (PDF 6117-6120):
 *   self_revision | model_updates | ontology_changes | source_reweighting
 *
 * External sources tracked (PDF 6122-6124):
 *   market_changes_real | venue_shifts | macro_regime_changes
 *
 * Per rule 6146: când boundary unclear → conservative mode required.
 * Per rule 6147: confuzia repetată self/world = defect de rang înalt.
 *
 * Plasament _audit (anti self-reinforcement guard, alongside
 * sourceAblationRobustness, outcomeBlindPolicyJudge, antiIdolatryEngine).
 */

const { db } = require('../../database');

const ATTRIBUTIONS = Object.freeze([
    'world_moved', 'i_moved', 'both_moved', 'unclear_attribution'
]);
const INTERNAL_SOURCES = Object.freeze([
    'self_revision', 'model_updates',
    'ontology_changes', 'source_reweighting'
]);
const EXTERNAL_SOURCES = Object.freeze([
    'market_changes_real', 'venue_shifts', 'macro_regime_changes'
]);

const UNCLEAR_GAP_THRESHOLD = 0.20;   // |internal - external| < this → unclear
const DOMINANT_THRESHOLD = 0.30;       // magnitude > this required for dominance
const BOTH_HIGH_THRESHOLD = 0.55;      // both above → both_moved

const CONSERVATIVE_ATTRIBUTIONS = new Set([
    'unclear_attribution', 'both_moved'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§189 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§189 invalid env: ${env}`);
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§189 ${name} must be in [0,1]`);
    }
}

function classifyAttribution(params) {
    const internal = _required(params, 'internalMagnitude');
    const external = _required(params, 'externalMagnitude');
    _requireRange01('internalMagnitude', internal);
    _requireRange01('externalMagnitude', external);
    // Both high → both_moved
    if (internal >= BOTH_HIGH_THRESHOLD && external >= BOTH_HIGH_THRESHOLD) {
        return { attribution: 'both_moved' };
    }
    const gap = Math.abs(internal - external);
    // Unclear if neither truly dominant (gap small)
    if (gap < UNCLEAR_GAP_THRESHOLD) {
        return { attribution: 'unclear_attribution' };
    }
    // Otherwise pick dominant if above threshold
    if (external > internal && external >= DOMINANT_THRESHOLD) {
        return { attribution: 'world_moved' };
    }
    if (internal > external && internal >= DOMINANT_THRESHOLD) {
        return { attribution: 'i_moved' };
    }
    return { attribution: 'unclear_attribution' };
}

function computeBoundaryIntegrityScore(params) {
    const internal = _required(params, 'internalMagnitude');
    const external = _required(params, 'externalMagnitude');
    _requireRange01('internalMagnitude', internal);
    _requireRange01('externalMagnitude', external);
    // Integrity = how clear the separation. High when one dominates clearly.
    // |internal - external| normalized to [0,1]
    const gap = Math.abs(internal - external);
    return { integrityScore: Math.max(0, Math.min(1, gap)) };
}

function requiresConservativeMode(params) {
    const attribution = _required(params, 'attribution');
    if (!ATTRIBUTIONS.includes(attribution)) {
        throw new Error(`§189 invalid attribution: ${attribution}`);
    }
    return { conservativeMode: CONSERVATIVE_ATTRIBUTIONS.has(attribution) ? 1 : 0 };
}

const _stmts = {
    insertAttribution: db.prepare(`
        INSERT INTO ml_self_world_boundary_attributions (
            user_id, resolved_env, attribution_id, change_label,
            internal_change_magnitude, external_change_magnitude,
            attribution, boundary_integrity_score, conservative_mode_flag,
            reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectAttribution: db.prepare(`
        SELECT id, attribution_id AS attributionId, change_label AS changeLabel,
               internal_change_magnitude AS internalChangeMagnitude,
               external_change_magnitude AS externalChangeMagnitude,
               attribution,
               boundary_integrity_score AS boundaryIntegrityScore,
               conservative_mode_flag AS conservativeModeFlag,
               reasoning, ts
        FROM ml_self_world_boundary_attributions
        WHERE attribution_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, attribution_id AS attributionId, change_label AS changeLabel,
               attribution,
               boundary_integrity_score AS boundaryIntegrityScore,
               conservative_mode_flag AS conservativeModeFlag, ts
        FROM ml_self_world_boundary_attributions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByAttribution: db.prepare(`
        SELECT id, attribution_id AS attributionId, change_label AS changeLabel,
               attribution,
               boundary_integrity_score AS boundaryIntegrityScore,
               conservative_mode_flag AS conservativeModeFlag, ts
        FROM ml_self_world_boundary_attributions
        WHERE user_id = ? AND resolved_env = ? AND attribution = ?
        ORDER BY ts DESC
    `),
    countByAttribution: db.prepare(`
        SELECT attribution, COUNT(*) AS count
        FROM ml_self_world_boundary_attributions
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY attribution
    `)
};

function recordBoundaryAttribution(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const attributionId = _required(params, 'attributionId');
    const changeLabel = _required(params, 'changeLabel');
    const internalMagnitude = _required(params, 'internalChangeMagnitude');
    const externalMagnitude = _required(params, 'externalChangeMagnitude');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectAttribution.get(attributionId)) {
        throw new Error(`§189 duplicate attributionId: ${attributionId}`);
    }

    const { attribution } = classifyAttribution({
        internalMagnitude, externalMagnitude
    });
    const { integrityScore: boundaryIntegrityScore } = computeBoundaryIntegrityScore({
        internalMagnitude, externalMagnitude
    });
    const { conservativeMode: conservativeModeFlag } = requiresConservativeMode({ attribution });

    _stmts.insertAttribution.run(
        userId, resolvedEnv, attributionId, changeLabel,
        internalMagnitude, externalMagnitude,
        attribution, boundaryIntegrityScore, conservativeModeFlag,
        reasoning, ts
    );

    return {
        recorded: true, attributionId, changeLabel,
        attribution, boundaryIntegrityScore, conservativeModeFlag
    };
}

function getRecentAttributions(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const attribution = params.attribution;
    if (attribution !== undefined && !ATTRIBUTIONS.includes(attribution)) {
        throw new Error(`§189 invalid attribution filter`);
    }
    return attribution
        ? _stmts.selectByAttribution.all(userId, resolvedEnv, attribution)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function getStatsByAttribution(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByAttribution.all(userId, resolvedEnv, sinceTs);
    const stats = {
        world_moved: 0, i_moved: 0, both_moved: 0,
        unclear_attribution: 0, totalCount: 0
    };
    for (const r of rows) {
        stats[r.attribution] = r.count;
        stats.totalCount += r.count;
    }
    return stats;
}

module.exports = {
    ATTRIBUTIONS,
    INTERNAL_SOURCES,
    EXTERNAL_SOURCES,
    UNCLEAR_GAP_THRESHOLD,
    DOMINANT_THRESHOLD,
    BOTH_HIGH_THRESHOLD,
    classifyAttribution,
    computeBoundaryIntegrityScore,
    requiresConservativeMode,
    recordBoundaryAttribution,
    getRecentAttributions,
    getStatsByAttribution
};
