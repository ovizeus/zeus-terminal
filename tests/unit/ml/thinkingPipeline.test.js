'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p9-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const tp = require('../../../server/services/ml/R2_cognition/thinkingPipeline');

const TEST_USER = 9009;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_thinking_traces WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§9 Migration 073_ml_thinking_traces', () => {
    test('table ml_thinking_traces exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_thinking_traces'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_thinking_traces)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'decision_id',
            'step', 'step_index', 'input_json', 'output_json',
            'status', 'duration_ms', 'created_at'
        ]));
    });

    test('CHECK step restricts to 12 spec values', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_thinking_traces
             (user_id, resolved_env, decision_id, step, step_index, status, created_at)
             VALUES (?, ?, 'dec-1', 'BOGUS_STEP', 1, 'OK', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK status restricts to OK/SKIPPED/ERROR', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_thinking_traces
             (user_id, resolved_env, decision_id, step, step_index, status, created_at)
             VALUES (?, ?, 'dec-2', 'OBSERVA', 1, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§9 Exported constants', () => {
    test('THINKING_STEPS has 12 spec entries in order', () => {
        expect(tp.THINKING_STEPS).toEqual([
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
    });

    test('STEP_TO_MODULE maps each step to providing OMEGA modules', () => {
        for (const step of tp.THINKING_STEPS) {
            expect(tp.STEP_TO_MODULE[step]).toBeDefined();
            expect(Array.isArray(tp.STEP_TO_MODULE[step])).toBe(true);
        }
    });

    test('STEP_STATUSES has 3 values', () => {
        expect(tp.STEP_STATUSES).toEqual(['OK', 'SKIPPED', 'ERROR']);
    });
});

describe('§9 executeStep', () => {
    test('records step trace with OK status', () => {
        tp.executeStep({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-step-1',
            step: 'OBSERVA',
            stepIndex: 1,
            input: { price: 50000 },
            output: { observation: 'normal market' },
            status: 'OK',
            durationMs: 5
        });
        const rows = db.prepare(
            `SELECT * FROM ml_thinking_traces WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].step).toBe('OBSERVA');
        expect(rows[0].status).toBe('OK');
    });

    test('records SKIPPED step', () => {
        tp.executeStep({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-skip',
            step: 'VERIFICA_MACRO_CORELATII_OPTIONS_VENUES',
            stepIndex: 7,
            input: { reason: 'macro feed unavailable' },
            status: 'SKIPPED'
        });
        const row = db.prepare(
            `SELECT * FROM ml_thinking_traces WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.status).toBe('SKIPPED');
    });

    test('records ERROR step', () => {
        tp.executeStep({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-err',
            step: 'IDENTIFICA_LICHIDITATEA',
            stepIndex: 5,
            input: { error: 'liquidity feed timeout' },
            status: 'ERROR'
        });
        const row = db.prepare(
            `SELECT * FROM ml_thinking_traces WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.status).toBe('ERROR');
    });

    test('throws on invalid step', () => {
        expect(() => tp.executeStep({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-bad',
            step: 'BOGUS_STEP',
            stepIndex: 1,
            status: 'OK'
        })).toThrow(/step/i);
    });
});

describe('§9 executeFullPipeline', () => {
    test('runs all 12 steps with default runners', () => {
        const stepRunners = {};
        for (const step of tp.THINKING_STEPS) {
            stepRunners[step] = (input) => ({ step, processed: true });
        }
        const r = tp.executeFullPipeline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-full-1',
            input: { symbol: 'BTCUSDT' },
            stepRunners
        });
        expect(r.completed).toBe(true);
        expect(r.steps).toHaveLength(12);
        const rows = db.prepare(
            `SELECT * FROM ml_thinking_traces WHERE user_id = ? AND decision_id = ?
             ORDER BY step_index ASC`
        ).all(TEST_USER, 'dec-full-1');
        expect(rows).toHaveLength(12);
    });

    test('halts on ERROR step + records partial trace', () => {
        const stepRunners = {};
        for (const step of tp.THINKING_STEPS) {
            stepRunners[step] = step === 'IDENTIFICA_LICHIDITATEA'
                ? () => { throw new Error('liquidity feed down'); }
                : () => ({ ok: true });
        }
        const r = tp.executeFullPipeline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-halt',
            input: { symbol: 'BTCUSDT' },
            stepRunners
        });
        expect(r.completed).toBe(false);
        expect(r.haltedAt).toBe('IDENTIFICA_LICHIDITATEA');
        const rows = db.prepare(
            `SELECT * FROM ml_thinking_traces WHERE user_id = ? AND decision_id = ?
             ORDER BY step_index ASC`
        ).all(TEST_USER, 'dec-halt');
        expect(rows.length).toBeLessThan(12);
        expect(rows.length).toBeGreaterThanOrEqual(5);
    });

    test('skips step when runner returns null/undefined', () => {
        const stepRunners = {};
        for (const step of tp.THINKING_STEPS) {
            stepRunners[step] = () => ({ ok: true });
        }
        stepRunners.VERIFICA_BIAS_GLOBAL = () => null;
        tp.executeFullPipeline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-skip-step',
            input: {},
            stepRunners
        });
        const skipped = db.prepare(
            `SELECT * FROM ml_thinking_traces
             WHERE user_id = ? AND decision_id = ? AND step = ?`
        ).get(TEST_USER, 'dec-skip-step', 'VERIFICA_BIAS_GLOBAL');
        expect(skipped.status).toBe('SKIPPED');
    });
});

describe('§9 getTraceForDecision', () => {
    test('returns empty for unknown decision', () => {
        const r = tp.getTraceForDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-unknown'
        });
        expect(r).toEqual([]);
    });

    test('returns ordered trace by step_index', () => {
        const stepRunners = {};
        for (const step of tp.THINKING_STEPS) {
            stepRunners[step] = () => ({ ok: true });
        }
        tp.executeFullPipeline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-trace',
            input: {}, stepRunners
        });
        const trace = tp.getTraceForDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-trace'
        });
        expect(trace).toHaveLength(12);
        for (let i = 0; i < trace.length - 1; i++) {
            expect(trace[i].stepIndex).toBeLessThan(trace[i + 1].stepIndex);
        }
    });
});

describe('§9 validateAllStepsExecuted — INVARIANT', () => {
    test('returns valid=true when all 12 steps present and OK', () => {
        const trace = tp.THINKING_STEPS.map((step, i) => ({
            step, stepIndex: i + 1, status: 'OK'
        }));
        const r = tp.validateAllStepsExecuted({ trace });
        expect(r.valid).toBe(true);
        expect(r.missing).toEqual([]);
        expect(r.errored).toEqual([]);
    });

    test('returns invalid when steps missing', () => {
        const trace = tp.THINKING_STEPS.slice(0, 5).map((step, i) => ({
            step, stepIndex: i + 1, status: 'OK'
        }));
        const r = tp.validateAllStepsExecuted({ trace });
        expect(r.valid).toBe(false);
        expect(r.missing.length).toBeGreaterThan(0);
    });

    test('returns invalid when steps errored', () => {
        const trace = tp.THINKING_STEPS.map((step, i) => ({
            step, stepIndex: i + 1,
            status: step === 'CALCULEAZA_AVANTAJUL' ? 'ERROR' : 'OK'
        }));
        const r = tp.validateAllStepsExecuted({ trace });
        expect(r.valid).toBe(false);
        expect(r.errored).toContain('CALCULEAZA_AVANTAJUL');
    });

    test('SKIPPED steps allowed for non-critical steps', () => {
        const trace = tp.THINKING_STEPS.map((step, i) => ({
            step, stepIndex: i + 1,
            status: step === 'VERIFICA_MACRO_CORELATII_OPTIONS_VENUES' ? 'SKIPPED' : 'OK'
        }));
        const r = tp.validateAllStepsExecuted({ trace });
        expect(r.valid).toBe(true);
        expect(r.skipped).toContain('VERIFICA_MACRO_CORELATII_OPTIONS_VENUES');
    });
});

describe('§9 getStepStatistics', () => {
    beforeEach(() => {
        // Generate some traces
        const stepRunners = {};
        for (const step of tp.THINKING_STEPS) {
            stepRunners[step] = () => ({ ok: true });
        }
        for (let i = 0; i < 3; i++) {
            tp.executeFullPipeline({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                decisionId: `dec-stats-${i}`, input: {}, stepRunners
            });
        }
    });

    test('returns counts per step', () => {
        const r = tp.getStepStatistics({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        for (const step of tp.THINKING_STEPS) {
            expect(r[step]).toBeDefined();
            expect(r[step].totalExecutions).toBe(3);
        }
    });

    test('filters by step', () => {
        const r = tp.getStepStatistics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            step: 'OBSERVA'
        });
        expect(Object.keys(r)).toEqual(['OBSERVA']);
    });
});

describe('§9 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9010;
        tp.executeStep({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-iso', step: 'OBSERVA',
            stepIndex: 1, status: 'OK'
        });
        const t1 = tp.getTraceForDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV, decisionId: 'dec-iso'
        });
        const t2 = tp.getTraceForDecision({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, decisionId: 'dec-iso'
        });
        expect(t1).toHaveLength(1);
        expect(t2).toHaveLength(0);
    });
});
