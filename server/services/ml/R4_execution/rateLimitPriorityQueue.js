'use strict';

/**
 * OMEGA R4 Execution — rateLimitPriorityQueue (audit-gap EXEC-N3)
 *
 * EXEC-N3 API RATE-LIMIT MESSAGE PRIORITY QUEUE.
 * Source: audit 2026-05-05 (project_ml_v3_additional_gaps_audit_2026-05-05.md)
 * Priority: P2 (R4 execution) — LAST audit gap.
 *
 * Budget-constrained environments need priority routing:
 *   CRITICAL → force_exit, panic actions
 *   HIGH     → SL/TP modifications, place_order
 *   NORMAL   → cancel, modify
 *   LOW      → status_check, balance_check (informational)
 *
 * When budget exhausted: drop LOW first, keep CRITICAL.
 * Expiration: drop requests past deadline.
 */

const { db } = require('../../database');

const PRIORITY_LEVELS = Object.freeze(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);
const QUEUE_STATUSES = Object.freeze(['PENDING', 'SENT', 'EXPIRED', 'DROPPED']);

const REQUEST_TYPES = Object.freeze([
    'place_order', 'cancel_order', 'modify_order',
    'set_sl', 'set_tp', 'force_exit',
    'status_check', 'balance_check',
    'get_position', 'get_orders'
]);

const REQUEST_PRIORITY_MAP = Object.freeze({
    force_exit:     'CRITICAL',
    set_sl:         'HIGH',
    set_tp:         'HIGH',
    place_order:    'HIGH',
    cancel_order:   'NORMAL',
    modify_order:   'NORMAL',
    get_position:   'NORMAL',
    get_orders:     'NORMAL',
    status_check:   'LOW',
    balance_check:  'LOW'
});

const PRIORITY_SCORES = Object.freeze({
    CRITICAL: 1000,
    HIGH:     500,
    NORMAL:   100,
    LOW:      10
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`rateLimitPriorityQueue: missing ${key}`);
    }
    return params[key];
}

// ── getRequestPriority (pure) ──────────────────────────────────────
function getRequestPriority(params) {
    const requestType = _required(params, 'requestType');
    const priority = REQUEST_PRIORITY_MAP[requestType] || 'NORMAL';
    return {
        priority,
        priorityScore: PRIORITY_SCORES[priority]
    };
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertRequest: db.prepare(`
        INSERT INTO ml_api_request_queue
        (user_id, resolved_env, exchange, request_type, priority,
         payload_json, status, deadline_at, enqueued_at)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `),
    selectNext: db.prepare(`
        SELECT * FROM ml_api_request_queue
        WHERE user_id = ? AND resolved_env = ? AND exchange = ?
          AND status = 'PENDING'
        ORDER BY
            CASE priority
                WHEN 'CRITICAL' THEN 4
                WHEN 'HIGH' THEN 3
                WHEN 'NORMAL' THEN 2
                WHEN 'LOW' THEN 1
            END DESC,
            enqueued_at ASC, id ASC
        LIMIT 1
    `),
    markSent: db.prepare(`
        UPDATE ml_api_request_queue
        SET status = 'SENT', processed_at = ?
        WHERE id = ?
    `),
    expireOld: db.prepare(`
        UPDATE ml_api_request_queue
        SET status = 'EXPIRED', processed_at = ?
        WHERE user_id = ? AND resolved_env = ? AND exchange = ?
          AND status = 'PENDING'
          AND deadline_at IS NOT NULL
          AND deadline_at < ?
    `),
    statsByPriority: db.prepare(`
        SELECT priority, COUNT(*) AS count FROM ml_api_request_queue
        WHERE user_id = ? AND resolved_env = ? AND exchange = ?
          AND status = 'PENDING'
        GROUP BY priority
    `)
};

// ── enqueueRequest ─────────────────────────────────────────────────
function enqueueRequest(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');
    const requestType = _required(params, 'requestType');
    const payload = _required(params, 'payload');
    const explicitPriority = (params && params.priority) ? params.priority : null;
    const deadlineMs = (params && typeof params.deadlineMs === 'number')
        ? params.deadlineMs : null;

    const priority = explicitPriority
        || REQUEST_PRIORITY_MAP[requestType]
        || 'NORMAL';

    if (!PRIORITY_LEVELS.includes(priority)) {
        throw new Error(`rateLimitPriorityQueue: invalid priority "${priority}"`);
    }

    const result = _stmts.insertRequest.run(
        userId, env, exchange, requestType, priority,
        JSON.stringify(payload),
        deadlineMs,
        Date.now()
    );

    return { id: result.lastInsertRowid, priority };
}

// ── dequeueNext ────────────────────────────────────────────────────
function dequeueNext(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');
    const currentBudgetRemaining = _required(params, 'currentBudgetRemaining');

    if (currentBudgetRemaining <= 0) {
        return { request: null, reason: 'budget_exhausted' };
    }

    const row = _stmts.selectNext.get(userId, env, exchange);
    if (!row) {
        return { request: null, reason: 'queue_empty' };
    }

    _stmts.markSent.run(Date.now(), row.id);

    return {
        request: {
            id: row.id,
            requestType: row.request_type,
            priority: row.priority,
            payload: JSON.parse(row.payload_json)
        }
    };
}

// ── dropExpiredRequests ────────────────────────────────────────────
function dropExpiredRequests(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');

    const result = _stmts.expireOld.run(
        Date.now(), userId, env, exchange, Date.now()
    );

    return { droppedCount: result.changes };
}

// ── getQueueStats ──────────────────────────────────────────────────
function getQueueStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');

    const rows = _stmts.statsByPriority.all(userId, env, exchange);

    const byPriority = { CRITICAL: 0, HIGH: 0, NORMAL: 0, LOW: 0 };
    let totalPending = 0;
    for (const row of rows) {
        byPriority[row.priority] = row.count;
        totalPending += row.count;
    }

    return { totalPending, byPriority };
}

module.exports = {
    PRIORITY_LEVELS,
    QUEUE_STATUSES,
    REQUEST_TYPES,
    REQUEST_PRIORITY_MAP,
    PRIORITY_SCORES,
    getRequestPriority,
    enqueueRequest,
    dequeueNext,
    dropExpiredRequests,
    getQueueStats
};
