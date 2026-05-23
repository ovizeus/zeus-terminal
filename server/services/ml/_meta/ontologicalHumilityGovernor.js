'use strict';

/**
 * OMEGA Wave 3 §148 — ONTOLOGICAL HUMILITY / REALITY-EXCEEDS-MODEL GOVERNOR.
 *
 * Canonical PDF §148 (ml_brain_canonic.txt lines 4821-4868).
 *
 * Distinct de:
 *   - §120 unknownsRegistry        — gap inventory (cunoaste că nu știe)
 *   - §132 semanticGroundingCheck  — anchoring concepts to data
 *   - §134 representationDebtTracker — predicted vs actual drift
 *   - §138 counterOntologySandbox  — alien-frame generation
 *
 * §148 = "ce parte a realitatii actuale nu incape bine în limbajul meu,
 *         chiar dacă sistemul încă pare functional?"
 *
 * Open remainder analysis (phenomena that don't fit any category) + periodic
 * humility assessments + aggression penalty when humility low (forced
 * restraint pe overclosure conceptuală — system forcing things into
 * categories that don't really fit).
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const crypto = require('crypto');
const { db } = require('../../database');

const FLAGGED_CATEGORIES = Object.freeze([
    'captured',              // residual < 0.20 → fits well
    'partially_captured',    // residual 0.20..0.50 → fits partially
    'unexplained',           // residual >= 0.50 → doesn't really fit
    'forces_new_category'    // best_match = 0 (no category attempted with any signal)
]);
const RECOMMENDED_ACTIONS = Object.freeze([
    'continue',
    'increase_observation',
    'expand_ontology'
]);
const HUMILITY_LEVELS = Object.freeze(['low', 'moderate', 'high']);

const RESIDUAL_THRESHOLDS = Object.freeze({ high: 0.50, medium: 0.20 });
const HUMILITY_THRESHOLDS = Object.freeze({ high: 0.70, low: 0.30 });
const AGGRESSION_PENALTY_MAP = Object.freeze({
    high: 0,
    moderate: 0.20,
    low: 0.50
});

const MIN_OBSERVATIONS_FOR_ASSESSMENT = 10;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§148 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§148 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§148 ${name} must be number in [0,1], got ${v}`);
    }
}
function _newId(prefix) {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function classifyResidual(params) {
    const residual = _required(params, 'residualScore');
    _requireRange01('residualScore', residual);
    let flag;
    if (residual >= RESIDUAL_THRESHOLDS.high) {
        flag = 'unexplained';
    } else if (residual >= RESIDUAL_THRESHOLDS.medium) {
        flag = 'partially_captured';
    } else {
        flag = 'captured';
    }
    return { flag, residualScore: residual };
}

function computeHumilityScore(params) {
    const meanResidual = _required(params, 'meanResidual');
    const overclosure = _required(params, 'overclosureAttemptsCount');
    const total = _required(params, 'totalObservations');
    _requireRange01('meanResidual', meanResidual);
    if (overclosure < 0 || total < 0) {
        throw new Error('§148 counts must be non-negative');
    }
    if (overclosure > total) {
        throw new Error('§148 overclosure exceeds observations');
    }
    if (total === 0) {
        return { humility: 0.50, components: { acknowledgment: 0, restraint: 0 } };
    }
    // acknowledgment = system recognizes how much doesn't fit (mean residual).
    // restraint = 1 - overclosureRate (high when system doesn't force).
    // Conjunction semantic: humility requires BOTH awareness AND restraint;
    // hubris = forcing despite seeing residual. Restraint is dominant gate —
    // high acknowledgment with low restraint is hypocrisy, not humility.
    const overclosureRate = overclosure / total;
    const acknowledgment = meanResidual;
    const restraint = 1 - overclosureRate;
    const humility = restraint * (0.5 + 0.5 * acknowledgment);
    const clamped = Math.max(0, Math.min(1, humility));
    return { humility: clamped, components: { acknowledgment, restraint } };
}

function classifyHumility(params) {
    const h = _required(params, 'humilityScore');
    _requireRange01('humilityScore', h);
    let level;
    if (h >= HUMILITY_THRESHOLDS.high) level = 'high';
    else if (h >= HUMILITY_THRESHOLDS.low) level = 'moderate';
    else level = 'low';
    return { level, humilityScore: h };
}

function computeAggressionPenalty(params) {
    const level = _required(params, 'humilityLevel');
    if (!HUMILITY_LEVELS.includes(level)) {
        throw new Error(`§148 invalid humilityLevel: ${level}`);
    }
    return { penalty: AGGRESSION_PENALTY_MAP[level], humilityLevel: level };
}

function recommendAction(params) {
    const level = _required(params, 'humilityLevel');
    const meanResidual = _required(params, 'meanResidual');
    if (!HUMILITY_LEVELS.includes(level)) {
        throw new Error(`§148 invalid humilityLevel: ${level}`);
    }
    _requireRange01('meanResidual', meanResidual);
    let action;
    if (level === 'low') {
        // Hubris detected — must expand ontology to acknowledge what doesn't fit.
        action = 'expand_ontology';
    } else if (meanResidual >= RESIDUAL_THRESHOLDS.high) {
        // Aware of high residual but not overclosing → gather more observations.
        action = 'increase_observation';
    } else if (level === 'moderate' && meanResidual >= RESIDUAL_THRESHOLDS.medium) {
        action = 'increase_observation';
    } else {
        action = 'continue';
    }
    return { action, humilityLevel: level, meanResidual };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertObservation: db.prepare(`
        INSERT INTO ml_open_remainder_observations (
            user_id, resolved_env, observation_id, decision_id,
            phenomenon_description, attempted_categories_json,
            best_match_score, residual_score, flagged_category, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectObservation: db.prepare(`
        SELECT id, observation_id AS observationId, decision_id AS decisionId,
               phenomenon_description AS phenomenonDescription,
               attempted_categories_json AS attemptedCategoriesJson,
               best_match_score AS bestMatchScore,
               residual_score AS residualScore,
               flagged_category AS flaggedCategory,
               ts
        FROM ml_open_remainder_observations
        WHERE observation_id = ?
    `),
    selectRecentObs: db.prepare(`
        SELECT id, observation_id AS observationId, decision_id AS decisionId,
               phenomenon_description AS phenomenonDescription,
               attempted_categories_json AS attemptedCategoriesJson,
               best_match_score AS bestMatchScore,
               residual_score AS residualScore,
               flagged_category AS flaggedCategory,
               ts
        FROM ml_open_remainder_observations
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        ORDER BY ts DESC
        LIMIT ?
    `),
    selectWindowObs: db.prepare(`
        SELECT residual_score AS residualScore,
               flagged_category AS flaggedCategory
        FROM ml_open_remainder_observations
        WHERE user_id = ? AND resolved_env = ?
          AND ts >= ? AND ts <= ?
    `),
    insertAssessment: db.prepare(`
        INSERT INTO ml_ontological_humility_assessments (
            user_id, resolved_env, assessment_id,
            window_start_ts, window_end_ts,
            observations_count, mean_residual_score,
            overclosure_attempts_count, humility_score, humility_level,
            aggression_penalty, recommended_action, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectAssessment: db.prepare(`
        SELECT id, assessment_id AS assessmentId,
               window_start_ts AS windowStartTs,
               window_end_ts AS windowEndTs,
               observations_count AS observationsCount,
               mean_residual_score AS meanResidualScore,
               overclosure_attempts_count AS overclosureAttemptsCount,
               humility_score AS humilityScore,
               humility_level AS humilityLevel,
               aggression_penalty AS aggressionPenalty,
               recommended_action AS recommendedAction,
               ts
        FROM ml_ontological_humility_assessments
        WHERE assessment_id = ?
    `),
    selectLatestAssessment: db.prepare(`
        SELECT id, assessment_id AS assessmentId,
               window_start_ts AS windowStartTs,
               window_end_ts AS windowEndTs,
               observations_count AS observationsCount,
               mean_residual_score AS meanResidualScore,
               overclosure_attempts_count AS overclosureAttemptsCount,
               humility_score AS humilityScore,
               humility_level AS humilityLevel,
               aggression_penalty AS aggressionPenalty,
               recommended_action AS recommendedAction,
               ts
        FROM ml_ontological_humility_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
        LIMIT 1
    `)
};

function recordOpenRemainderObservation(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const observationId = _required(params, 'observationId');
    const phenomenon = _required(params, 'phenomenonDescription');
    const categories = _required(params, 'attemptedCategories');
    const ts = _required(params, 'ts');
    const decisionId = params.decisionId ?? null;

    if (!Array.isArray(categories)) {
        throw new Error('§148 attemptedCategories must be array');
    }
    let bestMatchScore = 0;
    for (const c of categories) {
        if (typeof c.matchScore !== 'number') {
            throw new Error('§148 attemptedCategories entries must have numeric matchScore');
        }
        _requireRange01('matchScore', c.matchScore);
        if (c.matchScore > bestMatchScore) bestMatchScore = c.matchScore;
    }
    const residualScore = Math.max(0, Math.min(1, 1 - bestMatchScore));

    let flaggedCategory;
    if (bestMatchScore === 0) {
        flaggedCategory = 'forces_new_category';
    } else {
        flaggedCategory = classifyResidual({ residualScore }).flag;
    }

    if (_stmts.selectObservation.get(observationId)) {
        throw new Error(`§148 duplicate observationId: ${observationId}`);
    }
    _stmts.insertObservation.run(
        userId, resolvedEnv, observationId, decisionId,
        phenomenon, JSON.stringify(categories),
        bestMatchScore, residualScore, flaggedCategory, ts
    );
    return {
        recorded: true,
        observationId,
        bestMatchScore,
        residualScore,
        flaggedCategory
    };
}

function recordHumilityAssessment(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const assessmentId = _required(params, 'assessmentId');
    const windowStartTs = _required(params, 'windowStartTs');
    const windowEndTs = _required(params, 'windowEndTs');
    const overclosure = _required(params, 'overclosureAttemptsCount');
    const ts = _required(params, 'ts');

    if (windowStartTs > windowEndTs) {
        throw new Error('§148 windowStartTs > windowEndTs');
    }
    if (overclosure < 0) {
        throw new Error('§148 overclosureAttemptsCount must be non-negative');
    }
    if (_stmts.selectAssessment.get(assessmentId)) {
        throw new Error(`§148 duplicate assessmentId: ${assessmentId}`);
    }

    const obs = _stmts.selectWindowObs.all(userId, resolvedEnv, windowStartTs, windowEndTs);
    const observationsCount = obs.length;
    if (observationsCount < MIN_OBSERVATIONS_FOR_ASSESSMENT) {
        throw new Error(`§148 insufficient observations (${observationsCount} < MIN_OBSERVATIONS_FOR_ASSESSMENT=${MIN_OBSERVATIONS_FOR_ASSESSMENT})`);
    }
    if (overclosure > observationsCount) {
        throw new Error('§148 overclosure exceeds observations');
    }

    const meanResidual = obs.reduce((s, o) => s + o.residualScore, 0) / observationsCount;
    const { humility } = computeHumilityScore({
        meanResidual,
        overclosureAttemptsCount: overclosure,
        totalObservations: observationsCount
    });
    const { level: humilityLevel } = classifyHumility({ humilityScore: humility });
    const { penalty: aggressionPenalty } = computeAggressionPenalty({ humilityLevel });
    const { action: recommendedAction } = recommendAction({ humilityLevel, meanResidual });

    _stmts.insertAssessment.run(
        userId, resolvedEnv, assessmentId,
        windowStartTs, windowEndTs,
        observationsCount, meanResidual,
        overclosure, humility, humilityLevel,
        aggressionPenalty, recommendedAction, ts
    );

    return {
        recorded: true,
        assessmentId,
        observationsCount,
        meanResidualScore: meanResidual,
        humilityScore: humility,
        humilityLevel,
        aggressionPenalty,
        recommendedAction
    };
}

function getRecentObservations(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const limit = _required(params, 'limit');
    return _stmts.selectRecentObs.all(userId, resolvedEnv, sinceTs, limit);
}

function getLatestAssessment(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const row = _stmts.selectLatestAssessment.get(userId, resolvedEnv);
    return row || null;
}

module.exports = {
    // constants
    FLAGGED_CATEGORIES,
    RECOMMENDED_ACTIONS,
    HUMILITY_LEVELS,
    RESIDUAL_THRESHOLDS,
    HUMILITY_THRESHOLDS,
    AGGRESSION_PENALTY_MAP,
    MIN_OBSERVATIONS_FOR_ASSESSMENT,
    // pure
    classifyResidual,
    computeHumilityScore,
    classifyHumility,
    computeAggressionPenalty,
    recommendAction,
    // DB
    recordOpenRemainderObservation,
    recordHumilityAssessment,
    getRecentObservations,
    getLatestAssessment
};

// FILE END §148 ontologicalHumilityGovernor.js
