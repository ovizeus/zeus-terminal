'use strict';

/**
 * OMEGA Operator Interaction — panicButton (audit-gap OPS-N1)
 *
 * OPS-N1 OPERATOR-GRADE PANIC BUTTON.
 * Source: audit 2026-05-05 (project_ml_v3_additional_gaps_audit_2026-05-05.md)
 * Priority: P1.
 *
 * Hard halt mechanism for operator. Single action triggers:
 *   1. §29 circuitBreaker.setBreakerLevel('L5')   → flatten positions
 *   2. §34 humanInTheLoop.setEmergencyKillSwitch('ON') → block all AT
 *   3. ml_panic_events audit log → ACTIVE state
 *
 * Manual recovery only:
 *   - clearPanic() marks event CLEARED
 *   - DOES NOT auto-reset circuit breaker (operator must explicitly resume)
 *   - DOES NOT auto-clear kill switch (operator must explicitly clear)
 *
 * This enforces "panic is panic — recovery requires deliberate action".
 */

const { db } = require('../../database');
const cb = require('../R3A_safety/circuitBreaker');
const hl = require('./humanInTheLoop');

const PANIC_SEVERITY = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const PANIC_STATE = Object.freeze(['ACTIVE', 'CLEARED']);

const PANIC_ACTIONS = Object.freeze([
    'breaker_L5_flatten',
    'kill_switch_ON',
    'audit_logged'
]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`panicButton: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertEvent: db.prepare(`
        INSERT INTO ml_panic_events
        (user_id, resolved_env, severity, reason, actor, state, triggered_at)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)
    `),
    getActive: db.prepare(`
        SELECT * FROM ml_panic_events
        WHERE user_id = ? AND resolved_env = ? AND state = 'ACTIVE'
        ORDER BY triggered_at DESC, id DESC LIMIT 1
    `),
    clearActive: db.prepare(`
        UPDATE ml_panic_events
        SET state = 'CLEARED', cleared_at = ?
        WHERE user_id = ? AND resolved_env = ? AND state = 'ACTIVE'
    `),
    history: db.prepare(`
        SELECT * FROM ml_panic_events
        WHERE user_id = ? AND resolved_env = ?
          AND triggered_at >= ?
        ORDER BY triggered_at DESC, id DESC
        LIMIT ?
    `)
};

// ── triggerPanic ───────────────────────────────────────────────────
function triggerPanic(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const actor = _required(params, 'actor');
    const reason = _required(params, 'reason');
    const severity = (params && params.severity) ? params.severity : 'CRITICAL';

    if (!PANIC_SEVERITY.includes(severity)) {
        throw new Error(`panicButton: invalid severity "${severity}"`);
    }

    const now = Date.now();
    const result = _stmts.insertEvent.run(
        userId, env, severity, reason, actor, now
    );

    // Action 1: trigger §29 circuit breaker → L5 flatten
    cb.setBreakerLevel({
        userId, resolvedEnv: env,
        level: 'L5', reason: `panic:${reason}`, actor: `panic:${actor}`
    });

    // Action 2: trigger §34 emergency kill switch → ON
    hl.setEmergencyKillSwitch({
        userId, resolvedEnv: env,
        state: 'ON', reason: `panic:${reason}`, actor: `panic:${actor}`
    });

    return {
        triggered: true,
        panicId: result.lastInsertRowid,
        severity,
        actions: PANIC_ACTIONS
    };
}

// ── getActivePanic ─────────────────────────────────────────────────
function getActivePanic(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const row = _stmts.getActive.get(userId, env);
    if (!row) return null;
    return {
        id: row.id,
        severity: row.severity,
        reason: row.reason,
        actor: row.actor,
        state: row.state,
        triggeredAt: row.triggered_at
    };
}

// ── clearPanic ─────────────────────────────────────────────────────
function clearPanic(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const actor = _required(params, 'actor');
    const reason = _required(params, 'reason');

    const result = _stmts.clearActive.run(Date.now(), userId, env);
    void actor; void reason;

    // INVARIANT: clearing does NOT auto-reset breaker or kill switch.
    // Operator must explicitly resume via §29 attemptAutoResume / §34 kill switch OFF.

    return {
        cleared: result.changes > 0,
        clearedCount: result.changes
    };
}

// ── getPanicHistory ────────────────────────────────────────────────
function getPanicHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.history.all(userId, env, since, limit);
    return rows.map(r => ({
        id: r.id,
        severity: r.severity,
        reason: r.reason,
        actor: r.actor,
        state: r.state,
        triggeredAt: r.triggered_at,
        clearedAt: r.cleared_at
    }));
}

module.exports = {
    PANIC_SEVERITY,
    PANIC_STATE,
    PANIC_ACTIONS,
    triggerPanic,
    getActivePanic,
    clearPanic,
    getPanicHistory
};
