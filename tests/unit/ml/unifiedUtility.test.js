'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p59-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const uu = require('../../../server/services/ml/_meta/unifiedUtility');

const TEST_USER = 9059;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_utility_evaluations WHERE user_id IN (?, ?)').run(TEST_USER, 9060);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§59 Migration 105', () => {
    test('table ml_utility_evaluations exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_utility_evaluations'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_utility_evaluations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'decision_id',
            'expectancy_after_costs', 'tail_risk_penalty', 'turnover_penalty',
            'latency_penalty', 'concentration_penalty', 'crowding_penalty',
            'total_utility', 'weights_json', 'ts'
        ]));
    });
});

describe('§59 Constants', () => {
    test('UTILITY_COMPONENTS has 6 entries', () => {
        expect(uu.UTILITY_COMPONENTS).toEqual([
            'expectancy', 'tailRisk', 'turnover', 'latency',
            'concentration', 'crowding'
        ]);
    });

    test('DEFAULT_WEIGHTS has all required keys', () => {
        expect(uu.DEFAULT_WEIGHTS).toHaveProperty('tailRisk');
        expect(uu.DEFAULT_WEIGHTS).toHaveProperty('turnover');
        expect(uu.DEFAULT_WEIGHTS).toHaveProperty('latency');
        expect(uu.DEFAULT_WEIGHTS).toHaveProperty('concentration');
        expect(uu.DEFAULT_WEIGHTS).toHaveProperty('crowding');
    });

    test('getDefaultWeights returns a mutable copy', () => {
        const w = uu.getDefaultWeights();
        w.tailRisk = 999;
        expect(uu.DEFAULT_WEIGHTS.tailRisk).not.toBe(999);
    });
});

describe('§59 computeUtility', () => {
    test('happy path: expectancy with no penalties', () => {
        const r = uu.computeUtility({ expectancy: 100 });
        expect(r.totalUtility).toBe(100);
        expect(r.components.expectancy).toBe(100);
    });

    test('tail risk penalty reduces utility', () => {
        const noTail = uu.computeUtility({ expectancy: 100 });
        const withTail = uu.computeUtility({ expectancy: 100, tailRiskBps: 500, baseSize: 1 });
        expect(withTail.totalUtility).toBeLessThan(noTail.totalUtility);
        expect(withTail.components.tailRiskPenalty).toBeGreaterThan(0);
    });

    test('turnover penalty reduces utility', () => {
        const noTurnover = uu.computeUtility({ expectancy: 100 });
        const high = uu.computeUtility({ expectancy: 100, turnover: 50 });
        expect(high.totalUtility).toBeLessThan(noTurnover.totalUtility);
    });

    test('latency penalty reduces utility', () => {
        const fresh = uu.computeUtility({ expectancy: 100 });
        const laggy = uu.computeUtility({ expectancy: 100, latencyMs: 5000 });
        expect(laggy.totalUtility).toBeLessThan(fresh.totalUtility);
    });

    test('concentration penalty reduces utility', () => {
        const diverse = uu.computeUtility({ expectancy: 100 });
        const concentrated = uu.computeUtility({ expectancy: 100, concentrationScore: 0.8 });
        expect(concentrated.totalUtility).toBeLessThan(diverse.totalUtility);
    });

    test('crowding penalty reduces utility', () => {
        const open = uu.computeUtility({ expectancy: 100 });
        const crowded = uu.computeUtility({ expectancy: 100, crowdingScore: 0.6 });
        expect(crowded.totalUtility).toBeLessThan(open.totalUtility);
    });

    test('custom weights override defaults', () => {
        const def = uu.computeUtility({ expectancy: 100, tailRiskBps: 1000, baseSize: 1 });
        const heavy = uu.computeUtility({
            expectancy: 100, tailRiskBps: 1000, baseSize: 1,
            weights: { tailRisk: 5.0 }
        });
        expect(heavy.components.tailRiskPenalty).toBeGreaterThan(def.components.tailRiskPenalty);
    });

    test('throws on missing expectancy', () => {
        expect(() => uu.computeUtility({})).toThrow(/expectancy/i);
    });

    test('all penalties sum to expectancy - totalUtility', () => {
        const r = uu.computeUtility({
            expectancy: 100,
            tailRiskBps: 500, baseSize: 1,
            turnover: 20,
            latencyMs: 1000,
            concentrationScore: 0.3,
            crowdingScore: 0.4
        });
        const sumPenalties = r.components.tailRiskPenalty
            + r.components.turnoverPenalty
            + r.components.latencyPenalty
            + r.components.concentrationPenalty
            + r.components.crowdingPenalty;
        expect(r.components.expectancy - r.totalUtility).toBeCloseTo(sumPenalties);
    });
});

describe('§59 compareDecisions', () => {
    test('A wins when higher utility', () => {
        const r = uu.compareDecisions({
            decisionA: { expectancy: 100 },
            decisionB: { expectancy: 50 }
        });
        expect(r.verdict).toBe('A');
        expect(r.diff).toBeGreaterThan(0);
    });

    test('B wins when higher utility', () => {
        const r = uu.compareDecisions({
            decisionA: { expectancy: 50 },
            decisionB: { expectancy: 100 }
        });
        expect(r.verdict).toBe('B');
    });

    test('tie when identical utility', () => {
        const r = uu.compareDecisions({
            decisionA: { expectancy: 75 },
            decisionB: { expectancy: 75 }
        });
        expect(r.verdict).toBe('tie');
    });

    test('apples-to-apples: high expectancy + high tail loses to lower-expectancy lower-tail', () => {
        // Risky: 200 expectancy but 10000bps (100%) tail.
        // Safe: 100 expectancy with 100bps (1%) tail.
        // Operator amplifies tail weight to 150 (treats tail as 1.5x its magnitude).
        // Risky utility = 200 - 150*(10000/10000)*1 = 50
        // Safe utility  = 100 - 150*(100/10000)*1   = 98.5
        // → B wins.
        const risky = { expectancy: 200, tailRiskBps: 10000, baseSize: 1 };
        const safe = { expectancy: 100, tailRiskBps: 100, baseSize: 1 };
        const r = uu.compareDecisions({
            decisionA: risky, decisionB: safe,
            weights: { tailRisk: 150.0 }
        });
        expect(r.verdict).toBe('B');
    });
});

describe('§59 recordEvaluation', () => {
    test('persists utility eval row', () => {
        const u = uu.computeUtility({ expectancy: 100, tailRiskBps: 200 });
        const r = uu.recordEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'DEC-001',
            utilityResult: u
        });
        expect(r.recorded).toBe(true);
        const rows = db.prepare(
            `SELECT * FROM ml_utility_evaluations WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].decision_id).toBe('DEC-001');
        expect(rows[0].total_utility).toBeCloseTo(u.totalUtility);
    });
});

describe('§59 getUtilityTrend', () => {
    test('aggregates samples + averages', () => {
        for (let i = 0; i < 5; i++) {
            const u = uu.computeUtility({ expectancy: 100 + i * 10 });
            uu.recordEvaluation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                decisionId: `DEC-${i}`, utilityResult: u
            });
        }
        const t = uu.getUtilityTrend({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(t.samples).toBe(5);
        expect(t.avgUtility).toBeGreaterThan(100);
    });
});

describe('§59 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9060;
        const u = uu.computeUtility({ expectancy: 100 });
        uu.recordEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'X', utilityResult: u
        });
        const t1 = uu.getUtilityTrend({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const t2 = uu.getUtilityTrend({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(t1.samples).toBe(1);
        expect(t2.samples).toBe(0);
    });
});
