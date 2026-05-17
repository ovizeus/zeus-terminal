'use strict';

/**
 * OMEGA §208 — COUNTER-REIFICATION GUARD / DO-NOT-MISTAKE-METAPHOR-FOR-MECHANISM.
 * Canonical PDF lines 6584-6626.
 */

const { db } = require('../../database');

const CLASSIFICATIONS = Object.freeze([
    'descriptive_metaphor', 'heuristic_shorthand',
    'mechanism_supported_claim', 'unsupported_reified_construct'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§208 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§208 invalid env: ${env}`);
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§208 ${name} must be in [0,1]`);
    }
}

function computeReificationRiskScore(params) {
    const operationalAuthority = _required(params, 'operationalAuthorityLevel');
    const mechanismSupport = _required(params, 'mechanismSupportLevel');
    _requireRange01('operationalAuthorityLevel', operationalAuthority);
    _requireRange01('mechanismSupportLevel', mechanismSupport);
    // Risk = high authority + low support
    const risk = operationalAuthority * (1 - mechanismSupport);
    return { reificationRiskScore: Math.max(0, Math.min(1, risk)) };
}

function classifyExpression(params) {
    const riskScore = _required(params, 'reificationRiskScore');
    const mechanismSupport = _required(params, 'mechanismSupportLevel');
    _requireRange01('reificationRiskScore', riskScore);
    _requireRange01('mechanismSupportLevel', mechanismSupport);
    if (riskScore >= 0.60) {
        return { classification: 'unsupported_reified_construct' };
    }
    if (mechanismSupport >= 0.70) {
        return { classification: 'mechanism_supported_claim' };
    }
    if (mechanismSupport >= 0.40) {
        return { classification: 'heuristic_shorthand' };
    }
    return { classification: 'descriptive_metaphor' };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_counter_reification_audits (
            user_id, resolved_env, audit_id, expression_text,
            classification, reification_risk_score, mechanism_translation,
            penalty_applied, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_counter_reification_audits WHERE audit_id = ?`),
    selectAll: db.prepare(`
        SELECT id, audit_id AS auditId, expression_text AS expressionText,
               classification,
               reification_risk_score AS reificationRiskScore,
               mechanism_translation AS mechanismTranslation,
               penalty_applied AS penaltyApplied,
               reasoning, ts
        FROM ml_counter_reification_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordReificationAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const expressionText = _required(params, 'expressionText');
    const operationalAuthorityLevel = _required(params, 'operationalAuthorityLevel');
    const mechanismSupportLevel = _required(params, 'mechanismSupportLevel');
    const ts = _required(params, 'ts');
    const mechanismTranslation = params.mechanismTranslation ?? null;
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectById.get(auditId)) {
        throw new Error(`§208 duplicate auditId: ${auditId}`);
    }

    const { reificationRiskScore } = computeReificationRiskScore({
        operationalAuthorityLevel, mechanismSupportLevel
    });
    const { classification } = classifyExpression({
        reificationRiskScore, mechanismSupportLevel
    });
    // Penalty when reified construct: scale of risk
    const penaltyApplied = (classification === 'unsupported_reified_construct')
        ? reificationRiskScore
        : 0;

    _stmts.insert.run(
        userId, resolvedEnv, auditId, expressionText,
        classification, reificationRiskScore, mechanismTranslation,
        penaltyApplied, reasoning, ts
    );

    return {
        recorded: true, auditId, classification,
        reificationRiskScore, penaltyApplied
    };
}

function getRecentAudits(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = {
    CLASSIFICATIONS,
    computeReificationRiskScore, classifyExpression,
    recordReificationAudit, getRecentAudits
};
