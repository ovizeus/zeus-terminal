'use strict';

/**
 * OMEGA §227 — LEGIBILITY TAX / THE PRICE OF BEING UNDERSTOOD.
 * Canonical PDF lines 7057-7109.
 */

const { db } = require('../../database');

const CLASSIFICATIONS = Object.freeze([
    'truth_preserving_explanation', 'explanation_shaped_behavior',
    'audience_conditioned_cognition', 'performative_explainability_drift'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§227 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§227 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§227 ${name} must be in [0,1]`);
    }
}

function computeLegibilityTax(params) {
    const inner = _required(params, 'innerFidelityScore');
    const outer = _required(params, 'outerFidelityScore');
    _requireRange01('innerFidelityScore', inner);
    _requireRange01('outerFidelityScore', outer);
    // Tax = how much outer-explanation fidelity exceeds inner-cognition fidelity
    // (positive = sacrificing truth for ease of explanation)
    const tax = Math.max(0, outer - inner);
    return { legibilityTaxScore: Math.min(1, tax) };
}

function classifyDrift(params) {
    const tax = _required(params, 'legibilityTaxScore');
    _requireRange01('legibilityTaxScore', tax);
    if (tax >= 0.50) return { classification: 'performative_explainability_drift' };
    if (tax >= 0.30) return { classification: 'audience_conditioned_cognition' };
    if (tax >= 0.15) return { classification: 'explanation_shaped_behavior' };
    return { classification: 'truth_preserving_explanation' };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_legibility_tax_audits (
            user_id, resolved_env, audit_id,
            inner_fidelity_score, outer_fidelity_score,
            legibility_tax_score, classification, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_legibility_tax_audits WHERE audit_id = ?`),
    selectAll: db.prepare(`
        SELECT id, audit_id AS auditId,
               inner_fidelity_score AS innerFidelityScore,
               outer_fidelity_score AS outerFidelityScore,
               legibility_tax_score AS legibilityTaxScore,
               classification, ts
        FROM ml_legibility_tax_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const innerFidelityScore = _required(params, 'innerFidelityScore');
    const outerFidelityScore = _required(params, 'outerFidelityScore');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectById.get(auditId)) throw new Error(`§227 duplicate auditId: ${auditId}`);

    const { legibilityTaxScore } = computeLegibilityTax({ innerFidelityScore, outerFidelityScore });
    const { classification } = classifyDrift({ legibilityTaxScore });

    _stmts.insert.run(
        userId, resolvedEnv, auditId,
        innerFidelityScore, outerFidelityScore,
        legibilityTaxScore, classification, reasoning, ts
    );
    return { recorded: true, auditId, legibilityTaxScore, classification };
}

function getRecentAudits(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { CLASSIFICATIONS, computeLegibilityTax, classifyDrift, recordAudit, getRecentAudits };
