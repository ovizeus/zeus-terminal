'use strict';

/**
 * OMEGA R2 Cognition — adaptiveReasoningRouter (canonical §110)
 *
 * §110 ADAPTIVE COGNITIVE ROUTING / REASONING PATH PLANNER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2869-2898.
 *
 * "In unele situatii macro+derivatives sunt dominante. In altele microstructure
 *  +execution decid totul... alegere adaptiva a modulelor care merita
 *  consultate... skip logic pentru module irelevante... deep-dive pentru
 *  module critice... 'pentru acest caz concret, ce fir de gandire merita
 *  rulat?'... safety si veto modules au prioritate constanta... reasoning
 *  path trebuie logat si auditabil."
 *
 * Distinct from §9 thinkingPipeline (fixed chain), §24 detectorRegistry
 * (catalog), §85 computeBudgetGovernor (mode binary), §99 activeSensingPolicy
 * (data-query). §110 = context-aware per-decision module selection.
 */

const { db } = require('../../database');

const MODULE_KINDS = Object.freeze(['safety', 'veto', 'normal']);

const SAFETY_PRIORITY = 100;
const VETO_PRIORITY = 99;
const DEFAULT_NORMAL_PRIORITY = 50;
const MIN_DEEP_DIVE_BUDGET = 0.5;
const DEFAULT_NORMAL_COST = 0.1;

const DEFAULT_PRIORITY_BY_KIND = Object.freeze({
    safety: SAFETY_PRIORITY,
    veto: VETO_PRIORITY,
    normal: DEFAULT_NORMAL_PRIORITY
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`adaptiveReasoningRouter: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertPriority: db.prepare(`
        INSERT INTO ml_module_priorities
        (user_id, resolved_env, priority_id, module_id, kind,
         constant_priority, is_active, last_invoked, ts)
        VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?)
    `),
    listPriorities: db.prepare(`
        SELECT * FROM ml_module_priorities
        WHERE user_id = ? AND resolved_env = ? AND is_active = 1
        ORDER BY constant_priority DESC, ts DESC LIMIT ?
    `),
    listPrioritiesByKind: db.prepare(`
        SELECT * FROM ml_module_priorities
        WHERE user_id = ? AND resolved_env = ?
          AND is_active = 1 AND kind = ?
        ORDER BY constant_priority DESC, ts DESC LIMIT ?
    `),
    insertPath: db.prepare(`
        INSERT INTO ml_reasoning_paths
        (user_id, resolved_env, path_id, decision_context_json,
         modules_included_json, modules_skipped_json,
         cognitive_budget_used, justification, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listPaths: db.prepare(`
        SELECT * FROM ml_reasoning_paths
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── enforceSafetyVeto (pure) ───────────────────────────────────────
// Rule §110 line 2892: safety + veto modules NEVER skippable.
function enforceSafetyVeto(params) {
    const modulesIncluded = _required(params, 'modulesIncluded');
    const modulesSkipped = _required(params, 'modulesSkipped');
    const safetyIds = new Set(params && params.safetyModuleIds
        ? params.safetyModuleIds : []);
    const vetoIds = new Set(params && params.vetoModuleIds
        ? params.vetoModuleIds : []);

    const skippedIds = new Set(modulesSkipped.map(m => m.moduleId || m));
    for (const id of safetyIds) {
        if (skippedIds.has(id)) {
            throw new Error(
                `adaptiveReasoningRouter: safety module "${id}" cannot be skipped — ` +
                'safety has constant priority per §110'
            );
        }
    }
    for (const id of vetoIds) {
        if (skippedIds.has(id)) {
            throw new Error(
                `adaptiveReasoningRouter: veto module "${id}" cannot be skipped — ` +
                'veto has constant priority per §110'
            );
        }
    }
    return { valid: true, includedCount: modulesIncluded.length, skippedCount: modulesSkipped.length };
}

// ── selectReasoningPath (pure) ─────────────────────────────────────
function selectReasoningPath(params) {
    const contextSignals = _required(params, 'contextSignals');
    const candidateModules = _required(params, 'candidateModules');
    const cognitiveBudget = _required(params, 'cognitiveBudget');
    if (cognitiveBudget < 0) {
        throw new Error('adaptiveReasoningRouter: cognitiveBudget must be >= 0');
    }

    const included = [];
    const skipped = [];
    let budgetUsed = 0;

    // Pass 1: always include safety + veto regardless of budget
    for (const m of candidateModules) {
        if (m.kind === 'safety' || m.kind === 'veto') {
            included.push(m);
            const cost = typeof m.cost === 'number' ? m.cost : DEFAULT_NORMAL_COST;
            budgetUsed += cost;
        }
    }

    // Pass 2: rank normal modules by context_relevance × priority, fit in budget
    const normals = candidateModules
        .filter(m => m.kind === 'normal' || (!m.kind))
        .map(m => ({
            ...m,
            kind: m.kind || 'normal',
            priority: typeof m.priority === 'number' ? m.priority : DEFAULT_NORMAL_PRIORITY,
            contextRelevance: typeof m.contextRelevance === 'number' ? m.contextRelevance : 0,
            cost: typeof m.cost === 'number' ? m.cost : DEFAULT_NORMAL_COST
        }))
        .map(m => ({ ...m, _rank: m.contextRelevance * m.priority }))
        .sort((a, b) => b._rank - a._rank);

    for (const m of normals) {
        const remaining = cognitiveBudget - budgetUsed;
        if (m.cost <= remaining) {
            included.push(m);
            budgetUsed += m.cost;
        } else {
            skipped.push(m);
        }
    }

    let justification;
    if (included.length === 0) {
        justification = 'no_modules_selected_budget_exhausted_or_empty';
    } else if (skipped.length === 0) {
        justification = 'full_path_selected_budget_sufficient';
    } else {
        justification = `budget_constrained_${included.length}_of_${candidateModules.length}_modules`;
    }

    return {
        modulesIncluded: included,
        modulesSkipped: skipped,
        cognitiveBudgetUsed: budgetUsed,
        justification,
        contextSignals
    };
}

// ── registerModulePriority ─────────────────────────────────────────
function registerModulePriority(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const priorityId = _required(params, 'priorityId');
    const moduleId = _required(params, 'moduleId');
    const kind = _required(params, 'kind');
    if (!MODULE_KINDS.includes(kind)) {
        throw new Error(`adaptiveReasoningRouter: invalid kind "${kind}"`);
    }
    const constantPriority = (params && params.constantPriority !== undefined)
        ? params.constantPriority : DEFAULT_PRIORITY_BY_KIND[kind];
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertPriority.run(
            userId, env, priorityId, moduleId, kind,
            constantPriority, ts
        );
        return { registered: true, priorityId, constantPriority };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`adaptiveReasoningRouter: duplicate priorityId "${priorityId}"`);
        }
        throw err;
    }
}

// ── recordReasoningPath ────────────────────────────────────────────
function recordReasoningPath(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const pathId = _required(params, 'pathId');
    const decisionContext = _required(params, 'decisionContext');
    const modulesIncluded = _required(params, 'modulesIncluded');
    const modulesSkipped = _required(params, 'modulesSkipped');
    const cognitiveBudgetUsed = _required(params, 'cognitiveBudgetUsed');
    if (cognitiveBudgetUsed < 0) {
        throw new Error('adaptiveReasoningRouter: cognitiveBudgetUsed must be >= 0');
    }
    const justification = _required(params, 'justification');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertPath.run(
            userId, env, pathId,
            JSON.stringify(decisionContext),
            JSON.stringify(modulesIncluded),
            JSON.stringify(modulesSkipped),
            cognitiveBudgetUsed, justification, ts
        );
        return { recorded: true, pathId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`adaptiveReasoningRouter: duplicate pathId "${pathId}"`);
        }
        throw err;
    }
}

// ── getActiveModulePriorities ──────────────────────────────────────
function getActiveModulePriorities(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kind = params && params.kind;
    const limit = (params && params.limit) ? params.limit : 100;

    if (kind && !MODULE_KINDS.includes(kind)) {
        throw new Error(`adaptiveReasoningRouter: invalid kind "${kind}"`);
    }
    const rows = kind
        ? _stmts.listPrioritiesByKind.all(userId, env, kind, limit)
        : _stmts.listPriorities.all(userId, env, limit);
    return rows.map(r => ({
        priorityId: r.priority_id,
        moduleId: r.module_id,
        kind: r.kind,
        constantPriority: r.constant_priority,
        isActive: !!r.is_active,
        lastInvoked: r.last_invoked,
        ts: r.ts
    }));
}

// ── getReasoningHistory ────────────────────────────────────────────
function getReasoningHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listPaths.all(userId, env, limit);
    return rows.map(r => ({
        pathId: r.path_id,
        decisionContext: JSON.parse(r.decision_context_json),
        modulesIncluded: JSON.parse(r.modules_included_json),
        modulesSkipped: JSON.parse(r.modules_skipped_json),
        cognitiveBudgetUsed: r.cognitive_budget_used,
        justification: r.justification,
        ts: r.ts
    }));
}

module.exports = {
    MODULE_KINDS,
    SAFETY_PRIORITY,
    VETO_PRIORITY,
    DEFAULT_NORMAL_PRIORITY,
    MIN_DEEP_DIVE_BUDGET,
    DEFAULT_PRIORITY_BY_KIND,
    enforceSafetyVeto,
    selectReasoningPath,
    registerModulePriority,
    recordReasoningPath,
    getActiveModulePriorities,
    getReasoningHistory
};
