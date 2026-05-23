'use strict';

/**
 * OMEGA §238 — THE TRIANGULATION OF SELF / NO-SINGLE-VANTAGE TRUTH.
 * Canonical PDF lines 7386-7436.
 */

const { db } = require('../../database');

const CLASSIFICATIONS = Object.freeze([
    'converged', 'self_deception_detected',
    'observer_illusion_detected', 'outcome_distortion_detected'
]);
const CONVERGENCE_THRESHOLD = 0.80;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§238 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§238 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§238 ${name} must be in [0,1]`);
    }
}

function computeConvergence(params) {
    const inner = _required(params, 'innerSelfReportScore');
    const outer = _required(params, 'outerAuditScore');
    const world = _required(params, 'worldEffectScore');
    _requireRange01('innerSelfReportScore', inner);
    _requireRange01('outerAuditScore', outer);
    _requireRange01('worldEffectScore', world);
    // Convergence = 1 - max pairwise gap
    const gaps = [Math.abs(inner - outer), Math.abs(outer - world), Math.abs(inner - world)];
    const maxGap = Math.max(...gaps);
    return { convergenceScore: Math.max(0, Math.min(1, 1 - maxGap)) };
}

function detectDivergence(params) {
    const inner = _required(params, 'innerSelfReportScore');
    const outer = _required(params, 'outerAuditScore');
    const world = _required(params, 'worldEffectScore');
    const convergence = _required(params, 'convergenceScore');
    _requireRange01('convergenceScore', convergence);

    if (convergence >= CONVERGENCE_THRESHOLD) return { classification: 'converged' };
    // Inner is highest but world+outer lower → self-deception
    if (inner > outer && inner > world) return { classification: 'self_deception_detected' };
    // Outer is highest but inner+world lower → observer illusion
    if (outer > inner && outer > world) return { classification: 'observer_illusion_detected' };
    // World is highest but inner+outer lower → outcome distortion (lucky)
    return { classification: 'outcome_distortion_detected' };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_self_triangulation_audits (
            user_id, resolved_env, audit_id,
            inner_self_report_score, outer_audit_score, world_effect_score,
            convergence_score, classification, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_self_triangulation_audits WHERE audit_id = ?`),
    selectAll: db.prepare(`
        SELECT id, audit_id AS auditId,
               inner_self_report_score AS innerSelfReportScore,
               outer_audit_score AS outerAuditScore,
               world_effect_score AS worldEffectScore,
               convergence_score AS convergenceScore,
               classification, ts
        FROM ml_self_triangulation_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const innerSelfReportScore = _required(params, 'innerSelfReportScore');
    const outerAuditScore = _required(params, 'outerAuditScore');
    const worldEffectScore = _required(params, 'worldEffectScore');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectById.get(auditId)) throw new Error(`§238 duplicate auditId: ${auditId}`);

    const { convergenceScore } = computeConvergence({
        innerSelfReportScore, outerAuditScore, worldEffectScore
    });
    const { classification } = detectDivergence({
        innerSelfReportScore, outerAuditScore, worldEffectScore, convergenceScore
    });

    _stmts.insert.run(
        userId, resolvedEnv, auditId,
        innerSelfReportScore, outerAuditScore, worldEffectScore,
        convergenceScore, classification, reasoning, ts
    );
    return { recorded: true, auditId, convergenceScore, classification };
}

function getRecentAudits(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { CLASSIFICATIONS, CONVERGENCE_THRESHOLD,
    computeConvergence, detectDivergence, recordAudit, getRecentAudits };
