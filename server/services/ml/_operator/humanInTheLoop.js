'use strict';

/**
 * OMEGA Operator Interaction — humanInTheLoop (canonical §34)
 *
 * §34 HUMAN-IN-THE-LOOP SI CONTROALE UMANE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1340-1354.
 *
 * Adds 4 TRIGGER detectors that surface auto-decisions requiring human
 * review + emergency kill switch state management. Composes existing
 * approvalQueue (Wave 1D _operator/approvalQueue.js) for actual review
 * workflow.
 *
 * Override kinds (4 spec-aligned):
 *   AMBIGUOUS_CONFIDENCE     — score in [0.45, 0.55] band, model unsure
 *   INTERMEDIATE_THRESHOLD   — score in [0.5, 0.65) — borderline acceptable
 *   UNUSUAL_EXPOSURE          — candidate position > 3% of balance
 *   OPERATIONAL_CONFLICT      — 2+ critical operational signals active
 *
 * Kill switch: per-(user × env). State ON blocks all auto-trading.
 * Independent of approvalQueue — direct halt primitive.
 *
 * Spec items already covered elsewhere:
 *   - Manual override UI            → frontend (Wave 8 polish)
 *   - Emergency kill switch         → THIS module + approvalQueue
 *                                      (request_type='EMERGENCY_HALT')
 *   - Audit trails                  → ml_human_overrides + cross-cutting audit
 *   - Change approvals              → approvalQueue (Wave 1D)
 *   - Access control                → out of scope (auth layer)
 */

const { db } = require('../../database');
const approvalQueue = require('./approvalQueue');

const OVERRIDE_KINDS = Object.freeze([
    'AMBIGUOUS_CONFIDENCE',
    'INTERMEDIATE_THRESHOLD',
    'UNUSUAL_EXPOSURE',
    'OPERATIONAL_CONFLICT'
]);

const KILL_SWITCH_STATES = Object.freeze(['ON', 'OFF']);

const CONFIDENCE_AMBIGUITY = Object.freeze({ lo: 0.45, hi: 0.55 });

const DEFAULT_THRESHOLDS = Object.freeze({
    intermediate_min: 0.5,
    intermediate_max: 0.65,
    unusual_exposure_pct: 3.0
});

// Critical operational signals (any 2+ active = OPERATIONAL_CONFLICT)
const OPERATIONAL_SIGNAL_KEYS = [
    'drift_unstable', 'exchange_degraded', 'balance_mismatch',
    'feed_stale', 'api_rate_limited', 'partial_fills_high'
];

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`humanInTheLoop: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertOverride: db.prepare(`
        INSERT INTO ml_human_overrides
        (record_type, user_id, resolved_env, override_kind, state,
         payload_json, reason, actor, created_at)
        VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
    `),
    activeKillSwitch: db.prepare(`
        SELECT * FROM ml_human_overrides
        WHERE user_id = ? AND resolved_env = ?
          AND record_type = 'KILL_SWITCH' AND state = 'ACTIVE'
        ORDER BY created_at DESC LIMIT 1
    `),
    clearActiveKillSwitch: db.prepare(`
        UPDATE ml_human_overrides
        SET state = 'CLEARED', cleared_at = ?
        WHERE user_id = ? AND resolved_env = ?
          AND record_type = 'KILL_SWITCH' AND state = 'ACTIVE'
    `)
};

// ── Detection functions ────────────────────────────────────────────
function detectAmbiguousConfidence(params) {
    const score = params && typeof params.score === 'number' ? params.score : null;
    if (score === null || !Number.isFinite(score)) return false;
    const band = (params && params.thresholds) ? params.thresholds : CONFIDENCE_AMBIGUITY;
    return score >= band.lo && score <= band.hi;
}

function detectIntermediateThreshold(params) {
    const score = params && typeof params.score === 'number' ? params.score : null;
    if (score === null || !Number.isFinite(score)) return false;
    const t = (params && params.thresholds) ? params.thresholds : DEFAULT_THRESHOLDS;
    return score >= t.intermediate_min && score < t.intermediate_max;
}

function detectUnusualExposure(params) {
    if (!params || !params.candidate || typeof params.balance !== 'number' || params.balance <= 0) {
        return false;
    }
    const sizeUsd = Number(params.candidate.sizeUsd);
    if (!Number.isFinite(sizeUsd)) return false;
    const t = (params.thresholds) ? params.thresholds : DEFAULT_THRESHOLDS;
    const exposurePct = (sizeUsd / params.balance) * 100;
    return exposurePct > t.unusual_exposure_pct;
}

function detectOperationalConflict(params) {
    if (!params || !params.signals || typeof params.signals !== 'object') return false;
    let activeCritical = 0;
    for (const key of OPERATIONAL_SIGNAL_KEYS) {
        if (params.signals[key] === true) activeCritical++;
    }
    return activeCritical >= 2;
}

// ── submitForReview ────────────────────────────────────────────────
function submitForReview(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kind = _required(params, 'kind');
    const payload = _required(params, 'payload');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');

    if (!OVERRIDE_KINDS.includes(kind)) {
        throw new Error(`submitForReview: invalid kind "${kind}" (must be ${OVERRIDE_KINDS.join('|')})`);
    }

    const now = Date.now();
    const overrideResult = _stmts.insertOverride.run(
        'REVIEW_REQUEST', userId, env, kind,
        JSON.stringify(payload), reason, actor, now
    );

    // Determine tier from kind
    const tier = (kind === 'UNUSUAL_EXPOSURE' || kind === 'OPERATIONAL_CONFLICT')
        ? 'MAJOR'
        : 'MINOR';

    const approval = approvalQueue.enqueue({
        userId,
        requestType: 'PROMOTION',  // generic review request
        payload: { overrideId: overrideResult.lastInsertRowid, kind, ...payload },
        tier
    });

    return {
        reviewId: overrideResult.lastInsertRowid,
        approvalId: approval.id,
        tier
    };
}

// ── recordManualOverride ───────────────────────────────────────────
function recordManualOverride(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kind = _required(params, 'kind');
    const payload = _required(params, 'payload');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');

    if (!OVERRIDE_KINDS.includes(kind)) {
        throw new Error(`recordManualOverride: invalid kind "${kind}"`);
    }
    const result = _stmts.insertOverride.run(
        'OVERRIDE', userId, env, kind,
        JSON.stringify(payload), reason, actor, Date.now()
    );
    return { overrideId: result.lastInsertRowid };
}

// ── setEmergencyKillSwitch ─────────────────────────────────────────
function setEmergencyKillSwitch(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const state = _required(params, 'state');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');

    if (!KILL_SWITCH_STATES.includes(state)) {
        throw new Error(`setEmergencyKillSwitch: invalid state "${state}" (must be ON or OFF)`);
    }

    if (state === 'OFF') {
        // Clear any active kill switch for this user/env
        _stmts.clearActiveKillSwitch.run(Date.now(), userId, env);
        const result = _stmts.insertOverride.run(
            'KILL_SWITCH', userId, env, null,
            JSON.stringify({ state: 'OFF' }), reason, actor, Date.now()
        );
        // Mark this new row also CLEARED (it's a state transition log)
        db.prepare(`UPDATE ml_human_overrides SET state = 'CLEARED', cleared_at = ? WHERE id = ?`)
            .run(Date.now(), result.lastInsertRowid);
        return { switchId: result.lastInsertRowid, state: 'OFF' };
    }

    // state === 'ON' — clear any existing ACTIVE and insert new ACTIVE
    _stmts.clearActiveKillSwitch.run(Date.now(), userId, env);
    const result = _stmts.insertOverride.run(
        'KILL_SWITCH', userId, env, null,
        JSON.stringify({ state: 'ON' }), reason, actor, Date.now()
    );
    return { switchId: result.lastInsertRowid, state: 'ON' };
}

// ── getEmergencyKillSwitchState ────────────────────────────────────
function getEmergencyKillSwitchState(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const active = _stmts.activeKillSwitch.get(userId, env);
    if (!active) {
        return { state: 'OFF', reason: null, since: null };
    }
    return {
        state: 'ON',
        reason: active.reason,
        since: active.created_at,
        actor: active.actor
    };
}

// ── isKillSwitchActive ─────────────────────────────────────────────
function isKillSwitchActive(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    return _stmts.activeKillSwitch.get(userId, env) !== undefined;
}

module.exports = {
    OVERRIDE_KINDS,
    KILL_SWITCH_STATES,
    CONFIDENCE_AMBIGUITY,
    DEFAULT_THRESHOLDS,
    detectAmbiguousConfidence,
    detectIntermediateThreshold,
    detectUnusualExposure,
    detectOperationalConflict,
    submitForReview,
    recordManualOverride,
    setEmergencyKillSwitch,
    getEmergencyKillSwitchState,
    isKillSwitchActive
};
