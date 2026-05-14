'use strict';

/**
 * OMEGA Cross-cutting — Audit Trail
 *
 * Facade over `ml_decision_snapshots` + `ml_decision_light` providing:
 * - `logDecision(...)` — record full TIER 1 snapshot (Cornercase D events)
 * - `logLight(...)` — record NO_TRADE summary (compact, 90-day retention)
 * - `getByDigest(digest)` — retrieve snapshot for replay
 * - `getRecent({userId, resolvedEnv, sinceMs})` — recent decisions
 *
 * Wave 1D scope: foundation interface + DB wiring. Higher-level concerns
 * (retention sweeping, compression, lineage-of-belief graph) layer on top
 * in Wave 7 R6.
 */

const { db } = require('../../database');

function _requireField(obj, key) {
    if (!obj || obj[key] === undefined || obj[key] === null) {
        throw new Error(`auditTrail: missing required field "${key}"`);
    }
    return obj[key];
}

const _stmts = {
    insertSnapshot: db.prepare(`
        INSERT INTO ml_decision_snapshots
        (user_id, resolved_env, symbol, snapshot_event_type, decision_digest,
         snapshot_json, registry_digest, input_snapshot_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertLight: db.prepare(`
        INSERT INTO ml_decision_light
        (user_id, resolved_env, symbol, decision_digest, score,
         top5_features_json, abstain_count, reason_code, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getByDigest: db.prepare(`
        SELECT * FROM ml_decision_snapshots WHERE decision_digest = ? LIMIT 1
    `),
    getRecentSnapshots: db.prepare(`
        SELECT * FROM ml_decision_snapshots
        WHERE user_id = ? AND resolved_env = ? AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 1000
    `)
};

function logDecision(params) {
    const userId = _requireField(params, 'userId');
    const resolvedEnv = _requireField(params, 'resolvedEnv');
    const symbol = _requireField(params, 'symbol');
    const snapshotEventType = _requireField(params, 'snapshotEventType');
    const snapshotJson = _requireField(params, 'snapshotJson');
    const decisionDigest = _requireField(params, 'decisionDigest');
    const registryDigest = _requireField(params, 'registryDigest');
    const inputSnapshotRef = params.inputSnapshotRef || null;
    const result = _stmts.insertSnapshot.run(
        userId, resolvedEnv, symbol, snapshotEventType, decisionDigest,
        snapshotJson, registryDigest, inputSnapshotRef, Date.now()
    );
    return { id: result.lastInsertRowid };
}

function logLight(params) {
    const userId = _requireField(params, 'userId');
    const resolvedEnv = _requireField(params, 'resolvedEnv');
    const symbol = _requireField(params, 'symbol');
    const decisionDigest = _requireField(params, 'decisionDigest');
    const score = params.score ?? null;
    const top5 = params.top5FeaturesJson || null;
    const abstainCount = params.abstainCount || 0;
    const reasonCode = params.reasonCode || null;
    const result = _stmts.insertLight.run(
        userId, resolvedEnv, symbol, decisionDigest, score,
        top5, abstainCount, reasonCode, Date.now()
    );
    return { id: result.lastInsertRowid };
}

function getByDigest(digest) {
    if (typeof digest !== 'string' || digest.length === 0) return null;
    return _stmts.getByDigest.get(digest) || null;
}

function getRecent(params) {
    const userId = _requireField(params, 'userId');
    const resolvedEnv = _requireField(params, 'resolvedEnv');
    const sinceMs = params.sinceMs || 0;
    return _stmts.getRecentSnapshots.all(userId, resolvedEnv, sinceMs);
}

module.exports = {
    logDecision,
    logLight,
    getByDigest,
    getRecent
};
