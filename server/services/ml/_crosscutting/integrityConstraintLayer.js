'use strict';

/**
 * OMEGA cross-cutting — integrityConstraintLayer (canonical §104)
 *
 * §104 INTEGRITY CONSTRAINT LAYER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 2625.
 *
 * "Autoimpune constrangeri care NU sunt cerute legal sau operational, ci din
 *  ratiune de interes propriu pe termen lung si participare sanatoasa la
 *  ecosistem... NU exploata erori pricing exchange mic care l-ar putea
 *  falimenta. NU executa strategii care if-all-similar ar destabiliza
 *  infrastructura. NU front-runa algoritmi slabi descurajandu-i sa participe.
 *  Un sistem fara integritate e un participant care mananca ecosistemul
 *  din care traieste."
 *
 * Distinct from §66 complianceLayer (legal/regulatory). §104 = self-imposed
 * sustainability constraints beyond legal requirements.
 */

const { db } = require('../../database');

const INTEGRITY_KINDS = Object.freeze([
    'venue_health', 'ecosystem_impact',
    'peer_predation', 'liquidity_provision'
]);
const INTEGRITY_SEVERITIES = Object.freeze(['advisory', 'strict']);
const INTEGRITY_DECISIONS = Object.freeze([
    'BLOCK', 'REDUCE_SIZE', 'WARN', 'ACCEPT'
]);

const DEFAULT_STRICT_BLOCK_THRESHOLD = 0.50;
const DEFAULT_WARN_THRESHOLD = 0.20;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`integrityConstraintLayer: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertConstraint: db.prepare(`
        INSERT INTO ml_integrity_constraints
        (user_id, resolved_env, constraint_id, kind, description,
         severity, is_active, ts)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `),
    getConstraint: db.prepare(`
        SELECT * FROM ml_integrity_constraints WHERE constraint_id = ?
    `),
    listActiveConstraints: db.prepare(`
        SELECT * FROM ml_integrity_constraints
        WHERE user_id = ? AND resolved_env = ? AND is_active = 1
        ORDER BY ts DESC LIMIT ?
    `),
    listActiveConstraintsByKind: db.prepare(`
        SELECT * FROM ml_integrity_constraints
        WHERE user_id = ? AND resolved_env = ?
          AND is_active = 1 AND kind = ?
        ORDER BY ts DESC LIMIT ?
    `),
    retireConstraint: db.prepare(`
        UPDATE ml_integrity_constraints
        SET is_active = 0
        WHERE user_id = ? AND resolved_env = ? AND constraint_id = ?
    `),
    insertViolation: db.prepare(`
        INSERT INTO ml_integrity_violations
        (user_id, resolved_env, violation_id, constraint_id,
         action_context, severity_score, decision, reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listViolations: db.prepare(`
        SELECT * FROM ml_integrity_violations
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    listViolationsByDecision: db.prepare(`
        SELECT * FROM ml_integrity_violations
        WHERE user_id = ? AND resolved_env = ? AND decision = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── evaluateActionIntegrity (pure) ─────────────────────────────────
function evaluateActionIntegrity(params) {
    const severityScore = _required(params, 'severityScore');
    const constraintSeverity = _required(params, 'constraintSeverity');
    if (!INTEGRITY_SEVERITIES.includes(constraintSeverity)) {
        throw new Error(
            `integrityConstraintLayer: invalid constraintSeverity "${constraintSeverity}"`
        );
    }
    if (severityScore < 0 || severityScore > 1) {
        throw new Error('integrityConstraintLayer: severityScore must be in [0,1]');
    }
    const strictBlock = (params && params.strictBlockThreshold !== undefined)
        ? params.strictBlockThreshold : DEFAULT_STRICT_BLOCK_THRESHOLD;
    const warnThreshold = (params && params.warnThreshold !== undefined)
        ? params.warnThreshold : DEFAULT_WARN_THRESHOLD;

    let decision;
    if (constraintSeverity === 'strict') {
        if (severityScore >= strictBlock) decision = 'BLOCK';
        else if (severityScore >= warnThreshold) decision = 'REDUCE_SIZE';
        else if (severityScore > 0) decision = 'WARN';
        else decision = 'ACCEPT';
    } else {
        // advisory — never BLOCK
        if (severityScore >= strictBlock) decision = 'REDUCE_SIZE';
        else if (severityScore >= warnThreshold) decision = 'WARN';
        else decision = 'ACCEPT';
    }
    return {
        decision, severityScore, constraintSeverity,
        strictBlockThreshold: strictBlock,
        warnThreshold
    };
}

// ── registerIntegrityConstraint ────────────────────────────────────
function registerIntegrityConstraint(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const constraintId = _required(params, 'constraintId');
    const kind = _required(params, 'kind');
    if (!INTEGRITY_KINDS.includes(kind)) {
        throw new Error(`integrityConstraintLayer: invalid kind "${kind}"`);
    }
    const description = _required(params, 'description');
    const severity = _required(params, 'severity');
    if (!INTEGRITY_SEVERITIES.includes(severity)) {
        throw new Error(`integrityConstraintLayer: invalid severity "${severity}"`);
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertConstraint.run(
            userId, env, constraintId, kind, description, severity, ts
        );
        return { registered: true, constraintId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `integrityConstraintLayer: duplicate constraintId "${constraintId}"`
            );
        }
        throw err;
    }
}

// ── recordIntegrityCheck ───────────────────────────────────────────
function recordIntegrityCheck(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const violationId = _required(params, 'violationId');
    const constraintId = (params && params.constraintId) ? params.constraintId : null;
    const actionContext = _required(params, 'actionContext');
    const severityScore = _required(params, 'severityScore');
    if (severityScore < 0 || severityScore > 1) {
        throw new Error('integrityConstraintLayer: severityScore must be in [0,1]');
    }
    const decision = _required(params, 'decision');
    if (!INTEGRITY_DECISIONS.includes(decision)) {
        throw new Error(`integrityConstraintLayer: invalid decision "${decision}"`);
    }
    const reason = (params && params.reason) ? params.reason : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertViolation.run(
            userId, env, violationId, constraintId, actionContext,
            severityScore, decision, reason, ts
        );
        return { recorded: true, violationId, decision };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `integrityConstraintLayer: duplicate violationId "${violationId}"`
            );
        }
        throw err;
    }
}

// ── getActiveConstraints ───────────────────────────────────────────
function getActiveConstraints(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kind = params && params.kind;
    const limit = (params && params.limit) ? params.limit : 100;

    if (kind && !INTEGRITY_KINDS.includes(kind)) {
        throw new Error(`integrityConstraintLayer: invalid kind "${kind}"`);
    }
    const rows = kind
        ? _stmts.listActiveConstraintsByKind.all(userId, env, kind, limit)
        : _stmts.listActiveConstraints.all(userId, env, limit);
    return rows.map(r => ({
        constraintId: r.constraint_id,
        kind: r.kind,
        description: r.description,
        severity: r.severity,
        isActive: !!r.is_active,
        ts: r.ts
    }));
}

// ── getViolationHistory ────────────────────────────────────────────
function getViolationHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionFilter = params && params.decisionFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (decisionFilter && !INTEGRITY_DECISIONS.includes(decisionFilter)) {
        throw new Error(`integrityConstraintLayer: invalid decisionFilter "${decisionFilter}"`);
    }
    const rows = decisionFilter
        ? _stmts.listViolationsByDecision.all(userId, env, decisionFilter, limit)
        : _stmts.listViolations.all(userId, env, limit);
    return rows.map(r => ({
        violationId: r.violation_id,
        constraintId: r.constraint_id,
        actionContext: r.action_context,
        severityScore: r.severity_score,
        decision: r.decision,
        reason: r.reason,
        ts: r.ts
    }));
}

// ── retireConstraint ───────────────────────────────────────────────
function retireConstraint(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const constraintId = _required(params, 'constraintId');

    const c = _stmts.getConstraint.get(constraintId);
    if (!c) {
        throw new Error(
            `integrityConstraintLayer: constraint "${constraintId}" not found`
        );
    }
    if (c.user_id !== userId || c.resolved_env !== env) {
        throw new Error('integrityConstraintLayer: constraint not owned by user/env');
    }
    _stmts.retireConstraint.run(userId, env, constraintId);
    return { retired: true, constraintId };
}

module.exports = {
    INTEGRITY_KINDS,
    INTEGRITY_SEVERITIES,
    INTEGRITY_DECISIONS,
    DEFAULT_STRICT_BLOCK_THRESHOLD,
    DEFAULT_WARN_THRESHOLD,
    evaluateActionIntegrity,
    registerIntegrityConstraint,
    recordIntegrityCheck,
    getActiveConstraints,
    getViolationHistory,
    retireConstraint
};
