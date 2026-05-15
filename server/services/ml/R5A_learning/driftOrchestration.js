'use strict';

/**
 * OMEGA R5A Learning — driftOrchestration (canonical §52)
 *
 * §52 DRIFT ORCHESTRATION.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 1586.
 *
 * "Monitor PSI/KS/Brier; ruleaza retrain canary cand PSI > 0.2 sau
 *  Brier degrade; block live deploy pana la validare."
 *
 * R5A. Orchestration layer ABOVE drift detection (§21):
 *   - §21 driftDetection = computes PSI / KS / Brier metrics
 *   - §52 = orchestrates response: queue retrain, run canary, gate live
 *
 * Lifecycle:
 *   HEALTHY → drift detected (PSI > 0.2 / Brier degrade / KS > 0.15)
 *           → DEGRADED → schedule canary → CANARY_RUNNING (live blocked)
 *           → canary PASSED → HEALTHY (live unblocked)
 *           → canary FAILED → BLOCKED (live stays blocked)
 */

const { db } = require('../../database');

const DRIFT_STATUSES = Object.freeze([
    'HEALTHY', 'DEGRADED', 'RETRAIN_QUEUED', 'CANARY_RUNNING', 'BLOCKED'
]);
const CANARY_STATUSES = Object.freeze(['PENDING', 'RUNNING', 'PASSED', 'FAILED']);
const TRIGGER_METRICS = Object.freeze(['psi', 'brier', 'ks']);

const PSI_THRESHOLD = 0.2;
const KS_THRESHOLD = 0.15;
const BRIER_DEGRADE_PCT = 0.10;  // 10% relative degradation

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`driftOrchestration: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    upsertState: db.prepare(`
        INSERT INTO ml_drift_orchestration_state
        (user_id, resolved_env, model_id, status,
         psi, brier, ks, last_trigger_ts, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, model_id) DO UPDATE SET
            status = excluded.status,
            psi = excluded.psi,
            brier = excluded.brier,
            ks = excluded.ks,
            last_trigger_ts = excluded.last_trigger_ts,
            updated_at = excluded.updated_at
    `),
    getState: db.prepare(`
        SELECT * FROM ml_drift_orchestration_state
        WHERE user_id = ? AND resolved_env = ? AND model_id = ?
    `),
    insertCanary: db.prepare(`
        INSERT INTO ml_retrain_canary_runs
        (user_id, resolved_env, model_id, canary_run_id,
         trigger_metric, trigger_value, status, live_blocked,
         started_at, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateCanary: db.prepare(`
        UPDATE ml_retrain_canary_runs
        SET status = ?, live_blocked = ?, metrics_json = ?, completed_at = ?
        WHERE canary_run_id = ?
    `),
    activeCanaries: db.prepare(`
        SELECT * FROM ml_retrain_canary_runs
        WHERE user_id = ? AND resolved_env = ?
          AND status IN ('PENDING', 'RUNNING')
        ORDER BY ts DESC
    `),
    canaryHistory: db.prepare(`
        SELECT * FROM ml_retrain_canary_runs
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR model_id = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `),
    getCanaryById: db.prepare(`
        SELECT * FROM ml_retrain_canary_runs WHERE canary_run_id = ?
    `)
};

// ── evaluateDriftMetrics ───────────────────────────────────────────
function evaluateDriftMetrics(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const modelId = _required(params, 'modelId');
    const psi = (params && typeof params.psi === 'number') ? params.psi : 0;
    const brier = (params && typeof params.brier === 'number') ? params.brier : 0;
    const ks = (params && typeof params.ks === 'number') ? params.ks : 0;
    const baselineBrier = (params && typeof params.baselineBrier === 'number')
        ? params.baselineBrier : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const triggers = [];
    if (psi > PSI_THRESHOLD) triggers.push({ metric: 'psi', value: psi });
    if (ks > KS_THRESHOLD) triggers.push({ metric: 'ks', value: ks });
    if (baselineBrier !== null && baselineBrier > 0) {
        const degradePct = (brier - baselineBrier) / baselineBrier;
        if (degradePct >= BRIER_DEGRADE_PCT) {
            triggers.push({ metric: 'brier', value: brier });
        }
    }

    // Don't downgrade from BLOCKED / CANARY_RUNNING based on metrics alone.
    const current = _stmts.getState.get(userId, env, modelId);
    if (current && (current.status === 'CANARY_RUNNING' || current.status === 'BLOCKED')) {
        _stmts.upsertState.run(
            userId, env, modelId, current.status,
            psi, brier, ks, triggers.length > 0 ? ts : current.last_trigger_ts,
            ts
        );
        return {
            triggered: triggers.length > 0,
            status: current.status,
            triggers
        };
    }

    const newStatus = triggers.length > 0 ? 'DEGRADED' : 'HEALTHY';
    _stmts.upsertState.run(
        userId, env, modelId, newStatus,
        psi, brier, ks,
        triggers.length > 0 ? ts : (current ? current.last_trigger_ts : null),
        ts
    );

    return {
        triggered: triggers.length > 0,
        status: newStatus,
        triggers
    };
}

// ── scheduleRetrainCanary ──────────────────────────────────────────
function scheduleRetrainCanary(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const modelId = _required(params, 'modelId');
    const triggerMetric = _required(params, 'triggerMetric');
    const triggerValue = _required(params, 'triggerValue');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!TRIGGER_METRICS.includes(triggerMetric)) {
        throw new Error(`driftOrchestration: invalid triggerMetric "${triggerMetric}"`);
    }

    const canaryRunId = `canary-${userId}-${modelId}-${ts}-${Math.floor(Math.random() * 1000)}`;

    _stmts.insertCanary.run(
        userId, env, modelId, canaryRunId,
        triggerMetric, triggerValue, 'RUNNING', 1,
        ts, ts
    );

    _stmts.upsertState.run(
        userId, env, modelId, 'CANARY_RUNNING',
        null, null, null, ts, ts
    );

    return { scheduled: true, canaryRunId, liveBlocked: true };
}

// ── recordCanaryResult ─────────────────────────────────────────────
function recordCanaryResult(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const canaryRunId = _required(params, 'canaryRunId');
    const status = _required(params, 'status');
    const metrics = (params && params.metrics) ? params.metrics : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (status !== 'PASSED' && status !== 'FAILED') {
        throw new Error(`driftOrchestration: status must be PASSED or FAILED`);
    }

    const canary = _stmts.getCanaryById.get(canaryRunId);
    if (!canary) {
        throw new Error(`driftOrchestration: canary "${canaryRunId}" not found`);
    }

    const liveBlocked = status === 'PASSED' ? 0 : 1;
    _stmts.updateCanary.run(
        status, liveBlocked,
        metrics ? JSON.stringify(metrics) : null,
        ts, canaryRunId
    );

    const newStatus = status === 'PASSED' ? 'HEALTHY' : 'BLOCKED';
    _stmts.upsertState.run(
        userId, env, canary.model_id, newStatus,
        null, null, null, ts, ts
    );

    return {
        recorded: true,
        canaryStatus: status,
        modelStatus: newStatus,
        liveUnblocked: status === 'PASSED'
    };
}

// ── isLiveDeployBlocked ────────────────────────────────────────────
function isLiveDeployBlocked(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const modelId = _required(params, 'modelId');

    const state = _stmts.getState.get(userId, env, modelId);
    if (!state) return { blocked: false, status: 'HEALTHY' };

    const blocked = state.status === 'CANARY_RUNNING' || state.status === 'BLOCKED';
    return { blocked, status: state.status };
}

// ── getDriftStatus ─────────────────────────────────────────────────
function getDriftStatus(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const modelId = _required(params, 'modelId');
    const row = _stmts.getState.get(userId, env, modelId);
    if (!row) return { exists: false };
    return {
        exists: true,
        modelId: row.model_id,
        status: row.status,
        psi: row.psi,
        brier: row.brier,
        ks: row.ks,
        lastTriggerTs: row.last_trigger_ts,
        updatedAt: row.updated_at
    };
}

// ── listActiveCanaries ─────────────────────────────────────────────
function listActiveCanaries(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    return _stmts.activeCanaries.all(userId, env).map(r => ({
        canaryRunId: r.canary_run_id,
        modelId: r.model_id,
        triggerMetric: r.trigger_metric,
        triggerValue: r.trigger_value,
        status: r.status,
        startedAt: r.started_at
    }));
}

// ── getCanaryHistory ───────────────────────────────────────────────
function getCanaryHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const modelId = (params && params.modelId) ? params.modelId : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.canaryHistory.all(
        userId, env,
        modelId, modelId,
        since > 0 ? 1 : 0, since,
        limit
    );
}

module.exports = {
    DRIFT_STATUSES,
    CANARY_STATUSES,
    TRIGGER_METRICS,
    PSI_THRESHOLD,
    KS_THRESHOLD,
    BRIER_DEGRADE_PCT,
    evaluateDriftMetrics,
    scheduleRetrainCanary,
    recordCanaryResult,
    isLiveDeployBlocked,
    getDriftStatus,
    listActiveCanaries,
    getCanaryHistory
};
