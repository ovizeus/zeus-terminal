'use strict';

/**
 * OMEGA Cross-cutting — adversarialSelfTester (canonical §44)
 *
 * §44 ADVERSARIAL SELF-TESTING.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1526-1527.
 *
 * Red team periodic (weekly or post-major update). Generate scenarios:
 *   - veto_bypass: high-score signal that should still be blocked
 *   - state_machine_edge: rare/invalid transitions
 *   - api_saturation: flood requests to budget exhaustion
 *   - latency_injection: artificial delays
 *   - feed_desync: cross-feed timestamp drift
 *   - flash_crash: extreme price move worst timing
 *
 * Verify safety mechanisms (circuit breakers, vetos) activate as expected.
 * "Robustețea reală vine din a ști că sistemul rezistă când lumea încearcă să-l spargă."
 */

const { db } = require('../../database');

const SCENARIO_TYPES = Object.freeze([
    'veto_bypass',
    'state_machine_edge',
    'api_saturation',
    'latency_injection',
    'feed_desync',
    'flash_crash'
]);

const EXECUTION_MODES = Object.freeze(['SIMULATED', 'ACTUAL']);
const SCENARIO_SEVERITY = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`adversarialSelfTester: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertRun: db.prepare(`
        INSERT INTO ml_adversarial_runs
        (scenario_id, name, type, payload_json, expected_safety_trigger,
         severity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getRun: db.prepare(`
        SELECT * FROM ml_adversarial_runs WHERE scenario_id = ?
    `),
    insertResult: db.prepare(`
        INSERT INTO ml_adversarial_results
        (user_id, resolved_env, scenario_id, mode, passed,
         observations_json, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listResults: db.prepare(`
        SELECT * FROM ml_adversarial_results
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `),
    passRate: db.prepare(`
        SELECT COUNT(*) AS total,
               SUM(passed) AS passed_count
        FROM ml_adversarial_results
        WHERE scenario_id = ?
          AND (? = 0 OR created_at >= ?)
    `)
};

// ── registerScenario ───────────────────────────────────────────────
function registerScenario(params) {
    const scenarioId = _required(params, 'scenarioId');
    const name = _required(params, 'name');
    const type = _required(params, 'type');
    const payload = _required(params, 'payload');
    const expectedSafetyTrigger = _required(params, 'expectedSafetyTrigger');
    const severity = _required(params, 'severity');

    if (!SCENARIO_TYPES.includes(type)) {
        throw new Error(`adversarialSelfTester: invalid type "${type}"`);
    }
    if (!SCENARIO_SEVERITY.includes(severity)) {
        throw new Error(`adversarialSelfTester: invalid severity "${severity}"`);
    }

    _stmts.insertRun.run(
        scenarioId, name, type,
        JSON.stringify(payload),
        expectedSafetyTrigger, severity,
        Date.now()
    );

    return { registered: true, scenarioId };
}

// ── runScenario ────────────────────────────────────────────────────
function runScenario(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const scenarioId = _required(params, 'scenarioId');
    const mode = _required(params, 'mode');

    if (!EXECUTION_MODES.includes(mode)) {
        throw new Error(`adversarialSelfTester: invalid mode "${mode}"`);
    }

    const scenario = _stmts.getRun.get(scenarioId);
    if (!scenario) {
        throw new Error(`adversarialSelfTester: scenario "${scenarioId}" not registered`);
    }

    void userId; void env;

    return {
        runId: scenarioId + '-' + Date.now(),
        mode,
        scenario: {
            scenarioId: scenario.scenario_id,
            name: scenario.name,
            type: scenario.type,
            payload: JSON.parse(scenario.payload_json),
            expectedSafetyTrigger: scenario.expected_safety_trigger,
            severity: scenario.severity
        }
    };
}

// ── recordResult ───────────────────────────────────────────────────
function recordResult(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const scenarioId = _required(params, 'scenarioId');
    const mode = _required(params, 'mode');
    const passed = !!params.passed;
    const observations = _required(params, 'observations');
    const durationMs = (params && typeof params.durationMs === 'number')
        ? params.durationMs : null;

    _stmts.insertResult.run(
        userId, env, scenarioId, mode,
        passed ? 1 : 0,
        JSON.stringify(observations),
        durationMs, Date.now()
    );

    return { recorded: true };
}

// ── getRedTeamHistory ──────────────────────────────────────────────
function getRedTeamHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listResults.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );

    return rows.map(r => ({
        id: r.id,
        scenarioId: r.scenario_id,
        mode: r.mode,
        passed: r.passed === 1,
        observations: JSON.parse(r.observations_json),
        durationMs: r.duration_ms,
        createdAt: r.created_at
    }));
}

// ── getScenarioPassRate ────────────────────────────────────────────
function getScenarioPassRate(params) {
    const scenarioId = _required(params, 'scenarioId');
    const since = (params && params.since) ? params.since : 0;

    const row = _stmts.passRate.get(
        scenarioId,
        since > 0 ? 1 : 0, since
    );

    const total = row.total || 0;
    const passed = row.passed_count || 0;

    return {
        total,
        passed,
        passRate: total > 0 ? passed / total : 0
    };
}

module.exports = {
    SCENARIO_TYPES,
    EXECUTION_MODES,
    SCENARIO_SEVERITY,
    registerScenario,
    runScenario,
    recordResult,
    getRedTeamHistory,
    getScenarioPassRate
};
