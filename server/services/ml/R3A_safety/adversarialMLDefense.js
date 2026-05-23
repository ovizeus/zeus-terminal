'use strict';

/**
 * OMEGA R3A Safety — adversarialMLDefense v2 (Claude-Extra #2)
 *
 * DEFENSIVE version of operator's "neuro-weapons" idea. Detects when OTHER
 * bots try to induce psychosis in our ML via adversarial patterns.
 *
 * v2 changes per reviewer feedback:
 * - detection_model_version + sanitization_policy_version (reproducibility)
 * - anomaly_embedding_json: continuous vector representation of anomaly.
 *   Labels (attack_pattern enum) become SECONDARY INTERPRETATION ONLY —
 *   primary signal is the embedding. Pattern enum stays for human/legacy
 *   readability and easy filtering. Future: embedding-based classifier
 *   replaces pattern enum entirely.
 * - external_link_kind + external_link_id: optional FK-like reference to
 *   downstream entities affected by attack detection (gravity_zone /
 *   gravity_conflict). Integration hook for §141/Extra#1 lifecycle
 *   transitions (e.g., affected zone → decaying state).
 * - evidence_json CLARIFIED as raw forensic payload (NOT semantic source).
 *   All decision-critical fields are explicit columns.
 *
 * Sanitizes affected signals (null out suspect values, increase caution,
 * or pause trading). NO offensive action — pure defense.
 *
 * LEGAL: detection + signal sanitization is legal/legitimate. WE do NOT
 * spoof, manipulate, or place adversarial orders ourselves.
 */

const { db } = require('../../database');

const ATTACK_PATTERNS = Object.freeze([
    'spoofing_storm', 'ghost_liquidity',
    'micro_cancel_pattern', 'volume_anomaly'
]);
const SEVERITY_LEVELS = Object.freeze(['low', 'medium', 'high']);
const DEFENSE_ACTIONS = Object.freeze([
    'ignore_signal', 'increase_caution', 'pause_trading'
]);
const SEVERITY_THRESHOLDS = Object.freeze({
    high: 0.70, medium: 0.40
});

// Per-pattern detection thresholds. Each pattern uses a specific metric
// from `evidence`. Beyond threshold = anomaly score increases.
const DETECTION_THRESHOLDS = Object.freeze({
    spoofing_storm: Object.freeze({
        cancelRatePerSec: 50  // > 50 cancels/sec = anomalous
    }),
    ghost_liquidity: Object.freeze({
        flickerCountPerWindow: 30  // > 30 depth flickers in window
    }),
    micro_cancel_pattern: Object.freeze({
        cyclesPerMinute: 20  // > 20 place/cancel cycles/min
    }),
    volume_anomaly: Object.freeze({
        syntheticRatio: 0.30  // > 30% synthetic vol = anomalous
    })
});

// v2: versioning constants (semver). Bump when detection algorithm or
// sanitization policy changes — preserves reproducibility of past
// detections.
const DETECTION_MODEL_VERSION = 'v1.0.0';
const SANITIZATION_POLICY_VERSION = 'v1.0.0';

// v2: external link kinds for integration with downstream subsystems.
const EXTERNAL_LINK_KINDS = Object.freeze([
    'gravity_zone', 'gravity_conflict'
]);

const _SEVERITY_TO_ACTION = Object.freeze({
    low: 'ignore_signal',
    medium: 'increase_caution',
    high: 'pause_trading'
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`adversarialMLDefense: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertDetection: db.prepare(`
        INSERT INTO ml_adversarial_attack_detections
        (user_id, resolved_env, detection_id, asset, attack_pattern,
         anomaly_score, severity, evidence_json, defense_action, ts,
         detection_model_version, sanitization_policy_version,
         anomaly_embedding_json, external_link_kind, external_link_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertSanitization: db.prepare(`
        INSERT INTO ml_signal_sanitization_log
        (user_id, resolved_env, sanitization_id, detection_id,
         original_signal_json, sanitized_signal_json,
         sanitization_applied, ts, sanitization_policy_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listRecentByAssetSeverity: db.prepare(`
        SELECT * FROM ml_adversarial_attack_detections
        WHERE user_id = ? AND resolved_env = ?
          AND asset = ? AND severity = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── _evidenceKeyForPattern (internal) ──────────────────────────────
function _evidenceKeyForPattern(pattern) {
    const keys = {
        spoofing_storm: 'cancelRatePerSec',
        ghost_liquidity: 'flickerCountPerWindow',
        micro_cancel_pattern: 'cyclesPerMinute',
        volume_anomaly: 'syntheticRatio'
    };
    return keys[pattern];
}

// ── computeAnomalyScore (pure) ─────────────────────────────────────
// score = clamp(observed / (2 × threshold), [0, 1])
// At threshold → 0.5; at 2× threshold → 1.0; below → linear toward 0.
function computeAnomalyScore(params) {
    const pattern = _required(params, 'attackPattern');
    const evidence = _required(params, 'evidence');
    if (!ATTACK_PATTERNS.includes(pattern)) {
        throw new Error(
            `adversarialMLDefense: invalid attackPattern "${pattern}"`
        );
    }
    const key = _evidenceKeyForPattern(pattern);
    const observed = evidence[key];
    if (observed === undefined || observed === null) {
        return { anomalyScore: 0 };
    }
    if (observed < 0) {
        throw new Error('adversarialMLDefense: evidence value must be ≥ 0');
    }
    const threshold = DETECTION_THRESHOLDS[pattern][key];
    const score = observed / (2 * threshold);
    return { anomalyScore: Math.max(0, Math.min(1, score)) };
}

// ── computeAnomalyEmbedding (pure) — NEW v2 ────────────────────────
// Encodes the anomaly as a fixed-length vector. Each dimension corresponds
// to a known attack pattern; value = normalized signal strength relative
// to threshold. Captures gradient information (continuous) that the enum
// label loses. Future ML classifiers consume this vector as input.
function computeAnomalyEmbedding(params) {
    const evidence = _required(params, 'evidence');
    const vector = ATTACK_PATTERNS.map(pattern => {
        const key = _evidenceKeyForPattern(pattern);
        const observed = evidence[key];
        if (observed === undefined || observed === null) return 0;
        if (observed < 0) {
            throw new Error(`adversarialMLDefense: evidence ${key} must be ≥ 0`);
        }
        const threshold = DETECTION_THRESHOLDS[pattern][key];
        return Math.max(0, Math.min(1, observed / (2 * threshold)));
    });
    return { embedding: vector };
}

// ── classifySeverity (pure) ────────────────────────────────────────
function classifySeverity(params) {
    const score = _required(params, 'anomalyScore');
    if (score < 0 || score > 1) {
        throw new Error('adversarialMLDefense: anomalyScore must be in [0,1]');
    }
    if (score >= SEVERITY_THRESHOLDS.high) return { severity: 'high' };
    if (score >= SEVERITY_THRESHOLDS.medium) return { severity: 'medium' };
    return { severity: 'low' };
}

// ── selectDefenseAction (pure) ─────────────────────────────────────
function selectDefenseAction(params) {
    const sev = _required(params, 'severity');
    if (!SEVERITY_LEVELS.includes(sev)) {
        throw new Error(`adversarialMLDefense: invalid severity "${sev}"`);
    }
    return { defenseAction: _SEVERITY_TO_ACTION[sev] };
}

// ── shouldSanitizeSignal (pure) ────────────────────────────────────
function shouldSanitizeSignal(params) {
    const sev = _required(params, 'severity');
    if (!SEVERITY_LEVELS.includes(sev)) {
        throw new Error(`adversarialMLDefense: invalid severity "${sev}"`);
    }
    // Low = ignore the signal entirely (no sanitization needed; just skip).
    // Medium / high = sanitize affected signal values.
    return { shouldSanitize: sev !== 'low' };
}

// ── recordDetection (integration) ──────────────────────────────────
function recordDetection(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const detId = _required(params, 'detectionId');
    const asset = _required(params, 'asset');
    const pattern = _required(params, 'attackPattern');
    const evidence = _required(params, 'evidence');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!ATTACK_PATTERNS.includes(pattern)) {
        throw new Error(
            `adversarialMLDefense: invalid attackPattern "${pattern}"`
        );
    }

    const { anomalyScore } = computeAnomalyScore({
        attackPattern: pattern, evidence
    });
    const { severity } = classifySeverity({ anomalyScore });
    const { defenseAction } = selectDefenseAction({ severity });
    // v2: continuous vector representation
    const { embedding } = computeAnomalyEmbedding({ evidence });
    // v2: optional integration link
    const externalLinkKind = (params && params.externalLinkKind !== undefined &&
                              params.externalLinkKind !== null)
        ? params.externalLinkKind : null;
    const externalLinkId = (params && params.externalLinkId !== undefined &&
                            params.externalLinkId !== null)
        ? params.externalLinkId : null;
    if (externalLinkKind !== null && !EXTERNAL_LINK_KINDS.includes(externalLinkKind)) {
        throw new Error(
            `adversarialMLDefense: invalid externalLinkKind "${externalLinkKind}"`
        );
    }
    if (externalLinkKind !== null && externalLinkId === null) {
        throw new Error(
            'adversarialMLDefense: externalLinkId required when externalLinkKind set'
        );
    }
    // v2: versioning (params optional, default to module constants)
    const detVer = (params && params.detectionModelVersion)
        ? params.detectionModelVersion : DETECTION_MODEL_VERSION;
    const sanVer = (params && params.sanitizationPolicyVersion)
        ? params.sanitizationPolicyVersion : SANITIZATION_POLICY_VERSION;

    try {
        _stmts.insertDetection.run(
            userId, env, detId, asset, pattern,
            anomalyScore, severity,
            JSON.stringify(evidence), defenseAction, ts,
            detVer, sanVer, JSON.stringify(embedding),
            externalLinkKind, externalLinkId
        );
        return {
            recorded: true, detectionId: detId,
            anomalyScore, severity, defenseAction,
            anomalyEmbedding: embedding,
            detectionModelVersion: detVer,
            sanitizationPolicyVersion: sanVer,
            externalLinkKind, externalLinkId
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `adversarialMLDefense: duplicate detectionId "${detId}"`
            );
        }
        throw err;
    }
}

// ── recordSanitization (integration) ───────────────────────────────
function recordSanitization(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sanId = _required(params, 'sanitizationId');
    const detId = _required(params, 'detectionId');
    const original = _required(params, 'originalSignal');
    const sanitized = _required(params, 'sanitizedSignal');
    const applied = _required(params, 'sanitizationApplied');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const sanVer = (params && params.sanitizationPolicyVersion)
        ? params.sanitizationPolicyVersion : SANITIZATION_POLICY_VERSION;
    try {
        _stmts.insertSanitization.run(
            userId, env, sanId, detId,
            JSON.stringify(original), JSON.stringify(sanitized),
            applied ? 1 : 0, ts, sanVer
        );
        return {
            recorded: true, sanitizationId: sanId,
            sanitizationPolicyVersion: sanVer
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `adversarialMLDefense: duplicate sanitizationId "${sanId}"`
            );
        }
        if (err.message && err.message.toLowerCase().includes('foreign key')) {
            throw err;
        }
        throw err;
    }
}

// ── getRecentDetections ────────────────────────────────────────────
function getRecentDetections(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const asset = _required(params, 'asset');
    const severity = _required(params, 'severity');
    const limit = (params && params.limit) ? params.limit : 100;
    if (!SEVERITY_LEVELS.includes(severity)) {
        throw new Error(
            `adversarialMLDefense: invalid severity "${severity}"`
        );
    }
    const rows = _stmts.listRecentByAssetSeverity.all(
        userId, env, asset, severity, limit
    );
    return rows.map(r => ({
        detectionId: r.detection_id,
        asset: r.asset,
        attackPattern: r.attack_pattern,
        anomalyScore: r.anomaly_score,
        severity: r.severity,
        evidence: JSON.parse(r.evidence_json),
        defenseAction: r.defense_action,
        ts: r.ts,
        // v2 fields
        detectionModelVersion: r.detection_model_version,
        sanitizationPolicyVersion: r.sanitization_policy_version,
        anomalyEmbedding: r.anomaly_embedding_json
            ? JSON.parse(r.anomaly_embedding_json) : [],
        externalLinkKind: r.external_link_kind,
        externalLinkId: r.external_link_id
    }));
}

module.exports = {
    ATTACK_PATTERNS,
    SEVERITY_LEVELS,
    DEFENSE_ACTIONS,
    SEVERITY_THRESHOLDS,
    DETECTION_THRESHOLDS,
    DETECTION_MODEL_VERSION,
    SANITIZATION_POLICY_VERSION,
    EXTERNAL_LINK_KINDS,
    computeAnomalyScore,
    computeAnomalyEmbedding,
    classifySeverity,
    selectDefenseAction,
    shouldSanitizeSignal,
    recordDetection,
    recordSanitization,
    getRecentDetections
};
