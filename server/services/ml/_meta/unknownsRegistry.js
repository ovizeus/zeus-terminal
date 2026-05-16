'use strict';

/**
 * OMEGA _meta — unknownsRegistry (canonical §120)
 *
 * §120 UNKNOWNS REGISTRY / ASSUMPTION DEBT TRACKER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3249-3295.
 *
 * "Sistem mare trebuie sa tina evidenta explicita a ceea ce NU stie...
 *  registry de unknowns + assumptions... assumption debt score... 5 tags:
 *  unknown_known / known_unknown / unresolved_ambiguity / fragile_assumption /
 *  temporary_operational... impact pe sizing/confidence/regime/execution/
 *  portfolio_risk... 'ce anume nu stiu acum, dar ma afecteaza material?'...
 *  necunoscuta critica trebuie REZOLVATA sau ACCEPTATA cu penalizare...
 *  assumption debt mare → size_reduce / wait / active_sensing / observer...
 *  necunoscutele NU au voie sa ramana invizibile in decizie."
 *
 * Distinct from §47 inactivityDecay (time-based concept decay), §97
 * forgettingEngine (knowledge retire by decay), §103 wisdomLayer (judgment),
 * §106 competenceMap (domain validity), §99 activeSensingPolicy (cost-
 * aware queries). §120 = explicit ignorance ledger.
 */

const { db } = require('../../database');

const UNKNOWN_KINDS = Object.freeze([
    'unknown_known', 'known_unknown',
    'unresolved_ambiguity', 'fragile_assumption',
    'temporary_operational'
]);
const DEBT_ACTIONS = Object.freeze([
    'size_reduce', 'wait', 'active_sensing', 'observer', 'resolve'
]);
const STATUSES = Object.freeze(['OPEN', 'RESOLVED', 'ACCEPTED']);

const CRITICAL_DEBT_THRESHOLD = 0.50;
const STALE_DAYS_THRESHOLD = 14;
const DAY_MS = 86400000;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`unknownsRegistry: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertUnknown: db.prepare(`
        INSERT INTO ml_unknowns
        (user_id, resolved_env, unknown_id, kind, description,
         impact_sizing, impact_confidence, impact_regime,
         impact_execution, impact_portfolio_risk, debt_score,
         status, ts_registered, ts_resolved)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, NULL)
    `),
    getUnknown: db.prepare(`
        SELECT * FROM ml_unknowns WHERE unknown_id = ?
    `),
    listActiveUnknowns: db.prepare(`
        SELECT * FROM ml_unknowns
        WHERE user_id = ? AND resolved_env = ? AND status != 'RESOLVED'
        ORDER BY debt_score DESC LIMIT ?
    `),
    listActiveUnknownsByKind: db.prepare(`
        SELECT * FROM ml_unknowns
        WHERE user_id = ? AND resolved_env = ?
          AND status != 'RESOLVED' AND kind = ?
        ORDER BY debt_score DESC LIMIT ?
    `),
    listOpenUnknownsAll: db.prepare(`
        SELECT * FROM ml_unknowns
        WHERE user_id = ? AND resolved_env = ? AND status = 'OPEN'
    `),
    updateUnknownStatus: db.prepare(`
        UPDATE ml_unknowns
        SET status = ?, ts_resolved = ?
        WHERE user_id = ? AND resolved_env = ? AND unknown_id = ?
    `),
    insertAudit: db.prepare(`
        INSERT INTO ml_assumption_debt_audit
        (user_id, resolved_env, audit_id, unknown_id,
         action_taken, reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── computeAssumptionDebt (pure) ───────────────────────────────────
function computeAssumptionDebt(params) {
    const impactSizing = _required(params, 'impactSizing');
    const impactConfidence = _required(params, 'impactConfidence');
    const impactRegime = _required(params, 'impactRegime');
    const impactExecution = _required(params, 'impactExecution');
    const impactPortfolioRisk = _required(params, 'impactPortfolioRisk');
    for (const [k, v] of [
        ['impactSizing', impactSizing], ['impactConfidence', impactConfidence],
        ['impactRegime', impactRegime], ['impactExecution', impactExecution],
        ['impactPortfolioRisk', impactPortfolioRisk]
    ]) {
        if (v < 0 || v > 1) {
            throw new Error(`unknownsRegistry: ${k} must be in [0,1]`);
        }
    }
    const debtScore = (impactSizing + impactConfidence + impactRegime +
                       impactExecution + impactPortfolioRisk) / 5;
    return { debtScore };
}

// ── registerUnknown ────────────────────────────────────────────────
function registerUnknown(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const unknownId = _required(params, 'unknownId');
    const kind = _required(params, 'kind');
    if (!UNKNOWN_KINDS.includes(kind)) {
        throw new Error(`unknownsRegistry: invalid kind "${kind}"`);
    }
    const description = _required(params, 'description');
    const { debtScore } = computeAssumptionDebt(params);
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertUnknown.run(
            userId, env, unknownId, kind, description,
            params.impactSizing, params.impactConfidence,
            params.impactRegime, params.impactExecution,
            params.impactPortfolioRisk, debtScore, ts
        );
        return { registered: true, unknownId, debtScore };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`unknownsRegistry: duplicate unknownId "${unknownId}"`);
        }
        throw err;
    }
}

// ── escalateOldOrCritical ──────────────────────────────────────────
function escalateOldOrCritical(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const ageDaysThreshold = (params && params.ageDaysThreshold !== undefined)
        ? params.ageDaysThreshold : STALE_DAYS_THRESHOLD;
    const debtThreshold = (params && params.debtThreshold !== undefined)
        ? params.debtThreshold : CRITICAL_DEBT_THRESHOLD;
    const now = (params && params.now) ? params.now : Date.now();

    const rows = _stmts.listOpenUnknownsAll.all(userId, env);
    const escalated = [];
    for (const r of rows) {
        const ageDays = (now - r.ts_registered) / DAY_MS;
        const isCritical = r.debt_score >= debtThreshold;
        const isStale = ageDays >= ageDaysThreshold;
        if (isCritical || isStale) {
            escalated.push({
                unknownId: r.unknown_id, kind: r.kind,
                debtScore: r.debt_score, ageDays,
                reason: isCritical && isStale ? 'critical_and_stale'
                    : (isCritical ? 'critical_debt' : 'stale')
            });
        }
    }
    return escalated;
}

// ── recordDebtAction ───────────────────────────────────────────────
function recordDebtAction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const auditId = _required(params, 'auditId');
    const unknownId = _required(params, 'unknownId');
    const action = _required(params, 'action');
    if (!DEBT_ACTIONS.includes(action)) {
        throw new Error(`unknownsRegistry: invalid action "${action}"`);
    }
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertAudit.run(
            userId, env, auditId, unknownId, action, reason, ts
        );
        return { recorded: true, auditId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`unknownsRegistry: duplicate auditId "${auditId}"`);
        }
        throw err;
    }
}

// ── resolveUnknown ─────────────────────────────────────────────────
function resolveUnknown(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const unknownId = _required(params, 'unknownId');
    const resolution = _required(params, 'resolution');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const u = _stmts.getUnknown.get(unknownId);
    if (!u) {
        throw new Error(`unknownsRegistry: unknown "${unknownId}" not found`);
    }
    if (u.user_id !== userId || u.resolved_env !== env) {
        throw new Error('unknownsRegistry: unknown not owned by user/env');
    }
    _stmts.updateUnknownStatus.run(
        'RESOLVED', ts, userId, env, unknownId
    );
    return { resolved: true, unknownId, resolution };
}

// ── getActiveUnknowns ──────────────────────────────────────────────
function getActiveUnknowns(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kindFilter = params && params.kindFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (kindFilter && !UNKNOWN_KINDS.includes(kindFilter)) {
        throw new Error(`unknownsRegistry: invalid kindFilter "${kindFilter}"`);
    }
    const rows = kindFilter
        ? _stmts.listActiveUnknownsByKind.all(userId, env, kindFilter, limit)
        : _stmts.listActiveUnknowns.all(userId, env, limit);
    return rows.map(r => ({
        unknownId: r.unknown_id, kind: r.kind,
        description: r.description,
        impactSizing: r.impact_sizing,
        impactConfidence: r.impact_confidence,
        impactRegime: r.impact_regime,
        impactExecution: r.impact_execution,
        impactPortfolioRisk: r.impact_portfolio_risk,
        debtScore: r.debt_score,
        status: r.status,
        tsRegistered: r.ts_registered,
        tsResolved: r.ts_resolved
    }));
}

module.exports = {
    UNKNOWN_KINDS,
    DEBT_ACTIONS,
    STATUSES,
    CRITICAL_DEBT_THRESHOLD,
    STALE_DAYS_THRESHOLD,
    computeAssumptionDebt,
    registerUnknown,
    escalateOldOrCritical,
    recordDebtAction,
    resolveUnknown,
    getActiveUnknowns
};
