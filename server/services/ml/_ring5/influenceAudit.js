'use strict';

/**
 * ML Plan v3 Phase 4 — Influence Audit writer.
 *
 * Persists every Ring5 influence-mode attempt (accepted/rejected/skipped)
 * to ml_influence_audit. PRE-gate trail per PVR-5 two-table strategy.
 */

const { db } = require('../../database');

const _STMT = db.prepare(`
    INSERT INTO ml_influence_audit
    (user_id, env, symbol, regime,
     phase2_dir, phase2_confidence, phase2_score,
     proposed_dir, proposed_confidence, proposed_score,
     gate_status, gate_reason, rationale_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`influenceAudit: missing ${k}`);
    return p[k];
}

function _serializeRationale(r) {
    if (typeof r === 'string') return JSON.stringify({ text: r });
    return JSON.stringify(r);
}

function record(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const phase2 = _required(params, 'phase2Decision');
    const proposed = _required(params, 'proposedDecision');
    const gateStatus = _required(params, 'gateStatus');
    const gateReason = _required(params, 'gateReason');
    const rationale = _required(params, 'rationale');
    const ts = _required(params, 'ts');

    const info = _STMT.run(
        userId, env, symbol, regime,
        phase2.dir, phase2.confidence, phase2.score,
        proposed.dir, proposed.confidence, proposed.score,
        gateStatus, gateReason, _serializeRationale(rationale), ts
    );

    return { recorded: true, id: info.lastInsertRowid };
}

module.exports = { record };
