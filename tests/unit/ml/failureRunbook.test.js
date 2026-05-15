'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-obs5-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const rb = require('../../../server/services/ml/_operator/failureRunbook');

const TEST_USER = 9005;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare(`DELETE FROM ml_runbooks WHERE runbook_id LIKE 'test-%'`).run();
    db.prepare('DELETE FROM ml_runbook_executions WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('OBS-5 Migration 081', () => {
    test('table ml_runbooks exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_runbooks'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_runbook_executions exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_runbook_executions'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('runbooks has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_runbooks)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'runbook_id', 'name', 'trigger_signals_json',
            'steps_json', 'auto_execute', 'severity', 'created_at'
        ]));
    });

    test('executions has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_runbook_executions)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'runbook_id',
            'mode', 'actor', 'matched_signals_json', 'steps_executed',
            'status', 'created_at'
        ]));
    });
});

describe('OBS-5 Exported constants', () => {
    test('RUNBOOK_SEVERITY has 4 levels', () => {
        expect(rb.RUNBOOK_SEVERITY).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    });

    test('EXECUTION_MODES has 3 modes', () => {
        expect(rb.EXECUTION_MODES).toEqual(['AUTO', 'MANUAL', 'DRY_RUN']);
    });

    test('STEP_TYPES has set of step types', () => {
        expect(rb.STEP_TYPES).toEqual(expect.arrayContaining([
            'flatten_positions', 'trigger_panic', 'reduce_size',
            'enable_observer', 'notify_operator', 'rollback_config'
        ]));
    });
});

describe('OBS-5 registerRunbook', () => {
    test('creates new runbook', () => {
        rb.registerRunbook({
            runbookId: 'test-runbook-1',
            name: 'Latency spike runbook',
            triggerSignals: ['latency_severe', 'api_rate_limited'],
            steps: [{ type: 'notify_operator' }, { type: 'enable_observer' }],
            autoExecute: false,
            severity: 'HIGH'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_runbooks WHERE runbook_id = ?`
        ).all('test-runbook-1');
        expect(rows).toHaveLength(1);
    });

    test('throws on duplicate runbookId', () => {
        rb.registerRunbook({
            runbookId: 'test-dup', name: 'X',
            triggerSignals: ['x'], steps: [],
            autoExecute: false, severity: 'LOW'
        });
        expect(() => rb.registerRunbook({
            runbookId: 'test-dup', name: 'Y',
            triggerSignals: ['y'], steps: [],
            autoExecute: false, severity: 'HIGH'
        })).toThrow();
    });

    test('throws on invalid severity', () => {
        expect(() => rb.registerRunbook({
            runbookId: 'test-bad-sev', name: 'X',
            triggerSignals: ['x'], steps: [],
            autoExecute: false, severity: 'BOGUS'
        })).toThrow(/severity/i);
    });
});

describe('OBS-5 detectMatchingRunbook (pure)', () => {
    beforeEach(() => {
        rb.registerRunbook({
            runbookId: 'test-detect-1',
            name: 'Latency runbook',
            triggerSignals: ['latency_severe'],
            steps: [{ type: 'notify_operator' }],
            autoExecute: false, severity: 'HIGH'
        });
        rb.registerRunbook({
            runbookId: 'test-detect-2',
            name: 'Drift runbook',
            triggerSignals: ['drift_high', 'model_unstable'],
            steps: [{ type: 'enable_observer' }],
            autoExecute: false, severity: 'CRITICAL'
        });
    });

    test('finds runbook when all signals match', () => {
        const r = rb.detectMatchingRunbook({
            signals: ['latency_severe', 'some_other_signal']
        });
        expect(r.length).toBeGreaterThan(0);
        expect(r[0].runbookId).toBe('test-detect-1');
    });

    test('returns empty when no signals match', () => {
        const r = rb.detectMatchingRunbook({
            signals: ['unknown_signal']
        });
        const testRunbooks = r.filter(rb => rb.runbookId.startsWith('test-'));
        expect(testRunbooks).toHaveLength(0);
    });

    test('returns multiple matches sorted by severity', () => {
        rb.registerRunbook({
            runbookId: 'test-multi-1',
            name: 'Multi A',
            triggerSignals: ['common_signal'],
            steps: [], autoExecute: false, severity: 'LOW'
        });
        rb.registerRunbook({
            runbookId: 'test-multi-2',
            name: 'Multi B',
            triggerSignals: ['common_signal'],
            steps: [], autoExecute: false, severity: 'CRITICAL'
        });
        const r = rb.detectMatchingRunbook({
            signals: ['common_signal']
        });
        const tests = r.filter(rb => rb.runbookId.startsWith('test-multi'));
        // First match should be highest severity
        expect(tests[0].severity).toBe('CRITICAL');
    });
});

describe('OBS-5 executeRunbook', () => {
    beforeEach(() => {
        rb.registerRunbook({
            runbookId: 'test-exec-1',
            name: 'Exec runbook',
            triggerSignals: ['x'],
            steps: [
                { type: 'notify_operator' },
                { type: 'enable_observer' }
            ],
            autoExecute: false,
            severity: 'HIGH'
        });
    });

    test('records execution in AUTO mode', () => {
        rb.executeRunbook({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            runbookId: 'test-exec-1',
            actor: 'system', mode: 'AUTO',
            matchedSignals: ['x']
        });
        const rows = db.prepare(
            `SELECT * FROM ml_runbook_executions WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].mode).toBe('AUTO');
        expect(rows[0].status).toBe('EXECUTED');
    });

    test('DRY_RUN does not mark as executed', () => {
        rb.executeRunbook({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            runbookId: 'test-exec-1',
            actor: 'op', mode: 'DRY_RUN',
            matchedSignals: ['x']
        });
        const row = db.prepare(
            `SELECT * FROM ml_runbook_executions WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.mode).toBe('DRY_RUN');
        expect(row.status).toBe('SIMULATED');
    });

    test('returns steps to execute', () => {
        const r = rb.executeRunbook({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            runbookId: 'test-exec-1',
            actor: 'op', mode: 'AUTO',
            matchedSignals: ['x']
        });
        expect(r.steps).toHaveLength(2);
        expect(r.steps[0].type).toBe('notify_operator');
    });

    test('throws on invalid mode', () => {
        expect(() => rb.executeRunbook({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            runbookId: 'test-exec-1',
            actor: 'op', mode: 'BOGUS',
            matchedSignals: ['x']
        })).toThrow(/mode/i);
    });

    test('throws when runbookId not found', () => {
        expect(() => rb.executeRunbook({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            runbookId: 'nonexistent',
            actor: 'op', mode: 'AUTO',
            matchedSignals: []
        })).toThrow();
    });
});

describe('OBS-5 getRunbookHistory', () => {
    beforeEach(() => {
        rb.registerRunbook({
            runbookId: 'test-hist-1',
            name: 'Hist', triggerSignals: ['x'],
            steps: [{ type: 'notify_operator' }],
            autoExecute: false, severity: 'LOW'
        });
        for (let i = 0; i < 3; i++) {
            rb.executeRunbook({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                runbookId: 'test-hist-1',
                actor: 'op', mode: 'AUTO',
                matchedSignals: ['x']
            });
        }
    });

    test('returns execution history', () => {
        const r = rb.getRunbookHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(3);
    });

    test('respects limit', () => {
        const r = rb.getRunbookHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, limit: 2
        });
        expect(r).toHaveLength(2);
    });
});

describe('OBS-5 listRunbooks', () => {
    beforeEach(() => {
        rb.registerRunbook({
            runbookId: 'test-list-low',
            name: 'A', triggerSignals: ['x'],
            steps: [], autoExecute: false, severity: 'LOW'
        });
        rb.registerRunbook({
            runbookId: 'test-list-crit',
            name: 'B', triggerSignals: ['y'],
            steps: [], autoExecute: false, severity: 'CRITICAL'
        });
    });

    test('lists all when no filter', () => {
        const r = rb.listRunbooks({});
        const tests = r.filter(rb => rb.runbookId.startsWith('test-list'));
        expect(tests).toHaveLength(2);
    });

    test('filters by severity', () => {
        const r = rb.listRunbooks({ severity: 'CRITICAL' });
        const tests = r.filter(rb => rb.runbookId.startsWith('test-list'));
        expect(tests).toHaveLength(1);
        expect(tests[0].runbookId).toBe('test-list-crit');
    });
});
