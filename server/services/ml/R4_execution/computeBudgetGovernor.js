'use strict';

/**
 * OMEGA R4 Execution — computeBudgetGovernor (canonical §85)
 *
 * §85 REAL-TIME DEADLINE / COMPUTE BUDGET GOVERNOR.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2152-2191.
 *
 * "Decizie 'excelenta' dar prea tarziu = mai proasta decat decizie
 *  simpla la timp. Nu pierde deadline din cauza overthinking computational."
 *
 * R4 execution. Proactive inference mode selection BEFORE deadline missed.
 * 3 modes: full_stack / reduced_stack / emergency_safety.
 *
 * Distinct from §45 latencyAwareExecution (measures feed→decision latency).
 * §85 = PROACTIVELY choose simpler model when budget tight.
 *
 * Safety priority: emergency_exit ALWAYS uses full_stack regardless of
 * compute budget (safety overrides cost).
 */

const { db } = require('../../database');

const DECISION_TYPES = Object.freeze([
    'scalp', 'intraday', 'swing', 'emergency_exit'
]);
const INFERENCE_MODES = Object.freeze([
    'full_stack', 'reduced_stack', 'emergency_safety'
]);
const SAFETY_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'critical']);

const DEFAULT_DEADLINES_MS = Object.freeze({
    scalp: 500, intraday: 5000, swing: 30000, emergency_exit: 100
});
const FULL_STACK_MARGIN_MS = 50;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`computeBudgetGovernor: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    upsertBudget: db.prepare(`
        INSERT INTO ml_compute_budgets
        (user_id, resolved_env, decision_type, deadline_ms,
         compute_budget_ms, safety_priority, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, decision_type) DO UPDATE SET
            deadline_ms = excluded.deadline_ms,
            compute_budget_ms = excluded.compute_budget_ms,
            safety_priority = excluded.safety_priority,
            last_updated = excluded.last_updated
    `),
    getBudget: db.prepare(`
        SELECT * FROM ml_compute_budgets
        WHERE user_id = ? AND resolved_env = ? AND decision_type = ?
    `),
    insertInference: db.prepare(`
        INSERT INTO ml_inference_decisions
        (user_id, resolved_env, inference_id, decision_type,
         time_remaining_ms, estimated_cost_ms, chosen_mode,
         early_exit_triggered, reasoning, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    inferenceStats: db.prepare(`
        SELECT chosen_mode, decision_type, COUNT(*) AS count,
               AVG(time_remaining_ms) AS avg_time_remaining,
               SUM(early_exit_triggered) AS early_exits
        FROM ml_inference_decisions
        WHERE user_id = ? AND resolved_env = ?
          AND ts >= ?
        GROUP BY chosen_mode, decision_type
    `)
};

// ── configureBudget ────────────────────────────────────────────────
function configureBudget(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionType = _required(params, 'decisionType');
    const deadlineMs = (params && params.deadlineMs)
        ? params.deadlineMs : DEFAULT_DEADLINES_MS[decisionType];
    const computeBudgetMs = _required(params, 'computeBudgetMs');
    const safetyPriority = (params && params.safetyPriority)
        ? params.safetyPriority : 'normal';
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!DECISION_TYPES.includes(decisionType)) {
        throw new Error(`computeBudgetGovernor: invalid decisionType "${decisionType}"`);
    }
    if (!SAFETY_PRIORITIES.includes(safetyPriority)) {
        throw new Error(`computeBudgetGovernor: invalid safetyPriority "${safetyPriority}"`);
    }
    if (computeBudgetMs > deadlineMs) {
        throw new Error('computeBudgetGovernor: computeBudgetMs cannot exceed deadlineMs');
    }

    _stmts.upsertBudget.run(
        userId, env, decisionType, deadlineMs,
        computeBudgetMs, safetyPriority, ts
    );

    return { configured: true, decisionType, deadlineMs };
}

// ── chooseInferenceMode ────────────────────────────────────────────
function chooseInferenceMode(params) {
    const decisionType = _required(params, 'decisionType');
    const timeRemainingMs = _required(params, 'timeRemainingMs');
    const estimatedFullCostMs = _required(params, 'estimatedFullCostMs');
    const estimatedReducedCostMs = _required(params, 'estimatedReducedCostMs');

    if (!DECISION_TYPES.includes(decisionType)) {
        throw new Error(`computeBudgetGovernor: invalid decisionType "${decisionType}"`);
    }

    // Safety override: emergency_exit always full_stack
    if (decisionType === 'emergency_exit') {
        return {
            mode: 'full_stack',
            earlyExit: false,
            reasoning: 'emergency_exit safety overrides budget — full_stack mandatory'
        };
    }

    if (timeRemainingMs >= estimatedFullCostMs + FULL_STACK_MARGIN_MS) {
        return {
            mode: 'full_stack',
            earlyExit: false,
            reasoning: `time ${timeRemainingMs}ms >= full ${estimatedFullCostMs}ms + margin`
        };
    }

    if (timeRemainingMs >= estimatedReducedCostMs + FULL_STACK_MARGIN_MS) {
        return {
            mode: 'reduced_stack',
            earlyExit: false,
            reasoning: `time ${timeRemainingMs}ms too tight for full; reduced fits`
        };
    }

    return {
        mode: 'emergency_safety',
        earlyExit: true,
        reasoning: `time ${timeRemainingMs}ms below reduced threshold; emergency safety mode`
    };
}

// ── recordInferenceDecision ────────────────────────────────────────
function recordInferenceDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const inferenceId = _required(params, 'inferenceId');
    const decisionType = _required(params, 'decisionType');
    const timeRemainingMs = _required(params, 'timeRemainingMs');
    const estimatedCostMs = _required(params, 'estimatedCostMs');
    const chosenMode = _required(params, 'chosenMode');
    const earlyExitTriggered = !!params.earlyExitTriggered;
    const reasoning = (params && params.reasoning) ? params.reasoning : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!INFERENCE_MODES.includes(chosenMode)) {
        throw new Error(`computeBudgetGovernor: invalid chosenMode "${chosenMode}"`);
    }
    if (!DECISION_TYPES.includes(decisionType)) {
        throw new Error(`computeBudgetGovernor: invalid decisionType "${decisionType}"`);
    }

    try {
        _stmts.insertInference.run(
            userId, env, inferenceId, decisionType,
            timeRemainingMs, estimatedCostMs, chosenMode,
            earlyExitTriggered ? 1 : 0, reasoning, ts
        );
        return { recorded: true };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`computeBudgetGovernor: duplicate inferenceId "${inferenceId}"`);
        }
        throw err;
    }
}

// ── getBudget ──────────────────────────────────────────────────────
function getBudget(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionType = _required(params, 'decisionType');
    const row = _stmts.getBudget.get(userId, env, decisionType);
    if (!row) return null;
    return {
        decisionType: row.decision_type,
        deadlineMs: row.deadline_ms,
        computeBudgetMs: row.compute_budget_ms,
        safetyPriority: row.safety_priority,
        lastUpdated: row.last_updated
    };
}

// ── getInferenceStats ──────────────────────────────────────────────
function getInferenceStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.inferenceStats.all(userId, env, since);

    return {
        byModeAndDecision: rows.map(r => ({
            chosenMode: r.chosen_mode,
            decisionType: r.decision_type,
            count: r.count,
            avgTimeRemainingMs: r.avg_time_remaining,
            earlyExits: r.early_exits
        })),
        total: rows.reduce((s, r) => s + r.count, 0)
    };
}

// ── evaluateDeadlineHealth ─────────────────────────────────────────
function evaluateDeadlineHealth(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionType = _required(params, 'decisionType');
    const recentObservations = _required(params, 'recentObservations');

    if (!Array.isArray(recentObservations) || recentObservations.length === 0) {
        return { healthy: false, reason: 'no_observations' };
    }

    const budget = getBudget({ userId, resolvedEnv: env, decisionType });
    if (!budget) {
        return { healthy: false, reason: 'no_budget_configured' };
    }

    const overBudget = recentObservations.filter(o => o.actualMs > budget.computeBudgetMs).length;
    const overBudgetRate = overBudget / recentObservations.length;

    return {
        healthy: overBudgetRate < 0.20,
        overBudgetRate,
        overBudgetCount: overBudget,
        totalObservations: recentObservations.length,
        decisionType
    };
}

module.exports = {
    DECISION_TYPES,
    INFERENCE_MODES,
    SAFETY_PRIORITIES,
    DEFAULT_DEADLINES_MS,
    FULL_STACK_MARGIN_MS,
    configureBudget,
    chooseInferenceMode,
    recordInferenceDecision,
    getBudget,
    getInferenceStats,
    evaluateDeadlineHealth
};
