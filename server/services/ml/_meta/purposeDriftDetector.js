'use strict';

/**
 * OMEGA Wave 3 §149 — PURPOSE DRIFT DETECTOR / ENDS-MEANS MISALIGNMENT ENGINE.
 *
 * Canonical PDF §149 (ml_brain_canonic.txt lines 4869-4922).
 *
 * Distinct de:
 *   - §10  supremePrinciple        — criterii absolute (clean/with_advantage/...)
 *   - §59  unifiedUtility          — scalar utility verdict formula
 *   - §147 intellectualHonestyAudit — reason drift on decisions (rationalization)
 *   - §148 ontologicalHumility     — reality exceeds model (residual)
 *
 * §149 = SCOPE drift detector. "mai servesc inca scopul meu real sau
 *        am inceput sa servesc doar mecanismele mele locale?"
 *
 * Purpose hierarchy (PDF lines 4889-4893):
 *   final → proximate → intermediate_metric → policy_action
 *
 * 4 substitution patterns (PDF lines 4895-4899):
 *   - metric_becomes_purpose
 *   - convenience_becomes_strategy
 *   - safety_theater_becomes_paralysis
 *   - confidence_becomes_identity
 *
 * Periodic audit answers: "de ce exista această regulă? mai serveste
 * scopul sau doar inerția?"
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const PURPOSE_LEVELS = Object.freeze([
    'final', 'proximate', 'intermediate_metric', 'policy_action'
]);
const SUBSTITUTION_PATTERNS = Object.freeze([
    'metric_becomes_purpose',
    'convenience_becomes_strategy',
    'safety_theater_becomes_paralysis',
    'confidence_becomes_identity'
]);
const DRIFT_SEVERITIES = Object.freeze(['none', 'moderate', 'severe']);
const RECOMMENDATIONS = Object.freeze([
    'continue', 'governance_review', 'retire_purpose'
]);

const DRIFT_THRESHOLDS = Object.freeze({ severe: 0.70, moderate: 0.40 });
const MIN_JUSTIFICATION_SCORE = 0.30;
const SUBSTITUTION_DETECT_THRESHOLD = 0.60;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

const SUBSTITUTION_SIGNAL_KEYS = Object.freeze({
    metricFocusRatio: 'metric_becomes_purpose',
    conveniencePursuitRatio: 'convenience_becomes_strategy',
    safetyParalysisRatio: 'safety_theater_becomes_paralysis',
    confidenceIdentityRatio: 'confidence_becomes_identity'
});

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§149 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§149 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§149 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function classifyDrift(params) {
    const driftScore = _required(params, 'driftScore');
    _requireRange01('driftScore', driftScore);
    let severity;
    if (driftScore >= DRIFT_THRESHOLDS.severe) severity = 'severe';
    else if (driftScore >= DRIFT_THRESHOLDS.moderate) severity = 'moderate';
    else severity = 'none';
    return { severity, driftScore };
}

function detectSubstitutionPattern(params) {
    const signals = {
        metricFocusRatio: _required(params, 'metricFocusRatio'),
        conveniencePursuitRatio: _required(params, 'conveniencePursuitRatio'),
        safetyParalysisRatio: _required(params, 'safetyParalysisRatio'),
        confidenceIdentityRatio: _required(params, 'confidenceIdentityRatio')
    };
    for (const [k, v] of Object.entries(signals)) {
        _requireRange01(k, v);
    }
    let bestPattern = null;
    let bestValue = SUBSTITUTION_DETECT_THRESHOLD;
    for (const [key, pattern] of Object.entries(SUBSTITUTION_SIGNAL_KEYS)) {
        if (signals[key] >= bestValue) {
            bestValue = signals[key];
            bestPattern = pattern;
        }
    }
    return { pattern: bestPattern, dominantRatio: bestPattern ? bestValue : null };
}

function computeDriftScore(params) {
    const justification = _required(params, 'justificationScore');
    const pattern = params.substitutionPattern;  // null allowed
    _requireRange01('justificationScore', justification);
    if (pattern !== null && pattern !== undefined && !SUBSTITUTION_PATTERNS.includes(pattern)) {
        throw new Error(`§149 invalid substitutionPattern: ${pattern}`);
    }
    // Inverse justification = misalignment risk. Substitution adds penalty.
    // Substitution dominates when present — a confirmed substitution pattern
    // is structural drift even when justification looks acceptable on paper.
    const justificationGap = 1 - justification;
    const substitutionPenalty = pattern ? 0.40 : 0;
    const driftScore = Math.max(0, Math.min(1, justificationGap * 0.80 + substitutionPenalty));
    return { driftScore, justificationGap, substitutionPenalty };
}

function recommendAction(params) {
    const severity = _required(params, 'driftSeverity');
    const pattern = params.substitutionPattern;  // null allowed
    if (!DRIFT_SEVERITIES.includes(severity)) {
        throw new Error(`§149 invalid driftSeverity: ${severity}`);
    }
    if (pattern !== null && pattern !== undefined && !SUBSTITUTION_PATTERNS.includes(pattern)) {
        throw new Error(`§149 invalid substitutionPattern: ${pattern}`);
    }
    let action;
    if (severity === 'severe' && pattern) {
        action = 'retire_purpose';
    } else if (severity === 'severe' || severity === 'moderate') {
        action = 'governance_review';
    } else {
        action = 'continue';
    }
    return { action, driftSeverity: severity, substitutionPattern: pattern || null };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertPurpose: db.prepare(`
        INSERT INTO ml_purpose_registry (
            user_id, resolved_env, purpose_id, level, parent_purpose_id,
            description, telos_statement, active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `),
    selectPurpose: db.prepare(`
        SELECT id, purpose_id AS purposeId, level,
               parent_purpose_id AS parentPurposeId,
               description, telos_statement AS telosStatement,
               active, created_at AS createdAt, retired_at AS retiredAt
        FROM ml_purpose_registry
        WHERE purpose_id = ?
    `),
    selectActiveRegistry: db.prepare(`
        SELECT id, purpose_id AS purposeId, level,
               parent_purpose_id AS parentPurposeId,
               description, telos_statement AS telosStatement,
               active, created_at AS createdAt, retired_at AS retiredAt
        FROM ml_purpose_registry
        WHERE user_id = ? AND resolved_env = ? AND active = 1
        ORDER BY created_at ASC
    `),
    selectActiveRegistryByLevel: db.prepare(`
        SELECT id, purpose_id AS purposeId, level,
               parent_purpose_id AS parentPurposeId,
               description, telos_statement AS telosStatement,
               active, created_at AS createdAt, retired_at AS retiredAt
        FROM ml_purpose_registry
        WHERE user_id = ? AND resolved_env = ? AND active = 1 AND level = ?
        ORDER BY created_at ASC
    `),
    retirePurpose: db.prepare(`
        UPDATE ml_purpose_registry
        SET active = 0, retired_at = ?
        WHERE purpose_id = ? AND user_id = ? AND resolved_env = ?
    `),
    insertAudit: db.prepare(`
        INSERT INTO ml_purpose_drift_audits (
            user_id, resolved_env, audit_id, audited_purpose_id,
            justification_score, substitution_pattern,
            drift_score, drift_severity, recommended_action, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectAudit: db.prepare(`
        SELECT id, audit_id AS auditId,
               audited_purpose_id AS purposeId,
               justification_score AS justificationScore,
               substitution_pattern AS substitutionPattern,
               drift_score AS driftScore,
               drift_severity AS driftSeverity,
               recommended_action AS recommendedAction,
               ts
        FROM ml_purpose_drift_audits
        WHERE audit_id = ?
    `),
    selectLatestAudit: db.prepare(`
        SELECT id, audit_id AS auditId,
               audited_purpose_id AS purposeId,
               justification_score AS justificationScore,
               substitution_pattern AS substitutionPattern,
               drift_score AS driftScore,
               drift_severity AS driftSeverity,
               recommended_action AS recommendedAction,
               ts
        FROM ml_purpose_drift_audits
        WHERE user_id = ? AND resolved_env = ? AND audited_purpose_id = ?
        ORDER BY ts DESC
        LIMIT 1
    `)
};

function registerPurpose(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const purposeId = _required(params, 'purposeId');
    const level = _required(params, 'level');
    const description = _required(params, 'description');
    const ts = _required(params, 'ts');
    const parentPurposeId = params.parentPurposeId ?? null;
    const telosStatement = params.telosStatement ?? null;

    if (!PURPOSE_LEVELS.includes(level)) {
        throw new Error(`§149 invalid level: ${level}`);
    }
    if (level === 'final' && !telosStatement) {
        throw new Error('§149 final purpose requires telosStatement');
    }
    if (level !== 'final' && !parentPurposeId) {
        throw new Error(`§149 non-final purpose requires parentPurposeId (level=${level})`);
    }
    if (_stmts.selectPurpose.get(purposeId)) {
        throw new Error(`§149 duplicate purposeId: ${purposeId}`);
    }
    _stmts.insertPurpose.run(
        userId, resolvedEnv, purposeId, level, parentPurposeId,
        description, telosStatement, ts
    );
    return { registered: true, purposeId };
}

function auditPurposeDrift(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const purposeId = _required(params, 'purposeId');
    const justificationScore = _required(params, 'justificationScore');
    const signals = _required(params, 'substitutionSignals');
    const ts = _required(params, 'ts');

    _requireRange01('justificationScore', justificationScore);
    if (_stmts.selectAudit.get(auditId)) {
        throw new Error(`§149 duplicate auditId: ${auditId}`);
    }

    const { pattern } = detectSubstitutionPattern(signals);
    const { driftScore } = computeDriftScore({
        justificationScore,
        substitutionPattern: pattern
    });
    const { severity } = classifyDrift({ driftScore });
    const { action } = recommendAction({
        driftSeverity: severity,
        substitutionPattern: pattern
    });

    _stmts.insertAudit.run(
        userId, resolvedEnv, auditId, purposeId,
        justificationScore, pattern,
        driftScore, severity, action, ts
    );

    return {
        recorded: true,
        auditId,
        purposeId,
        driftScore,
        driftSeverity: severity,
        substitutionPattern: pattern,
        recommendedAction: action
    };
}

function getPurposeRegistry(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const level = params.level;
    if (level !== undefined && !PURPOSE_LEVELS.includes(level)) {
        throw new Error(`§149 invalid level filter: ${level}`);
    }
    return level
        ? _stmts.selectActiveRegistryByLevel.all(userId, resolvedEnv, level)
        : _stmts.selectActiveRegistry.all(userId, resolvedEnv);
}

function getLatestAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const purposeId = _required(params, 'purposeId');
    const row = _stmts.selectLatestAudit.get(userId, resolvedEnv, purposeId);
    return row || null;
}

function retirePurpose(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const purposeId = _required(params, 'purposeId');
    const ts = _required(params, 'ts');
    const existing = _stmts.selectPurpose.get(purposeId);
    if (!existing) {
        throw new Error(`§149 purpose not found: ${purposeId}`);
    }
    _stmts.retirePurpose.run(ts, purposeId, userId, resolvedEnv);
    return { retired: true, purposeId };
}

module.exports = {
    // constants
    PURPOSE_LEVELS,
    SUBSTITUTION_PATTERNS,
    DRIFT_SEVERITIES,
    RECOMMENDATIONS,
    DRIFT_THRESHOLDS,
    MIN_JUSTIFICATION_SCORE,
    SUBSTITUTION_DETECT_THRESHOLD,
    // pure
    classifyDrift,
    detectSubstitutionPattern,
    computeDriftScore,
    recommendAction,
    // DB
    registerPurpose,
    auditPurposeDrift,
    getPurposeRegistry,
    getLatestAudit,
    retirePurpose
};

// FILE END §149 purposeDriftDetector.js
