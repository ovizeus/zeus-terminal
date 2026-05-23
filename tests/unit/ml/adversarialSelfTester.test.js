'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p44-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ast = require('../../../server/services/ml/_crosscutting/adversarialSelfTester');

const TEST_USER = 9044;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare(`DELETE FROM ml_adversarial_runs WHERE scenario_id LIKE 'test-%'`).run();
    db.prepare('DELETE FROM ml_adversarial_results WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§44 Migration 091', () => {
    test('table ml_adversarial_runs exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_adversarial_runs'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_adversarial_results exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_adversarial_results'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('runs has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_adversarial_runs)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'scenario_id', 'name', 'type',
            'payload_json', 'expected_safety_trigger',
            'severity', 'created_at'
        ]));
    });

    test('results has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_adversarial_results)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'scenario_id',
            'mode', 'passed', 'observations_json',
            'duration_ms', 'created_at'
        ]));
    });
});

describe('§44 Exported constants', () => {
    test('SCENARIO_TYPES has 6 spec entries', () => {
        expect(ast.SCENARIO_TYPES).toEqual(expect.arrayContaining([
            'veto_bypass', 'state_machine_edge', 'api_saturation',
            'latency_injection', 'feed_desync', 'flash_crash'
        ]));
    });

    test('EXECUTION_MODES has SIMULATED/ACTUAL', () => {
        expect(ast.EXECUTION_MODES).toEqual(['SIMULATED', 'ACTUAL']);
    });

    test('SCENARIO_SEVERITY has 4 levels', () => {
        expect(ast.SCENARIO_SEVERITY).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    });
});

describe('§44 registerScenario', () => {
    test('registers new scenario', () => {
        ast.registerScenario({
            scenarioId: 'test-veto-bypass-1',
            name: 'Try to bypass macro veto with high score',
            type: 'veto_bypass',
            payload: { simulatedScore: 0.95, expectedVeto: 'macro_red_flag' },
            expectedSafetyTrigger: 'block_trade',
            severity: 'HIGH'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_adversarial_runs WHERE scenario_id = 'test-veto-bypass-1'`
        ).all();
        expect(rows).toHaveLength(1);
    });

    test('throws on duplicate scenarioId', () => {
        ast.registerScenario({
            scenarioId: 'test-dup',
            name: 'A', type: 'veto_bypass',
            payload: {}, expectedSafetyTrigger: 'x', severity: 'LOW'
        });
        expect(() => ast.registerScenario({
            scenarioId: 'test-dup',
            name: 'B', type: 'veto_bypass',
            payload: {}, expectedSafetyTrigger: 'x', severity: 'LOW'
        })).toThrow();
    });

    test('throws on invalid type', () => {
        expect(() => ast.registerScenario({
            scenarioId: 'test-bad-type',
            name: 'X', type: 'BOGUS',
            payload: {}, expectedSafetyTrigger: 'x', severity: 'LOW'
        })).toThrow(/type/i);
    });
});

describe('§44 runScenario', () => {
    beforeEach(() => {
        ast.registerScenario({
            scenarioId: 'test-run-1',
            name: 'API saturation test',
            type: 'api_saturation',
            payload: { requestRate: 10000 },
            expectedSafetyTrigger: 'rate_limit_throttle',
            severity: 'HIGH'
        });
    });

    test('runs in SIMULATED mode', () => {
        const r = ast.runScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'test-run-1',
            mode: 'SIMULATED'
        });
        expect(r.runId).toBeDefined();
        expect(r.mode).toBe('SIMULATED');
    });

    test('throws on invalid mode', () => {
        expect(() => ast.runScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'test-run-1',
            mode: 'BOGUS'
        })).toThrow(/mode/i);
    });

    test('throws on unknown scenarioId', () => {
        expect(() => ast.runScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'nonexistent',
            mode: 'SIMULATED'
        })).toThrow();
    });
});

describe('§44 recordResult', () => {
    test('records passing result', () => {
        ast.registerScenario({
            scenarioId: 'test-res-1',
            name: 'X', type: 'flash_crash',
            payload: {}, expectedSafetyTrigger: 'circuit_breaker',
            severity: 'CRITICAL'
        });
        ast.recordResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'test-res-1',
            mode: 'SIMULATED',
            passed: true,
            observations: { triggeredIn: 150, expected: 200 },
            durationMs: 150
        });
        const rows = db.prepare(
            `SELECT * FROM ml_adversarial_results WHERE user_id = ? AND scenario_id = 'test-res-1'`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].passed).toBe(1);
    });

    test('records failing result', () => {
        ast.registerScenario({
            scenarioId: 'test-fail-1',
            name: 'X', type: 'veto_bypass',
            payload: {}, expectedSafetyTrigger: 'block',
            severity: 'HIGH'
        });
        ast.recordResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'test-fail-1',
            mode: 'SIMULATED',
            passed: false,
            observations: { error: 'veto did not trigger' }
        });
        const row = db.prepare(
            `SELECT * FROM ml_adversarial_results WHERE user_id = ? AND scenario_id = 'test-fail-1'`
        ).get(TEST_USER);
        expect(row.passed).toBe(0);
    });
});

describe('§44 getRedTeamHistory', () => {
    beforeEach(() => {
        ast.registerScenario({
            scenarioId: 'test-hist-1',
            name: 'H', type: 'feed_desync',
            payload: {}, expectedSafetyTrigger: 'pause',
            severity: 'HIGH'
        });
        for (let i = 0; i < 3; i++) {
            ast.recordResult({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                scenarioId: 'test-hist-1',
                mode: 'SIMULATED',
                passed: i < 2,  // 2 pass, 1 fail
                observations: { i }
            });
        }
    });

    test('returns history', () => {
        const r = ast.getRedTeamHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(3);
    });

    test('respects limit', () => {
        const r = ast.getRedTeamHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, limit: 2
        });
        expect(r).toHaveLength(2);
    });
});

describe('§44 getScenarioPassRate', () => {
    beforeEach(() => {
        ast.registerScenario({
            scenarioId: 'test-rate-1',
            name: 'R', type: 'state_machine_edge',
            payload: {}, expectedSafetyTrigger: 'reject',
            severity: 'MEDIUM'
        });
        for (let i = 0; i < 8; i++) {
            ast.recordResult({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                scenarioId: 'test-rate-1',
                mode: 'SIMULATED',
                passed: i < 6,  // 6 pass, 2 fail
                observations: {}
            });
        }
    });

    test('returns pass rate', () => {
        const r = ast.getScenarioPassRate({
            scenarioId: 'test-rate-1'
        });
        expect(r.total).toBe(8);
        expect(r.passed).toBe(6);
        expect(r.passRate).toBeCloseTo(0.75);
    });

    test('returns zero stats when no results', () => {
        const r = ast.getScenarioPassRate({
            scenarioId: 'test-nonexistent'
        });
        expect(r.total).toBe(0);
        expect(r.passRate).toBe(0);
    });
});

describe('§44 isolation', () => {
    test('per (user × env) isolation on results', () => {
        const OTHER_USER = 9045;
        ast.registerScenario({
            scenarioId: 'test-iso-1',
            name: 'I', type: 'latency_injection',
            payload: {}, expectedSafetyTrigger: 'alert',
            severity: 'MEDIUM'
        });
        ast.recordResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'test-iso-1',
            mode: 'SIMULATED', passed: true, observations: {}
        });
        const r1 = ast.getRedTeamHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = ast.getRedTeamHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1).toHaveLength(1);
        expect(r2).toHaveLength(0);
    });
});
