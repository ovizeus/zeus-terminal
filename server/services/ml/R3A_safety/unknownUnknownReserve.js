'use strict';

/**
 * OMEGA Wave 3 §155 — UNKNOWN-UNKNOWN RESERVE / SACRED SLACK ENGINE.
 *
 * Canonical PDF §155 (ml_brain_canonic.txt lines 5181-5232).
 *
 * "ce parte din prudenta mea este rezervata pentru lucruri pe care nici
 *  macar nu stiu inca sa le numesc?"
 *
 * Distinct de:
 *   - §120 unknownsRegistry (R5B?)    — KNOWN unknowns (formulable)
 *   - §148 ontologicalHumility (_meta) — reality exceeds model
 *   - R3A/blackSwanAbstention          — REACTIVE abstain on regime break
 *   - R3A/ergodicityAwareness          — single-path risk
 *
 * §155 = PROACTIVE permanent buffer pentru radical unknown.
 *
 * 5 canonical reserve types (PDF lines 5203-5208):
 *   risk_budget | latency_budget | cognitive_budget |
 *   optionality_budget | trust_budget
 *
 * 4 canonical activation triggers (PDF lines 5213-5217):
 *   unclassifiable_event | unexplained_residual |
 *   ontology_failure | precontradiction_extreme
 *
 * Reguli (PDF lines 5225-5228):
 * - reserve nu poate fi consumată pentru convenience (enforced via enum
 *   CHECK on trigger — only 4 canonical triggers permitted)
 * - never_below_floor hard enforcement — chiar și în periode de claritate
 *   mare, o fracțiune rămâne intactă
 * - sistemele care nu păstrează slack pentru necunoscutul radical devin
 *   fragile tocmai când par cele mai complete
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const RESERVE_TYPES = Object.freeze([
    'risk_budget', 'latency_budget',
    'cognitive_budget', 'optionality_budget', 'trust_budget'
]);
const ACTIVATION_TRIGGERS = Object.freeze([
    'unclassifiable_event', 'unexplained_residual',
    'ontology_failure', 'precontradiction_extreme'
]);

const DEFAULT_RESERVE_FRACTION = 0.10;
const DEFAULT_NEVER_BELOW_FLOOR = 0.03;
const BOLDNESS_HAIRCUT_PER_DEPLETED_RESERVE = 0.10;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§155 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§155 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§155 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeReserveScore(params) {
    const allocatedFraction = _required(params, 'allocatedFraction');
    const currentConsumed = _required(params, 'currentConsumed');
    const neverBelowFloor = _required(params, 'neverBelowFloor');
    _requireRange01('allocatedFraction', allocatedFraction);
    _requireRange01('currentConsumed', currentConsumed);
    _requireRange01('neverBelowFloor', neverBelowFloor);
    if (neverBelowFloor > allocatedFraction) {
        throw new Error('§155 neverBelowFloor cannot exceed allocatedFraction');
    }
    const remainingFraction = Math.max(neverBelowFloor, allocatedFraction - currentConsumed);
    const score = allocatedFraction > 0
        ? remainingFraction / allocatedFraction
        : 0;
    const reserveDepleted = remainingFraction <= neverBelowFloor;
    return {
        score: Math.max(0, Math.min(1, score)),
        remainingFraction,
        reserveDepleted
    };
}

function canActivateReserve(params) {
    const allocatedFraction = _required(params, 'allocatedFraction');
    const currentConsumed = _required(params, 'currentConsumed');
    const neverBelowFloor = _required(params, 'neverBelowFloor');
    const requestedDrawdown = _required(params, 'requestedDrawdown');
    _requireRange01('allocatedFraction', allocatedFraction);
    _requireRange01('currentConsumed', currentConsumed);
    _requireRange01('neverBelowFloor', neverBelowFloor);
    if (typeof requestedDrawdown !== 'number' || requestedDrawdown <= 0) {
        throw new Error('§155 requestedDrawdown must be positive number');
    }
    if (neverBelowFloor > allocatedFraction) {
        throw new Error('§155 neverBelowFloor cannot exceed allocatedFraction');
    }
    const postConsumed = currentConsumed + requestedDrawdown;
    const postRemaining = allocatedFraction - postConsumed;
    if (postRemaining < neverBelowFloor) {
        return {
            allowed: false,
            reason: `would breach never_below_floor (${neverBelowFloor}); post remaining = ${postRemaining}`
        };
    }
    return { allowed: true, postConsumed, postRemaining };
}

function computeBoldnessHaircut(params) {
    const reserves = _required(params, 'reserves');
    if (!Array.isArray(reserves)) {
        throw new Error('§155 reserves must be array');
    }
    let depletedCount = 0;
    for (const r of reserves) {
        if (r.reserveDepleted === true) depletedCount += 1;
    }
    const raw = depletedCount * BOLDNESS_HAIRCUT_PER_DEPLETED_RESERVE;
    return {
        haircut: Math.max(0, Math.min(1, raw)),
        depletedReservesCount: depletedCount
    };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertReserve: db.prepare(`
        INSERT INTO ml_unknown_unknown_reserves (
            user_id, resolved_env, reserve_id, reserve_type, allocated_fraction,
            never_below_floor, current_consumed, description, registered_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `),
    selectReserve: db.prepare(`
        SELECT id, reserve_id AS reserveId, reserve_type AS reserveType,
               allocated_fraction AS allocatedFraction,
               never_below_floor AS neverBelowFloor,
               current_consumed AS currentConsumed,
               description, registered_at AS registeredAt
        FROM ml_unknown_unknown_reserves
        WHERE reserve_id = ?
    `),
    selectAllReserves: db.prepare(`
        SELECT id, reserve_id AS reserveId, reserve_type AS reserveType,
               allocated_fraction AS allocatedFraction,
               never_below_floor AS neverBelowFloor,
               current_consumed AS currentConsumed,
               description, registered_at AS registeredAt
        FROM ml_unknown_unknown_reserves
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY registered_at ASC
    `),
    selectReservesByType: db.prepare(`
        SELECT id, reserve_id AS reserveId, reserve_type AS reserveType,
               allocated_fraction AS allocatedFraction,
               never_below_floor AS neverBelowFloor,
               current_consumed AS currentConsumed,
               description, registered_at AS registeredAt
        FROM ml_unknown_unknown_reserves
        WHERE user_id = ? AND resolved_env = ? AND reserve_type = ?
        ORDER BY registered_at ASC
    `),
    updateConsumed: db.prepare(`
        UPDATE ml_unknown_unknown_reserves
        SET current_consumed = ?
        WHERE reserve_id = ? AND user_id = ? AND resolved_env = ?
    `),
    insertActivation: db.prepare(`
        INSERT INTO ml_reserve_activations (
            user_id, resolved_env, activation_id, reserve_id,
            activation_trigger, pre_activation_reserve_score,
            drawdown_amount, post_activation_reserve_score, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectActivation: db.prepare(`
        SELECT id, activation_id AS activationId, reserve_id AS reserveId,
               activation_trigger AS activationTrigger,
               pre_activation_reserve_score AS preActivationReserveScore,
               drawdown_amount AS drawdownAmount,
               post_activation_reserve_score AS postActivationReserveScore,
               reasoning, ts
        FROM ml_reserve_activations
        WHERE activation_id = ?
    `),
    selectActivationsForReserve: db.prepare(`
        SELECT id, activation_id AS activationId, reserve_id AS reserveId,
               activation_trigger AS activationTrigger,
               pre_activation_reserve_score AS preActivationReserveScore,
               drawdown_amount AS drawdownAmount,
               post_activation_reserve_score AS postActivationReserveScore,
               reasoning, ts
        FROM ml_reserve_activations
        WHERE user_id = ? AND resolved_env = ? AND reserve_id = ?
        ORDER BY ts ASC
    `)
};

function registerReserve(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const reserveId = _required(params, 'reserveId');
    const reserveType = _required(params, 'reserveType');
    const allocatedFraction = _required(params, 'allocatedFraction');
    const neverBelowFloor = _required(params, 'neverBelowFloor');
    const description = _required(params, 'description');
    const ts = _required(params, 'ts');

    if (!RESERVE_TYPES.includes(reserveType)) {
        throw new Error(`§155 invalid reserveType: ${reserveType}`);
    }
    _requireRange01('allocatedFraction', allocatedFraction);
    _requireRange01('neverBelowFloor', neverBelowFloor);
    if (allocatedFraction <= 0) {
        throw new Error('§155 allocatedFraction must be positive');
    }
    if (neverBelowFloor > allocatedFraction) {
        throw new Error(`§155 neverBelowFloor (${neverBelowFloor}) cannot exceed allocatedFraction (${allocatedFraction})`);
    }
    if (_stmts.selectReserve.get(reserveId)) {
        throw new Error(`§155 duplicate reserveId: ${reserveId}`);
    }
    _stmts.insertReserve.run(
        userId, resolvedEnv, reserveId, reserveType, allocatedFraction,
        neverBelowFloor, description, ts
    );
    return { registered: true, reserveId, reserveType };
}

function recordActivation(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const activationId = _required(params, 'activationId');
    const reserveId = _required(params, 'reserveId');
    const activationTrigger = _required(params, 'activationTrigger');
    const drawdownAmount = _required(params, 'drawdownAmount');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!ACTIVATION_TRIGGERS.includes(activationTrigger)) {
        throw new Error(`§155 invalid activationTrigger: ${activationTrigger}`);
    }
    if (typeof drawdownAmount !== 'number' || drawdownAmount <= 0) {
        throw new Error('§155 drawdownAmount must be positive number');
    }
    if (_stmts.selectActivation.get(activationId)) {
        throw new Error(`§155 duplicate activationId: ${activationId}`);
    }

    const reserve = _stmts.selectReserve.get(reserveId);
    if (!reserve) {
        throw new Error(`§155 reserve not found: ${reserveId}`);
    }

    const preState = computeReserveScore({
        allocatedFraction: reserve.allocatedFraction,
        currentConsumed: reserve.currentConsumed,
        neverBelowFloor: reserve.neverBelowFloor
    });

    const { allowed, reason } = canActivateReserve({
        allocatedFraction: reserve.allocatedFraction,
        currentConsumed: reserve.currentConsumed,
        neverBelowFloor: reserve.neverBelowFloor,
        requestedDrawdown: drawdownAmount
    });
    if (!allowed) {
        throw new Error(`§155 activation blocked: ${reason}`);
    }

    const newConsumed = reserve.currentConsumed + drawdownAmount;
    const postState = computeReserveScore({
        allocatedFraction: reserve.allocatedFraction,
        currentConsumed: newConsumed,
        neverBelowFloor: reserve.neverBelowFloor
    });

    _stmts.insertActivation.run(
        userId, resolvedEnv, activationId, reserveId,
        activationTrigger, preState.score, drawdownAmount, postState.score,
        reasoning, ts
    );
    _stmts.updateConsumed.run(newConsumed, reserveId, userId, resolvedEnv);

    return {
        recorded: true,
        activationId, reserveId,
        preActivationReserveScore: preState.score,
        postActivationReserveScore: postState.score,
        newConsumed
    };
}

function getReserves(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const reserveType = params.reserveType;
    if (reserveType !== undefined && !RESERVE_TYPES.includes(reserveType)) {
        throw new Error(`§155 invalid reserveType filter: ${reserveType}`);
    }
    return reserveType
        ? _stmts.selectReservesByType.all(userId, resolvedEnv, reserveType)
        : _stmts.selectAllReserves.all(userId, resolvedEnv);
}

function getActivationHistory(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const reserveId = _required(params, 'reserveId');
    return _stmts.selectActivationsForReserve.all(userId, resolvedEnv, reserveId);
}

module.exports = {
    // constants
    RESERVE_TYPES,
    ACTIVATION_TRIGGERS,
    DEFAULT_RESERVE_FRACTION,
    DEFAULT_NEVER_BELOW_FLOOR,
    BOLDNESS_HAIRCUT_PER_DEPLETED_RESERVE,
    // pure
    computeReserveScore,
    canActivateReserve,
    computeBoldnessHaircut,
    // DB
    registerReserve,
    recordActivation,
    getReserves,
    getActivationHistory
};

// FILE END §155 unknownUnknownReserve.js
