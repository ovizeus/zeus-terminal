'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-execn2-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const fae = require('../../../server/services/ml/R4_execution/fundingAwareExit');

const TEST_USER = 9002;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_funding_evaluations WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('EXEC-N2 Migration 074', () => {
    test('table ml_funding_evaluations exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_funding_evaluations'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_funding_evaluations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'pos_id',
            'current_funding_rate', 'time_to_funding_ms',
            'estimated_cost_usd', 'recommendation',
            'should_exit', 'created_at'
        ]));
    });

    test('CHECK recommendation restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_funding_evaluations
             (user_id, resolved_env, pos_id, current_funding_rate, time_to_funding_ms,
              estimated_cost_usd, recommendation, should_exit, created_at)
             VALUES (?, ?, 'pos-1', 0.01, 1000, 5, 'BOGUS', 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('EXEC-N2 Exported constants', () => {
    test('FUNDING_PING_INTERVAL_MS = 8h', () => {
        expect(fae.FUNDING_PING_INTERVAL_MS).toBe(28800000);
    });

    test('FUNDING_PING_HOURS_UTC = [0, 8, 16]', () => {
        expect(fae.FUNDING_PING_HOURS_UTC).toEqual([0, 8, 16]);
    });

    test('EXIT_RECOMMENDATIONS has 3 values', () => {
        expect(fae.EXIT_RECOMMENDATIONS).toEqual(['HOLD', 'REDUCE', 'EXIT']);
    });

    test('DEFAULT_THRESHOLDS has finite values', () => {
        expect(fae.DEFAULT_THRESHOLDS.exit_cost_pct_balance).toBeGreaterThan(0);
        expect(fae.DEFAULT_THRESHOLDS.reduce_cost_pct_balance).toBeGreaterThan(0);
        expect(fae.DEFAULT_THRESHOLDS.proximity_ms_warning).toBeGreaterThan(0);
        expect(fae.DEFAULT_THRESHOLDS.high_funding_rate).toBeGreaterThan(0);
    });
});

describe('EXEC-N2 getNextFundingPing (pure)', () => {
    test('returns next 8h ping after current time', () => {
        const now = new Date('2026-05-15T05:30:00Z').getTime();
        const next = fae.getNextFundingPing({ timestamp: now });
        const nextDate = new Date(next);
        expect(nextDate.getUTCHours()).toBe(8);
    });

    test('next ping 00:00 UTC when after 16:00', () => {
        const now = new Date('2026-05-15T18:00:00Z').getTime();
        const next = fae.getNextFundingPing({ timestamp: now });
        const nextDate = new Date(next);
        expect(nextDate.getUTCHours()).toBe(0);
        expect(nextDate.getUTCDate()).toBe(16);  // next day
    });

    test('next ping 16:00 UTC when at 14:00', () => {
        const now = new Date('2026-05-15T14:00:00Z').getTime();
        const next = fae.getNextFundingPing({ timestamp: now });
        expect(new Date(next).getUTCHours()).toBe(16);
    });

    test('returns time difference', () => {
        const now = new Date('2026-05-15T07:00:00Z').getTime();
        const next = fae.getNextFundingPing({ timestamp: now });
        const diff = next - now;
        expect(diff).toBeGreaterThan(0);
        expect(diff).toBeLessThanOrEqual(fae.FUNDING_PING_INTERVAL_MS);
    });
});

describe('EXEC-N2 evaluateFundingExposure (pure)', () => {
    test('LONG + positive funding → costs money (short pays long)', () => {
        const r = fae.evaluateFundingExposure({
            position: { side: 'LONG', sizeUsd: 10000 },
            currentFundingRate: 0.0005,  // 0.05% (high)
            timeToFundingMs: 1800000     // 30 min
        });
        expect(r.estimatedCostUsd).toBeLessThan(0);  // negative = pays
    });

    test('LONG + negative funding → earns (long receives)', () => {
        const r = fae.evaluateFundingExposure({
            position: { side: 'LONG', sizeUsd: 10000 },
            currentFundingRate: -0.0005,
            timeToFundingMs: 1800000
        });
        expect(r.estimatedCostUsd).toBeGreaterThan(0);
    });

    test('SHORT + positive funding → earns', () => {
        const r = fae.evaluateFundingExposure({
            position: { side: 'SHORT', sizeUsd: 10000 },
            currentFundingRate: 0.0005,
            timeToFundingMs: 1800000
        });
        expect(r.estimatedCostUsd).toBeGreaterThan(0);
    });

    test('returns proximity flag', () => {
        const r = fae.evaluateFundingExposure({
            position: { side: 'LONG', sizeUsd: 10000 },
            currentFundingRate: 0.0001,
            timeToFundingMs: 500000  // 8 min - close
        });
        expect(r.nearFunding).toBe(true);
    });

    test('no position → zero cost', () => {
        const r = fae.evaluateFundingExposure({
            position: null,
            currentFundingRate: 0.01,
            timeToFundingMs: 1000
        });
        expect(r.estimatedCostUsd).toBe(0);
    });
});

describe('EXEC-N2 shouldExitBeforeFunding (pure)', () => {
    test('LONG + low funding + far ping → HOLD', () => {
        const r = fae.shouldExitBeforeFunding({
            position: { side: 'LONG', sizeUsd: 10000 },
            currentFundingRate: 0.00005,
            timeToFundingMs: 7200000,  // 2h
            balanceUsd: 100000
        });
        expect(r.shouldExit).toBe(false);
        expect(r.recommendation).toBe('HOLD');
    });

    test('LONG + extreme positive funding + close ping → EXIT', () => {
        const r = fae.shouldExitBeforeFunding({
            position: { side: 'LONG', sizeUsd: 50000 },
            currentFundingRate: 0.003,   // 0.3% — extreme
            timeToFundingMs: 600000,     // 10 min
            balanceUsd: 100000
        });
        expect(r.shouldExit).toBe(true);
        expect(r.recommendation).toBe('EXIT');
    });

    test('LONG + moderate funding + medium proximity → REDUCE', () => {
        const r = fae.shouldExitBeforeFunding({
            position: { side: 'LONG', sizeUsd: 30000 },
            currentFundingRate: 0.0008,
            timeToFundingMs: 1200000,
            balanceUsd: 100000
        });
        expect(['REDUCE', 'EXIT']).toContain(r.recommendation);
    });

    test('SHORT + positive funding (earning) → HOLD', () => {
        const r = fae.shouldExitBeforeFunding({
            position: { side: 'SHORT', sizeUsd: 10000 },
            currentFundingRate: 0.003,
            timeToFundingMs: 600000,
            balanceUsd: 100000
        });
        expect(r.shouldExit).toBe(false);
    });

    test('returns reason for recommendation', () => {
        const r = fae.shouldExitBeforeFunding({
            position: { side: 'LONG', sizeUsd: 100000 },
            currentFundingRate: 0.005,
            timeToFundingMs: 300000,
            balanceUsd: 100000
        });
        expect(r.reason).toMatch(/funding|cost/i);
    });
});

describe('EXEC-N2 recordFundingEvaluation', () => {
    test('records evaluation row', () => {
        fae.recordFundingEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-fund-1',
            evaluation: {
                currentFundingRate: 0.0005,
                timeToFundingMs: 1800000,
                estimatedCostUsd: -5,
                recommendation: 'HOLD',
                shouldExit: false
            }
        });
        const rows = db.prepare(
            `SELECT * FROM ml_funding_evaluations WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].recommendation).toBe('HOLD');
    });

    test('throws on invalid recommendation', () => {
        expect(() => fae.recordFundingEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-bad',
            evaluation: { recommendation: 'BOGUS' }
        })).toThrow(/recommendation/i);
    });
});

describe('EXEC-N2 getFundingHistory', () => {
    beforeEach(() => {
        for (let i = 0; i < 5; i++) {
            fae.recordFundingEvaluation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                posId: `pos-hist-${i}`,
                evaluation: {
                    currentFundingRate: 0.001 * i,
                    timeToFundingMs: 1000000,
                    estimatedCostUsd: -i,
                    recommendation: 'HOLD',
                    shouldExit: false
                }
            });
        }
    });

    test('returns all evaluations when no filter', () => {
        const r = fae.getFundingHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.length).toBe(5);
    });

    test('filters by posId', () => {
        const r = fae.getFundingHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-hist-2'
        });
        expect(r.length).toBe(1);
    });

    test('respects limit', () => {
        const r = fae.getFundingHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            limit: 3
        });
        expect(r.length).toBe(3);
    });
});

describe('EXEC-N2 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9003;
        fae.recordFundingEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-iso',
            evaluation: {
                currentFundingRate: 0.0005, timeToFundingMs: 1000,
                estimatedCostUsd: 1, recommendation: 'HOLD', shouldExit: false
            }
        });
        fae.recordFundingEvaluation({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-iso',
            evaluation: {
                currentFundingRate: 0.005, timeToFundingMs: 100,
                estimatedCostUsd: 50, recommendation: 'EXIT', shouldExit: true
            }
        });
        const r1 = fae.getFundingHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = fae.getFundingHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1[0].recommendation).toBe('HOLD');
        expect(r2[0].recommendation).toBe('EXIT');
        db.prepare(`DELETE FROM ml_funding_evaluations WHERE user_id = ?`).run(OTHER_USER);
    });
});
