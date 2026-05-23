'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p52-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const drift = require('../../../server/services/ml/R5A_learning/driftOrchestration');

const TEST_USER = 9052;
const TEST_ENV = 'DEMO';
const MODEL = 'omega-ring2-v1';

function cleanRows() {
    db.prepare('DELETE FROM ml_drift_orchestration_state WHERE user_id IN (?, ?)').run(TEST_USER, 9053);
    db.prepare('DELETE FROM ml_retrain_canary_runs WHERE user_id IN (?, ?)').run(TEST_USER, 9053);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§52 Migrations 122 + 123', () => {
    test('ml_drift_orchestration_state exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_drift_orchestration_state)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'user_id', 'resolved_env', 'model_id', 'status',
            'psi', 'brier', 'ks', 'last_trigger_ts', 'updated_at'
        ]));
    });

    test('CHECK status restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_drift_orchestration_state
             (user_id, resolved_env, model_id, status, updated_at)
             VALUES (?, ?, 'M', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK trigger_metric restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_retrain_canary_runs
             (user_id, resolved_env, model_id, canary_run_id, trigger_metric,
              trigger_value, status, live_blocked, started_at, ts)
             VALUES (?, ?, 'M', 'C1', 'BOGUS', 0.5, 'RUNNING', 1, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('canary_run_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_retrain_canary_runs
             (user_id, resolved_env, model_id, canary_run_id, trigger_metric,
              trigger_value, status, live_blocked, started_at, ts)
             VALUES (?, ?, 'M', 'UNIQ-1', 'psi', 0.5, 'RUNNING', 1, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_retrain_canary_runs
             (user_id, resolved_env, model_id, canary_run_id, trigger_metric,
              trigger_value, status, live_blocked, started_at, ts)
             VALUES (?, ?, 'M', 'UNIQ-1', 'ks', 0.3, 'RUNNING', 1, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });
});

describe('§52 Constants', () => {
    test('DRIFT_STATUSES has 5 entries', () => {
        expect(drift.DRIFT_STATUSES).toEqual([
            'HEALTHY', 'DEGRADED', 'RETRAIN_QUEUED', 'CANARY_RUNNING', 'BLOCKED'
        ]);
    });

    test('CANARY_STATUSES has 4 entries', () => {
        expect(drift.CANARY_STATUSES).toEqual(['PENDING', 'RUNNING', 'PASSED', 'FAILED']);
    });

    test('thresholds match spec', () => {
        expect(drift.PSI_THRESHOLD).toBe(0.2);
        expect(drift.KS_THRESHOLD).toBeGreaterThan(0);
        expect(drift.BRIER_DEGRADE_PCT).toBeGreaterThan(0);
    });
});

describe('§52 evaluateDriftMetrics', () => {
    test('HEALTHY when all metrics under thresholds', () => {
        const r = drift.evaluateDriftMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL,
            psi: 0.1, brier: 0.2, ks: 0.05
        });
        expect(r.triggered).toBe(false);
        expect(r.status).toBe('HEALTHY');
    });

    test('PSI > 0.2 triggers DEGRADED', () => {
        const r = drift.evaluateDriftMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL,
            psi: 0.25, brier: 0.2, ks: 0.05
        });
        expect(r.triggered).toBe(true);
        expect(r.status).toBe('DEGRADED');
        expect(r.triggers.some(t => t.metric === 'psi')).toBe(true);
    });

    test('KS > 0.15 triggers DEGRADED', () => {
        const r = drift.evaluateDriftMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL,
            psi: 0.1, brier: 0.2, ks: 0.20
        });
        expect(r.triggered).toBe(true);
        expect(r.triggers.some(t => t.metric === 'ks')).toBe(true);
    });

    test('Brier degrade > 10% triggers DEGRADED', () => {
        const r = drift.evaluateDriftMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL,
            psi: 0.1, brier: 0.25, ks: 0.05,
            baselineBrier: 0.20  // 25% degrade
        });
        expect(r.triggered).toBe(true);
        expect(r.triggers.some(t => t.metric === 'brier')).toBe(true);
    });

    test('does not downgrade BLOCKED state on healthy metrics', () => {
        drift.evaluateDriftMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL, psi: 0.30
        });
        drift.scheduleRetrainCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL, triggerMetric: 'psi', triggerValue: 0.30
        });
        // Now simulate clean metrics
        const r = drift.evaluateDriftMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL, psi: 0.05, brier: 0.1, ks: 0.01
        });
        expect(r.status).toBe('CANARY_RUNNING');  // not downgraded
    });
});

describe('§52 scheduleRetrainCanary', () => {
    test('creates canary + blocks live', () => {
        const r = drift.scheduleRetrainCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL,
            triggerMetric: 'psi', triggerValue: 0.3
        });
        expect(r.scheduled).toBe(true);
        expect(r.liveBlocked).toBe(true);

        const blocked = drift.isLiveDeployBlocked({
            userId: TEST_USER, resolvedEnv: TEST_ENV, modelId: MODEL
        });
        expect(blocked.blocked).toBe(true);
        expect(blocked.status).toBe('CANARY_RUNNING');
    });

    test('throws on invalid triggerMetric', () => {
        expect(() => drift.scheduleRetrainCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL, triggerMetric: 'BOGUS', triggerValue: 0.3
        })).toThrow();
    });
});

describe('§52 recordCanaryResult', () => {
    test('PASSED unblocks live + HEALTHY', () => {
        const c = drift.scheduleRetrainCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL,
            triggerMetric: 'psi', triggerValue: 0.3
        });
        const r = drift.recordCanaryResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            canaryRunId: c.canaryRunId,
            status: 'PASSED',
            metrics: { newPsi: 0.05 }
        });
        expect(r.liveUnblocked).toBe(true);
        expect(r.modelStatus).toBe('HEALTHY');

        const blocked = drift.isLiveDeployBlocked({
            userId: TEST_USER, resolvedEnv: TEST_ENV, modelId: MODEL
        });
        expect(blocked.blocked).toBe(false);
    });

    test('FAILED keeps blocked + BLOCKED', () => {
        const c = drift.scheduleRetrainCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL,
            triggerMetric: 'ks', triggerValue: 0.20
        });
        const r = drift.recordCanaryResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            canaryRunId: c.canaryRunId,
            status: 'FAILED'
        });
        expect(r.liveUnblocked).toBe(false);
        expect(r.modelStatus).toBe('BLOCKED');

        const blocked = drift.isLiveDeployBlocked({
            userId: TEST_USER, resolvedEnv: TEST_ENV, modelId: MODEL
        });
        expect(blocked.blocked).toBe(true);
    });

    test('throws on invalid status', () => {
        const c = drift.scheduleRetrainCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL,
            triggerMetric: 'psi', triggerValue: 0.3
        });
        expect(() => drift.recordCanaryResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            canaryRunId: c.canaryRunId, status: 'PENDING'
        })).toThrow();
    });

    test('throws when canaryRunId not found', () => {
        expect(() => drift.recordCanaryResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            canaryRunId: 'NONEXISTENT', status: 'PASSED'
        })).toThrow();
    });
});

describe('§52 isLiveDeployBlocked', () => {
    test('returns false for unseen model', () => {
        const r = drift.isLiveDeployBlocked({
            userId: TEST_USER, resolvedEnv: TEST_ENV, modelId: 'unseen'
        });
        expect(r.blocked).toBe(false);
        expect(r.status).toBe('HEALTHY');
    });
});

describe('§52 listActiveCanaries + history', () => {
    test('active list returns RUNNING canaries', () => {
        drift.scheduleRetrainCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL, triggerMetric: 'psi', triggerValue: 0.3
        });
        const active = drift.listActiveCanaries({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(active.length).toBeGreaterThan(0);
    });

    test('history returns all per model', () => {
        const c1 = drift.scheduleRetrainCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL, triggerMetric: 'psi', triggerValue: 0.3
        });
        drift.recordCanaryResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            canaryRunId: c1.canaryRunId, status: 'PASSED'
        });
        const h = drift.getCanaryHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, modelId: MODEL
        });
        expect(h.length).toBe(1);
    });
});

describe('§52 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9053;
        drift.scheduleRetrainCanary({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelId: MODEL, triggerMetric: 'psi', triggerValue: 0.3
        });
        const a1 = drift.listActiveCanaries({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const a2 = drift.listActiveCanaries({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a1.length).toBe(1);
        expect(a2.length).toBe(0);
    });
});
