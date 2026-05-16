'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p86-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const sc = require('../../../server/services/ml/R5A_learning/strategyCapacity');

const TEST_USER = 9086;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_capacity_observations WHERE user_id IN (?, ?)').run(TEST_USER, 9087);
    db.prepare('DELETE FROM ml_capacity_ceilings WHERE user_id IN (?, ?)').run(TEST_USER, 9087);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§86 Migrations 161 + 162', () => {
    test('UNIQUE composite per (user, env, strategy, regime, asset)', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_capacity_ceilings
             (user_id, resolved_env, strategy_id, regime, asset,
              soft_cap_capital, hard_cap_capital,
              diminishing_returns_inflection, last_validated, status)
             VALUES (?, ?, 'S', 'r', 'BTC', 1000, 1500, 1200, ?, 'VALID')`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_capacity_ceilings
             (user_id, resolved_env, strategy_id, regime, asset,
              soft_cap_capital, hard_cap_capital,
              diminishing_returns_inflection, last_validated, status)
             VALUES (?, ?, 'S', 'r', 'BTC', 2000, 3000, 2400, ?, 'VALID')`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK status restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_capacity_ceilings
             (user_id, resolved_env, strategy_id, regime, asset,
              soft_cap_capital, hard_cap_capital,
              diminishing_returns_inflection, last_validated, status)
             VALUES (?, ?, 'S', 'r', 'BTC', 1000, 1500, 1200, ?, 'BOGUS')`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });
});

describe('§86 Constants', () => {
    test('CAPACITY_STATUSES has 3 entries', () => {
        expect(sc.CAPACITY_STATUSES).toEqual(['VALID', 'STALE', 'EXCEEDED']);
    });

    test('SOFT_CAP_MULTIPLIER in (0,1)', () => {
        expect(sc.SOFT_CAP_MULTIPLIER).toBeGreaterThan(0);
        expect(sc.SOFT_CAP_MULTIPLIER).toBeLessThan(1);
    });

    test('STALE_THRESHOLD_DAYS positive', () => {
        expect(sc.STALE_THRESHOLD_DAYS).toBeGreaterThan(0);
    });
});

describe('§86 recordCapacityObservation', () => {
    test('persists + computes marginal alpha', () => {
        const r = sc.recordCapacityObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S1', regime: 'range', asset: 'BTC',
            deployedCapital: 1000, observedPnl: 50,
            observedSlippage: 5, observedImpact: 3
        });
        expect(r.marginalAlpha).toBeCloseTo(0.05);
    });

    test('throws on zero deployed capital', () => {
        expect(() => sc.recordCapacityObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S1', regime: 'r', asset: 'BTC',
            deployedCapital: 0, observedPnl: 0,
            observedSlippage: 0, observedImpact: 0
        })).toThrow();
    });
});

describe('§86 computeCapacityCeiling', () => {
    test('insufficient samples returns sufficient=false', () => {
        for (let i = 0; i < 5; i++) {
            sc.recordCapacityObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                strategyId: 'S-INS', regime: 'r', asset: 'BTC',
                deployedCapital: 100 * (i + 1), observedPnl: 5,
                observedSlippage: 5, observedImpact: 3
            });
        }
        const r = sc.computeCapacityCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-INS', regime: 'r', asset: 'BTC'
        });
        expect(r.sufficient).toBe(false);
    });

    test('sufficient samples computes ceiling', () => {
        // Increasing capital, decreasing marginal alpha (diminishing returns)
        for (let i = 0; i < 15; i++) {
            const capital = 100 * (i + 1);
            // pnl(capital) = 10 - 0.5 × i (decreasing per unit)
            const marginalAlphaTarget = Math.max(0.001, 0.10 - i * 0.005);
            const pnl = capital * marginalAlphaTarget;
            sc.recordCapacityObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                strategyId: 'S-FIT', regime: 'range', asset: 'BTC',
                deployedCapital: capital, observedPnl: pnl,
                observedSlippage: 5, observedImpact: 3
            });
        }
        const r = sc.computeCapacityCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-FIT', regime: 'range', asset: 'BTC'
        });
        expect(r.sufficient).toBe(true);
        expect(r.softCapCapital).toBeLessThan(r.hardCapCapital);
    });
});

describe('§86 recordCeiling + getCeiling', () => {
    test('persists', () => {
        sc.recordCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S1', regime: 'r', asset: 'BTC',
            softCap: 1000, hardCap: 1500, inflection: 1200
        });
        const c = sc.getCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S1', regime: 'r', asset: 'BTC'
        });
        expect(c.softCapCapital).toBe(1000);
        expect(c.hardCapCapital).toBe(1500);
    });

    test('upserts on duplicate', () => {
        sc.recordCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S2', regime: 'r', asset: 'BTC',
            softCap: 1000, hardCap: 1500, inflection: 1200
        });
        sc.recordCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S2', regime: 'r', asset: 'BTC',
            softCap: 2000, hardCap: 3000, inflection: 2400
        });
        const c = sc.getCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S2', regime: 'r', asset: 'BTC'
        });
        expect(c.softCapCapital).toBe(2000);
    });

    test('throws if softCap > hardCap', () => {
        expect(() => sc.recordCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-BAD', regime: 'r', asset: 'BTC',
            softCap: 2000, hardCap: 1000, inflection: 500
        })).toThrow();
    });
});

describe('§86 evaluateCapacityHealth', () => {
    beforeEach(() => {
        sc.recordCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-EVAL', regime: 'range', asset: 'BTC',
            softCap: 1000, hardCap: 1500, inflection: 1200
        });
    });

    test('approved when within soft cap', () => {
        const r = sc.evaluateCapacityHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-EVAL', regime: 'range', asset: 'BTC',
            proposedCapital: 800
        });
        expect(r.recommendation).toBe('APPROVED');
        expect(r.withinSoftCap).toBe(true);
    });

    test('warn when over soft but within hard', () => {
        const r = sc.evaluateCapacityHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-EVAL', regime: 'range', asset: 'BTC',
            proposedCapital: 1200
        });
        expect(r.recommendation).toBe('WARN_OVER_SOFT_CAP');
        expect(r.withinSoftCap).toBe(false);
        expect(r.withinHardCap).toBe(true);
    });

    test('reject when over hard cap', () => {
        const r = sc.evaluateCapacityHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-EVAL', regime: 'range', asset: 'BTC',
            proposedCapital: 2000
        });
        expect(r.recommendation).toBe('REJECT_OVER_HARD_CAP');
        expect(r.withinHardCap).toBe(false);
    });

    test('no ceiling configured → no_ceiling_configured', () => {
        const r = sc.evaluateCapacityHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'NEW-STRAT', regime: 'range', asset: 'BTC',
            proposedCapital: 500
        });
        expect(r.recommendation).toBe('no_ceiling_configured');
    });
});

describe('§86 markStaleIfOlderThan', () => {
    test('marks old ceilings as STALE', () => {
        const oldTs = Date.now() - 90 * 86400000;
        sc.recordCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-OLD', regime: 'r', asset: 'BTC',
            softCap: 1000, hardCap: 1500, inflection: 1200,
            ts: oldTs
        });
        sc.markStaleIfOlderThan({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            daysThreshold: 30
        });
        const c = sc.getCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-OLD', regime: 'r', asset: 'BTC'
        });
        expect(c.status).toBe('STALE');
    });

    test('STALE rejects revalidation requirement', () => {
        const oldTs = Date.now() - 60 * 86400000;
        sc.recordCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-STALE', regime: 'r', asset: 'BTC',
            softCap: 1000, hardCap: 1500, inflection: 1200,
            ts: oldTs
        });
        sc.markStaleIfOlderThan({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            daysThreshold: 30
        });
        const r = sc.evaluateCapacityHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-STALE', regime: 'r', asset: 'BTC',
            proposedCapital: 500
        });
        expect(r.recommendation).toMatch(/revalidate/i);
    });
});

describe('§86 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9087;
        sc.recordCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-ISO', regime: 'r', asset: 'BTC',
            softCap: 1000, hardCap: 1500, inflection: 1200
        });
        const c1 = sc.getCeiling({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-ISO', regime: 'r', asset: 'BTC'
        });
        const c2 = sc.getCeiling({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            strategyId: 'S-ISO', regime: 'r', asset: 'BTC'
        });
        expect(c1).toBeTruthy();
        expect(c2).toBe(null);
    });
});
