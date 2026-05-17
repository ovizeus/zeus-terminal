'use strict';

/**
 * OMEGA §218 — SEMANTIC EVENT HORIZON / SELF-REFERENCE CUTOFF.
 * Canonical PDF lines 6838-6891.
 */

const { db } = require('../../database');

const REFLECTION_CLASSIFICATIONS = Object.freeze([
    'useful_reflection', 'heavy_reflection',
    'self_referential_orbit', 'epistemic_blackhole_risk'
]);
const COLLAPSE_DEPTH = 5;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§218 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§218 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§218 ${name} must be in [0,1]`);
    }
}

function classifyReflection(params) {
    const depth = _required(params, 'recursiveDepth');
    const saturation = _required(params, 'saturationScore');
    _requireRange01('saturationScore', saturation);
    if (depth >= COLLAPSE_DEPTH || saturation >= 0.85) {
        return { classification: 'epistemic_blackhole_risk' };
    }
    if (saturation >= 0.65) return { classification: 'self_referential_orbit' };
    if (saturation >= 0.40) return { classification: 'heavy_reflection' };
    return { classification: 'useful_reflection' };
}

function shouldCollapseToWorld(params) {
    const classification = _required(params, 'classification');
    if (!REFLECTION_CLASSIFICATIONS.includes(classification)) throw new Error(`§218 invalid class`);
    return { collapseInvoked: (classification === 'self_referential_orbit' || classification === 'epistemic_blackhole_risk') ? 1 : 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_semantic_event_horizon_audits (
            user_id, resolved_env, audit_id, recursive_depth,
            saturation_score, reflection_classification,
            collapse_to_world_invoked, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_semantic_event_horizon_audits WHERE audit_id = ?`),
    selectAll: db.prepare(`
        SELECT id, audit_id AS auditId, recursive_depth AS recursiveDepth,
               saturation_score AS saturationScore,
               reflection_classification AS reflectionClassification,
               collapse_to_world_invoked AS collapseToWorldInvoked, ts
        FROM ml_semantic_event_horizon_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const recursiveDepth = _required(params, 'recursiveDepth');
    const saturationScore = _required(params, 'saturationScore');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (typeof recursiveDepth !== 'number' || recursiveDepth < 0) throw new Error('§218 recursiveDepth must be non-negative');
    if (_stmts.selectById.get(auditId)) throw new Error(`§218 duplicate auditId: ${auditId}`);

    const { classification } = classifyReflection({ recursiveDepth, saturationScore });
    const { collapseInvoked } = shouldCollapseToWorld({ classification });

    _stmts.insert.run(
        userId, resolvedEnv, auditId, recursiveDepth,
        saturationScore, classification, collapseInvoked, reasoning, ts
    );
    return { recorded: true, auditId, reflectionClassification: classification, collapseToWorldInvoked: collapseInvoked };
}

function getRecentAudits(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { REFLECTION_CLASSIFICATIONS, COLLAPSE_DEPTH,
    classifyReflection, shouldCollapseToWorld, recordAudit, getRecentAudits };
