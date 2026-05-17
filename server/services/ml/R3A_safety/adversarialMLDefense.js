'use strict';

/**
 * OMEGA R3A Safety — adversarialMLDefense (Claude-Extra #2)
 *
 * DEFENSIVE version of operator's "neuro-weapons" idea. Detects when OTHER
 * bots try to induce psychosis in our ML via adversarial patterns:
 *  - spoofing_storm (cancellation rate anomalies)
 *  - ghost_liquidity (orderbook depth flickering)
 *  - micro_cancel_pattern (cyclic place/cancel micro-orders)
 *  - volume_anomaly (synthetic vs natural volume divergence)
 *
 * Sanitizes affected signals (null out suspect values, increase caution
 * weight, or pause trading). NO offensive action — pure defense.
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
         anomaly_score, severity, evidence_json, defense_action, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertSanitization: db.prepare(`
        INSERT INTO ml_signal_sanitization_log
        (user_id, resolved_env, sanitization_id, detection_id,
         original_signal_json, sanitized_signal_json,
         sanitization_applied, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

    try {
        _stmts.insertDetection.run(
            userId, env, detId, asset, pattern,
            anomalyScore, severity,
            JSON.stringify(evidence), defenseAction, ts
        );
        return {
            recorded: true, detectionId: detId,
            anomalyScore, severity, defenseAction
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

    try {
        _stmts.insertSanitization.run(
            userId, env, sanId, detId,
            JSON.stringify(original), JSON.stringify(sanitized),
            applied ? 1 : 0, ts
        );
        return { recorded: true, sanitizationId: sanId };
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
        ts: r.ts
    }));
}

module.exports = {
    ATTACK_PATTERNS,
    SEVERITY_LEVELS,
    DEFENSE_ACTIONS,
    SEVERITY_THRESHOLDS,
    DETECTION_THRESHOLDS,
    computeAnomalyScore,
    classifySeverity,
    selectDefenseAction,
    shouldSanitizeSignal,
    recordDetection,
    recordSanitization,
    getRecentDetections
};
