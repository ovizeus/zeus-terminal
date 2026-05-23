'use strict';

/**
 * OMEGA R0 Substrate — dbContentionMonitor (expert-obs OBS-6)
 *
 * OBS-6 MULTI-USER CONCURRENT STRESS TEST.
 * Source: project_ml_v3_expert_observations_2026-05-05.md
 * Priority: P1 — HIGH at scale (SQLite contention).
 *
 * Track per-operation duration + lock wait time. Detect contention
 * patterns (sustained slow ops, high lock waits).
 */

const { db } = require('../../database');

const OPERATION_TYPES = Object.freeze([
    'read', 'write', 'transaction', 'migration', 'index_rebuild'
]);

const CONTENTION_THRESHOLDS = Object.freeze({
    slow_op_ms:           100,
    high_lock_wait_ms:    50,
    contention_density:   0.7   // ≥70% slow ops in window
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`dbContentionMonitor: missing ${key}`);
    }
    return params[key];
}

function _clampUnit(x) {
    return Math.max(0, Math.min(1, x));
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertOperation: db.prepare(`
        INSERT INTO ml_db_contention_log
        (user_id, resolved_env, operation, duration_ms, lock_wait_ms, error_msg, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    statsByOp: db.prepare(`
        SELECT
            COUNT(*) AS total_ops,
            AVG(duration_ms) AS avg_duration,
            MAX(duration_ms) AS max_duration,
            MIN(duration_ms) AS min_duration,
            AVG(COALESCE(lock_wait_ms, 0)) AS avg_lock_wait
        FROM ml_db_contention_log
        WHERE user_id = ? AND resolved_env = ?
          AND (? IS NULL OR operation = ?)
          AND (? = 0 OR created_at >= ?)
    `),
    listLongOps: db.prepare(`
        SELECT * FROM ml_db_contention_log
        WHERE user_id = ? AND resolved_env = ?
          AND duration_ms >= ?
          AND (? = 0 OR created_at >= ?)
        ORDER BY duration_ms DESC, id DESC
        LIMIT ?
    `)
};

// ── recordOperation ────────────────────────────────────────────────
function recordOperation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const operation = _required(params, 'operation');
    const durationMs = _required(params, 'durationMs');
    const lockWaitMs = (params && typeof params.lockWaitMs === 'number')
        ? params.lockWaitMs : null;
    const errorMsg = (params && params.errorMsg) ? params.errorMsg : null;

    _stmts.insertOperation.run(
        userId, env, operation, durationMs, lockWaitMs, errorMsg, Date.now()
    );

    return { recorded: true };
}

// ── detectContention (pure) ────────────────────────────────────────
function detectContention(params) {
    const recentOps = (params && Array.isArray(params.recentOps)) ? params.recentOps : [];
    const thresholds = (params && params.thresholds) ? params.thresholds : CONTENTION_THRESHOLDS;

    if (recentOps.length === 0) {
        return { contentionDetected: false, severity: 0 };
    }

    let slowOps = 0;
    let highLockWaits = 0;
    let totalLockWait = 0;
    for (const op of recentOps) {
        if (op.durationMs >= thresholds.slow_op_ms) slowOps++;
        const lockWait = op.lockWaitMs || 0;
        if (lockWait >= thresholds.high_lock_wait_ms) highLockWaits++;
        totalLockWait += lockWait;
    }

    const slowDensity = slowOps / recentOps.length;
    const lockWaitDensity = highLockWaits / recentOps.length;
    const severity = _clampUnit(slowDensity * 0.4 + lockWaitDensity * 0.6);

    const contentionDetected = slowDensity >= thresholds.contention_density
        || lockWaitDensity >= 0.3
        || severity >= 0.5;

    return {
        contentionDetected,
        severity,
        slowDensity,
        lockWaitDensity,
        avgLockWaitMs: recentOps.length > 0 ? totalLockWait / recentOps.length : 0
    };
}

// ── getContentionStats ─────────────────────────────────────────────
function getContentionStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const operation = (params && params.operation) ? params.operation : null;
    const since = (params && params.since) ? params.since : 0;

    const row = _stmts.statsByOp.get(
        userId, env, operation, operation,
        since > 0 ? 1 : 0, since
    );

    return {
        totalOps: row.total_ops || 0,
        avgDurationMs: row.avg_duration || 0,
        maxDurationMs: row.max_duration || 0,
        minDurationMs: row.min_duration || 0,
        avgLockWaitMs: row.avg_lock_wait || 0
    };
}

// ── getLongOperations ──────────────────────────────────────────────
function getLongOperations(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const thresholdMs = (params && typeof params.thresholdMs === 'number')
        ? params.thresholdMs : CONTENTION_THRESHOLDS.slow_op_ms;
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listLongOps.all(
        userId, env, thresholdMs,
        since > 0 ? 1 : 0, since,
        limit
    );

    return rows.map(r => ({
        id: r.id,
        operation: r.operation,
        durationMs: r.duration_ms,
        lockWaitMs: r.lock_wait_ms,
        errorMsg: r.error_msg,
        createdAt: r.created_at
    }));
}

module.exports = {
    OPERATION_TYPES,
    CONTENTION_THRESHOLDS,
    recordOperation,
    detectContention,
    getContentionStats,
    getLongOperations
};
