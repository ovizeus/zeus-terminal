'use strict';

/**
 * OMEGA R1 Constitution — constitutionalCharterLayer (canonical §116)
 *
 * §116 CONSTITUTIONAL REASONING / IMMUTABLE CHARTER LAYER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3076-3115.
 *
 * "Anumite principii NU trebuie sa fie negociabile, indiferent de cat de
 *  seducatoare pare o oportunitate... constitutional rulebook... principii
 *  imuabile... ierarhie: profit/safety/truth/compliance/integrity/
 *  long_term_survivability... constitutional conflict resolver... tagging
 *  fiecare decizie: constitutional_compliant/degraded/blocked... 'chiar daca
 *  pot face asta, am voie?'... charter-ul NU este tunabil live de policy
 *  layer... orice schimbare necesita governance separat + review explicit...
 *  constitutional blocks BAT utility optimization."
 *
 * Distinct from §10 supremePrinciple (cognitive intelligence what-it-is),
 * §104 integrityConstraintLayer (ecosystem peer-predation), §66
 * complianceLayer (legal/regulatory). §116 = SELF-IMPOSED IMMUTABLE
 * charter with hierarchy enforcement.
 */

const { db } = require('../../database');

const PRINCIPLE_KINDS = Object.freeze([
    'profit', 'safety', 'truth', 'compliance',
    'integrity', 'long_term_survivability'
]);
const CHARTER_STATUSES = Object.freeze([
    'CONSTITUTIONAL_COMPLIANT',
    'CONSTITUTIONALLY_DEGRADED',
    'CONSTITUTIONALLY_BLOCKED'
]);

// Canonical hierarchy per §116 line 3088-3094:
// safety > truth > compliance > integrity > long_term_survivability > profit
const DEFAULT_PRIORITY_RANKS = Object.freeze({
    safety: 1,
    truth: 2,
    compliance: 3,
    integrity: 4,
    long_term_survivability: 5,
    profit: 6
});

const BLOCKING_RANK_CEILING = 3;   // ranks 1-3 are hard blockers

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`constitutionalCharterLayer: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertPrinciple: db.prepare(`
        INSERT INTO ml_charter_principles
        (user_id, resolved_env, principle_id, kind, priority_rank,
         description, is_active, ts_created, ts_last_updated)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `),
    listActivePrinciples: db.prepare(`
        SELECT * FROM ml_charter_principles
        WHERE user_id = ? AND resolved_env = ? AND is_active = 1
        ORDER BY priority_rank ASC LIMIT ?
    `),
    listActivePrinciplesByKind: db.prepare(`
        SELECT * FROM ml_charter_principles
        WHERE user_id = ? AND resolved_env = ?
          AND is_active = 1 AND kind = ?
        ORDER BY priority_rank ASC LIMIT ?
    `),
    getPriorityMap: db.prepare(`
        SELECT kind, priority_rank FROM ml_charter_principles
        WHERE user_id = ? AND resolved_env = ? AND is_active = 1
    `),
    insertDecision: db.prepare(`
        INSERT INTO ml_charter_decisions
        (user_id, resolved_env, decision_id, action_summary,
         conflicting_principles_json, charter_status,
         utility_score, override_reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listDecisions: db.prepare(`
        SELECT * FROM ml_charter_decisions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    listDecisionsByStatus: db.prepare(`
        SELECT * FROM ml_charter_decisions
        WHERE user_id = ? AND resolved_env = ? AND charter_status = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── resolveConflict (pure) ─────────────────────────────────────────
// Enforces canonical hierarchy: lowest priority_rank principle in conflict
// determines outcome. Ranks 1-3 = hard blockers (canonical line 3111).
function resolveConflict(params) {
    const involvedKinds = _required(params, 'involvedPrincipleKinds');
    const priorityMap = (params && params.registeredPriorityMap)
        ? params.registeredPriorityMap : DEFAULT_PRIORITY_RANKS;
    const blockingCeiling = (params && params.blockingRankCeiling !== undefined)
        ? params.blockingRankCeiling : BLOCKING_RANK_CEILING;

    if (!Array.isArray(involvedKinds) || involvedKinds.length === 0) {
        return {
            charterStatus: 'CONSTITUTIONAL_COMPLIANT',
            triggeringPrinciple: null,
            triggeringRank: null,
            reason: 'no_conflicts'
        };
    }

    let topPrinciple = null;
    let topRank = Infinity;
    for (const k of involvedKinds) {
        if (!PRINCIPLE_KINDS.includes(k)) {
            throw new Error(
                `constitutionalCharterLayer: invalid principle kind "${k}"`
            );
        }
        const rank = priorityMap[k];
        if (typeof rank !== 'number') continue;
        if (rank < topRank) {
            topRank = rank;
            topPrinciple = k;
        }
    }

    if (topPrinciple === null) {
        return {
            charterStatus: 'CONSTITUTIONAL_COMPLIANT',
            triggeringPrinciple: null,
            triggeringRank: null,
            reason: 'no_registered_principles_matched'
        };
    }

    if (topRank <= blockingCeiling) {
        return {
            charterStatus: 'CONSTITUTIONALLY_BLOCKED',
            triggeringPrinciple: topPrinciple,
            triggeringRank: topRank,
            reason: `top-${blockingCeiling}_principle_conflict`
        };
    }

    // Profit-only conflicts (rank 6) → COMPLIANT (canonical hierarchy)
    if (topPrinciple === 'profit') {
        return {
            charterStatus: 'CONSTITUTIONAL_COMPLIANT',
            triggeringPrinciple: 'profit',
            triggeringRank: topRank,
            reason: 'profit_only_no_higher_principle'
        };
    }

    return {
        charterStatus: 'CONSTITUTIONALLY_DEGRADED',
        triggeringPrinciple: topPrinciple,
        triggeringRank: topRank,
        reason: 'non_blocking_principle_compromised'
    };
}

// ── registerPrinciple ──────────────────────────────────────────────
function registerPrinciple(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const principleId = _required(params, 'principleId');
    const kind = _required(params, 'kind');
    if (!PRINCIPLE_KINDS.includes(kind)) {
        throw new Error(`constitutionalCharterLayer: invalid kind "${kind}"`);
    }
    const priorityRank = (params && params.priorityRank !== undefined)
        ? params.priorityRank : DEFAULT_PRIORITY_RANKS[kind];
    if (priorityRank < 1) {
        throw new Error('constitutionalCharterLayer: priorityRank must be >= 1');
    }
    const description = _required(params, 'description');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertPrinciple.run(
            userId, env, principleId, kind,
            priorityRank, description, ts, ts
        );
        return { registered: true, principleId, priorityRank };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `constitutionalCharterLayer: duplicate principleId "${principleId}"`
            );
        }
        throw err;
    }
}

// ── evaluateDecisionAgainstCharter ─────────────────────────────────
function evaluateDecisionAgainstCharter(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const principleKinds = _required(params, 'principleKinds');
    const utilityScore = (params && params.utilityScore !== undefined)
        ? params.utilityScore : null;

    // Build priority map from registered principles; fallback DEFAULT
    const rows = _stmts.getPriorityMap.all(userId, env);
    const map = { ...DEFAULT_PRIORITY_RANKS };
    for (const r of rows) {
        map[r.kind] = r.priority_rank;
    }
    return resolveConflict({
        involvedPrincipleKinds: principleKinds,
        registeredPriorityMap: map,
        utilityScore
    });
}

// ── recordCharterDecision ──────────────────────────────────────────
function recordCharterDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const actionSummary = _required(params, 'actionSummary');
    const conflictingPrinciples = _required(params, 'conflictingPrinciples');
    const charterStatus = _required(params, 'charterStatus');
    if (!CHARTER_STATUSES.includes(charterStatus)) {
        throw new Error(
            `constitutionalCharterLayer: invalid charterStatus "${charterStatus}"`
        );
    }
    const utilityScore = (params && params.utilityScore !== undefined)
        ? params.utilityScore : null;
    const overrideReason = (params && params.overrideReason)
        ? params.overrideReason : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertDecision.run(
            userId, env, decisionId, actionSummary,
            JSON.stringify(conflictingPrinciples),
            charterStatus, utilityScore, overrideReason, ts
        );
        return { recorded: true, decisionId, charterStatus };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `constitutionalCharterLayer: duplicate decisionId "${decisionId}"`
            );
        }
        throw err;
    }
}

// ── getActivePrinciples ────────────────────────────────────────────
function getActivePrinciples(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kindFilter = params && params.kindFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (kindFilter && !PRINCIPLE_KINDS.includes(kindFilter)) {
        throw new Error(
            `constitutionalCharterLayer: invalid kindFilter "${kindFilter}"`
        );
    }
    const rows = kindFilter
        ? _stmts.listActivePrinciplesByKind.all(userId, env, kindFilter, limit)
        : _stmts.listActivePrinciples.all(userId, env, limit);
    return rows.map(r => ({
        principleId: r.principle_id,
        kind: r.kind,
        priorityRank: r.priority_rank,
        description: r.description,
        isActive: !!r.is_active,
        tsCreated: r.ts_created,
        tsLastUpdated: r.ts_last_updated
    }));
}

// ── getCharterDecisions ────────────────────────────────────────────
function getCharterDecisions(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const statusFilter = params && params.statusFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (statusFilter && !CHARTER_STATUSES.includes(statusFilter)) {
        throw new Error(
            `constitutionalCharterLayer: invalid statusFilter "${statusFilter}"`
        );
    }
    const rows = statusFilter
        ? _stmts.listDecisionsByStatus.all(userId, env, statusFilter, limit)
        : _stmts.listDecisions.all(userId, env, limit);
    return rows.map(r => ({
        decisionId: r.decision_id,
        actionSummary: r.action_summary,
        conflictingPrinciples: JSON.parse(r.conflicting_principles_json),
        charterStatus: r.charter_status,
        utilityScore: r.utility_score,
        overrideReason: r.override_reason,
        ts: r.ts
    }));
}

module.exports = {
    PRINCIPLE_KINDS,
    CHARTER_STATUSES,
    DEFAULT_PRIORITY_RANKS,
    BLOCKING_RANK_CEILING,
    resolveConflict,
    registerPrinciple,
    evaluateDecisionAgainstCharter,
    recordCharterDecision,
    getActivePrinciples,
    getCharterDecisions
};
