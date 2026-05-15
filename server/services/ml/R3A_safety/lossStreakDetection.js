'use strict';

/**
 * OMEGA R3A Safety — lossStreakDetection (canonical §46)
 *
 * §46 LOSS STREAK DETECTION GEOMETRIC.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1540-1551.
 *
 * Geometric size reduction pe consecutive losses, independent de DD:
 *   0-1 losses → 100% size
 *   2 losses → 50%
 *   3 losses → 25%
 *   4+ losses → 0% (STOP)
 *
 * Recovery: after win, gradual return (NOT instant full). Per spec:
 * "După un win → revine la size normal treptat".
 *
 * Distinct de:
 *   - §246* graduated DD recovery (post-incident, percentage-based)
 *   - OBS-2 size ramp (pre-production confidence build)
 */

const { db } = require('../../database');

const STREAK_SIZE_MAP = Object.freeze({
    0: 1.0,
    1: 1.0,
    2: 0.5,
    3: 0.25,
    4: 0  // and beyond
});

const FULL_STOP_AFTER = 4;

// Recovery pattern: how much multiplier increases per win (post-stop or post-reduction).
// Pattern: 1st win after streak → +0.25, 2nd → +0.25, etc. Returns to 1.0 in ~4 wins.
const RECOVERY_PATTERN = Object.freeze([0.25, 0.25, 0.25, 0.25]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`lossStreakDetection: missing ${key}`);
    }
    return params[key];
}

function _multiplierForLosses(consecutiveLosses) {
    if (consecutiveLosses >= FULL_STOP_AFTER) return 0;
    return STREAK_SIZE_MAP[consecutiveLosses] !== undefined
        ? STREAK_SIZE_MAP[consecutiveLosses]
        : 1.0;
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getState: db.prepare(`
        SELECT * FROM ml_loss_streak_state
        WHERE user_id = ? AND resolved_env = ?
    `),
    upsertState: db.prepare(`
        INSERT INTO ml_loss_streak_state
        (user_id, resolved_env, consecutive_losses, size_multiplier,
         last_win_at, recovery_progress, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            consecutive_losses = excluded.consecutive_losses,
            size_multiplier = excluded.size_multiplier,
            last_win_at = excluded.last_win_at,
            recovery_progress = excluded.recovery_progress,
            updated_at = excluded.updated_at
    `),
    deleteState: db.prepare(`
        DELETE FROM ml_loss_streak_state WHERE user_id = ? AND resolved_env = ?
    `)
};

// ── recordTradeOutcome ─────────────────────────────────────────────
function recordTradeOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const won = !!params.won;

    const now = Date.now();
    const existing = _stmts.getState.get(userId, env);

    let consecutiveLosses;
    let sizeMultiplier;
    let lastWinAt;
    let recoveryProgress;

    if (won) {
        // Win: reset consecutive losses, advance recovery if was reduced
        const wasReduced = existing && existing.size_multiplier < 1.0;
        consecutiveLosses = 0;
        lastWinAt = now;
        if (wasReduced && existing) {
            // Gradual recovery: add recovery step
            const newRecoveryProgress = existing.recovery_progress + 1;
            const recoveryIdx = Math.min(newRecoveryProgress - 1, RECOVERY_PATTERN.length - 1);
            const recoveryAmount = RECOVERY_PATTERN[recoveryIdx];
            sizeMultiplier = Math.min(1.0, existing.size_multiplier + recoveryAmount);
            recoveryProgress = sizeMultiplier >= 1.0 ? 0 : newRecoveryProgress;
        } else {
            sizeMultiplier = 1.0;
            recoveryProgress = 0;
        }
    } else {
        // Loss: increment streak
        consecutiveLosses = (existing ? existing.consecutive_losses : 0) + 1;
        sizeMultiplier = _multiplierForLosses(consecutiveLosses);
        lastWinAt = existing ? existing.last_win_at : null;
        recoveryProgress = 0;
    }

    _stmts.upsertState.run(
        userId, env, consecutiveLosses, sizeMultiplier,
        lastWinAt, recoveryProgress, now
    );

    return {
        consecutiveLosses,
        sizeMultiplier,
        stopActive: sizeMultiplier === 0
    };
}

// ── getStreakState ─────────────────────────────────────────────────
function getStreakState(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');

    const row = _stmts.getState.get(userId, env);
    if (!row) {
        return {
            exists: false,
            consecutiveLosses: 0,
            sizeMultiplier: 1.0,
            stopActive: false
        };
    }
    return {
        exists: true,
        consecutiveLosses: row.consecutive_losses,
        sizeMultiplier: row.size_multiplier,
        lastWin: row.last_win_at,
        recoveryProgress: row.recovery_progress,
        stopActive: row.size_multiplier === 0
    };
}

// ── getCurrentSizeMultiplier ───────────────────────────────────────
function getCurrentSizeMultiplier(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');

    const row = _stmts.getState.get(userId, env);
    return row ? row.size_multiplier : 1.0;
}

// ── resetStreak ────────────────────────────────────────────────────
function resetStreak(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');
    void reason; void actor;

    _stmts.deleteState.run(userId, env);
    return { reset: true };
}

module.exports = {
    STREAK_SIZE_MAP,
    FULL_STOP_AFTER,
    RECOVERY_PATTERN,
    recordTradeOutcome,
    getStreakState,
    getCurrentSizeMultiplier,
    resetStreak
};
