'use strict';

/**
 * ML Plan v3 Phase 2 — ring5State helper.
 *
 * Pure DB-bound state-getter/setter per SPEC-1 ModuleState contract:
 *   Composite key: (user_id, resolved_env, symbol, module_id)
 *   Fields: version, last_observed_ts, trust_score, bandit_params_json
 *
 * Atomic upsert via INSERT ON CONFLICT UPDATE — version auto-increments on
 * existing rows, new rows start at version=1.
 *
 * No business logic; pure persistence isolated for testability.
 * Ring5LearningService facade composes this helper with adapter logic.
 */

const { db } = require('../../database');

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`ring5State: missing required field ${k}`);
    }
    return p[k];
}

function _validateEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`ring5State: invalid resolvedEnv '${env}'`);
    }
    return env;
}

function _validateTrustScore(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`ring5State: trustScore must be number in [0,1], got ${v}`);
    }
    return v;
}

const _stmts = {
    select: db.prepare(`
        SELECT id, user_id, resolved_env, symbol, module_id, version,
               last_observed_ts, trust_score, bandit_params_json, updated_at
        FROM ml_module_state
        WHERE user_id = ? AND resolved_env = ? AND symbol = ? AND module_id = ?
    `),
    upsert: db.prepare(`
        INSERT INTO ml_module_state
            (user_id, resolved_env, symbol, module_id, version,
             last_observed_ts, trust_score, bandit_params_json, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, symbol, module_id) DO UPDATE SET
            version = version + 1,
            last_observed_ts = excluded.last_observed_ts,
            trust_score = excluded.trust_score,
            bandit_params_json = excluded.bandit_params_json,
            updated_at = excluded.updated_at
    `)
};

function getModuleState(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const moduleId = _required(params, 'moduleId');
    const row = _stmts.select.get(userId, resolvedEnv, symbol, moduleId);
    if (!row) return null;
    return {
        id: row.id,
        userId: row.user_id,
        resolvedEnv: row.resolved_env,
        symbol: row.symbol,
        moduleId: row.module_id,
        version: row.version,
        lastObservedTs: row.last_observed_ts,
        trustScore: row.trust_score,
        banditParams: JSON.parse(row.bandit_params_json),
        updatedAt: row.updated_at
    };
}

function updateModuleState(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const moduleId = _required(params, 'moduleId');
    const trustScore = _validateTrustScore(_required(params, 'trustScore'));
    const banditParams = _required(params, 'banditParams');
    const lastObservedTs = _required(params, 'lastObservedTs');
    const ts = _required(params, 'ts');

    _stmts.upsert.run(
        userId, resolvedEnv, symbol, moduleId,
        lastObservedTs, trustScore, JSON.stringify(banditParams), ts
    );
    return { updated: true };
}

module.exports = { getModuleState, updateModuleState };
