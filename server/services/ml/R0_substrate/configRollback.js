'use strict';

/**
 * OMEGA R0 Substrate — configRollback (expert-obs OBS-3)
 *
 * OBS-3 CONFIG ROLLBACK <60s.
 * Source: project_ml_v3_expert_observations_2026-05-05.md
 * Priority: P1.
 *
 * Distinct from §19 versionRegistry (model versioning) — this is for
 * runtime configuration parameters (thresholds, flags, settings).
 *
 * Target: rollback duration <60s (TARGET_ROLLBACK_MS).
 *
 * Pattern:
 *   - snapshotConfig() each config change → versioned history
 *   - rollbackConfig() flips is_active flag instantly → no redeploy
 *   - getCurrentConfig() returns latest is_active=1 row
 */

const { db } = require('../../database');

const CONFIG_CATEGORIES = Object.freeze([
    'threshold', 'flag', 'rate_limit', 'timing', 'strategy_param'
]);

const ROLLBACK_REASONS = Object.freeze([
    'bad_deploy',
    'performance_regression',
    'unintended_behavior',
    'manual_revert',
    'incident_response'
]);

const TARGET_ROLLBACK_MS = 60000;  // 60s per spec

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`configRollback: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    deactivateAll: db.prepare(`
        UPDATE ml_config_snapshots SET is_active = 0
        WHERE user_id = ? AND resolved_env = ? AND config_key = ? AND is_active = 1
    `),
    insertSnapshot: db.prepare(`
        INSERT INTO ml_config_snapshots
        (user_id, resolved_env, config_key, value_json, version,
         is_active, actor, reason, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `),
    activateVersion: db.prepare(`
        UPDATE ml_config_snapshots SET is_active = 1
        WHERE user_id = ? AND resolved_env = ? AND config_key = ? AND version = ?
    `),
    getActive: db.prepare(`
        SELECT * FROM ml_config_snapshots
        WHERE user_id = ? AND resolved_env = ?
          AND config_key = ? AND is_active = 1
        LIMIT 1
    `),
    getByVersion: db.prepare(`
        SELECT * FROM ml_config_snapshots
        WHERE user_id = ? AND resolved_env = ?
          AND config_key = ? AND version = ?
    `),
    listVersions: db.prepare(`
        SELECT * FROM ml_config_snapshots
        WHERE user_id = ? AND resolved_env = ? AND config_key = ?
        ORDER BY created_at DESC, id DESC
    `),
    previousVersion: db.prepare(`
        SELECT * FROM ml_config_snapshots
        WHERE user_id = ? AND resolved_env = ? AND config_key = ?
          AND id < (SELECT id FROM ml_config_snapshots
                    WHERE user_id = ? AND resolved_env = ?
                    AND config_key = ? AND is_active = 1)
        ORDER BY id DESC LIMIT 1
    `),
    insertRollback: db.prepare(`
        INSERT INTO ml_config_rollback_log
        (user_id, resolved_env, config_key, from_version, to_version,
         reason, actor, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listRollbacks: db.prepare(`
        SELECT * FROM ml_config_rollback_log
        WHERE user_id = ? AND resolved_env = ?
          AND created_at >= ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── snapshotConfig ─────────────────────────────────────────────────
function snapshotConfig(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const configKey = _required(params, 'configKey');
    const value = _required(params, 'value');
    const version = _required(params, 'version');
    const actor = _required(params, 'actor');
    const reason = (params && params.reason) ? params.reason : null;

    // Deactivate prior active version
    _stmts.deactivateAll.run(userId, env, configKey);

    _stmts.insertSnapshot.run(
        userId, env, configKey,
        JSON.stringify(value),
        version, actor, reason, Date.now()
    );

    return { snapshotted: true, version };
}

// ── getCurrentConfig ───────────────────────────────────────────────
function getCurrentConfig(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const configKey = _required(params, 'configKey');

    const row = _stmts.getActive.get(userId, env, configKey);
    if (!row) return null;

    return {
        value: JSON.parse(row.value_json),
        version: row.version,
        actor: row.actor,
        createdAt: row.created_at
    };
}

// ── rollbackConfig ─────────────────────────────────────────────────
function rollbackConfig(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const configKey = _required(params, 'configKey');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');
    const targetVersion = (params && params.targetVersion) ? params.targetVersion : null;

    const startTime = Date.now();

    // Get current active version
    const current = _stmts.getActive.get(userId, env, configKey);
    const fromVersion = current ? current.version : null;

    let target;
    if (targetVersion) {
        target = _stmts.getByVersion.get(userId, env, configKey, targetVersion);
        if (!target) {
            throw new Error(`configRollback: target version "${targetVersion}" not found`);
        }
    } else {
        // Default: previous version
        target = _stmts.previousVersion.get(
            userId, env, configKey,
            userId, env, configKey
        );
        if (!target) {
            throw new Error(`configRollback: no previous version to rollback to`);
        }
    }

    // Deactivate current, activate target
    _stmts.deactivateAll.run(userId, env, configKey);
    _stmts.activateVersion.run(userId, env, configKey, target.version);

    const durationMs = Date.now() - startTime;

    // Log rollback
    _stmts.insertRollback.run(
        userId, env, configKey,
        fromVersion, target.version,
        reason, actor, durationMs, Date.now()
    );

    return {
        rolledBack: true,
        fromVersion,
        toVersion: target.version,
        durationMs,
        withinTarget: durationMs < TARGET_ROLLBACK_MS
    };
}

// ── getConfigHistory ───────────────────────────────────────────────
function getConfigHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const configKey = _required(params, 'configKey');

    const rows = _stmts.listVersions.all(userId, env, configKey);
    return rows.map(r => ({
        version: r.version,
        value: JSON.parse(r.value_json),
        isActive: r.is_active === 1,
        actor: r.actor,
        reason: r.reason,
        createdAt: r.created_at
    }));
}

// ── getRollbackHistory ─────────────────────────────────────────────
function getRollbackHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listRollbacks.all(userId, env, since, limit);
    return rows.map(r => ({
        id: r.id,
        configKey: r.config_key,
        fromVersion: r.from_version,
        toVersion: r.to_version,
        reason: r.reason,
        actor: r.actor,
        durationMs: r.duration_ms,
        createdAt: r.created_at
    }));
}

module.exports = {
    CONFIG_CATEGORIES,
    ROLLBACK_REASONS,
    TARGET_ROLLBACK_MS,
    snapshotConfig,
    getCurrentConfig,
    rollbackConfig,
    getConfigHistory,
    getRollbackHistory
};
