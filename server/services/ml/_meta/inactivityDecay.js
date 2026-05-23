'use strict';

/**
 * OMEGA Meta — inactivityDecay (canonical §47)
 *
 * §47 INACTIVITY DECAY / BOREDOM PREVENTION.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1553-1560.
 *
 * Anti-FOMO: după 3 zile inactivitate în SNIPER mode, threshold CREȘTE 10%
 * (mai selectiv, NU mai puțin). Spec EXPLICIT exclude opusul.
 *
 * Formula:
 *   adjustment_pct = max(0, days_since - 3) × 10%
 *   capped at MAX_THRESHOLD_INCREASE (default 50%)
 *   adjustedThreshold = baseThreshold × (1 + adjustment_pct), capped at 1.0
 */

const { db } = require('../../database');

const INACTIVITY_DAYS_TRIGGER = 3;
const THRESHOLD_INCREASE_PCT = 0.10;  // 10% per day past trigger
const MAX_THRESHOLD_INCREASE = 0.5;   // cap at +50%
const DAYS_MS = 86400000;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`inactivityDecay: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getState: db.prepare(`
        SELECT * FROM ml_inactivity_state
        WHERE user_id = ? AND resolved_env = ?
    `),
    upsertState: db.prepare(`
        INSERT INTO ml_inactivity_state
        (user_id, resolved_env, last_trade_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            last_trade_at = excluded.last_trade_at,
            updated_at = excluded.updated_at
    `),
    deleteState: db.prepare(`
        DELETE FROM ml_inactivity_state
        WHERE user_id = ? AND resolved_env = ?
    `)
};

// ── computeThresholdAdjustment (pure) ──────────────────────────────
function computeThresholdAdjustment(params) {
    const daysSinceLastTrade = _required(params, 'daysSinceLastTrade');
    const baseThreshold = _required(params, 'baseThreshold');

    const daysOver = Math.max(0, daysSinceLastTrade - INACTIVITY_DAYS_TRIGGER + 1);
    let increasePct = daysOver * THRESHOLD_INCREASE_PCT;
    if (daysSinceLastTrade < INACTIVITY_DAYS_TRIGGER) increasePct = 0;
    increasePct = Math.min(MAX_THRESHOLD_INCREASE, increasePct);

    const adjustedThreshold = Math.min(1.0, baseThreshold * (1 + increasePct));

    return {
        increasePct,
        adjustedThreshold,
        baseThreshold,
        daysSinceLastTrade
    };
}

// ── recordTradeEntry ───────────────────────────────────────────────
function recordTradeEntry(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');

    const now = Date.now();
    _stmts.upsertState.run(userId, env, now, now);
    return { recorded: true };
}

// ── getInactivityState ─────────────────────────────────────────────
function getInactivityState(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');

    const row = _stmts.getState.get(userId, env);
    if (!row) {
        return {
            exists: false,
            daysSinceLastTrade: 0,
            thresholdAdjustmentInfo: { increasePct: 0 }
        };
    }
    const daysSinceLastTrade = (Date.now() - row.last_trade_at) / DAYS_MS;
    const thresholdAdjustmentInfo = computeThresholdAdjustment({
        daysSinceLastTrade,
        baseThreshold: 0.65  // reference (not used elsewhere, just for info)
    });

    return {
        exists: true,
        daysSinceLastTrade,
        lastTradeAt: row.last_trade_at,
        thresholdAdjustmentInfo
    };
}

// ── resetInactivity ────────────────────────────────────────────────
function resetInactivity(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');
    void reason; void actor;

    _stmts.deleteState.run(userId, env);
    return { reset: true };
}

module.exports = {
    INACTIVITY_DAYS_TRIGGER,
    THRESHOLD_INCREASE_PCT,
    MAX_THRESHOLD_INCREASE,
    computeThresholdAdjustment,
    recordTradeEntry,
    getInactivityState,
    resetInactivity
};
