'use strict';

/**
 * OMEGA R0 Substrate — deadMansSwitch (canonical §63)
 *
 * §63 DEAD MAN'S SWITCH — proces complet extern, complet separat.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1735-1736.
 *
 * "Nu e modul de siguranta. E siguranta de rezerva a modului de siguranta."
 *
 * External independent process receives heartbeat from bot every N seconds.
 * If heartbeat disappears (OOM / hardware failure / network partition /
 * kernel panic), watchdog executes emergency:
 *   - close positions
 *   - cancel orders
 *   - send alert
 *
 * Scope Wave 3: server-side primitives = heartbeat emit + state tracking +
 * emergency ledger. External watchdog deployment (separate machine + cron
 * + emergency exec scripts) = ops-level work, post-ML.
 *
 * State machine: HEALTHY → STALE → DEAD. DEAD blocks further heartbeats
 * until manual reset (cannot self-recover).
 */

const { db } = require('../../database');

const HEARTBEAT_STATUSES = Object.freeze(['HEALTHY', 'STALE', 'DEAD']);
const EMERGENCY_REASONS = Object.freeze(['heartbeat_dead', 'manual', 'external_watchdog']);

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;   // 30s
const DEFAULT_STALENESS_MS = 60000;            // 1 min
const DEFAULT_DEAD_MS = 300000;                // 5 min

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`deadMansSwitch: missing ${key}`);
    }
    return params[key];
}

function _statusFromStaleness(elapsed, stalenessMs, deadMs) {
    if (elapsed >= deadMs) return 'DEAD';
    if (elapsed >= stalenessMs) return 'STALE';
    return 'HEALTHY';
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getState: db.prepare(`
        SELECT * FROM ml_heartbeat_state
        WHERE user_id = ? AND resolved_env = ?
    `),
    upsertState: db.prepare(`
        INSERT INTO ml_heartbeat_state
        (user_id, resolved_env, last_heartbeat_ts,
         expected_interval_ms, staleness_threshold_ms, dead_threshold_ms,
         status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'HEALTHY', ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            expected_interval_ms = excluded.expected_interval_ms,
            staleness_threshold_ms = excluded.staleness_threshold_ms,
            dead_threshold_ms = excluded.dead_threshold_ms,
            updated_at = excluded.updated_at
    `),
    updateHeartbeat: db.prepare(`
        UPDATE ml_heartbeat_state
        SET last_heartbeat_ts = ?, status = 'HEALTHY', updated_at = ?
        WHERE user_id = ? AND resolved_env = ? AND status != 'DEAD'
    `),
    updateStatus: db.prepare(`
        UPDATE ml_heartbeat_state
        SET status = ?, last_check_ts = ?, updated_at = ?
        WHERE user_id = ? AND resolved_env = ?
    `),
    insertEmergency: db.prepare(`
        INSERT INTO ml_dead_man_emergencies
        (user_id, resolved_env, trigger_reason, ts)
        VALUES (?, ?, ?, ?)
    `),
    updateEmergencyOutcome: db.prepare(`
        UPDATE ml_dead_man_emergencies
        SET positions_closed_count = ?, orders_cancelled_count = ?,
            alert_sent = ?, completed_at = ?
        WHERE id = ?
    `),
    historyForUser: db.prepare(`
        SELECT * FROM ml_dead_man_emergencies
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── configureThresholds ────────────────────────────────────────────
function configureThresholds(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const intervalMs = (params && params.expectedIntervalMs)
        ? params.expectedIntervalMs : DEFAULT_HEARTBEAT_INTERVAL_MS;
    const stalenessMs = (params && params.stalenessMs)
        ? params.stalenessMs : DEFAULT_STALENESS_MS;
    const deadMs = (params && params.deadMs)
        ? params.deadMs : DEFAULT_DEAD_MS;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!(deadMs > stalenessMs && stalenessMs > intervalMs)) {
        throw new Error(
            'deadMansSwitch: thresholds must satisfy deadMs > stalenessMs > intervalMs'
        );
    }

    _stmts.upsertState.run(
        userId, env, ts, intervalMs, stalenessMs, deadMs, ts
    );

    return {
        configured: true,
        expectedIntervalMs: intervalMs,
        stalenessThresholdMs: stalenessMs,
        deadThresholdMs: deadMs
    };
}

// ── emitHeartbeat ──────────────────────────────────────────────────
function emitHeartbeat(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const current = _stmts.getState.get(userId, env);
    if (!current) {
        // Auto-init with defaults
        configureThresholds({ userId, resolvedEnv: env, ts });
        return { emitted: true, status: 'HEALTHY' };
    }

    if (current.status === 'DEAD') {
        return {
            emitted: false,
            status: 'DEAD',
            reason: 'dead_state_blocks_heartbeat_requires_manual_reset'
        };
    }

    const result = _stmts.updateHeartbeat.run(ts, ts, userId, env);
    return {
        emitted: result.changes > 0,
        status: 'HEALTHY'
    };
}

// ── checkHeartbeatStaleness ────────────────────────────────────────
function checkHeartbeatStaleness(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const now = (params && params.now) ? params.now : Date.now();

    const current = _stmts.getState.get(userId, env);
    if (!current) {
        return { status: 'HEALTHY', exists: false };
    }

    const elapsed = now - current.last_heartbeat_ts;
    const newStatus = current.status === 'DEAD'
        ? 'DEAD'  // sticky
        : _statusFromStaleness(elapsed, current.staleness_threshold_ms, current.dead_threshold_ms);

    if (newStatus !== current.status) {
        _stmts.updateStatus.run(newStatus, now, now, userId, env);
    }

    return {
        status: newStatus,
        elapsedMs: elapsed,
        lastHeartbeatTs: current.last_heartbeat_ts,
        exists: true
    };
}

// ── triggerEmergency ───────────────────────────────────────────────
function triggerEmergency(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!EMERGENCY_REASONS.includes(reason)) {
        throw new Error(`deadMansSwitch: invalid reason "${reason}"`);
    }

    const result = _stmts.insertEmergency.run(userId, env, reason, ts);

    // Move state to DEAD when triggered via heartbeat path.
    if (reason === 'heartbeat_dead' || reason === 'external_watchdog') {
        _stmts.updateStatus.run('DEAD', ts, ts, userId, env);
    }

    const positions = (params && params.positions) ? params.positions : [];
    const orders = (params && params.orders) ? params.orders : [];

    return {
        emergencyId: result.lastInsertRowid,
        reason,
        actionPlan: {
            positionsToClose: positions.map(p => p.id || p),
            ordersToCancel: orders.map(o => o.id || o),
            alertRequired: true
        }
    };
}

// ── recordEmergencyOutcome ─────────────────────────────────────────
function recordEmergencyOutcome(params) {
    const emergencyId = _required(params, 'emergencyId');
    const positionsClosedCount = _required(params, 'positionsClosedCount');
    const ordersCancelledCount = _required(params, 'ordersCancelledCount');
    const alertSent = !!params.alertSent;
    const completedAt = (params && params.completedAt) ? params.completedAt : Date.now();

    const result = _stmts.updateEmergencyOutcome.run(
        positionsClosedCount, ordersCancelledCount,
        alertSent ? 1 : 0, completedAt, emergencyId
    );

    return { recorded: result.changes > 0 };
}

// ── getHeartbeatStatus ─────────────────────────────────────────────
function getHeartbeatStatus(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const row = _stmts.getState.get(userId, env);
    if (!row) {
        return { exists: false, status: 'HEALTHY' };
    }
    return {
        exists: true,
        status: row.status,
        lastHeartbeatTs: row.last_heartbeat_ts,
        expectedIntervalMs: row.expected_interval_ms,
        stalenessThresholdMs: row.staleness_threshold_ms,
        deadThresholdMs: row.dead_threshold_ms,
        lastCheckTs: row.last_check_ts
    };
}

// ── getEmergencyHistory ────────────────────────────────────────────
function getEmergencyHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    return _stmts.historyForUser.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );
}

// ── isDeadManTriggered — external watchdog quick check ─────────────
function isDeadManTriggered(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const now = (params && params.now) ? params.now : Date.now();

    const r = checkHeartbeatStaleness({ userId, resolvedEnv: env, now });
    return { triggered: r.status === 'DEAD', status: r.status };
}

module.exports = {
    HEARTBEAT_STATUSES,
    EMERGENCY_REASONS,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    DEFAULT_STALENESS_MS,
    DEFAULT_DEAD_MS,
    configureThresholds,
    emitHeartbeat,
    checkHeartbeatStaleness,
    triggerEmergency,
    recordEmergencyOutcome,
    getHeartbeatStatus,
    getEmergencyHistory,
    isDeadManTriggered
};
