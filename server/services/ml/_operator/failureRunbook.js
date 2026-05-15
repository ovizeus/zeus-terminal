'use strict';

/**
 * OMEGA Operator Interaction — failureRunbook (expert-obs OBS-5)
 *
 * OBS-5 FAILURE MODE RUNBOOK OPS-GRADE.
 * Source: project_ml_v3_expert_observations_2026-05-05.md
 * Priority: P1.
 *
 * Per known failure mode:
 *   - Trigger signals (e.g. ['latency_severe', 'api_rate_limited'])
 *   - Steps to take (notify_operator, enable_observer, etc.)
 *   - Auto-execute permission
 *   - Severity classification
 *
 * Signal-driven matching: incoming signals → matching runbooks sorted by severity.
 * Audit log of executions (AUTO/MANUAL/DRY_RUN modes).
 */

const { db } = require('../../database');

const RUNBOOK_SEVERITY = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const EXECUTION_MODES = Object.freeze(['AUTO', 'MANUAL', 'DRY_RUN']);

const STEP_TYPES = Object.freeze([
    'flatten_positions',
    'trigger_panic',
    'reduce_size',
    'enable_observer',
    'notify_operator',
    'rollback_config',
    'pause_at',
    'snapshot_diagnostics'
]);

const SEVERITY_RANK = Object.freeze({
    LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`failureRunbook: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertRunbook: db.prepare(`
        INSERT INTO ml_runbooks
        (runbook_id, name, trigger_signals_json, steps_json,
         auto_execute, severity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getRunbook: db.prepare(`
        SELECT * FROM ml_runbooks WHERE runbook_id = ?
    `),
    listAllRunbooks: db.prepare(`
        SELECT * FROM ml_runbooks ORDER BY severity DESC, created_at ASC
    `),
    listBySeverity: db.prepare(`
        SELECT * FROM ml_runbooks WHERE severity = ? ORDER BY created_at ASC
    `),
    insertExecution: db.prepare(`
        INSERT INTO ml_runbook_executions
        (user_id, resolved_env, runbook_id, mode, actor,
         matched_signals_json, steps_executed, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listExecutions: db.prepare(`
        SELECT * FROM ml_runbook_executions
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── Helper ─────────────────────────────────────────────────────────
function _rowToRunbook(row) {
    return {
        runbookId: row.runbook_id,
        name: row.name,
        triggerSignals: JSON.parse(row.trigger_signals_json),
        steps: JSON.parse(row.steps_json),
        autoExecute: row.auto_execute === 1,
        severity: row.severity,
        createdAt: row.created_at
    };
}

// ── registerRunbook ────────────────────────────────────────────────
function registerRunbook(params) {
    const runbookId = _required(params, 'runbookId');
    const name = _required(params, 'name');
    const triggerSignals = _required(params, 'triggerSignals');
    const steps = _required(params, 'steps');
    const autoExecute = !!(params && params.autoExecute);
    const severity = _required(params, 'severity');

    if (!RUNBOOK_SEVERITY.includes(severity)) {
        throw new Error(`failureRunbook: invalid severity "${severity}"`);
    }

    _stmts.insertRunbook.run(
        runbookId, name,
        JSON.stringify(triggerSignals),
        JSON.stringify(steps),
        autoExecute ? 1 : 0,
        severity,
        Date.now()
    );

    return { registered: true, runbookId };
}

// ── detectMatchingRunbook (pure) ───────────────────────────────────
function detectMatchingRunbook(params) {
    const signals = (params && Array.isArray(params.signals)) ? params.signals : [];

    const allRunbooks = _stmts.listAllRunbooks.all().map(_rowToRunbook);

    const matches = allRunbooks.filter(rb =>
        rb.triggerSignals.some(s => signals.includes(s))
    );

    // Sort by severity (CRITICAL first)
    matches.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

    return matches;
}

// ── executeRunbook ─────────────────────────────────────────────────
function executeRunbook(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const runbookId = _required(params, 'runbookId');
    const actor = _required(params, 'actor');
    const mode = _required(params, 'mode');
    const matchedSignals = (params && Array.isArray(params.matchedSignals))
        ? params.matchedSignals : [];

    if (!EXECUTION_MODES.includes(mode)) {
        throw new Error(`failureRunbook: invalid mode "${mode}"`);
    }

    const row = _stmts.getRunbook.get(runbookId);
    if (!row) {
        throw new Error(`failureRunbook: runbookId "${runbookId}" not found`);
    }
    const runbook = _rowToRunbook(row);

    const status = mode === 'DRY_RUN' ? 'SIMULATED' : 'EXECUTED';
    const stepsExecuted = mode === 'DRY_RUN' ? 0 : runbook.steps.length;

    _stmts.insertExecution.run(
        userId, env, runbookId, mode, actor,
        JSON.stringify(matchedSignals),
        stepsExecuted, status, Date.now()
    );

    return {
        executed: status === 'EXECUTED',
        runbookId,
        mode,
        steps: runbook.steps,
        status
    };
}

// ── getRunbookHistory ──────────────────────────────────────────────
function getRunbookHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listExecutions.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );

    return rows.map(r => ({
        id: r.id,
        runbookId: r.runbook_id,
        mode: r.mode,
        actor: r.actor,
        matchedSignals: JSON.parse(r.matched_signals_json),
        stepsExecuted: r.steps_executed,
        status: r.status,
        createdAt: r.created_at
    }));
}

// ── listRunbooks ───────────────────────────────────────────────────
function listRunbooks(params) {
    const filter = params || {};
    let rows;
    if (filter.severity) {
        rows = _stmts.listBySeverity.all(filter.severity);
    } else {
        rows = _stmts.listAllRunbooks.all();
    }
    return rows.map(_rowToRunbook);
}

module.exports = {
    RUNBOOK_SEVERITY,
    EXECUTION_MODES,
    STEP_TYPES,
    SEVERITY_RANK,
    registerRunbook,
    detectMatchingRunbook,
    executeRunbook,
    getRunbookHistory,
    listRunbooks
};
