'use strict';

/**
 * OMEGA R5A Learning — beliefUpdateRegularizer (canonical §118)
 *
 * §118 BELIEF UPDATE REGULARIZER / ANTI-RECENCY & ANTI-LUCK BIAS LAYER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3164-3201.
 *
 * "Sistem adaptiv poate deveni prea impresionabil. Poate supra-reacționa
 *  la ultimele 3 trade-uri, la un eveniment strident sau la o saptamana
 *  noroacasa... strat care regularizeaza viteza si forta actualizarilor
 *  de credinte... separation structural_signal / strident_event /
 *  lucky_streak / unlucky_streak... regime-aware update inertia...
 *  credintele centrale NU au voie sa se rescrie brutal fara evidenta
 *  suficienta... regularizerul mai strict in regimuri noisy, mai
 *  flexibil in regimuri schimbate."
 *
 * Distinct from §15 confidenceDecay (time-based decay), §21 driftDetection
 * (statistical drift), §97 forgettingEngine (TTL/retire), §105
 * latentStateFilter (Bayesian belief tracking — different table
 * ml_belief_updates), §107 invarianceLayer (perturbation stability).
 * §118 = velocity-limiter + evidence-kind classifier.
 */

const { db } = require('../../database');

const EVIDENCE_KINDS = Object.freeze([
    'structural_signal', 'strident_event',
    'lucky_streak', 'unlucky_streak'
]);

const KIND_REGULARIZATION_FACTORS = Object.freeze({
    structural_signal: 1.0,
    strident_event: 0.3,
    lucky_streak: 0.2,
    unlucky_streak: 0.2
});

const MIN_SAMPLE_FOR_STRUCTURAL = 30;
const STRIDENT_SAMPLE_CEILING = 5;
const STRIDENT_DELTA_FLOOR = 0.30;
const NOISY_REGIME_THRESHOLD = 0.60;
const NOISY_REGIME_MULTIPLIER = 0.5;
const DEFAULT_MAX_DELTA = 0.10;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`beliefUpdateRegularizer: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAudit: db.prepare(`
        INSERT INTO ml_belief_regularization_audit
        (user_id, resolved_env, audit_id, belief_id,
         prior_value, proposed_value, applied_value,
         evidence_kind, regularization_factor, reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listAuditByBelief: db.prepare(`
        SELECT * FROM ml_belief_regularization_audit
        WHERE user_id = ? AND resolved_env = ? AND belief_id = ?
        ORDER BY ts DESC LIMIT ?
    `),
    insertLimit: db.prepare(`
        INSERT INTO ml_belief_update_limits
        (user_id, resolved_env, limit_id, belief_category,
         max_delta_per_update, max_updates_per_window,
         window_seconds, regime_modifier_json,
         ts_created, ts_last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── classifyEvidenceKind (pure) ────────────────────────────────────
function classifyEvidenceKind(params) {
    const deltaMagnitude = _required(params, 'deltaMagnitude');
    const sampleSize = _required(params, 'sampleSize');
    const regimeNoiseLevel = (params && params.regimeNoiseLevel !== undefined)
        ? params.regimeNoiseLevel : 0.5;
    const deltaSign = (params && params.deltaSign !== undefined)
        ? params.deltaSign : 1;

    if (deltaMagnitude < 0) {
        throw new Error('beliefUpdateRegularizer: deltaMagnitude must be >= 0');
    }
    if (sampleSize < 0) {
        throw new Error('beliefUpdateRegularizer: sampleSize must be >= 0');
    }

    // Structural: large samples regardless of delta magnitude
    if (sampleSize >= MIN_SAMPLE_FOR_STRUCTURAL) {
        return {
            kind: 'structural_signal',
            reason: `sample_size_>=_${MIN_SAMPLE_FOR_STRUCTURAL}`
        };
    }
    // Strident: extreme delta + few samples (one-off shock)
    if (deltaMagnitude >= STRIDENT_DELTA_FLOOR &&
        sampleSize <= STRIDENT_SAMPLE_CEILING) {
        return {
            kind: 'strident_event',
            reason: 'extreme_delta_few_samples'
        };
    }
    // Streak: high-noise regime + moderate sample → lucky/unlucky
    if (regimeNoiseLevel >= NOISY_REGIME_THRESHOLD &&
        sampleSize >= 3 && sampleSize <= STRIDENT_SAMPLE_CEILING) {
        return {
            kind: deltaSign >= 0 ? 'lucky_streak' : 'unlucky_streak',
            reason: 'high_noise_short_sample'
        };
    }
    // Default fallback to structural for clean signal
    return {
        kind: 'structural_signal',
        reason: 'default_no_streak_no_strident'
    };
}

// ── computeRegularizationFactor (pure) ─────────────────────────────
function computeRegularizationFactor(params) {
    const evidenceKind = _required(params, 'evidenceKind');
    if (!EVIDENCE_KINDS.includes(evidenceKind)) {
        throw new Error(
            `beliefUpdateRegularizer: invalid evidenceKind "${evidenceKind}"`
        );
    }
    const regimeNoiseLevel = (params && params.regimeNoiseLevel !== undefined)
        ? params.regimeNoiseLevel : 0;

    let factor = KIND_REGULARIZATION_FACTORS[evidenceKind];
    if (regimeNoiseLevel >= NOISY_REGIME_THRESHOLD) {
        factor *= NOISY_REGIME_MULTIPLIER;
    }
    return {
        factor: Math.max(0, Math.min(1, factor)),
        evidenceKind,
        regimeNoiseLevel
    };
}

// ── regularizeUpdate (pure) ────────────────────────────────────────
function regularizeUpdate(params) {
    const priorValue = _required(params, 'priorValue');
    const proposedValue = _required(params, 'proposedValue');
    const evidenceKind = _required(params, 'evidenceKind');
    const maxDelta = (params && params.maxDelta !== undefined)
        ? params.maxDelta : DEFAULT_MAX_DELTA;
    const regimeNoiseLevel = (params && params.regimeNoiseLevel !== undefined)
        ? params.regimeNoiseLevel : 0;

    const { factor } = computeRegularizationFactor({
        evidenceKind, regimeNoiseLevel
    });
    const rawDelta = (proposedValue - priorValue) * factor;
    // Clamp to maxDelta in absolute terms
    const clampedDelta = Math.sign(rawDelta) *
        Math.min(Math.abs(rawDelta), maxDelta);
    const appliedValue = priorValue + clampedDelta;

    return {
        appliedValue,
        rawDelta, clampedDelta, factor,
        evidenceKind
    };
}

// ── registerSpeedLimit ─────────────────────────────────────────────
function registerSpeedLimit(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limitId = _required(params, 'limitId');
    const beliefCategory = _required(params, 'beliefCategory');
    const maxDeltaPerUpdate = _required(params, 'maxDeltaPerUpdate');
    if (maxDeltaPerUpdate <= 0) {
        throw new Error(
            'beliefUpdateRegularizer: maxDeltaPerUpdate must be > 0'
        );
    }
    const maxUpdatesPerWindow = _required(params, 'maxUpdatesPerWindow');
    if (maxUpdatesPerWindow <= 0) {
        throw new Error(
            'beliefUpdateRegularizer: maxUpdatesPerWindow must be > 0'
        );
    }
    const windowSeconds = _required(params, 'windowSeconds');
    if (windowSeconds <= 0) {
        throw new Error(
            'beliefUpdateRegularizer: windowSeconds must be > 0'
        );
    }
    const regimeModifier = (params && params.regimeModifier)
        ? JSON.stringify(params.regimeModifier) : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertLimit.run(
            userId, env, limitId, beliefCategory,
            maxDeltaPerUpdate, maxUpdatesPerWindow,
            windowSeconds, regimeModifier, ts, ts
        );
        return { registered: true, limitId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`beliefUpdateRegularizer: duplicate limitId "${limitId}"`);
        }
        throw err;
    }
}

// ── recordBeliefUpdate ─────────────────────────────────────────────
function recordBeliefUpdate(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const auditId = _required(params, 'auditId');
    const beliefId = _required(params, 'beliefId');
    const priorValue = _required(params, 'priorValue');
    const proposedValue = _required(params, 'proposedValue');
    const appliedValue = _required(params, 'appliedValue');
    const evidenceKind = _required(params, 'evidenceKind');
    if (!EVIDENCE_KINDS.includes(evidenceKind)) {
        throw new Error(
            `beliefUpdateRegularizer: invalid evidenceKind "${evidenceKind}"`
        );
    }
    const regularizationFactor = _required(params, 'regularizationFactor');
    if (regularizationFactor < 0 || regularizationFactor > 1) {
        throw new Error(
            'beliefUpdateRegularizer: regularizationFactor must be in [0,1]'
        );
    }
    const reason = (params && params.reason) ? params.reason : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertAudit.run(
            userId, env, auditId, beliefId,
            priorValue, proposedValue, appliedValue,
            evidenceKind, regularizationFactor, reason, ts
        );
        return { recorded: true, auditId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`beliefUpdateRegularizer: duplicate auditId "${auditId}"`);
        }
        throw err;
    }
}

// ── getUpdateAudit ─────────────────────────────────────────────────
function getUpdateAudit(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const beliefId = _required(params, 'beliefId');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listAuditByBelief.all(userId, env, beliefId, limit);
    return rows.map(r => ({
        auditId: r.audit_id,
        beliefId: r.belief_id,
        priorValue: r.prior_value,
        proposedValue: r.proposed_value,
        appliedValue: r.applied_value,
        evidenceKind: r.evidence_kind,
        regularizationFactor: r.regularization_factor,
        reason: r.reason,
        ts: r.ts
    }));
}

module.exports = {
    EVIDENCE_KINDS,
    KIND_REGULARIZATION_FACTORS,
    MIN_SAMPLE_FOR_STRUCTURAL,
    STRIDENT_SAMPLE_CEILING,
    NOISY_REGIME_MULTIPLIER,
    NOISY_REGIME_THRESHOLD,
    DEFAULT_MAX_DELTA,
    classifyEvidenceKind,
    computeRegularizationFactor,
    regularizeUpdate,
    registerSpeedLimit,
    recordBeliefUpdate,
    getUpdateAudit
};
