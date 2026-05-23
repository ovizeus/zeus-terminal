'use strict';

/**
 * OMEGA Doctor D-5.2 — Quarantine Manager (Interventional Doctor).
 *
 * Per FAILURE_ONTOLOGY + project_omega_doctor_layer_locked.md:
 *   - clamp_influence: module runs read-only; outputs ignored downstream
 *   - shadow_only: module runs but outputs suppressed (used for forensic)
 *   - disable: module not invoked at all (emergency)
 *
 * Anti-flapping: max 3 quarantine cycles per module per 24h (per Phone Claude
 * proposal cooldown anti-pattern). 4th attempt requires manual operator override
 * via D-5.4 overrideJournal (operator forces, accepts consequences).
 *
 * Emits 'quarantine' events to bus (subscribed by analyzer for state
 * computation + Doctor UI for live display).
 *
 * Hot path impact: lookup-only via prepared statement, <0.1ms.
 */

const { db } = require('../../database');
const eventBus = require('./eventBus');
const moduleRegistry = require('./moduleRegistry');

const ACTIONS = Object.freeze(['clamp_influence', 'shadow_only', 'disable']);
const COOLDOWN_MS = 3600_000;   // 1h between quarantine cycles for same module
const MAX_PER_DAY = 3;          // max 3 cycles/24h before flapping protection

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`quarantineManager: missing required field ${k}`);
    }
    return p[k];
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_module_quarantines
        (module_id, quarantine_action, reason, operator_id, quarantined_at, ts)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    selectActive: db.prepare(`
        SELECT * FROM ml_module_quarantines
        WHERE module_id = ? AND lifted_at IS NULL
        ORDER BY id DESC LIMIT 1
    `),
    lift: db.prepare(`
        UPDATE ml_module_quarantines
        SET lifted_at = ?, lift_reason = ?
        WHERE module_id = ? AND lifted_at IS NULL
    `),
    countCyclesSince: db.prepare(`
        SELECT COUNT(*) AS n FROM ml_module_quarantines
        WHERE module_id = ? AND quarantined_at >= ?
    `),
    listActive: db.prepare(`
        SELECT module_id, quarantine_action, reason, operator_id,
               quarantined_at
        FROM ml_module_quarantines
        WHERE lifted_at IS NULL
        ORDER BY quarantined_at DESC
    `)
};

function quarantine(params) {
    const moduleId = _required(params, 'moduleId');
    const action = _required(params, 'action');
    const reason = _required(params, 'reason');
    const ts = _required(params, 'ts');
    const operatorId = params.operatorId ?? null;

    if (!ACTIONS.includes(action)) {
        throw new Error(`quarantineManager: invalid action '${action}'`);
    }

    // Cannot re-quarantine if already active.
    const existing = _stmts.selectActive.get(moduleId);
    if (existing) {
        throw new Error(`quarantineManager: ${moduleId} already has active quarantine (action=${existing.quarantine_action})`);
    }

    // Flapping protection: max MAX_PER_DAY cycles in last 24h.
    const cycles = _stmts.countCyclesSince.get(moduleId, ts - 86400_000).n;
    if (cycles >= MAX_PER_DAY) {
        throw new Error(`quarantineManager: ${moduleId} reached max ${MAX_PER_DAY} quarantines/24h — manual operator override required`);
    }

    _stmts.insert.run(moduleId, action, reason, operatorId, ts, ts);
    eventBus.emit({
        eventType: 'quarantine',
        moduleId,
        severity: 'P1',
        payload: { action: 'apply', quarantineAction: action, reason, operatorId },
        ts
    });

    return { quarantined: true, moduleId, action };
}

function lift(params) {
    const moduleId = _required(params, 'moduleId');
    const liftReason = _required(params, 'liftReason');
    const ts = _required(params, 'ts');

    const existing = _stmts.selectActive.get(moduleId);
    if (!existing) {
        throw new Error(`quarantineManager: no active quarantine for ${moduleId}`);
    }

    _stmts.lift.run(ts, liftReason, moduleId);
    eventBus.emit({
        eventType: 'quarantine',
        moduleId,
        severity: 'P3',
        payload: { action: 'lift', liftReason, priorAction: existing.quarantine_action },
        ts
    });

    return { lifted: true, moduleId };
}

function isQuarantined(params) {
    const moduleId = _required(params, 'moduleId');
    const row = _stmts.selectActive.get(moduleId);
    if (!row) return { quarantined: false };
    return {
        quarantined: true,
        action: row.quarantine_action,
        reason: row.reason,
        quarantinedAt: row.quarantined_at,
        operatorId: row.operator_id
    };
}

function getActiveQuarantines() {
    const rows = _stmts.listActive.all();
    return rows.map(r => ({
        moduleId: r.module_id,
        action: r.quarantine_action,
        reason: r.reason,
        operatorId: r.operator_id,
        quarantinedAt: r.quarantined_at
    }));
}

function getActiveCountsByRole() {
    const counts = {
        hot_path_critical: 0,
        hot_path_assist: 0,
        shadow_assist: 0,
        governance: 0,
        forensic: 0,
        introspection_meta: 0,
        philosophical: 0
    };
    const active = getActiveQuarantines();
    for (const q of active) {
        const m = moduleRegistry.getModule({ moduleId: q.moduleId });
        if (m && counts[m.roleTag] != null) counts[m.roleTag] += 1;
    }
    return counts;
}

function resetForTest() {
    // Stateless module — DB-driven only.
}

module.exports = {
    ACTIONS, COOLDOWN_MS, MAX_PER_DAY,
    quarantine, lift, isQuarantined,
    getActiveQuarantines, getActiveCountsByRole,
    resetForTest
};
