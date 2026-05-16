'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p80-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const voi = require('../../../server/services/ml/R2_cognition/valueOfInformation');

const TEST_USER = 9080;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_voi_evaluations WHERE user_id IN (?, ?)').run(TEST_USER, 9081);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§80 Migration 150', () => {
    test('ml_voi_evaluations exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_voi_evaluations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'decision_id', 'expected_confirmation_value', 'funding_cost_bps',
            'opportunity_cost', 'slippage_cost_bps', 'total_cost',
            'voi', 'recommendation', 'ts'
        ]));
    });

    test('decision_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_voi_evaluations
             (user_id, resolved_env, decision_id, expected_confirmation_value,
              funding_cost_bps, opportunity_cost, slippage_cost_bps,
              total_cost, voi, recommendation, ts)
             VALUES (?, ?, 'V-UNIQ', 10, 1, 2, 1, 4, 6, 'WAIT', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_voi_evaluations
             (user_id, resolved_env, decision_id, expected_confirmation_value,
              funding_cost_bps, opportunity_cost, slippage_cost_bps,
              total_cost, voi, recommendation, ts)
             VALUES (?, ?, 'V-UNIQ', 10, 1, 2, 1, 4, 6, 'WAIT', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK recommendation restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_voi_evaluations
             (user_id, resolved_env, decision_id, expected_confirmation_value,
              funding_cost_bps, opportunity_cost, slippage_cost_bps,
              total_cost, voi, recommendation, ts)
             VALUES (?, ?, 'V-BAD', 10, 1, 2, 1, 4, 6, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§80 Constants', () => {
    test('RECOMMENDATIONS has 2 entries', () => {
        expect(voi.RECOMMENDATIONS).toEqual(['WAIT', 'ACT_NOW']);
    });

    test('VOI_POSITIVE_THRESHOLD = 0', () => {
        expect(voi.VOI_POSITIVE_THRESHOLD).toBe(0);
    });

    test('VOI_SIGNIFICANT_THRESHOLD positive', () => {
        expect(voi.VOI_SIGNIFICANT_THRESHOLD).toBeGreaterThan(0);
    });
});

describe('§80 computeWaitCosts (pure)', () => {
    test('sums all cost components', () => {
        const r = voi.computeWaitCosts({
            fundingRateBps: 10, timeUntilSignalMs: 3600000,  // 10bps/hour × 1h = 10
            opportunityProbabilityLeaves: 0.30,
            expectedPriceMoveBps: 20,                          // 0.30 × 20 = 6
            slippageDeltaBps: 3
        });
        expect(r.fundingCostBps).toBeCloseTo(10);
        expect(r.opportunityCost).toBeCloseTo(6);
        expect(r.slippageCostBps).toBe(3);
        expect(r.totalCost).toBeCloseTo(19);
    });

    test('zero defaults safe', () => {
        const r = voi.computeWaitCosts({});
        expect(r.totalCost).toBe(0);
    });

    test('opportunity uses abs(priceMove)', () => {
        const r = voi.computeWaitCosts({
            opportunityProbabilityLeaves: 0.5,
            expectedPriceMoveBps: -20
        });
        expect(r.opportunityCost).toBeCloseTo(10);
    });
});

describe('§80 computeExpectedConfirmationValue (pure)', () => {
    test('high prob + low current = high expected value', () => {
        const r = voi.computeExpectedConfirmationValue({
            signalProbability: 0.8,
            currentConfidence: 0.2,
            valueIfConfirmed: 100
        });
        expect(r.expectedConfirmationValue).toBeCloseTo(64);  // 0.8 × 100 × 0.8
    });

    test('full confidence already → zero uplift', () => {
        const r = voi.computeExpectedConfirmationValue({
            signalProbability: 1.0,
            currentConfidence: 1.0,
            valueIfConfirmed: 100
        });
        expect(r.expectedConfirmationValue).toBe(0);
    });

    test('throws on out-of-range probability', () => {
        expect(() => voi.computeExpectedConfirmationValue({
            signalProbability: 1.5,
            currentConfidence: 0.5,
            valueIfConfirmed: 100
        })).toThrow();
    });
});

describe('§80 evaluateVOI (pure)', () => {
    test('positive VOI → WAIT', () => {
        const r = voi.evaluateVOI({
            expectedConfirmationValue: 50,
            totalWaitCost: 20
        });
        expect(r.recommendation).toBe('WAIT');
        expect(r.voi).toBe(30);
    });

    test('negative VOI → ACT_NOW', () => {
        const r = voi.evaluateVOI({
            expectedConfirmationValue: 10,
            totalWaitCost: 30
        });
        expect(r.recommendation).toBe('ACT_NOW');
    });

    test('zero VOI → ACT_NOW (no benefit to wait)', () => {
        const r = voi.evaluateVOI({
            expectedConfirmationValue: 20,
            totalWaitCost: 20
        });
        expect(r.recommendation).toBe('ACT_NOW');
        expect(r.voi).toBe(0);
    });

    test('significant flag triggers on large VOI', () => {
        const r = voi.evaluateVOI({
            expectedConfirmationValue: 50,
            totalWaitCost: 10
        });
        expect(r.significant).toBe(true);
    });
});

describe('§80 recordVOIEvaluation', () => {
    test('persists', () => {
        voi.recordVOIEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'V-001',
            expectedConfirmationValue: 50,
            fundingCostBps: 5, opportunityCost: 10, slippageCostBps: 3,
            totalCost: 18, voi: 32,
            recommendation: 'WAIT'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_voi_evaluations WHERE decision_id = 'V-001'`
        ).all();
        expect(rows).toHaveLength(1);
    });

    test('duplicate decisionId throws', () => {
        voi.recordVOIEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'V-DUP',
            expectedConfirmationValue: 50,
            fundingCostBps: 5, opportunityCost: 10, slippageCostBps: 3,
            totalCost: 18, voi: 32,
            recommendation: 'WAIT'
        });
        expect(() => voi.recordVOIEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'V-DUP',
            expectedConfirmationValue: 50,
            fundingCostBps: 5, opportunityCost: 10, slippageCostBps: 3,
            totalCost: 18, voi: 32,
            recommendation: 'WAIT'
        })).toThrow();
    });

    test('throws on invalid recommendation', () => {
        expect(() => voi.recordVOIEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'V-BAD',
            expectedConfirmationValue: 50,
            fundingCostBps: 5, opportunityCost: 10, slippageCostBps: 3,
            totalCost: 18, voi: 32,
            recommendation: 'BOGUS'
        })).toThrow();
    });
});

describe('§80 getVOIHistory + stats', () => {
    test('history filter by recommendation', () => {
        voi.recordVOIEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'V-H1',
            expectedConfirmationValue: 50, fundingCostBps: 5,
            opportunityCost: 5, slippageCostBps: 5,
            totalCost: 15, voi: 35, recommendation: 'WAIT'
        });
        voi.recordVOIEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'V-H2',
            expectedConfirmationValue: 5, fundingCostBps: 10,
            opportunityCost: 10, slippageCostBps: 10,
            totalCost: 30, voi: -25, recommendation: 'ACT_NOW'
        });
        const waits = voi.getVOIHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, recommendation: 'WAIT'
        });
        const acts = voi.getVOIHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, recommendation: 'ACT_NOW'
        });
        expect(waits).toHaveLength(1);
        expect(acts).toHaveLength(1);
    });

    test('stats aggregates', () => {
        voi.recordVOIEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'V-S1',
            expectedConfirmationValue: 50, fundingCostBps: 5,
            opportunityCost: 5, slippageCostBps: 5,
            totalCost: 15, voi: 35, recommendation: 'WAIT'
        });
        const s = voi.getVOIStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.total).toBe(1);
    });
});

describe('§80 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9081;
        voi.recordVOIEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'V-ISO',
            expectedConfirmationValue: 50, fundingCostBps: 5,
            opportunityCost: 5, slippageCostBps: 5,
            totalCost: 15, voi: 35, recommendation: 'WAIT'
        });
        const h1 = voi.getVOIHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const h2 = voi.getVOIHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(h1.length).toBe(1);
        expect(h2.length).toBe(0);
    });
});
