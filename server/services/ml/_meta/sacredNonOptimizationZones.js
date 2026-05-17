'use strict';

/**
 * OMEGA §200 — SACRED NON-OPTIMIZATION ZONES / THINGS-NOT-TO-BE-IMPROVED.
 * Canonical PDF lines 6419-6466.
 */

const { db } = require('../../database');

const OPTIMIZATION_TIERS = Object.freeze([
    'may_be_optimized',
    'conditional_optimization_only',
    'never_purely_instrumental'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§200 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§200 invalid env: ${env}`);
    return env;
}

function allowsOptimization(params) {
    const tier = _required(params, 'optimizationTier');
    if (!OPTIMIZATION_TIERS.includes(tier)) {
        throw new Error(`§200 invalid tier: ${tier}`);
    }
    if (tier === 'may_be_optimized') return { allowed: 'yes' };
    if (tier === 'conditional_optimization_only') return { allowed: 'requires_review' };
    return { allowed: 'no' };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_sacred_non_optimization_registry (
            user_id, resolved_env, entry_id, protected_quantity_label,
            optimization_tier, reasoning, active, registered_at, ts
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_sacred_non_optimization_registry WHERE entry_id = ?`),
    selectActive: db.prepare(`
        SELECT id, entry_id AS entryId,
               protected_quantity_label AS protectedQuantityLabel,
               optimization_tier AS optimizationTier,
               reasoning, active, registered_at AS registeredAt, ts
        FROM ml_sacred_non_optimization_registry
        WHERE user_id = ? AND resolved_env = ? AND active = 1
        ORDER BY registered_at ASC
    `),
    selectByTier: db.prepare(`
        SELECT id, entry_id AS entryId,
               protected_quantity_label AS protectedQuantityLabel,
               optimization_tier AS optimizationTier,
               reasoning, active, registered_at AS registeredAt, ts
        FROM ml_sacred_non_optimization_registry
        WHERE user_id = ? AND resolved_env = ? AND optimization_tier = ? AND active = 1
        ORDER BY registered_at ASC
    `),
    deactivate: db.prepare(`
        UPDATE ml_sacred_non_optimization_registry SET active = 0
        WHERE user_id = ? AND resolved_env = ? AND entry_id = ?
    `)
};

function registerProtectedQuantity(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const entryId = _required(params, 'entryId');
    const protectedQuantityLabel = _required(params, 'protectedQuantityLabel');
    const optimizationTier = _required(params, 'optimizationTier');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!OPTIMIZATION_TIERS.includes(optimizationTier)) {
        throw new Error(`§200 invalid tier: ${optimizationTier}`);
    }
    if (_stmts.selectById.get(entryId)) {
        throw new Error(`§200 duplicate entryId: ${entryId}`);
    }

    _stmts.insert.run(
        userId, resolvedEnv, entryId, protectedQuantityLabel,
        optimizationTier, reasoning, ts, ts
    );

    return { registered: true, entryId, optimizationTier };
}

function deactivateProtected(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const entryId = _required(params, 'entryId');
    _stmts.deactivate.run(userId, resolvedEnv, entryId);
    return { deactivated: true, entryId };
}

function getActive(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const optimizationTier = params.optimizationTier;
    if (optimizationTier !== undefined && !OPTIMIZATION_TIERS.includes(optimizationTier)) {
        throw new Error(`§200 invalid tier filter`);
    }
    return optimizationTier
        ? _stmts.selectByTier.all(userId, resolvedEnv, optimizationTier)
        : _stmts.selectActive.all(userId, resolvedEnv);
}

module.exports = {
    OPTIMIZATION_TIERS,
    allowsOptimization,
    registerProtectedQuantity,
    deactivateProtected,
    getActive
};
