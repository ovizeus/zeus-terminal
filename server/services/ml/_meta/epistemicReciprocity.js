'use strict';

/**
 * OMEGA §210 — EPISTEMIC RECIPROCITY PROTOCOL / LET-THE-WORLD-ANSWER-BACK.
 * Canonical PDF lines 6674-6712.
 */

const { db } = require('../../database');

const MIN_FALSIFICATION_RATIO = 0.25;  // per rule 6706: disconfirmation component required

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§210 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§210 invalid env: ${env}`);
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§210 ${name} must be in [0,1]`);
    }
}

function computeReciprocityScore(params) {
    const conf = _required(params, 'confirmationSeekingRatio');
    const clar = _required(params, 'clarificationSeekingRatio');
    const fals = _required(params, 'falsificationSeekingRatio');
    _requireRange01('confirmationSeekingRatio', conf);
    _requireRange01('clarificationSeekingRatio', clar);
    _requireRange01('falsificationSeekingRatio', fals);
    // Reciprocity high when falsification meaningfully present + balance
    // Penalty when confirmation > 0.70 (extracting-only)
    let score = fals;
    if (conf > 0.70) score *= 0.5;  // heavy confirmation bias penalty
    if (fals < MIN_FALSIFICATION_RATIO) score *= 0.5;
    return { reciprocityScore: Math.max(0, Math.min(1, score)) };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_epistemic_reciprocity_audits (
            user_id, resolved_env, audit_id, thesis_label,
            confirmation_seeking_ratio, clarification_seeking_ratio,
            falsification_seeking_ratio, reciprocity_score,
            disconfirmatory_observations_count, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_epistemic_reciprocity_audits WHERE audit_id = ?`),
    selectAll: db.prepare(`
        SELECT id, audit_id AS auditId, thesis_label AS thesisLabel,
               confirmation_seeking_ratio AS confirmationSeekingRatio,
               clarification_seeking_ratio AS clarificationSeekingRatio,
               falsification_seeking_ratio AS falsificationSeekingRatio,
               reciprocity_score AS reciprocityScore,
               disconfirmatory_observations_count AS disconfirmatoryObservationsCount,
               reasoning, ts
        FROM ml_epistemic_reciprocity_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordReciprocityAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const thesisLabel = _required(params, 'thesisLabel');
    const confirmationSeekingRatio = _required(params, 'confirmationSeekingRatio');
    const clarificationSeekingRatio = _required(params, 'clarificationSeekingRatio');
    const falsificationSeekingRatio = _required(params, 'falsificationSeekingRatio');
    const disconfirmatoryObservationsCount = _required(params, 'disconfirmatoryObservationsCount');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (typeof disconfirmatoryObservationsCount !== 'number' || disconfirmatoryObservationsCount < 0) {
        throw new Error('§210 disconfirmatoryObservationsCount must be non-negative');
    }
    if (_stmts.selectById.get(auditId)) {
        throw new Error(`§210 duplicate auditId: ${auditId}`);
    }

    const { reciprocityScore } = computeReciprocityScore({
        confirmationSeekingRatio, clarificationSeekingRatio, falsificationSeekingRatio
    });

    _stmts.insert.run(
        userId, resolvedEnv, auditId, thesisLabel,
        confirmationSeekingRatio, clarificationSeekingRatio,
        falsificationSeekingRatio, reciprocityScore,
        disconfirmatoryObservationsCount, reasoning, ts
    );

    return { recorded: true, auditId, reciprocityScore };
}

function getRecentAudits(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = {
    MIN_FALSIFICATION_RATIO,
    computeReciprocityScore,
    recordReciprocityAudit,
    getRecentAudits
};
