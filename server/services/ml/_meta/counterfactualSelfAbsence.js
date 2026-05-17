'use strict';

/**
 * OMEGA §220 — COUNTERFACTUAL SELF-ABSENCE / DEPENDENCY ON SELF.
 * Canonical PDF lines 6954-7012.
 */

const { db } = require('../../database');

const CLASSIFICATIONS = Object.freeze([
    'truly_external_signal', 'weakly_self_influenced_signal',
    'heavily_self_shaped_signal', 'self_created_task'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§220 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§220 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§220 ${name} must be in [0,1]`);
    }
}

function classifyDependency(params) {
    const score = _required(params, 'dependencyScore');
    _requireRange01('dependencyScore', score);
    if (score >= 0.85) return { classification: 'self_created_task' };
    if (score >= 0.60) return { classification: 'heavily_self_shaped_signal' };
    if (score >= 0.30) return { classification: 'weakly_self_influenced_signal' };
    return { classification: 'truly_external_signal' };
}

function boldnessAdjustment(params) {
    const classification = _required(params, 'classification');
    if (!CLASSIFICATIONS.includes(classification)) throw new Error(`§220 invalid class`);
    // Higher self-dependence → reduce boldness (less confident this is real-world).
    const table = {
        truly_external_signal: 1.00,
        weakly_self_influenced_signal: 0.85,
        heavily_self_shaped_signal: 0.55,
        self_created_task: 0.20
    };
    return { boldnessAdjustment: table[classification] };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_self_absence_counterfactuals (
            user_id, resolved_env, counterfactual_id, phenomenon_label,
            dependency_score, classification, boldness_adjustment, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_self_absence_counterfactuals WHERE counterfactual_id = ?`),
    selectAll: db.prepare(`
        SELECT id, counterfactual_id AS counterfactualId,
               phenomenon_label AS phenomenonLabel,
               dependency_score AS dependencyScore, classification,
               boldness_adjustment AS boldnessAdjustment, ts
        FROM ml_self_absence_counterfactuals
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordCounterfactual(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const counterfactualId = _required(params, 'counterfactualId');
    const phenomenonLabel = _required(params, 'phenomenonLabel');
    const dependencyScore = _required(params, 'dependencyScore');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    _requireRange01('dependencyScore', dependencyScore);
    if (_stmts.selectById.get(counterfactualId)) throw new Error(`§220 duplicate counterfactualId: ${counterfactualId}`);

    const { classification } = classifyDependency({ dependencyScore });
    const { boldnessAdjustment: adj } = boldnessAdjustment({ classification });

    _stmts.insert.run(
        userId, resolvedEnv, counterfactualId, phenomenonLabel,
        dependencyScore, classification, adj, reasoning, ts
    );
    return { recorded: true, counterfactualId, classification, boldnessAdjustment: adj };
}

function getRecentCounterfactuals(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { CLASSIFICATIONS,
    classifyDependency, boldnessAdjustment,
    recordCounterfactual, getRecentCounterfactuals };
