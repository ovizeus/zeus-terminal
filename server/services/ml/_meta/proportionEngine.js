'use strict';

/**
 * OMEGA §230 — PROPORTION ENGINE / DO-NOT-SPEND-A-COSMOS-ON-A-GRAIN.
 * Canonical PDF lines 7221-7266.
 */

const { db } = require('../../database');

const CLASSIFICATIONS = Object.freeze([
    'proportionate', 'minor_over_investigation',
    'theatrical_depth', 'philosophical_inflation_of_trivia'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§230 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§230 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§230 ${name} must be in [0,1]`);
    }
}

function computeProportionality(params) {
    const stake = _required(params, 'stakeScore');
    const irreversibility = _required(params, 'irreversibilityScore');
    const cognitiveCost = _required(params, 'cognitiveCostScore');
    _requireRange01('stakeScore', stake);
    _requireRange01('irreversibilityScore', irreversibility);
    _requireRange01('cognitiveCostScore', cognitiveCost);
    // Proportionality = how well cognitive cost matches stake+irreversibility.
    // 1 = perfectly proportionate; 0 = wildly disproportionate.
    const expectedCost = (stake + irreversibility) / 2;
    const gap = Math.abs(cognitiveCost - expectedCost);
    const score = Math.max(0, Math.min(1, 1 - gap));
    return { proportionalityScore: score };
}

function classifyProportion(params) {
    const score = _required(params, 'proportionalityScore');
    const stake = _required(params, 'stakeScore');
    const cognitiveCost = _required(params, 'cognitiveCostScore');
    _requireRange01('proportionalityScore', score);
    _requireRange01('stakeScore', stake);
    _requireRange01('cognitiveCostScore', cognitiveCost);
    // Cost wildly exceeds stake — inflation
    if (cognitiveCost - stake >= 0.60) return { classification: 'philosophical_inflation_of_trivia' };
    if (cognitiveCost - stake >= 0.40) return { classification: 'theatrical_depth' };
    if (cognitiveCost - stake >= 0.20) return { classification: 'minor_over_investigation' };
    return { classification: 'proportionate' };
}

function simplificationMandate(params) {
    const classification = _required(params, 'classification');
    if (!CLASSIFICATIONS.includes(classification)) throw new Error(`§230 invalid class`);
    return { simplificationMandate: (classification === 'theatrical_depth' || classification === 'philosophical_inflation_of_trivia') ? 1 : 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_proportion_audits (
            user_id, resolved_env, audit_id,
            stake_score, irreversibility_score, cognitive_cost_score,
            proportionality_score, classification, simplification_mandate,
            reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_proportion_audits WHERE audit_id = ?`),
    selectAll: db.prepare(`
        SELECT id, audit_id AS auditId,
               stake_score AS stakeScore,
               irreversibility_score AS irreversibilityScore,
               cognitive_cost_score AS cognitiveCostScore,
               proportionality_score AS proportionalityScore,
               classification,
               simplification_mandate AS simplificationMandate, ts
        FROM ml_proportion_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const stakeScore = _required(params, 'stakeScore');
    const irreversibilityScore = _required(params, 'irreversibilityScore');
    const cognitiveCostScore = _required(params, 'cognitiveCostScore');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectById.get(auditId)) throw new Error(`§230 duplicate auditId: ${auditId}`);

    const { proportionalityScore } = computeProportionality({
        stakeScore, irreversibilityScore, cognitiveCostScore
    });
    const { classification } = classifyProportion({
        proportionalityScore, stakeScore, cognitiveCostScore
    });
    const { simplificationMandate: mandate } = simplificationMandate({ classification });

    _stmts.insert.run(
        userId, resolvedEnv, auditId,
        stakeScore, irreversibilityScore, cognitiveCostScore,
        proportionalityScore, classification, mandate, reasoning, ts
    );
    return { recorded: true, auditId, proportionalityScore, classification, simplificationMandate: mandate };
}

function getRecentAudits(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { CLASSIFICATIONS,
    computeProportionality, classifyProportion, simplificationMandate,
    recordAudit, getRecentAudits };
