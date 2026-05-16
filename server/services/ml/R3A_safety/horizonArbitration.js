'use strict';

/**
 * OMEGA R3A Safety — horizonArbitration (canonical §77)
 *
 * §77 CROSS-HORIZON ARBITRATION / HORIZON OWNERSHIP ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1985-2024.
 *
 * "Cine are autoritate asupra acestei pozitii chiar acum?"
 *
 * R3A. Each position has explicit horizon owner. Signal arbitration
 * decides whether incoming signal should:
 *   - invalidate the thesis (full exit)
 *   - hedge_or_reduce (partial)
 *   - be ignored as noise
 *
 * Arbitration rules per spec:
 *   - HTF veto power over LTF (HTF can invalidate any lower horizon)
 *   - LTF signal vs HTF position = noise unless very strong (>0.85)
 *   - Same-horizon conflict invalidates only if score > threshold
 *   - Microstructure: only hedge_or_reduce, NEVER invalidate full thesis
 *
 * Distinct from §14 conflictResolution (signal-vs-signal vetoes) and
 * §27 temporalPatterns (timeframe pattern detection).
 */

const { db } = require('../../database');

const THESIS_HORIZONS = Object.freeze([
    'scalp', 'intraday', 'swing', 'macro_defensive'
]);
const OWNER_TIMEFRAMES = Object.freeze(['HTF', 'MTF', 'LTF', 'micro']);
const SIGNAL_IMPACTS = Object.freeze([
    'invalidates', 'noise', 'hedge_or_reduce'
]);
const RECOMMENDED_ACTIONS = Object.freeze(['ignore', 'hedge', 'reduce', 'exit']);

const HORIZON_HIERARCHY = Object.freeze({
    macro_defensive: 4, swing: 3, intraday: 2, scalp: 1
});

const TIMEFRAME_HIERARCHY = Object.freeze({
    HTF: 4, MTF: 3, LTF: 2, micro: 1
});

const STRONG_LTF_THRESHOLD = 0.85;
const SAME_HORIZON_INVALIDATE_THRESHOLD = 0.75;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`horizonArbitration: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertOwnership: db.prepare(`
        INSERT INTO ml_horizon_ownership
        (user_id, resolved_env, position_id, thesis_horizon,
         owner_timeframe, assigned_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
    `),
    getOwnership: db.prepare(`
        SELECT * FROM ml_horizon_ownership
        WHERE user_id = ? AND resolved_env = ? AND position_id = ?
    `),
    retireOwnership: db.prepare(`
        UPDATE ml_horizon_ownership
        SET status = 'RETIRED', retired_at = ?
        WHERE user_id = ? AND resolved_env = ? AND position_id = ?
          AND status = 'ACTIVE'
    `),
    insertConflict: db.prepare(`
        INSERT INTO ml_horizon_conflicts
        (user_id, resolved_env, position_id, signal_timeframe,
         signal_strength, conflict_score, action_recommended,
         resolution_reasoning, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    conflictHistory: db.prepare(`
        SELECT * FROM ml_horizon_conflicts
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR position_id = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── assignHorizonOwner ─────────────────────────────────────────────
function assignHorizonOwner(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const positionId = _required(params, 'positionId');
    const thesisHorizon = _required(params, 'thesisHorizon');
    const ownerTimeframe = _required(params, 'ownerTimeframe');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!THESIS_HORIZONS.includes(thesisHorizon)) {
        throw new Error(`horizonArbitration: invalid thesisHorizon "${thesisHorizon}"`);
    }
    if (!OWNER_TIMEFRAMES.includes(ownerTimeframe)) {
        throw new Error(`horizonArbitration: invalid ownerTimeframe "${ownerTimeframe}"`);
    }

    try {
        _stmts.insertOwnership.run(
            userId, env, positionId, thesisHorizon, ownerTimeframe, ts
        );
        return { assigned: true, positionId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`horizonArbitration: position "${positionId}" already has ownership`);
        }
        throw err;
    }
}

// ── classifySignalImpact (pure) ────────────────────────────────────
function classifySignalImpact(params) {
    const signalStrength = _required(params, 'signalStrength');
    const ownerTimeframe = _required(params, 'ownerTimeframe');
    const signalTimeframe = _required(params, 'signalTimeframe');

    if (!TIMEFRAME_HIERARCHY[ownerTimeframe] || !TIMEFRAME_HIERARCHY[signalTimeframe]) {
        throw new Error('horizonArbitration: invalid timeframe');
    }

    const ownerRank = TIMEFRAME_HIERARCHY[ownerTimeframe];
    const signalRank = TIMEFRAME_HIERARCHY[signalTimeframe];

    // Microstructure NEVER invalidates full thesis (per spec)
    if (signalTimeframe === 'micro') {
        if (signalStrength >= 0.50) return 'hedge_or_reduce';
        return 'noise';
    }

    // HTF veto power: HTF can invalidate lower horizons
    if (signalRank > ownerRank) {
        if (signalStrength >= 0.60) return 'invalidates';
        if (signalStrength >= 0.40) return 'hedge_or_reduce';
        return 'noise';
    }

    // LTF signal vs HTF position: noise unless very strong
    if (signalRank < ownerRank) {
        if (signalStrength >= STRONG_LTF_THRESHOLD) return 'hedge_or_reduce';
        return 'noise';
    }

    // Same horizon
    if (signalStrength >= SAME_HORIZON_INVALIDATE_THRESHOLD) return 'invalidates';
    if (signalStrength >= 0.50) return 'hedge_or_reduce';
    return 'noise';
}

// ── evaluateSignalConflict ─────────────────────────────────────────
function evaluateSignalConflict(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const positionId = _required(params, 'positionId');
    const signalTimeframe = _required(params, 'signalTimeframe');
    const signalStrength = _required(params, 'signalStrength');

    if (!OWNER_TIMEFRAMES.includes(signalTimeframe)) {
        throw new Error(`horizonArbitration: invalid signalTimeframe "${signalTimeframe}"`);
    }

    const own = _stmts.getOwnership.get(userId, env, positionId);
    if (!own || own.status !== 'ACTIVE') {
        return {
            allowed: true,
            actionRecommended: 'ignore',
            reason: 'no_active_ownership'
        };
    }

    const impact = classifySignalImpact({
        signalStrength,
        ownerTimeframe: own.owner_timeframe,
        signalTimeframe
    });

    const ownerRank = TIMEFRAME_HIERARCHY[own.owner_timeframe];
    const signalRank = TIMEFRAME_HIERARCHY[signalTimeframe];
    const conflictScore = signalStrength * Math.abs(signalRank - ownerRank) / 4 +
                          (impact === 'invalidates' ? 0.5 : impact === 'hedge_or_reduce' ? 0.25 : 0);

    let action;
    if (impact === 'invalidates') action = 'exit';
    else if (impact === 'hedge_or_reduce') action = signalStrength > 0.70 ? 'reduce' : 'hedge';
    else action = 'ignore';

    return {
        allowed: action !== 'exit',
        actionRecommended: action,
        impact,
        conflictScore,
        ownerTimeframe: own.owner_timeframe,
        thesisHorizon: own.thesis_horizon
    };
}

// ── recordConflict ─────────────────────────────────────────────────
function recordConflict(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const positionId = _required(params, 'positionId');
    const signalTimeframe = _required(params, 'signalTimeframe');
    const signalStrength = _required(params, 'signalStrength');
    const conflictScore = _required(params, 'conflictScore');
    const actionRecommended = _required(params, 'actionRecommended');
    const resolutionReasoning = (params && params.resolutionReasoning) ? params.resolutionReasoning : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!OWNER_TIMEFRAMES.includes(signalTimeframe)) {
        throw new Error(`horizonArbitration: invalid signalTimeframe`);
    }
    if (!RECOMMENDED_ACTIONS.includes(actionRecommended)) {
        throw new Error(`horizonArbitration: invalid actionRecommended "${actionRecommended}"`);
    }

    _stmts.insertConflict.run(
        userId, env, positionId, signalTimeframe,
        signalStrength, conflictScore, actionRecommended,
        resolutionReasoning, ts
    );

    return { recorded: true };
}

// ── retireOwnership ────────────────────────────────────────────────
function retireOwnership(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const positionId = _required(params, 'positionId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const result = _stmts.retireOwnership.run(ts, userId, env, positionId);
    return { retired: result.changes > 0 };
}

// ── getOwnership ───────────────────────────────────────────────────
function getOwnership(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const positionId = _required(params, 'positionId');
    const row = _stmts.getOwnership.get(userId, env, positionId);
    if (!row) return { exists: false };
    return {
        exists: true,
        positionId: row.position_id,
        thesisHorizon: row.thesis_horizon,
        ownerTimeframe: row.owner_timeframe,
        status: row.status,
        assignedAt: row.assigned_at
    };
}

// ── getConflictHistory ─────────────────────────────────────────────
function getConflictHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const positionId = (params && params.positionId) ? params.positionId : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.conflictHistory.all(
        userId, env,
        positionId, positionId,
        since > 0 ? 1 : 0, since,
        limit
    );
}

module.exports = {
    THESIS_HORIZONS,
    OWNER_TIMEFRAMES,
    SIGNAL_IMPACTS,
    RECOMMENDED_ACTIONS,
    HORIZON_HIERARCHY,
    TIMEFRAME_HIERARCHY,
    STRONG_LTF_THRESHOLD,
    SAME_HORIZON_INVALIDATE_THRESHOLD,
    assignHorizonOwner,
    classifySignalImpact,
    evaluateSignalConflict,
    recordConflict,
    retireOwnership,
    getOwnership,
    getConflictHistory
};
