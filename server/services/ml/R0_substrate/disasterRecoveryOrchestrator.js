'use strict';

/**
 * OMEGA R0 Substrate — disasterRecoveryOrchestrator (§243 chat-precedent)
 *
 * §243 DR — chat-precedent addition (2026-04, BEFORE Claude-extras 04-29).
 * NOT in canonical PDF (which goes 0-241). NOT Claude-extras (those have *).
 *
 * Source: project_ml_brain_pro_244.md "243 → R0 (disaster recovery:
 * VPS = single point of failure pentru live position state, requires
 * DISASTER_RECOVERY.md + off-site DB backup S3/Backblaze hourly +
 * standby host + heartbeat.ts + failover.ts)"
 *
 * Wave 3 scope = orchestration primitives only. Actual S3 upload, VPS
 * provisioning, DNS failover = operator infra config (out of code scope).
 *
 * Provides:
 *   - recordHeartbeat / getHeartbeatStatus — LIVE/STALE/DEAD per node
 *   - recordBackupManifest / listRecentBackups — backup tracking
 *   - triggerFailover — state machine (record only; physical swap = ops)
 *   - runDrDrill — measure RTO via drill simulation
 *   - getRecoveryReadiness — composite RPO + RTO + heartbeat health
 *
 * Builds on Wave 1C dr.js (snapshot save/load primitives). Adds
 * orchestration layer for full DR workflow.
 */

const { db } = require('../../database');

const RECORD_TYPES = Object.freeze(['HEARTBEAT', 'BACKUP', 'FAILOVER', 'DRILL']);
const ROLES = Object.freeze(['PRIMARY', 'STANDBY']);
const HEARTBEAT_STATES = Object.freeze(['LIVE', 'STALE', 'DEAD']);

// Default thresholds: 60s stale, 300s (5min) dead
const DEFAULT_STALE_THRESHOLD_MS = 60_000;
const DEFAULT_DEAD_THRESHOLD_MS = 300_000;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`disasterRecoveryOrchestrator: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertHeartbeat: db.prepare(`
        INSERT INTO ml_dr_state
        (record_type, node_id, role, state, payload_json, actor, created_at)
        VALUES ('HEARTBEAT', ?, ?, 'LIVE', ?, ?, ?)
    `),
    latestHeartbeat: db.prepare(`
        SELECT * FROM ml_dr_state
        WHERE record_type = 'HEARTBEAT' AND node_id = ?
        ORDER BY created_at DESC
        LIMIT 1
    `),
    insertBackup: db.prepare(`
        INSERT INTO ml_dr_state
        (record_type, payload_json, actor, created_at, expires_at)
        VALUES ('BACKUP', ?, ?, ?, ?)
    `),
    listBackups: db.prepare(`
        SELECT * FROM ml_dr_state
        WHERE record_type = 'BACKUP'
        ORDER BY created_at DESC
        LIMIT ?
    `),
    latestBackup: db.prepare(`
        SELECT * FROM ml_dr_state
        WHERE record_type = 'BACKUP'
        ORDER BY created_at DESC
        LIMIT 1
    `),
    insertFailover: db.prepare(`
        INSERT INTO ml_dr_state
        (record_type, node_id, role, state, payload_json, actor, created_at)
        VALUES ('FAILOVER', ?, ?, 'EXECUTING', ?, ?, ?)
    `),
    insertDrill: db.prepare(`
        INSERT INTO ml_dr_state
        (record_type, state, payload_json, actor, created_at)
        VALUES ('DRILL', 'COMPLETED', ?, ?, ?)
    `),
    latestDrill: db.prepare(`
        SELECT * FROM ml_dr_state
        WHERE record_type = 'DRILL'
        ORDER BY created_at DESC
        LIMIT 1
    `)
};

// ── recordHeartbeat ────────────────────────────────────────────────
function recordHeartbeat(params) {
    const nodeId = _required(params, 'nodeId');
    const role = _required(params, 'role');
    const actor = params.actor || nodeId;

    if (!ROLES.includes(role)) {
        throw new Error(`recordHeartbeat: invalid role "${role}" (expected ${ROLES.join('|')})`);
    }
    const payload = JSON.stringify({
        timestamp: Date.now(),
        node_id: nodeId,
        role
    });
    const result = _stmts.insertHeartbeat.run(nodeId, role, payload, actor, Date.now());
    return { id: result.lastInsertRowid };
}

// ── getHeartbeatStatus ─────────────────────────────────────────────
function getHeartbeatStatus(params) {
    const nodeId = _required(params, 'nodeId');
    const staleMs = params.staleThresholdMs || DEFAULT_STALE_THRESHOLD_MS;
    const deadMs = params.deadThresholdMs || DEFAULT_DEAD_THRESHOLD_MS;

    const latest = _stmts.latestHeartbeat.get(nodeId);
    if (!latest) {
        return {
            nodeId,
            state: 'DEAD',
            last_heartbeat_at: null,
            age_ms: null,
            reason: 'no heartbeat record'
        };
    }
    const ageMs = Date.now() - latest.created_at;
    let state = 'LIVE';
    if (ageMs > deadMs) state = 'DEAD';
    else if (ageMs > staleMs) state = 'STALE';

    return {
        nodeId,
        state,
        last_heartbeat_at: latest.created_at,
        age_ms: ageMs,
        role: latest.role
    };
}

// ── recordBackupManifest ───────────────────────────────────────────
function recordBackupManifest(params) {
    const label = _required(params, 'label');
    const hash = _required(params, 'hash');
    const sizeBytes = _required(params, 'sizeBytes');
    const targetUrl = _required(params, 'targetUrl');
    const expiresAt = _required(params, 'expiresAt');
    const actor = params.actor || 'system';

    const payload = JSON.stringify({
        label, hash, size_bytes: sizeBytes, target_url: targetUrl
    });
    const result = _stmts.insertBackup.run(payload, actor, Date.now(), expiresAt);
    return { id: result.lastInsertRowid };
}

// ── listRecentBackups ──────────────────────────────────────────────
function listRecentBackups(params = {}) {
    const limit = Math.max(1, Math.min(500, params.limit || 50));
    return _stmts.listBackups.all(limit);
}

// ── triggerFailover ────────────────────────────────────────────────
// Record only — physical swap (DNS, load balancer) = operator/infra task.
function triggerFailover(params) {
    const primaryNodeId = _required(params, 'primaryNodeId');
    const standbyNodeId = _required(params, 'standbyNodeId');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');

    const payload = JSON.stringify({
        primary_node_id: primaryNodeId,
        standby_node_id: standbyNodeId,
        reason,
        triggered_at: Date.now()
    });
    const result = _stmts.insertFailover.run(
        primaryNodeId, 'PRIMARY', payload, actor, Date.now()
    );
    return { id: result.lastInsertRowid };
}

// ── runDrDrill ─────────────────────────────────────────────────────
// Simulate recovery without actually swapping; record RTO (recovery
// time objective) so we know how long real recovery would take.
function runDrDrill(params) {
    const drillPlan = _required(params, 'drillPlan');
    const actor = params.actor || 'drill_runner';

    const start = Date.now();
    // Simulated drill steps — in production this would actually load
    // the latest backup into a sandbox DB, verify integrity, etc.
    // For Wave 3 skeleton: just measure code path latency.
    const latest = _stmts.latestBackup.get();
    const integrityOk = latest !== undefined;
    const rtoMs = Date.now() - start;

    const payload = JSON.stringify({
        drill_plan: drillPlan,
        rto_ms: rtoMs,
        integrity_ok: integrityOk,
        latest_backup_id: latest ? latest.id : null
    });
    const result = _stmts.insertDrill.run(payload, actor, Date.now());
    return { id: result.lastInsertRowid, rto_ms: rtoMs, integrity_ok: integrityOk };
}

// ── getRecoveryReadiness ───────────────────────────────────────────
function getRecoveryReadiness(params = {}) {
    const primaryNodeId = params.primaryNodeId || null;
    const now = Date.now();

    const latestBackup = _stmts.latestBackup.get();
    const rpo = {
        last_backup_at: latestBackup ? latestBackup.created_at : null,
        age_ms: latestBackup ? (now - latestBackup.created_at) : null
    };

    const latestDrill = _stmts.latestDrill.get();
    const rto = {
        last_drill_at: latestDrill ? latestDrill.created_at : null,
        latest_rto_ms: null
    };
    if (latestDrill) {
        try {
            const p = JSON.parse(latestDrill.payload_json);
            rto.latest_rto_ms = p.rto_ms || null;
        } catch (_) { /* defensive */ }
    }

    const heartbeat_health = primaryNodeId
        ? getHeartbeatStatus({ nodeId: primaryNodeId })
        : { nodeId: null, state: 'UNKNOWN', last_heartbeat_at: null, age_ms: null };

    return { rpo, rto, heartbeat_health };
}

module.exports = {
    RECORD_TYPES,
    ROLES,
    HEARTBEAT_STATES,
    DEFAULT_STALE_THRESHOLD_MS,
    DEFAULT_DEAD_THRESHOLD_MS,
    recordHeartbeat,
    getHeartbeatStatus,
    recordBackupManifest,
    listRecentBackups,
    triggerFailover,
    runDrDrill,
    getRecoveryReadiness
};
