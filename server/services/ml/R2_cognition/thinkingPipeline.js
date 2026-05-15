'use strict';

/**
 * OMEGA R2 Cognition — thinkingPipeline (canonical §9)
 *
 * §9 FORMULA LUI CORECTA DE GANDIRE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 749-760.
 *
 * 12 sequential thinking steps (THE brain reasoning pipeline):
 *
 *   1. OBSERVA                                  → R2 detector outputs
 *   2. CLASIFICA_REGIMUL                        → §17 regimeMetrics
 *   3. VERIFICA_BIAS_GLOBAL                     → macro filter detector
 *   4. MAPEAZA_STRUCTURA                        → R2 structure cognition
 *   5. IDENTIFICA_LICHIDITATEA                  → R2 liquidity cognition
 *   6. VERIFICA_PARTICIPAREA_REALA              → §31 smart money
 *   7. VERIFICA_MACRO_CORELATII_OPTIONS_VENUES  → §31 + §32
 *   8. EVALUAZA_RISCUL_SI_EXECUTIA              → §30 portfolio + §23 TCA
 *   9. CALCULEAZA_AVANTAJUL                     → §16 attribution + §23 edge
 *  10. DECIDE_SAU_STA                           → §14 veto + §37 mode
 *  11. GESTIONEAZA                              → §26 RL position manager
 *  12. INVATA                                   → §16 + §22 + §25 explainability
 *
 * Conductor module. Orchestrates the entire brain reasoning loop.
 * Each step delegates to providing OMEGA modules (see STEP_TO_MODULE).
 */

const { db } = require('../../database');

const THINKING_STEPS = Object.freeze([
    'OBSERVA',
    'CLASIFICA_REGIMUL',
    'VERIFICA_BIAS_GLOBAL',
    'MAPEAZA_STRUCTURA',
    'IDENTIFICA_LICHIDITATEA',
    'VERIFICA_PARTICIPAREA_REALA',
    'VERIFICA_MACRO_CORELATII_OPTIONS_VENUES',
    'EVALUAZA_RISCUL_SI_EXECUTIA',
    'CALCULEAZA_AVANTAJUL',
    'DECIDE_SAU_STA',
    'GESTIONEAZA',
    'INVATA'
]);

const STEP_STATUSES = Object.freeze(['OK', 'SKIPPED', 'ERROR']);

// Step → providing OMEGA modules (traceability mapping).
const STEP_TO_MODULE = Object.freeze({
    OBSERVA:                                  ['R2:§24 detectorRegistry (sensor outputs)'],
    CLASIFICA_REGIMUL:                        ['R5A:§17 regimeMetrics'],
    VERIFICA_BIAS_GLOBAL:                     ['R2:§24 macro_filter detector'],
    MAPEAZA_STRUCTURA:                        ['R2:§27 temporalPatterns (structure)'],
    IDENTIFICA_LICHIDITATEA:                  ['R2:§24 liquidity_sweep detector'],
    VERIFICA_PARTICIPAREA_REALA:              ['R2:§31 smartMoneyDetector'],
    VERIFICA_MACRO_CORELATII_OPTIONS_VENUES:  ['R2:§31 + §32 optionsContextAnalyzer'],
    EVALUAZA_RISCUL_SI_EXECUTIA:              ['R3A:§30 portfolioGovernance + R4:§23 TCA'],
    CALCULEAZA_AVANTAJUL:                     ['R4:§23 evaluateEdgeVsCost'],
    DECIDE_SAU_STA:                           ['R3A:§14 conflictResolution + meta:§37 mode'],
    GESTIONEAZA:                              ['R6:§26 rlPositionManager'],
    INVATA:                                   ['R5A:§16 attribution + §22 dataHygiene + cross-cutting:§25 explainability']
});

// Critical steps that cannot be SKIPPED (must execute or pipeline halts).
const CRITICAL_STEPS = Object.freeze([
    'OBSERVA',
    'CLASIFICA_REGIMUL',
    'EVALUAZA_RISCUL_SI_EXECUTIA',
    'CALCULEAZA_AVANTAJUL',
    'DECIDE_SAU_STA',
    'INVATA'
]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`thinkingPipeline: missing ${key}`);
    }
    return params[key];
}

function _validateStep(step) {
    if (!THINKING_STEPS.includes(step)) {
        throw new Error(`thinkingPipeline: invalid step "${step}"`);
    }
}

function _validateStatus(status) {
    if (!STEP_STATUSES.includes(status)) {
        throw new Error(`thinkingPipeline: invalid status "${status}"`);
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertTrace: db.prepare(`
        INSERT INTO ml_thinking_traces
        (user_id, resolved_env, decision_id, step, step_index,
         input_json, output_json, status, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectTrace: db.prepare(`
        SELECT * FROM ml_thinking_traces
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY step_index ASC, id ASC
    `),
    selectStepStats: db.prepare(`
        SELECT step, status, COUNT(*) AS count, AVG(duration_ms) AS avg_duration
        FROM ml_thinking_traces
        WHERE user_id = ? AND resolved_env = ?
          AND (? IS NULL OR step = ?)
          AND (? = 0 OR created_at >= ?)
        GROUP BY step, status
    `)
};

// ── executeStep ────────────────────────────────────────────────────
function executeStep(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const step = _required(params, 'step');
    const stepIndex = _required(params, 'stepIndex');
    const status = _required(params, 'status');

    _validateStep(step);
    _validateStatus(status);

    const input = (params && params.input !== undefined) ? params.input : null;
    const output = (params && params.output !== undefined) ? params.output : null;
    const durationMs = (params && typeof params.durationMs === 'number')
        ? params.durationMs : null;

    _stmts.insertTrace.run(
        userId, env, decisionId, step, stepIndex,
        input !== null ? JSON.stringify(input) : null,
        output !== null ? JSON.stringify(output) : null,
        status, durationMs, Date.now()
    );

    return { recorded: true, step, status };
}

// ── executeFullPipeline ────────────────────────────────────────────
function executeFullPipeline(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const input = _required(params, 'input');
    const stepRunners = (params && params.stepRunners) ? params.stepRunners : {};

    const stepResults = [];
    let haltedAt = null;

    for (let i = 0; i < THINKING_STEPS.length; i++) {
        const step = THINKING_STEPS[i];
        const runner = stepRunners[step];
        const startTime = Date.now();

        let status = 'OK';
        let output = null;
        let err = null;

        if (!runner) {
            status = 'SKIPPED';
        } else {
            try {
                output = runner(input);
                if (output === null || output === undefined) {
                    status = 'SKIPPED';
                }
            } catch (e) {
                status = 'ERROR';
                err = e.message || String(e);
            }
        }

        const durationMs = Date.now() - startTime;

        executeStep({
            userId, resolvedEnv: env, decisionId, step,
            stepIndex: i + 1, input: input, output: err ? { error: err } : output,
            status, durationMs
        });

        stepResults.push({ step, status, durationMs });

        if (status === 'ERROR') {
            haltedAt = step;
            break;
        }
    }

    return {
        completed: !haltedAt,
        haltedAt,
        steps: stepResults,
        totalSteps: stepResults.length
    };
}

// ── getTraceForDecision ────────────────────────────────────────────
function getTraceForDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');

    const rows = _stmts.selectTrace.all(userId, env, decisionId);
    return rows.map(r => ({
        id: r.id,
        step: r.step,
        stepIndex: r.step_index,
        input: r.input_json ? JSON.parse(r.input_json) : null,
        output: r.output_json ? JSON.parse(r.output_json) : null,
        status: r.status,
        durationMs: r.duration_ms,
        createdAt: r.created_at
    }));
}

// ── validateAllStepsExecuted — INVARIANT (PURE) ────────────────────
function validateAllStepsExecuted(params) {
    const trace = (params && Array.isArray(params.trace)) ? params.trace : [];
    const traceSteps = new Map(trace.map(t => [t.step, t]));

    const missing = [];
    const errored = [];
    const skipped = [];

    for (const step of THINKING_STEPS) {
        const t = traceSteps.get(step);
        if (!t) {
            missing.push(step);
        } else if (t.status === 'ERROR') {
            errored.push(step);
        } else if (t.status === 'SKIPPED') {
            skipped.push(step);
            // Critical steps cannot be skipped
            if (CRITICAL_STEPS.includes(step)) {
                missing.push(step);  // treat as missing for validity
            }
        }
    }

    return {
        valid: missing.length === 0 && errored.length === 0,
        missing,
        errored,
        skipped,
        executed: trace.length,
        total: THINKING_STEPS.length
    };
}

// ── getStepStatistics ──────────────────────────────────────────────
function getStepStatistics(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const stepFilter = (params && params.step) ? params.step : null;
    const since = (params && params.since) ? params.since : 0;

    const rows = _stmts.selectStepStats.all(
        userId, env, stepFilter, stepFilter,
        since > 0 ? 1 : 0, since
    );

    const result = {};
    for (const row of rows) {
        if (!result[row.step]) {
            result[row.step] = {
                totalExecutions: 0,
                byStatus: {},
                avgDurationMs: 0
            };
        }
        result[row.step].totalExecutions += row.count;
        result[row.step].byStatus[row.status] = row.count;
        if (row.avg_duration !== null) {
            result[row.step].avgDurationMs = row.avg_duration;
        }
    }
    return result;
}

module.exports = {
    THINKING_STEPS,
    STEP_STATUSES,
    STEP_TO_MODULE,
    CRITICAL_STEPS,
    executeStep,
    executeFullPipeline,
    getTraceForDecision,
    validateAllStepsExecuted,
    getStepStatistics
};
