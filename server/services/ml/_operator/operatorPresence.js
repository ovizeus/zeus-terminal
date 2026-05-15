'use strict';

/**
 * OMEGA Operator Interaction — operatorPresence (A-Z Raid item O)
 *
 * RAID-O OPERATOR PRESENCE DETECTION.
 * Source: A-Z Raid Wave 1 UX additions MUST-ADD item O.
 *
 * Heartbeat-driven presence detection. Builds on §253* operatorUnavailability
 * to detect away vs active state. Activities (clicks, keystrokes, API calls)
 * update last_activity_at. AWAY when idle > threshold.
 *
 * Explicit markAway (operator says "I'm away") + markBack restoration.
 */

const { db } = require('../../database');

const PRESENCE_STATES = Object.freeze(['ACTIVE', 'AWAY', 'UNKNOWN']);

const ACTIVITY_TYPES = Object.freeze([
    'click', 'keystroke', 'api_call', 'page_view',
    'order_action', 'config_change'
]);

const AWAY_THRESHOLD_MS = 300000;  // 5 min default

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`operatorPresence: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getPresence: db.prepare(`
        SELECT * FROM ml_operator_presence
        WHERE user_id = ? AND resolved_env = ?
    `),
    upsertPresence: db.prepare(`
        INSERT INTO ml_operator_presence
        (user_id, resolved_env, state, last_activity_at, updated_at, explicit_reason)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            state = excluded.state,
            last_activity_at = excluded.last_activity_at,
            updated_at = excluded.updated_at,
            explicit_reason = excluded.explicit_reason
    `),
    insertActivity: db.prepare(`
        INSERT INTO ml_operator_activity_log
        (user_id, resolved_env, activity_type, source, created_at)
        VALUES (?, ?, ?, ?, ?)
    `),
    listActivity: db.prepare(`
        SELECT * FROM ml_operator_activity_log
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── recordActivity ─────────────────────────────────────────────────
function recordActivity(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const activityType = _required(params, 'activityType');
    const source = (params && params.source) ? params.source : null;

    if (!ACTIVITY_TYPES.includes(activityType)) {
        throw new Error(`operatorPresence: invalid activityType "${activityType}"`);
    }

    const now = Date.now();
    _stmts.upsertPresence.run(
        userId, env, 'ACTIVE', now, now, null
    );
    _stmts.insertActivity.run(
        userId, env, activityType, source, now
    );

    return { recorded: true };
}

// ── getPresence ────────────────────────────────────────────────────
function getPresence(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const awayThresholdMs = (params && typeof params.awayThresholdMs === 'number')
        ? params.awayThresholdMs : AWAY_THRESHOLD_MS;

    const row = _stmts.getPresence.get(userId, env);
    if (!row) {
        return {
            exists: false,
            state: 'UNKNOWN',
            lastSeen: null,
            idleMs: null
        };
    }

    const idleMs = Date.now() - row.last_activity_at;

    // Explicit AWAY overrides idle check
    if (row.state === 'AWAY') {
        return {
            exists: true,
            state: 'AWAY',
            lastSeen: row.last_activity_at,
            idleMs,
            explicit: true,
            reason: row.explicit_reason
        };
    }

    // Idle-based: if last activity > threshold, AWAY
    const state = idleMs >= awayThresholdMs ? 'AWAY' : 'ACTIVE';

    return {
        exists: true,
        state,
        lastSeen: row.last_activity_at,
        idleMs,
        explicit: false
    };
}

// ── markAway ───────────────────────────────────────────────────────
function markAway(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');
    void actor;

    const now = Date.now();
    const existing = _stmts.getPresence.get(userId, env);
    const lastActivity = existing ? existing.last_activity_at : now;
    _stmts.upsertPresence.run(
        userId, env, 'AWAY', lastActivity, now, reason
    );

    return { markedAway: true };
}

// ── markBack ───────────────────────────────────────────────────────
function markBack(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const actor = _required(params, 'actor');
    void actor;

    const now = Date.now();
    _stmts.upsertPresence.run(
        userId, env, 'ACTIVE', now, now, null
    );

    return { markedBack: true };
}

// ── getActivityHistory ─────────────────────────────────────────────
function getActivityHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listActivity.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );

    return rows.map(r => ({
        id: r.id,
        activityType: r.activity_type,
        source: r.source,
        createdAt: r.created_at
    }));
}

module.exports = {
    PRESENCE_STATES,
    ACTIVITY_TYPES,
    AWAY_THRESHOLD_MS,
    recordActivity,
    getPresence,
    markAway,
    markBack,
    getActivityHistory
};
