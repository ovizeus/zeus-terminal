'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p51-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const tca = require('../../../server/services/ml/R4_execution/tcaFillSimulator');

const TEST_USER = 9051;
const TEST_ENV = 'DEMO';
const EX = 'binance';
const SYM = 'BTCUSDT';

function cleanRows() {
    db.prepare('DELETE FROM ml_l2_depth_snapshots WHERE user_id IN (?, ?)').run(TEST_USER, 9052);
    db.prepare('DELETE FROM ml_slippage_calibration WHERE user_id IN (?, ?)').run(TEST_USER, 9052);
    db.prepare('DELETE FROM ml_fill_simulations WHERE user_id IN (?, ?)').run(TEST_USER, 9052);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§51 Migrations 119-121', () => {
    test('ml_l2_depth_snapshots exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_l2_depth_snapshots'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('ml_slippage_calibration UNIQUE per user×env×exchange×symbol', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_slippage_calibration
             (user_id, resolved_env, exchange, symbol,
              sample_count, alpha, beta, r_squared, last_updated)
             VALUES (?, ?, 'X', 'Y', 10, 1, 0.1, 0.5, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_slippage_calibration
             (user_id, resolved_env, exchange, symbol,
              sample_count, alpha, beta, r_squared, last_updated)
             VALUES (?, ?, 'X', 'Y', 20, 2, 0.2, 0.6, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('ml_fill_simulations CHECK mode restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_fill_simulations
             (user_id, resolved_env, exchange, symbol, mode,
              order_side, order_size, simulated_avg_price,
              simulated_slippage_bps, ts)
             VALUES (?, ?, 'binance', 'BTC', 'BOGUS', 'LONG', 1, 100, 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('ml_fill_simulations CHECK order_side restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_fill_simulations
             (user_id, resolved_env, exchange, symbol, mode,
              order_side, order_size, simulated_avg_price,
              simulated_slippage_bps, ts)
             VALUES (?, ?, 'binance', 'BTC', 'backtest', 'BOGUS', 1, 100, 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§51 Constants', () => {
    test('SIM_MODES has 2 entries', () => {
        expect(tca.SIM_MODES).toEqual(['backtest', 'shadow']);
    });

    test('ORDER_SIDES has 2 entries', () => {
        expect(tca.ORDER_SIDES).toEqual(['LONG', 'SHORT']);
    });

    test('MIN_SAMPLES_FOR_CALIBRATION positive', () => {
        expect(tca.MIN_SAMPLES_FOR_CALIBRATION).toBeGreaterThan(0);
    });
});

describe('§51 recordL2Snapshot', () => {
    test('persists with computed mid_price', () => {
        const r = tca.recordL2Snapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: EX, symbol: SYM,
            bids: [[100, 5], [99, 10]],
            asks: [[101, 3], [102, 8]]
        });
        expect(r.midPrice).toBe(100.5);

        const rows = db.prepare(
            `SELECT * FROM ml_l2_depth_snapshots WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].mid_price).toBe(100.5);
    });
});

describe('§51 simulateFill — walk the book', () => {
    test('LONG buys from asks', () => {
        const r = tca.simulateFill({
            side: 'LONG', size: 2,
            depthBook: {
                bids: [[100, 10]],
                asks: [[101, 1], [102, 5]]
            }
        });
        expect(r.fullyFilled).toBe(true);
        // 1@101 + 1@102 → avgPrice = 101.5; midRef = 100.5
        expect(r.avgPrice).toBe(101.5);
        expect(r.slippageBps).toBeGreaterThan(0);
        expect(r.levelsConsumed).toBe(2);
    });

    test('SHORT sells into bids', () => {
        const r = tca.simulateFill({
            side: 'SHORT', size: 2,
            depthBook: {
                bids: [[100, 1], [99, 5]],
                asks: [[101, 10]]
            }
        });
        expect(r.fullyFilled).toBe(true);
        // 1@100 + 1@99 → avgPrice = 99.5; midRef = 100.5
        expect(r.avgPrice).toBe(99.5);
        expect(r.slippageBps).toBeGreaterThan(0);  // adverse for SHORT going down
    });

    test('single level fully filled', () => {
        const r = tca.simulateFill({
            side: 'LONG', size: 1,
            depthBook: {
                bids: [[100, 10]],
                asks: [[101, 5]]
            }
        });
        expect(r.fullyFilled).toBe(true);
        expect(r.avgPrice).toBe(101);
        expect(r.levelsConsumed).toBe(1);
    });

    test('insufficient depth returns not-fully-filled', () => {
        const r = tca.simulateFill({
            side: 'LONG', size: 100,
            depthBook: {
                bids: [[100, 10]],
                asks: [[101, 1], [102, 2]]
            }
        });
        expect(r.fullyFilled).toBe(false);
        expect(r.remainingSize).toBe(97);
    });

    test('throws on invalid side', () => {
        expect(() => tca.simulateFill({
            side: 'BOGUS', size: 1,
            depthBook: { bids: [[100, 1]], asks: [[101, 1]] }
        })).toThrow();
    });

    test('throws on empty book side', () => {
        expect(() => tca.simulateFill({
            side: 'LONG', size: 1,
            depthBook: { bids: [[100, 1]], asks: [] }
        })).toThrow();
    });
});

describe('§51 calibrateSlippageModel', () => {
    function seedFills(count, sizes, slippages) {
        for (let i = 0; i < count; i++) {
            tca.recordFillSimulation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                exchange: EX, symbol: SYM,
                mode: 'backtest', side: 'LONG',
                size: sizes[i % sizes.length],
                simulatedAvgPrice: 100 + slippages[i % slippages.length] / 100,
                simulatedSlippageBps: slippages[i % slippages.length]
            });
        }
    }

    test('insufficient samples returns calibrated=false', () => {
        seedFills(3, [1, 2, 3], [5, 6, 7]);
        const r = tca.calibrateSlippageModel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: EX, symbol: SYM
        });
        expect(r.calibrated).toBe(false);
    });

    test('sufficient samples returns alpha/beta/r²', () => {
        const sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const slippages = sizes.map(s => 2 + 0.5 * s);  // perfect linear
        for (let i = 0; i < 10; i++) {
            tca.recordFillSimulation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                exchange: EX, symbol: SYM,
                mode: 'backtest', side: 'LONG',
                size: sizes[i],
                simulatedAvgPrice: 100,
                simulatedSlippageBps: slippages[i]
            });
        }
        const r = tca.calibrateSlippageModel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: EX, symbol: SYM
        });
        expect(r.calibrated).toBe(true);
        expect(r.alpha).toBeCloseTo(2, 0);
        expect(r.beta).toBeCloseTo(0.5, 1);
        expect(r.rSquared).toBeCloseTo(1, 1);
    });
});

describe('§51 predictSlippage', () => {
    test('no calibration returns sufficient=false', () => {
        const r = tca.predictSlippage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'unknown', symbol: 'unknown',
            size: 5
        });
        expect(r.sufficient).toBe(false);
    });

    test('uses stored calibration', () => {
        for (let i = 1; i <= 10; i++) {
            tca.recordFillSimulation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                exchange: EX, symbol: SYM,
                mode: 'backtest', side: 'LONG',
                size: i,
                simulatedAvgPrice: 100,
                simulatedSlippageBps: 2 + 0.5 * i
            });
        }
        tca.calibrateSlippageModel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: EX, symbol: SYM
        });
        const r = tca.predictSlippage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: EX, symbol: SYM, size: 20
        });
        expect(r.sufficient).toBe(true);
        expect(r.predictedBps).toBeCloseTo(12, 0);  // 2 + 0.5*20
    });
});

describe('§51 recordFillSimulation', () => {
    test('persists', () => {
        const r = tca.recordFillSimulation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: EX, symbol: SYM,
            mode: 'shadow', side: 'LONG',
            size: 5, simulatedAvgPrice: 100.5,
            simulatedSlippageBps: 5
        });
        expect(r.recorded).toBe(true);
    });

    test('throws on invalid mode', () => {
        expect(() => tca.recordFillSimulation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: EX, symbol: SYM,
            mode: 'BOGUS', side: 'LONG',
            size: 1, simulatedAvgPrice: 100, simulatedSlippageBps: 0
        })).toThrow();
    });
});

describe('§51 getCalibrationStats + history', () => {
    test('stats exists=false when no calibration', () => {
        const s = tca.getCalibrationStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: EX, symbol: SYM
        });
        expect(s.exists).toBe(false);
    });

    test('history filters by mode', () => {
        for (let i = 0; i < 3; i++) {
            tca.recordFillSimulation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                exchange: EX, symbol: SYM,
                mode: 'backtest', side: 'LONG',
                size: 1, simulatedAvgPrice: 100, simulatedSlippageBps: 5
            });
        }
        tca.recordFillSimulation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: EX, symbol: SYM,
            mode: 'shadow', side: 'LONG',
            size: 1, simulatedAvgPrice: 100, simulatedSlippageBps: 5
        });
        const bt = tca.getFillSimulationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, mode: 'backtest'
        });
        const sh = tca.getFillSimulationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, mode: 'shadow'
        });
        expect(bt).toHaveLength(3);
        expect(sh).toHaveLength(1);
    });
});

describe('§51 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9052;
        tca.recordFillSimulation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: EX, symbol: SYM,
            mode: 'backtest', side: 'LONG',
            size: 1, simulatedAvgPrice: 100, simulatedSlippageBps: 5
        });
        const r1 = tca.getFillSimulationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = tca.getFillSimulationHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1).toHaveLength(1);
        expect(r2).toHaveLength(0);
    });
});
