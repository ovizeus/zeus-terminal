'use strict';

/**
 * OMEGA Cross-cutting — moodEmaTracker (A-Z Raid item M)
 *
 * RAID-M MOOD EMA SMOOTHING (anti-flicker).
 * Source: A-Z Raid Wave 1 UX additions.
 *
 * EMA smoothing for Ω mood indicator (Orb UI). Anti-flicker logic
 * smooths raw mood signals so UI doesn't oscillate between states.
 *
 * Formula: smoothed = alpha × raw + (1 - alpha) × previous_smoothed
 * Default alpha = 0.3 (responsive but smooth).
 */

const { db } = require('../../database');

const DEFAULT_EMA_ALPHA = 0.3;
const MOOD_RANGE = Object.freeze({ min: -1.0, max: 1.0 });
const FLICKER_THRESHOLD = 0.05;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`moodEmaTracker: missing ${key}`);
    }
    return params[key];
}

function _clampMood(score) {
    return Math.max(MOOD_RANGE.min, Math.min(MOOD_RANGE.max, score));
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getState: db.prepare(`
        SELECT * FROM ml_mood_state
        WHERE user_id = ? AND resolved_env = ?
    `),
    upsertState: db.prepare(`
        INSERT INTO ml_mood_state
        (user_id, resolved_env, smoothed_score, sample_count, last_raw_score, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            smoothed_score = excluded.smoothed_score,
            sample_count = excluded.sample_count,
            last_raw_score = excluded.last_raw_score,
            updated_at = excluded.updated_at
    `),
    insertHistory: db.prepare(`
        INSERT INTO ml_mood_history
        (user_id, resolved_env, raw_score, smoothed_score, alpha_used, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    deleteState: db.prepare(`
        DELETE FROM ml_mood_state WHERE user_id = ? AND resolved_env = ?
    `),
    listHistory: db.prepare(`
        SELECT * FROM ml_mood_history
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── updateMood ─────────────────────────────────────────────────────
function updateMood(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const rawMoodScore = _required(params, 'rawMoodScore');
    const alpha = (params && typeof params.alpha === 'number') ? params.alpha : DEFAULT_EMA_ALPHA;

    const clampedRaw = _clampMood(rawMoodScore);

    const existing = _stmts.getState.get(userId, env);
    let smoothed;
    let sampleCount;
    if (!existing) {
        smoothed = clampedRaw;
        sampleCount = 1;
    } else {
        smoothed = alpha * clampedRaw + (1 - alpha) * existing.smoothed_score;
        sampleCount = existing.sample_count + 1;
    }

    smoothed = _clampMood(smoothed);
    const now = Date.now();

    _stmts.upsertState.run(
        userId, env, smoothed, sampleCount, clampedRaw, now
    );
    _stmts.insertHistory.run(
        userId, env, clampedRaw, smoothed, alpha, now
    );

    return {
        smoothed,
        rawScore: clampedRaw,
        sampleCount,
        alpha
    };
}

// ── getCurrentMood ─────────────────────────────────────────────────
function getCurrentMood(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');

    const row = _stmts.getState.get(userId, env);
    if (!row) {
        return {
            exists: false,
            smoothed: 0,
            sampleCount: 0
        };
    }
    return {
        exists: true,
        smoothed: row.smoothed_score,
        sampleCount: row.sample_count,
        lastRawScore: row.last_raw_score,
        updatedAt: row.updated_at
    };
}

// ── resetMood ──────────────────────────────────────────────────────
function resetMood(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');
    void reason; void actor;

    const existing = _stmts.getState.get(userId, env);
    if (!existing) return { reset: false };

    _stmts.deleteState.run(userId, env);
    return { reset: true };
}

// ── getMoodHistory ─────────────────────────────────────────────────
function getMoodHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listHistory.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );

    return rows.map(r => ({
        id: r.id,
        rawScore: r.raw_score,
        smoothedScore: r.smoothed_score,
        alphaUsed: r.alpha_used,
        createdAt: r.created_at
    }));
}

module.exports = {
    DEFAULT_EMA_ALPHA,
    MOOD_RANGE,
    FLICKER_THRESHOLD,
    updateMood,
    getCurrentMood,
    resetMood,
    getMoodHistory
};
