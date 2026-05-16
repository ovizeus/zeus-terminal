'use strict';

/**
 * OMEGA R3A Safety — hierarchicalPlanning (canonical §83)
 *
 * §83 PLANIFICARE IERARHICA TEMPORALA — strategie, tactica, executie.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2147-2148.
 *
 * "Nivelul inferior NU poate contrazice mandatul nivelului superior,
 *  indiferent cat de bun arata un setup local. Constrangere arhitecturala,
 *  NU regula de scoring."
 *
 * R3A safety. 3-level hierarchy:
 *   STRATEGIC (saptamanal): portfolio mandates + regime constraints
 *   TACTICAL (orar/zilnic): setup selection in strategic envelope
 *   EXECUTION (secunde): fill optimization in tactical decision
 *
 * Distinct from §77 horizonArbitration (signal vs position-horizon).
 * §83 = strategic mandates as HARD CONSTRAINTS over tactical+execution.
 */

const { db } = require('../../database');

const LEVELS = Object.freeze(['strategic', 'tactical', 'execution']);
const LEVEL_HIERARCHY = Object.freeze({
    strategic: 3, tactical: 2, execution: 1
});
const CONSTRAINT_TYPES = Object.freeze([
    'max_exposure', 'asset_block', 'regime_block',
    'direction_limit', 'exposure_cap'
]);
const MANDATE_STATUSES = Object.freeze(['ACTIVE', 'EXPIRED']);
const DECISIONS = Object.freeze([
    'APPROVED', 'REJECTED_BY_HIGHER_LEVEL', 'MODIFIED'
]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`hierarchicalPlanning: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertMandate: db.prepare(`
        INSERT INTO ml_strategic_mandates
        (user_id, resolved_env, mandate_id, level, constraint_type,
         parameters_json, valid_from, valid_until, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
    `),
    expireMandate: db.prepare(`
        UPDATE ml_strategic_mandates
        SET status = 'EXPIRED'
        WHERE user_id = ? AND resolved_env = ? AND mandate_id = ?
    `),
    activeMandates: db.prepare(`
        SELECT * FROM ml_strategic_mandates
        WHERE user_id = ? AND resolved_env = ?
          AND status = 'ACTIVE'
          AND valid_from <= ? AND valid_until >= ?
          AND (? = '' OR level = ?)
        ORDER BY level
    `),
    insertDecision: db.prepare(`
        INSERT INTO ml_hierarchical_decisions
        (user_id, resolved_env, decision_id, level,
         candidate_action_json, mandates_checked_json,
         violations_json, decision, reasoning, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    decisionHistory: db.prepare(`
        SELECT * FROM ml_hierarchical_decisions
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR level = ?)
          AND (? = '' OR decision = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── defineMandate ──────────────────────────────────────────────────
function defineMandate(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const mandateId = _required(params, 'mandateId');
    const level = _required(params, 'level');
    const constraintType = _required(params, 'constraintType');
    const parameters = _required(params, 'parameters');
    const validFrom = (params && params.validFrom) ? params.validFrom : Date.now();
    const validUntil = _required(params, 'validUntil');
    const createdAt = (params && params.createdAt) ? params.createdAt : Date.now();

    if (!LEVELS.includes(level)) {
        throw new Error(`hierarchicalPlanning: invalid level "${level}"`);
    }
    if (!CONSTRAINT_TYPES.includes(constraintType)) {
        throw new Error(`hierarchicalPlanning: invalid constraintType "${constraintType}"`);
    }
    if (validUntil <= validFrom) {
        throw new Error('hierarchicalPlanning: validUntil must be > validFrom');
    }

    try {
        _stmts.insertMandate.run(
            userId, env, mandateId, level, constraintType,
            JSON.stringify(parameters), validFrom, validUntil, createdAt
        );
        return { defined: true, mandateId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`hierarchicalPlanning: duplicate mandateId "${mandateId}"`);
        }
        throw err;
    }
}

// ── _checkViolation (internal) ─────────────────────────────────────
function _checkViolation(mandate, candidateAction) {
    const params = JSON.parse(mandate.parameters_json);
    const constraint = mandate.constraint_type;

    if (constraint === 'asset_block') {
        const blockedAssets = params.assets || [];
        if (blockedAssets.includes(candidateAction.asset)) {
            return `asset ${candidateAction.asset} blocked by ${mandate.mandate_id}`;
        }
    } else if (constraint === 'max_exposure') {
        const cap = params.maxPct || 1.0;
        if ((candidateAction.proposedExposurePct || 0) > cap) {
            return `proposed exposure ${candidateAction.proposedExposurePct} > cap ${cap} (${mandate.mandate_id})`;
        }
    } else if (constraint === 'regime_block') {
        const blockedRegimes = params.regimes || [];
        if (blockedRegimes.includes(candidateAction.regime)) {
            return `regime ${candidateAction.regime} blocked by ${mandate.mandate_id}`;
        }
    } else if (constraint === 'direction_limit') {
        const allowedDirections = params.allowed || [];
        if (allowedDirections.length > 0 && !allowedDirections.includes(candidateAction.direction)) {
            return `direction ${candidateAction.direction} not allowed (${mandate.mandate_id})`;
        }
    } else if (constraint === 'exposure_cap') {
        const cap = params.cap || Infinity;
        if ((candidateAction.absoluteExposure || 0) > cap) {
            return `absolute exposure ${candidateAction.absoluteExposure} > cap ${cap} (${mandate.mandate_id})`;
        }
    }

    return null;
}

// ── evaluateAgainstMandates ────────────────────────────────────────
function evaluateAgainstMandates(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const level = _required(params, 'level');
    const candidateAction = _required(params, 'candidateAction');
    const now = (params && params.now) ? params.now : Date.now();

    if (!LEVELS.includes(level)) {
        throw new Error(`hierarchicalPlanning: invalid level "${level}"`);
    }

    const candidateRank = LEVEL_HIERARCHY[level];
    const allActive = _stmts.activeMandates.all(userId, env, now, now, '', '');

    // Only check mandates at HIGHER level than candidate
    const higherLevelMandates = allActive.filter(m => LEVEL_HIERARCHY[m.level] > candidateRank);
    const violations = [];
    const mandatesChecked = [];

    for (const m of higherLevelMandates) {
        mandatesChecked.push(m.mandate_id);
        const violation = _checkViolation(m, candidateAction);
        if (violation) {
            violations.push({
                mandateId: m.mandate_id, level: m.level,
                constraintType: m.constraint_type, reason: violation
            });
        }
    }

    const decision = violations.length > 0 ? 'REJECTED_BY_HIGHER_LEVEL' : 'APPROVED';
    const reasoning = violations.length > 0
        ? violations.map(v => v.reason).join('; ')
        : `no higher-level violations (${mandatesChecked.length} mandates checked)`;

    return {
        decision,
        violations,
        mandatesChecked,
        reasoning
    };
}

// ── expireMandate ──────────────────────────────────────────────────
function expireMandate(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const mandateId = _required(params, 'mandateId');

    const result = _stmts.expireMandate.run(userId, env, mandateId);
    return { expired: result.changes > 0 };
}

// ── recordHierarchicalDecision ─────────────────────────────────────
function recordHierarchicalDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const level = _required(params, 'level');
    const candidateAction = _required(params, 'candidateAction');
    const mandatesChecked = _required(params, 'mandatesChecked');
    const violations = (params && params.violations) ? params.violations : [];
    const decision = _required(params, 'decision');
    const reasoning = (params && params.reasoning) ? params.reasoning : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!DECISIONS.includes(decision)) {
        throw new Error(`hierarchicalPlanning: invalid decision "${decision}"`);
    }
    if (!LEVELS.includes(level)) {
        throw new Error(`hierarchicalPlanning: invalid level "${level}"`);
    }

    try {
        _stmts.insertDecision.run(
            userId, env, decisionId, level,
            JSON.stringify(candidateAction),
            JSON.stringify(mandatesChecked),
            JSON.stringify(violations),
            decision, reasoning, ts
        );
        return { recorded: true };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`hierarchicalPlanning: duplicate decisionId "${decisionId}"`);
        }
        throw err;
    }
}

// ── getActiveMandates ──────────────────────────────────────────────
function getActiveMandates(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const level = (params && params.level) ? params.level : '';
    const now = (params && params.now) ? params.now : Date.now();

    return _stmts.activeMandates.all(userId, env, now, now, level, level);
}

// ── getDecisionHistory ─────────────────────────────────────────────
function getDecisionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const level = (params && params.level) ? params.level : '';
    const decision = (params && params.decision) ? params.decision : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.decisionHistory.all(
        userId, env,
        level, level,
        decision, decision,
        since > 0 ? 1 : 0, since,
        limit
    );
}

module.exports = {
    LEVELS,
    LEVEL_HIERARCHY,
    CONSTRAINT_TYPES,
    MANDATE_STATUSES,
    DECISIONS,
    defineMandate,
    evaluateAgainstMandates,
    expireMandate,
    recordHierarchicalDecision,
    getActiveMandates,
    getDecisionHistory
};
