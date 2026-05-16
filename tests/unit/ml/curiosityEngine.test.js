'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p95-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ce = require('../../../server/services/ml/R6_shadowMeta/curiosityEngine');

const TEST_USER = 9095;
const OTHER_USER = 9096;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_curiosity_setups WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_curiosity_trades WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§95 Migrations 179 + 180', () => {
    test('setup_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_curiosity_setups
             (user_id, resolved_env, setup_id, hypothesis, stage,
              allocated_capital, max_capital_cap,
              observations_count, pnl_cumulative,
              ts_created, ts_last_updated)
             VALUES (?, ?, 'CS-UNIQ', 'h', 'EXPLORE', 10, 20, 0, 0, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_curiosity_setups
             (user_id, resolved_env, setup_id, hypothesis, stage,
              allocated_capital, max_capital_cap,
              observations_count, pnl_cumulative,
              ts_created, ts_last_updated)
             VALUES (?, ?, 'CS-UNIQ', 'h2', 'EXPLORE', 5, 10, 0, 0, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK stage restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_curiosity_setups
             (user_id, resolved_env, setup_id, hypothesis, stage,
              allocated_capital, max_capital_cap,
              observations_count, pnl_cumulative,
              ts_created, ts_last_updated)
             VALUES (?, ?, 'CS-BAD', 'h', 'BOGUS', 10, 20, 0, 0, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK source restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_curiosity_trades
             (user_id, resolved_env, trade_id, setup_id, source,
              capital_used, pnl, ts)
             VALUES (?, ?, 'TR-BAD', 'CS', 'BOGUS', 10, 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§95 Constants', () => {
    test('CURIOSITY_STAGES has 5 entries', () => {
        expect(ce.CURIOSITY_STAGES).toEqual([
            'EXPLORE', 'OBSERVE', 'VALIDATE', 'GRADUATED', 'RETIRED'
        ]);
    });

    test('TRADE_SOURCES has 2 entries', () => {
        expect(ce.TRADE_SOURCES).toEqual(['exploitation', 'exploration']);
    });

    test('STAGE_OBS_THRESHOLDS strictly increasing', () => {
        expect(ce.STAGE_OBS_THRESHOLDS.EXPLORE_TO_OBSERVE)
            .toBeLessThan(ce.STAGE_OBS_THRESHOLDS.OBSERVE_TO_VALIDATE);
        expect(ce.STAGE_OBS_THRESHOLDS.OBSERVE_TO_VALIDATE)
            .toBeLessThan(ce.STAGE_OBS_THRESHOLDS.VALIDATE_TO_GRADUATE);
    });
});

describe('§95 allocateCapital', () => {
    test('caps at setupMaxCap when requested exceeds', () => {
        const r = ce.allocateCapital({
            totalCapital: 10000, requestedAmount: 500,
            setupMaxCap: 100, exploreBudgetRatio: 0.05
        });
        expect(r.allocated).toBe(100);
        expect(r.reason).toBe('capped');
    });

    test('caps at budget remainder when budget low', () => {
        const r = ce.allocateCapital({
            totalCapital: 1000, requestedAmount: 200,
            setupMaxCap: 200, exploreBudgetRatio: 0.05,
            currentExplorationUsed: 30
        });
        // budget = 50, remaining = 20
        expect(r.allocated).toBe(20);
        expect(r.reason).toBe('capped');
    });

    test('full request when both caps high', () => {
        const r = ce.allocateCapital({
            totalCapital: 10000, requestedAmount: 50,
            setupMaxCap: 500
        });
        expect(r.allocated).toBe(50);
        expect(r.reason).toBe('full_request');
    });

    test('zero capital returns no_capital', () => {
        const r = ce.allocateCapital({
            totalCapital: 0, requestedAmount: 100, setupMaxCap: 100
        });
        expect(r.allocated).toBe(0);
        expect(r.reason).toBe('no_capital');
    });
});

describe('§95 registerSetup', () => {
    test('persists with EXPLORE stage', () => {
        const r = ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RS-1', hypothesis: 'volume spike at open',
            initialCapital: 100, maxCapitalCap: 500
        });
        expect(r.registered).toBe(true);
        expect(r.stage).toBe('EXPLORE');
    });

    test('duplicate throws', () => {
        ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RS-DUP', hypothesis: 'h', initialCapital: 50
        });
        expect(() => ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RS-DUP', hypothesis: 'h2', initialCapital: 100
        })).toThrow();
    });

    test('maxCap < initialCapital throws', () => {
        expect(() => ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RS-BAD', hypothesis: 'h',
            initialCapital: 200, maxCapitalCap: 100
        })).toThrow();
    });
});

describe('§95 recordExploratoryTrade', () => {
    test('tags exploration + increments setup counts', () => {
        ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RX-1', hypothesis: 'h', initialCapital: 100
        });
        const r = ce.recordExploratoryTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-1', setupId: 'RX-1',
            capitalUsed: 50, pnl: 5
        });
        expect(r.source).toBe('exploration');
        expect(r.newObservationsCount).toBe(1);
        expect(r.newPnlCumulative).toBe(5);
    });

    test('unregistered setup throws', () => {
        expect(() => ce.recordExploratoryTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-MISSING', setupId: 'NOEXIST',
            capitalUsed: 10, pnl: 1
        })).toThrow();
    });
});

describe('§95 evaluateGraduation', () => {
    function feedTrades(setupId, count, pnlEach) {
        for (let i = 0; i < count; i++) {
            ce.recordExploratoryTrade({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                tradeId: `${setupId}-T-${i}`, setupId,
                capitalUsed: 10, pnl: pnlEach
            });
        }
    }

    test('EXPLORE → OBSERVE at threshold', () => {
        ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'EG-EO', hypothesis: 'h', initialCapital: 50
        });
        feedTrades('EG-EO', 5, 1);
        const r = ce.evaluateGraduation({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupId: 'EG-EO'
        });
        expect(r.toStage).toBe('OBSERVE');
    });

    test('VALIDATE → GRADUATED with positive pnl', () => {
        ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'EG-VG', hypothesis: 'h', initialCapital: 50
        });
        feedTrades('EG-VG', 20, 2);
        // step through stages
        ce.evaluateGraduation({ userId: TEST_USER, resolvedEnv: TEST_ENV, setupId: 'EG-VG' });
        ce.evaluateGraduation({ userId: TEST_USER, resolvedEnv: TEST_ENV, setupId: 'EG-VG' });
        const r = ce.evaluateGraduation({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupId: 'EG-VG'
        });
        expect(r.toStage).toBe('GRADUATED');
    });

    test('auto-retire on persistent negative pnl', () => {
        ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'EG-AR', hypothesis: 'h', initialCapital: 50
        });
        feedTrades('EG-AR', 6, -5);
        const r = ce.evaluateGraduation({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupId: 'EG-AR'
        });
        expect(r.toStage).toBe('RETIRED');
    });

    test('no transition when below threshold', () => {
        ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'EG-NT', hypothesis: 'h', initialCapital: 50
        });
        feedTrades('EG-NT', 2, 1);
        const r = ce.evaluateGraduation({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupId: 'EG-NT'
        });
        expect(r.transitioned).toBe(false);
    });
});

describe('§95 getCuriosityReport', () => {
    test('separates exploration alpha', () => {
        ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'CR-1', hypothesis: 'h', initialCapital: 50
        });
        ce.recordExploratoryTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'CR-T-1', setupId: 'CR-1',
            capitalUsed: 10, pnl: 5
        });
        const r = ce.getCuriosityReport({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.exploration.trades).toBe(1);
        expect(r.exploration.pnlSum).toBe(5);
        expect(r.exploitation.trades).toBe(0);
    });
});

describe('§95 retireSetup', () => {
    test('marks RETIRED', () => {
        ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RT-1', hypothesis: 'h', initialCapital: 50
        });
        const r = ce.retireSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RT-1', reason: 'operator'
        });
        expect(r.retired).toBe(true);
        expect(r.previousStage).toBe('EXPLORE');
    });
});

describe('§95 isolation', () => {
    test('per (user × env) isolation', () => {
        ce.registerSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'ISO-1', hypothesis: 'h', initialCapital: 50
        });
        ce.recordExploratoryTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'ISO-T', setupId: 'ISO-1',
            capitalUsed: 10, pnl: 1
        });
        const a = ce.getCuriosityReport({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const b = ce.getCuriosityReport({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(a.exploration.trades).toBe(1);
        expect(b.exploration.trades).toBe(0);
    });
});
