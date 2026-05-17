'use strict';

/**
 * OMEGA §219 — ONTIC FRICTION METER / ABSTRACTION-LOSS ACCOUNTING.
 * Canonical PDF lines 6894-6951.
 */

const { db } = require('../../database');

const CLASSIFICATIONS = Object.freeze([
    'productive_compression', 'acceptable_loss',
    'dangerous_oversmoothing', 'semantic_sanding_of_reality'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§219 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§219 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§219 ${name} must be in [0,1]`);
    }
}

function computeCumulativeLoss(params) {
    const perLayer = _required(params, 'perLayerLosses');
    if (!Array.isArray(perLayer)) throw new Error('§219 perLayerLosses must be array');
    // (1 - product(1 - lossPerLayer)) — independent compounding losses
    let retention = 1;
    for (const loss of perLayer) {
        _requireRange01('layerLoss', loss);
        retention *= (1 - loss);
    }
    return { cumulativeLossScore: Math.max(0, Math.min(1, 1 - retention)) };
}

function classifyLoss(params) {
    const loss = _required(params, 'cumulativeLossScore');
    _requireRange01('cumulativeLossScore', loss);
    if (loss >= 0.75) return { classification: 'semantic_sanding_of_reality' };
    if (loss >= 0.50) return { classification: 'dangerous_oversmoothing' };
    if (loss >= 0.25) return { classification: 'acceptable_loss' };
    return { classification: 'productive_compression' };
}

function recommendRawReplay(params) {
    const classification = _required(params, 'classification');
    if (!CLASSIFICATIONS.includes(classification)) throw new Error(`§219 invalid class`);
    return { recommendRawReplay: (classification === 'dangerous_oversmoothing' || classification === 'semantic_sanding_of_reality') ? 1 : 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_ontic_friction_audits (
            user_id, resolved_env, audit_id, transformation_chain_json,
            per_layer_losses_json, cumulative_loss_score, classification,
            recommend_raw_replay, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_ontic_friction_audits WHERE audit_id = ?`),
    selectAll: db.prepare(`
        SELECT id, audit_id AS auditId,
               transformation_chain_json AS transformationChainJson,
               per_layer_losses_json AS perLayerLossesJson,
               cumulative_loss_score AS cumulativeLossScore,
               classification,
               recommend_raw_replay AS recommendRawReplay, ts
        FROM ml_ontic_friction_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const transformationChain = _required(params, 'transformationChain');
    const perLayerLosses = _required(params, 'perLayerLosses');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!Array.isArray(transformationChain)) throw new Error('§219 transformationChain must be array');
    if (!Array.isArray(perLayerLosses)) throw new Error('§219 perLayerLosses must be array');
    if (_stmts.selectById.get(auditId)) throw new Error(`§219 duplicate auditId: ${auditId}`);

    const { cumulativeLossScore } = computeCumulativeLoss({ perLayerLosses });
    const { classification } = classifyLoss({ cumulativeLossScore });
    const { recommendRawReplay } = (() => {
        const c = classification;
        return { recommendRawReplay: (c === 'dangerous_oversmoothing' || c === 'semantic_sanding_of_reality') ? 1 : 0 };
    })();

    _stmts.insert.run(
        userId, resolvedEnv, auditId,
        JSON.stringify(transformationChain),
        JSON.stringify(perLayerLosses),
        cumulativeLossScore, classification, recommendRawReplay,
        reasoning, ts
    );
    return { recorded: true, auditId, cumulativeLossScore, classification, recommendRawReplay };
}

function getRecentAudits(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { CLASSIFICATIONS,
    computeCumulativeLoss, classifyLoss, recommendRawReplay,
    recordAudit, getRecentAudits };
