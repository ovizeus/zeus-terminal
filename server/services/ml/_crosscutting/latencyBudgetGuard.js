'use strict';

/**
 * OMEGA Cross-cutting — latencyBudgetGuard (A-Z Raid item L)
 *
 * RAID-L LATENCY BUDGET HARD CAP <100ms.
 * Source: A-Z Raid Wave 1 UX additions MUST-ADD item L.
 *
 * Hard latency caps per task type. Drop messages exceeding budget
 * (no late delivery). Track drop rate + average latency.
 *
 * voice_push: 100ms cap (UX critical)
 * alert: 200ms cap
 * notification: 500ms cap
 * log_emit: 1000ms cap
 */

const { db } = require('../../database');

const TASK_TYPES = Object.freeze([
    'voice_push', 'alert', 'notification', 'log_emit'
]);

const DEFAULT_BUDGET_MS_BY_TASK = Object.freeze({
    voice_push:    100,
    alert:         200,
    notification:  500,
    log_emit:     1000
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`latencyBudgetGuard: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertEvent: db.prepare(`
        INSERT INTO ml_latency_budget_log
        (user_id, resolved_env, task_type, latency_ms, budget_ms,
         accepted, drop_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    statsByTask: db.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN accepted = 0 THEN 1 ELSE 0 END) AS dropped,
               AVG(latency_ms) AS avg_lat
        FROM ml_latency_budget_log
        WHERE user_id = ? AND resolved_env = ?
          AND (? IS NULL OR task_type = ?)
          AND (? = 0 OR created_at >= ?)
    `),
    listDrops: db.prepare(`
        SELECT * FROM ml_latency_budget_log
        WHERE user_id = ? AND resolved_env = ?
          AND accepted = 0
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── enforceBudget (pure) ───────────────────────────────────────────
function enforceBudget(params) {
    const deadline = _required(params, 'deadline');
    const taskType = _required(params, 'taskType');
    const currentTime = (params && typeof params.currentTime === 'number')
        ? params.currentTime : Date.now();

    if (!TASK_TYPES.includes(taskType)) {
        throw new Error(`latencyBudgetGuard: invalid taskType "${taskType}"`);
    }

    const budgetMs = DEFAULT_BUDGET_MS_BY_TASK[taskType];
    const latencyMs = currentTime - (deadline - budgetMs);
    const allowed = currentTime <= deadline;

    return {
        allowed,
        latencyMs,
        budgetMs,
        taskType,
        droppedReason: allowed ? null : 'latency_exceeded'
    };
}

// ── recordBudgetEvent ──────────────────────────────────────────────
function recordBudgetEvent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const taskType = _required(params, 'taskType');
    const latencyMs = _required(params, 'latencyMs');
    const budgetMs = _required(params, 'budgetMs');
    const accepted = _required(params, 'accepted');
    const dropReason = (params && params.dropReason) ? params.dropReason : null;

    _stmts.insertEvent.run(
        userId, env, taskType, latencyMs, budgetMs,
        accepted ? 1 : 0, dropReason, Date.now()
    );

    return { recorded: true };
}

// ── getBudgetStats ─────────────────────────────────────────────────
function getBudgetStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const taskType = (params && params.taskType) ? params.taskType : null;
    const since = (params && params.since) ? params.since : 0;

    const row = _stmts.statsByTask.get(
        userId, env, taskType, taskType,
        since > 0 ? 1 : 0, since
    );

    const total = row.total || 0;
    const dropped = row.dropped || 0;

    return {
        totalEvents: total,
        droppedCount: dropped,
        dropRate: total > 0 ? dropped / total : 0,
        avgLatencyMs: row.avg_lat || 0
    };
}

// ── getRecentDrops ─────────────────────────────────────────────────
function getRecentDrops(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listDrops.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );

    return rows.map(r => ({
        id: r.id,
        taskType: r.task_type,
        latencyMs: r.latency_ms,
        budgetMs: r.budget_ms,
        accepted: r.accepted === 1,
        dropReason: r.drop_reason,
        createdAt: r.created_at
    }));
}

module.exports = {
    TASK_TYPES,
    DEFAULT_BUDGET_MS_BY_TASK,
    enforceBudget,
    recordBudgetEvent,
    getBudgetStats,
    getRecentDrops
};
