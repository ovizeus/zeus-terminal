'use strict';

/**
 * OMEGA Wave 3 §171 — RETRACTION HONOR SYSTEM / ELEGANT BACKDOWN ENGINE.
 *
 * Canonical PDF §171 (ml_brain_canonic.txt lines 5672-5719).
 *
 * "daca ma retrag acum, e slabiciune sau e putere epistemica?"
 *
 * 5 canonical retraction types (PDF lines 5687-5692):
 *   early_abandonment | justified_size_reduction | elegant_bias_flip |
 *   pre_invalidation_exit | explicit_error_recognition
 *
 * 4 canonical classifications (PDF lines 5693-5697):
 *   panic_exit (bad — late, emotional)
 *   coward_exit (bad — early but unjustified)
 *   elegant_backdown (good — clean, timely, justified)
 *   strategic_surrender (good — calculated, mid-tier)
 *
 * Honor score = 0.40 * timeliness + 0.30 * clarity + 0.30 * justification.
 * Timeliness dominant per PDF rule 5712: "credit cand se corecteaza
 * INAINTE ca piata sa-l pedepseasca brutal."
 *
 * Classification logic:
 *   - honor ≥ 0.70 → elegant_backdown
 *   - honor 0.40..0.70 → strategic_surrender
 *   - honor < 0.40 + low timeliness → panic_exit (late, stressed)
 *   - honor < 0.40 + moderate timeliness → coward_exit (early but weak)
 *
 * Per PDF rule 5713-5714: even retractions that wouldn't have lost much
 * are evaluated POSITIVELY when timely. Honor system breaks the toxic
 * abandon↔shame link by giving prestige to elegant retreat.
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const RETRACTION_TYPES = Object.freeze([
    'early_abandonment', 'justified_size_reduction',
    'elegant_bias_flip', 'pre_invalidation_exit',
    'explicit_error_recognition'
]);
const CLASSIFICATIONS = Object.freeze([
    'panic_exit', 'coward_exit',
    'elegant_backdown', 'strategic_surrender'
]);
const HONORED_CLASSIFICATIONS = Object.freeze([
    'elegant_backdown', 'strategic_surrender'
]);

const HONOR_WEIGHTS = Object.freeze({
    timeliness: 0.40,
    clarity: 0.30,
    justification: 0.30
});

const HONOR_THRESHOLDS = Object.freeze({
    high: 0.70,
    mid: 0.40
});
const PANIC_TIMELINESS_CEILING = 0.40;  // below this = panic territory

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§171 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§171 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§171 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeHonorScore(params) {
    const timeliness = _required(params, 'timeliness');
    const clarity = _required(params, 'clarity');
    const justification = _required(params, 'justification');
    _requireRange01('timeliness', timeliness);
    _requireRange01('clarity', clarity);
    _requireRange01('justification', justification);
    const score = timeliness * HONOR_WEIGHTS.timeliness
                + clarity * HONOR_WEIGHTS.clarity
                + justification * HONOR_WEIGHTS.justification;
    return { honorScore: Math.max(0, Math.min(1, score)) };
}

function classifyRetraction(params) {
    const honorScore = _required(params, 'honorScore');
    const timeliness = _required(params, 'timeliness');
    _requireRange01('honorScore', honorScore);
    _requireRange01('timeliness', timeliness);
    if (honorScore >= HONOR_THRESHOLDS.high) {
        return { classification: 'elegant_backdown' };
    }
    if (honorScore >= HONOR_THRESHOLDS.mid) {
        return { classification: 'strategic_surrender' };
    }
    // Honor is low — distinguish panic (late) vs coward (early but unjustified)
    if (timeliness < PANIC_TIMELINESS_CEILING) {
        return { classification: 'panic_exit' };
    }
    return { classification: 'coward_exit' };
}

function isHonorWorthy(params) {
    const classification = _required(params, 'classification');
    if (!CLASSIFICATIONS.includes(classification)) {
        throw new Error(`§171 invalid classification: ${classification}`);
    }
    return { honorWorthy: HONORED_CLASSIFICATIONS.includes(classification) };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertRetraction: db.prepare(`
        INSERT INTO ml_retractions (
            user_id, resolved_env, retraction_id, thesis_label, retraction_type,
            classification, timeliness_score, clarity_score, justification_score,
            honor_score, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectRetraction: db.prepare(`
        SELECT id, retraction_id AS retractionId, thesis_label AS thesisLabel,
               retraction_type AS retractionType,
               classification,
               timeliness_score AS timelinessScore,
               clarity_score AS clarityScore,
               justification_score AS justificationScore,
               honor_score AS honorScore,
               reasoning, ts
        FROM ml_retractions
        WHERE retraction_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, retraction_id AS retractionId, thesis_label AS thesisLabel,
               retraction_type AS retractionType,
               classification,
               timeliness_score AS timelinessScore,
               clarity_score AS clarityScore,
               justification_score AS justificationScore,
               honor_score AS honorScore,
               reasoning, ts
        FROM ml_retractions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByClassification: db.prepare(`
        SELECT id, retraction_id AS retractionId, thesis_label AS thesisLabel,
               retraction_type AS retractionType,
               classification,
               timeliness_score AS timelinessScore,
               clarity_score AS clarityScore,
               justification_score AS justificationScore,
               honor_score AS honorScore,
               reasoning, ts
        FROM ml_retractions
        WHERE user_id = ? AND resolved_env = ? AND classification = ?
        ORDER BY ts DESC
    `),
    aggregateStats: db.prepare(`
        SELECT classification, honor_score AS honorScore
        FROM ml_retractions
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
    `)
};

function recordRetraction(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const retractionId = _required(params, 'retractionId');
    const thesisLabel = _required(params, 'thesisLabel');
    const retractionType = _required(params, 'retractionType');
    const timeliness = _required(params, 'timeliness');
    const clarity = _required(params, 'clarity');
    const justification = _required(params, 'justification');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!RETRACTION_TYPES.includes(retractionType)) {
        throw new Error(`§171 invalid retractionType: ${retractionType}`);
    }
    if (_stmts.selectRetraction.get(retractionId)) {
        throw new Error(`§171 duplicate retractionId: ${retractionId}`);
    }

    const { honorScore } = computeHonorScore({ timeliness, clarity, justification });
    const { classification } = classifyRetraction({ honorScore, timeliness });

    _stmts.insertRetraction.run(
        userId, resolvedEnv, retractionId, thesisLabel, retractionType,
        classification, timeliness, clarity, justification, honorScore,
        reasoning, ts
    );

    return {
        recorded: true,
        retractionId, thesisLabel,
        honorScore, classification
    };
}

function getRecentRetractions(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const classification = params.classification;
    if (classification !== undefined && !CLASSIFICATIONS.includes(classification)) {
        throw new Error(`§171 invalid classification filter: ${classification}`);
    }
    return classification
        ? _stmts.selectByClassification.all(userId, resolvedEnv, classification)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function getHonorStats(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.aggregateStats.all(userId, resolvedEnv, sinceTs);
    let honoredCount = 0;
    let unhonoredCount = 0;
    let totalHonor = 0;
    for (const r of rows) {
        if (HONORED_CLASSIFICATIONS.includes(r.classification)) {
            honoredCount += 1;
        } else {
            unhonoredCount += 1;
        }
        totalHonor += r.honorScore;
    }
    const totalCount = rows.length;
    return {
        totalCount,
        honoredCount,
        unhonoredCount,
        meanHonorScore: totalCount > 0 ? totalHonor / totalCount : 0
    };
}

module.exports = {
    // constants
    RETRACTION_TYPES,
    CLASSIFICATIONS,
    HONORED_CLASSIFICATIONS,
    HONOR_WEIGHTS,
    HONOR_THRESHOLDS,
    PANIC_TIMELINESS_CEILING,
    // pure
    computeHonorScore,
    classifyRetraction,
    isHonorWorthy,
    // DB
    recordRetraction,
    getRecentRetractions,
    getHonorStats
};

// FILE END §171 retractionHonorSystem.js
