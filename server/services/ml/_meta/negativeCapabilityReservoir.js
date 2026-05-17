'use strict';

/**
 * OMEGA Wave 3 §188 — NEGATIVE CAPABILITY RESERVOIR / STRUCTURED AMBIGUITY HOLDING.
 *
 * Canonical PDF §188 (ml_brain_canonic.txt lines 6042-6090).
 *
 * "pot sa traiesc lucid cu faptul ca situatia nu este inca inteligibila?"
 *
 * Per rule 6086: ambiguity prea mult fără plan → escalation required.
 */

const { db } = require('../../database');

const AMBIGUITY_CLASSIFICATIONS = Object.freeze([
    'healthy_tolerated_ambiguity', 'anxious_ambiguity',
    'artificial_closure_avoidance'
]);
const HANDLING_MODES = Object.freeze([
    'unresolved_thesis', 'unresolved_but_stable', 'wait', 'observer'
]);

const DURATION_ESCALATION_THRESHOLD_MS = 4 * 3600 * 1000;
const STABILITY_INDEX_THRESHOLD = 0.65;
const ANXIETY_THRESHOLD = 0.60;
const HEALTHY_SCORE_THRESHOLD = 0.65;
const CLOSURE_AVOIDANCE_THRESHOLD = 0.35;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§188 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§188 invalid env: ${env}`);
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§188 ${name} must be in [0,1]`);
    }
}

function computeNegativeCapabilityScore(params) {
    const lucidity = _required(params, 'lucidityScore');
    const stability = _required(params, 'stabilityScore');
    const anxiety = _required(params, 'anxietyScore');
    _requireRange01('lucidityScore', lucidity);
    _requireRange01('stabilityScore', stability);
    _requireRange01('anxietyScore', anxiety);
    // Score = weighted positive minus anxiety penalty
    const score = 0.40 * lucidity + 0.40 * stability + 0.20 * (1 - anxiety);
    return { score: Math.max(0, Math.min(1, score)) };
}

function classifyAmbiguityHandling(params) {
    const score = _required(params, 'negativeCapabilityScore');
    const anxiety = _required(params, 'anxietyScore');
    _requireRange01('negativeCapabilityScore', score);
    _requireRange01('anxietyScore', anxiety);
    if (anxiety >= ANXIETY_THRESHOLD) {
        return { classification: 'anxious_ambiguity' };
    }
    if (score >= HEALTHY_SCORE_THRESHOLD) {
        return { classification: 'healthy_tolerated_ambiguity' };
    }
    // Low score + low anxiety = system fakes closure to avoid sitting
    return { classification: 'artificial_closure_avoidance' };
}

function requiresEscalation(params) {
    const duration = _required(params, 'ambiguityDurationMs');
    const hasPlan = _required(params, 'hasResolutionPlan');
    if (typeof duration !== 'number' || duration < 0) {
        throw new Error('§188 duration must be non-negative');
    }
    if (duration > DURATION_ESCALATION_THRESHOLD_MS && !hasPlan) {
        return { escalationRequired: 1 };
    }
    return { escalationRequired: 0 };
}

const _stmts = {
    insertState: db.prepare(`
        INSERT INTO ml_negative_capability_states (
            user_id, resolved_env, state_id, thesis_label,
            ambiguity_classification, handling_mode,
            negative_capability_score, ambiguity_duration_ms,
            escalation_required, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectState: db.prepare(`
        SELECT id, state_id AS stateId, thesis_label AS thesisLabel,
               ambiguity_classification AS ambiguityClassification,
               handling_mode AS handlingMode,
               negative_capability_score AS negativeCapabilityScore,
               ambiguity_duration_ms AS ambiguityDurationMs,
               escalation_required AS escalationRequired,
               reasoning, ts
        FROM ml_negative_capability_states WHERE state_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, state_id AS stateId, thesis_label AS thesisLabel,
               ambiguity_classification AS ambiguityClassification,
               handling_mode AS handlingMode,
               negative_capability_score AS negativeCapabilityScore,
               ambiguity_duration_ms AS ambiguityDurationMs,
               escalation_required AS escalationRequired, ts
        FROM ml_negative_capability_states
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByClassification: db.prepare(`
        SELECT id, state_id AS stateId, thesis_label AS thesisLabel,
               ambiguity_classification AS ambiguityClassification,
               handling_mode AS handlingMode,
               negative_capability_score AS negativeCapabilityScore,
               ambiguity_duration_ms AS ambiguityDurationMs,
               escalation_required AS escalationRequired, ts
        FROM ml_negative_capability_states
        WHERE user_id = ? AND resolved_env = ? AND ambiguity_classification = ?
        ORDER BY ts DESC
    `),
    countByClassification: db.prepare(`
        SELECT ambiguity_classification AS ambiguityClassification, COUNT(*) AS count
        FROM ml_negative_capability_states
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY ambiguity_classification
    `)
};

function recordAmbiguityState(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const stateId = _required(params, 'stateId');
    const thesisLabel = _required(params, 'thesisLabel');
    const handlingMode = _required(params, 'handlingMode');
    const lucidityScore = _required(params, 'lucidityScore');
    const stabilityScore = _required(params, 'stabilityScore');
    const anxietyScore = _required(params, 'anxietyScore');
    const ambiguityDurationMs = _required(params, 'ambiguityDurationMs');
    const hasResolutionPlan = _required(params, 'hasResolutionPlan');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!HANDLING_MODES.includes(handlingMode)) {
        throw new Error(`§188 invalid handlingMode: ${handlingMode}`);
    }
    if (_stmts.selectState.get(stateId)) {
        throw new Error(`§188 duplicate stateId: ${stateId}`);
    }

    const { score } = computeNegativeCapabilityScore({
        lucidityScore, stabilityScore, anxietyScore
    });
    const { classification: ambiguityClassification } = classifyAmbiguityHandling({
        negativeCapabilityScore: score, anxietyScore
    });
    const { escalationRequired } = requiresEscalation({
        ambiguityDurationMs, hasResolutionPlan
    });

    _stmts.insertState.run(
        userId, resolvedEnv, stateId, thesisLabel,
        ambiguityClassification, handlingMode,
        score, ambiguityDurationMs, escalationRequired, reasoning, ts
    );

    return {
        recorded: true, stateId,
        ambiguityClassification, handlingMode,
        negativeCapabilityScore: score,
        escalationRequired
    };
}

function getRecentStates(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const ambiguityClassification = params.ambiguityClassification;
    if (ambiguityClassification !== undefined && !AMBIGUITY_CLASSIFICATIONS.includes(ambiguityClassification)) {
        throw new Error(`§188 invalid classification filter`);
    }
    return ambiguityClassification
        ? _stmts.selectByClassification.all(userId, resolvedEnv, ambiguityClassification)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function getStatsByClassification(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByClassification.all(userId, resolvedEnv, sinceTs);
    const stats = {
        healthy_tolerated_ambiguity: 0, anxious_ambiguity: 0,
        artificial_closure_avoidance: 0, totalCount: 0
    };
    for (const r of rows) {
        stats[r.ambiguityClassification] = r.count;
        stats.totalCount += r.count;
    }
    return stats;
}

module.exports = {
    AMBIGUITY_CLASSIFICATIONS,
    HANDLING_MODES,
    DURATION_ESCALATION_THRESHOLD_MS,
    STABILITY_INDEX_THRESHOLD,
    ANXIETY_THRESHOLD,
    HEALTHY_SCORE_THRESHOLD,
    CLOSURE_AVOIDANCE_THRESHOLD,
    computeNegativeCapabilityScore,
    classifyAmbiguityHandling,
    requiresEscalation,
    recordAmbiguityState,
    getRecentStates,
    getStatsByClassification
};
