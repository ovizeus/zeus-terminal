'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p53-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const mc = require('../../../server/services/ml/R-1_testHarness/adversarialMonteCarlo');

const TEST_USER = 9053;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_adversarial_mc_runs WHERE user_id IN (?, ?)').run(TEST_USER, 9054);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§53 Migration 101', () => {
    test('table ml_adversarial_mc_runs exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_adversarial_mc_runs'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_adversarial_mc_runs)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'scenario_type',
            'num_simulations', 'base_pnl', 'mc_mean_pnl',
            'mc_p5_pnl', 'mc_p50_pnl', 'mc_p95_pnl', 'mc_p99_pnl',
            'max_drawdown', 'max_loss', 'stress_factor', 'ts'
        ]));
    });

    test('CHECK scenario_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_adversarial_mc_runs
             (user_id, resolved_env, scenario_type, num_simulations,
              base_pnl, mc_mean_pnl, mc_p5_pnl, mc_p50_pnl, mc_p95_pnl, mc_p99_pnl,
              max_drawdown, max_loss, stress_factor, ts)
             VALUES (?, ?, 'BOGUS', 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§53 Exported constants', () => {
    test('SCENARIO_TYPES has 5 entries', () => {
        expect(mc.SCENARIO_TYPES).toEqual([
            'funding_spike', 'oi_cascade', 'venue_outage',
            'flash_crash', 'liquidity_evaporation'
        ]);
    });

    test('DEFAULT_NUM_SIMULATIONS positive', () => {
        expect(mc.DEFAULT_NUM_SIMULATIONS).toBeGreaterThanOrEqual(100);
    });

    test('STRESS_PERCENTILES has 4 entries', () => {
        expect(mc.STRESS_PERCENTILES).toEqual([5, 50, 95, 99]);
    });
});

describe('§53 defineScenario', () => {
    test('returns scenario handle for valid type', () => {
        for (const type of mc.SCENARIO_TYPES) {
            const r = mc.defineScenario({ scenarioType: type });
            expect(r.scenarioType).toBe(type);
            expect(typeof r.fn).toBe('function');
        }
    });

    test('throws on unknown scenarioType', () => {
        expect(() => mc.defineScenario({ scenarioType: 'unknown_bogus' }))
            .toThrow(/scenarioType/i);
    });
});

describe('§53 runMonteCarlo — distribution properties', () => {
    test('percentiles ordered p5 <= p50 <= p95 <= p99', () => {
        const r = mc.runMonteCarlo({
            scenarioType: 'funding_spike',
            basePnl: 1000,
            numSimulations: 500
        });
        expect(r.p5).toBeLessThanOrEqual(r.p50);
        expect(r.p50).toBeLessThanOrEqual(r.p95);
        expect(r.p95).toBeLessThanOrEqual(r.p99);
    });

    test('maxLoss is the minimum PnL', () => {
        const r = mc.runMonteCarlo({
            scenarioType: 'flash_crash',
            basePnl: 1000,
            numSimulations: 200
        });
        expect(r.maxLoss).toBeLessThanOrEqual(r.p5);
    });

    test('all 5 scenarios produce valid result shape', () => {
        for (const type of mc.SCENARIO_TYPES) {
            const r = mc.runMonteCarlo({
                scenarioType: type,
                basePnl: 1000,
                numSimulations: 100
            });
            expect(r.scenarioType).toBe(type);
            expect(r.numSimulations).toBe(100);
            expect(typeof r.mean).toBe('number');
            expect(typeof r.maxDrawdown).toBe('number');
        }
    });

    test('flash_crash produces predominantly negative mean (adverse)', () => {
        const r = mc.runMonteCarlo({
            scenarioType: 'flash_crash',
            basePnl: 1000,
            numSimulations: 500
        });
        // Flash crash spec: -8% to -15% drop, recovery uncertain → mean < base
        expect(r.mean).toBeLessThan(1000);
    });

    test('oi_cascade always adverse (loss)', () => {
        const r = mc.runMonteCarlo({
            scenarioType: 'oi_cascade',
            basePnl: 1000,
            numSimulations: 200
        });
        expect(r.mean).toBeLessThan(1000);  // always adverse per spec
    });

    test('throws on invalid scenarioType', () => {
        expect(() => mc.runMonteCarlo({
            scenarioType: 'bogus',
            basePnl: 100,
            numSimulations: 10
        })).toThrow(/scenarioType/i);
    });

    test('throws on numSimulations < 1', () => {
        expect(() => mc.runMonteCarlo({
            scenarioType: 'funding_spike',
            basePnl: 100,
            numSimulations: 0
        })).toThrow();
    });
});

describe('§53 stressTestPortfolio', () => {
    test('runs multiple scenarios and identifies worst case', () => {
        const r = mc.stressTestPortfolio({
            portfolio: { basePnl: 1000, positions: [] },
            scenarios: ['funding_spike', 'flash_crash', 'oi_cascade'],
            numSimulations: 100
        });
        expect(r.scenarios).toHaveLength(3);
        expect(r.worstCase).toBeTruthy();
        expect(typeof r.worstCaseLoss).toBe('number');
    });

    test('throws on empty scenarios array', () => {
        expect(() => mc.stressTestPortfolio({
            portfolio: { basePnl: 1000 },
            scenarios: []
        })).toThrow();
    });
});

describe('§53 recordAdversarialRun', () => {
    test('persists MC result', () => {
        const result = mc.runMonteCarlo({
            scenarioType: 'funding_spike',
            basePnl: 1000,
            numSimulations: 50
        });
        const r = mc.recordAdversarialRun({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioType: 'funding_spike',
            result,
            scenarioParams: { spikeBps: 500 }
        });
        expect(r.recorded).toBe(true);
        const rows = db.prepare(
            `SELECT * FROM ml_adversarial_mc_runs WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].scenario_type).toBe('funding_spike');
        expect(JSON.parse(rows[0].scenario_params_json).spikeBps).toBe(500);
    });

    test('throws on invalid scenarioType', () => {
        expect(() => mc.recordAdversarialRun({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioType: 'unknown',
            result: { numSimulations: 1, basePnl: 0, mean: 0,
                      p5: 0, p50: 0, p95: 0, p99: 0,
                      maxDrawdown: 0, maxLoss: 0, stressFactor: 0 }
        })).toThrow();
    });
});

describe('§53 getAdversarialStats', () => {
    test('aggregates samples per scenario', () => {
        for (let i = 0; i < 5; i++) {
            const result = mc.runMonteCarlo({
                scenarioType: 'funding_spike',
                basePnl: 1000,
                numSimulations: 50
            });
            mc.recordAdversarialRun({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                scenarioType: 'funding_spike',
                result
            });
        }
        const stats = mc.getAdversarialStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioType: 'funding_spike'
        });
        expect(stats.samples).toBe(5);
        expect(typeof stats.avgMeanPnl).toBe('number');
    });
});

describe('§53 isolation', () => {
    test('per (user × env × scenario) isolation', () => {
        const OTHER_USER = 9054;
        const result = mc.runMonteCarlo({
            scenarioType: 'funding_spike',
            basePnl: 1000,
            numSimulations: 10
        });
        mc.recordAdversarialRun({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioType: 'funding_spike', result
        });
        const s1 = mc.getAdversarialStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioType: 'funding_spike'
        });
        const s2 = mc.getAdversarialStats({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            scenarioType: 'funding_spike'
        });
        expect(s1.samples).toBe(1);
        expect(s2.samples).toBe(0);
    });
});
