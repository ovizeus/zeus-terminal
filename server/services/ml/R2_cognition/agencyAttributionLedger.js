'use strict';

/**
 * OMEGA Wave 3 §167 — AGENCY ATTRIBUTION LEDGER / WHO-CAUSED-WHAT ENGINE.
 *
 * Canonical PDF §167 (ml_brain_canonic.txt lines 5457-5516).
 *
 * "ce s-a schimbat, si mai ales cine a produs probabil schimbarea?"
 *
 * 5 canonical agency categories (PDF lines 5481-5485):
 *   self_caused | market_endogenous | adversary_induced |
 *   macro_exogenous | venue_artifact
 *
 * Dominant attribution = category with probability > AMBIGUITY_THRESHOLD
 *                        (0.40). If no category exceeds threshold → 'ambiguous'.
 *
 * Learning weight derived from (confidence × ambiguity penalty):
 *   clear attribution: weight = confidence (the max probability)
 *   ambiguous:         weight = confidence × 0.50 (LEARNING_WEIGHT_AMBIGUOUS_PENALTY)
 *
 * Per canonical PDF rules 5509-5512:
 * - observed change without clear attribution gets reduced confidence
 * - self-caused effects MUST NOT be confused with market edge
 * - lessons from ambiguous-agency events weighted weaker
 *
 * Plasament în R2_cognition (next to beliefPropagation, structuralCausalModel,
 * interventionalReasoning, narrativeCoherence — integrates cu acestea
 * per PDF rule 5493-5498).
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const AGENCY_CATEGORIES = Object.freeze([
    'self_caused', 'market_endogenous',
    'adversary_induced', 'macro_exogenous', 'venue_artifact'
]);
const DOMINANT_CATEGORIES = Object.freeze([
    ...AGENCY_CATEGORIES, 'ambiguous'
]);

const AMBIGUITY_THRESHOLD = 0.40;
const HIGH_CONFIDENCE_THRESHOLD = 0.70;
const LEARNING_WEIGHT_AMBIGUOUS_PENALTY = 0.50;

const CAMEL_TO_SNAKE = Object.freeze({
    selfCaused: 'self_caused',
    marketEndogenous: 'market_endogenous',
    adversaryInduced: 'adversary_induced',
    macroExogenous: 'macro_exogenous',
    venueArtifact: 'venue_artifact'
});
const SNAKE_TO_CAMEL = Object.freeze({
    self_caused: 'selfCaused',
    market_endogenous: 'marketEndogenous',
    adversary_induced: 'adversaryInduced',
    macro_exogenous: 'macroExogenous',
    venue_artifact: 'venueArtifact'
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§167 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§167 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§167 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function normalizeAttribution(params) {
    const probabilities = _required(params, 'probabilities');
    const keys = Object.keys(CAMEL_TO_SNAKE);
    let sum = 0;
    for (const k of keys) {
        if (probabilities[k] === undefined || probabilities[k] === null) {
            throw new Error(`§167 missing probability key: ${k}`);
        }
        _requireRange01(k, probabilities[k]);
        sum += probabilities[k];
    }
    if (sum === 0) {
        throw new Error('§167 cannot normalize: all probabilities zero');
    }
    const normalized = {};
    for (const k of keys) {
        normalized[k] = probabilities[k] / sum;
    }
    return { normalized, originalSum: sum };
}

function classifyDominantAttribution(params) {
    const { normalized } = normalizeAttribution(params);
    let maxKey = null;
    let maxValue = 0;
    for (const k of Object.keys(normalized)) {
        if (normalized[k] > maxValue) {
            maxValue = normalized[k];
            maxKey = k;
        }
    }
    if (maxValue <= AMBIGUITY_THRESHOLD) {
        return {
            dominantAttribution: 'ambiguous',
            confidenceScore: maxValue,
            normalized
        };
    }
    return {
        dominantAttribution: CAMEL_TO_SNAKE[maxKey],
        confidenceScore: maxValue,
        normalized
    };
}

function computeLearningWeight(params) {
    const confidenceScore = _required(params, 'confidenceScore');
    const dominantAttribution = _required(params, 'dominantAttribution');
    _requireRange01('confidenceScore', confidenceScore);
    if (!DOMINANT_CATEGORIES.includes(dominantAttribution)) {
        throw new Error(`§167 invalid dominantAttribution: ${dominantAttribution}`);
    }
    const penalty = (dominantAttribution === 'ambiguous')
        ? LEARNING_WEIGHT_AMBIGUOUS_PENALTY
        : 1.0;
    const raw = confidenceScore * penalty;
    return {
        learningWeight: Math.max(0, Math.min(1, raw)),
        dominantAttribution,
        confidenceScore
    };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertRecord: db.prepare(`
        INSERT INTO ml_agency_attribution_records (
            user_id, resolved_env, record_id, state_change_label,
            state_change_magnitude, self_caused_probability,
            market_endogenous_probability, adversary_induced_probability,
            macro_exogenous_probability, venue_artifact_probability,
            dominant_attribution, confidence_score, learning_weight,
            reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectRecord: db.prepare(`
        SELECT id, record_id AS recordId,
               state_change_label AS stateChangeLabel,
               state_change_magnitude AS stateChangeMagnitude,
               self_caused_probability AS selfCausedProbability,
               market_endogenous_probability AS marketEndogenousProbability,
               adversary_induced_probability AS adversaryInducedProbability,
               macro_exogenous_probability AS macroExogenousProbability,
               venue_artifact_probability AS venueArtifactProbability,
               dominant_attribution AS dominantAttribution,
               confidence_score AS confidenceScore,
               learning_weight AS learningWeight,
               reasoning, ts
        FROM ml_agency_attribution_records
        WHERE record_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, record_id AS recordId,
               state_change_label AS stateChangeLabel,
               state_change_magnitude AS stateChangeMagnitude,
               self_caused_probability AS selfCausedProbability,
               market_endogenous_probability AS marketEndogenousProbability,
               adversary_induced_probability AS adversaryInducedProbability,
               macro_exogenous_probability AS macroExogenousProbability,
               venue_artifact_probability AS venueArtifactProbability,
               dominant_attribution AS dominantAttribution,
               confidence_score AS confidenceScore,
               learning_weight AS learningWeight,
               reasoning, ts
        FROM ml_agency_attribution_records
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByAttribution: db.prepare(`
        SELECT id, record_id AS recordId,
               state_change_label AS stateChangeLabel,
               state_change_magnitude AS stateChangeMagnitude,
               self_caused_probability AS selfCausedProbability,
               market_endogenous_probability AS marketEndogenousProbability,
               adversary_induced_probability AS adversaryInducedProbability,
               macro_exogenous_probability AS macroExogenousProbability,
               venue_artifact_probability AS venueArtifactProbability,
               dominant_attribution AS dominantAttribution,
               confidence_score AS confidenceScore,
               learning_weight AS learningWeight,
               reasoning, ts
        FROM ml_agency_attribution_records
        WHERE user_id = ? AND resolved_env = ? AND dominant_attribution = ?
        ORDER BY ts DESC
    `),
    countByAttribution: db.prepare(`
        SELECT dominant_attribution AS dominantAttribution, COUNT(*) AS count
        FROM ml_agency_attribution_records
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY dominant_attribution
    `)
};

function recordAttribution(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const recordId = _required(params, 'recordId');
    const stateChangeLabel = _required(params, 'stateChangeLabel');
    const stateChangeMagnitude = _required(params, 'stateChangeMagnitude');
    const probabilities = _required(params, 'probabilities');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    _requireRange01('stateChangeMagnitude', stateChangeMagnitude);
    if (_stmts.selectRecord.get(recordId)) {
        throw new Error(`§167 duplicate recordId: ${recordId}`);
    }

    const { dominantAttribution, confidenceScore, normalized } =
        classifyDominantAttribution({ probabilities });
    const { learningWeight } = computeLearningWeight({
        confidenceScore, dominantAttribution
    });

    _stmts.insertRecord.run(
        userId, resolvedEnv, recordId, stateChangeLabel, stateChangeMagnitude,
        normalized.selfCaused, normalized.marketEndogenous,
        normalized.adversaryInduced, normalized.macroExogenous,
        normalized.venueArtifact,
        dominantAttribution, confidenceScore, learningWeight,
        reasoning, ts
    );

    return {
        recorded: true,
        recordId,
        dominantAttribution,
        confidenceScore,
        learningWeight
    };
}

function getRecentRecords(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const dominantAttribution = params.dominantAttribution;
    if (dominantAttribution !== undefined &&
        !DOMINANT_CATEGORIES.includes(dominantAttribution)) {
        throw new Error(`§167 invalid dominantAttribution filter: ${dominantAttribution}`);
    }
    return dominantAttribution
        ? _stmts.selectByAttribution.all(userId, resolvedEnv, dominantAttribution)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function getAttributionStats(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByAttribution.all(userId, resolvedEnv, sinceTs);
    const stats = {
        self_caused: 0, market_endogenous: 0, adversary_induced: 0,
        macro_exogenous: 0, venue_artifact: 0, ambiguous: 0, totalCount: 0
    };
    for (const r of rows) {
        stats[r.dominantAttribution] = r.count;
        stats.totalCount += r.count;
    }
    return stats;
}

module.exports = {
    // constants
    AGENCY_CATEGORIES,
    DOMINANT_CATEGORIES,
    AMBIGUITY_THRESHOLD,
    HIGH_CONFIDENCE_THRESHOLD,
    LEARNING_WEIGHT_AMBIGUOUS_PENALTY,
    // pure
    normalizeAttribution,
    classifyDominantAttribution,
    computeLearningWeight,
    // DB
    recordAttribution,
    getRecentRecords,
    getAttributionStats
};

// FILE END §167 agencyAttributionLedger.js
