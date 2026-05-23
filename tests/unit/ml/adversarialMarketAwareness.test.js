'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p62-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ama = require('../../../server/services/ml/R3A_safety/adversarialMarketAwareness');

const TEST_USER = 9062;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_fingerprint_observations WHERE user_id IN (?, ?)').run(TEST_USER, 9063);
    db.prepare('DELETE FROM ml_fingerprint_alerts WHERE user_id IN (?, ?)').run(TEST_USER, 9063);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§62 Migrations 109 + 110', () => {
    test('ml_fingerprint_observations exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_fingerprint_observations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'user_id', 'resolved_env', 'setup_type', 'entry_delay_ms',
            'size_jitter_pct', 'order_type_used', 'actual_slippage_bps',
            'expected_slippage_bps', 'slippage_excess_bps', 'ts'
        ]));
    });

    test('CHECK order_type_used restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_fingerprint_observations
             (user_id, resolved_env, setup_type, entry_delay_ms, size_jitter_pct,
              order_type_used, actual_slippage_bps, expected_slippage_bps,
              slippage_excess_bps, ts)
             VALUES (?, ?, 'sweep', 0, 0, 'BOGUS', 0, 0, 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('ml_fingerprint_alerts CHECK severity restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_fingerprint_alerts
             (user_id, resolved_env, setup_type, slippage_trend_bps,
              samples_in_window, severity, ts)
             VALUES (?, ?, 'sweep', 10, 20, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§62 Constants', () => {
    test('ORDER_TYPES has 4 entries', () => {
        expect(ama.ORDER_TYPES).toEqual(['market', 'limit', 'post_only', 'ioc']);
    });

    test('default jitter values reasonable', () => {
        expect(ama.DEFAULT_TIMING_JITTER_MS).toBeGreaterThan(0);
        expect(ama.DEFAULT_SIZE_JITTER_PCT).toBeGreaterThan(0);
        expect(ama.DEFAULT_SIZE_JITTER_PCT).toBeLessThan(0.5);
    });
});

describe('§62 applyEntryJitter — zero-mean property', () => {
    test('mean jitter approaches zero over many calls', () => {
        let sum = 0;
        const N = 1000;
        for (let i = 0; i < N; i++) {
            const r = ama.applyEntryJitter({ baseDelayMs: 1000, jitterRangeMs: 500 });
            sum += r.jitterApplied;
        }
        const mean = sum / N;
        // Zero-mean check: with 1000 samples and range ±500, mean should be within ~50
        expect(Math.abs(mean)).toBeLessThan(50);
    });

    test('jitter respects range', () => {
        for (let i = 0; i < 100; i++) {
            const r = ama.applyEntryJitter({ baseDelayMs: 1000, jitterRangeMs: 200 });
            expect(r.jitterApplied).toBeGreaterThanOrEqual(-200);
            expect(r.jitterApplied).toBeLessThanOrEqual(200);
        }
    });

    test('delayMs never negative', () => {
        const r = ama.applyEntryJitter({ baseDelayMs: 50, jitterRangeMs: 500 });
        expect(r.delayMs).toBeGreaterThanOrEqual(0);
    });
});

describe('§62 applySizeJitter — zero-mean property', () => {
    test('mean size jitter approaches zero', () => {
        let sum = 0;
        const N = 1000;
        for (let i = 0; i < N; i++) {
            const r = ama.applySizeJitter({ baseSize: 100, jitterPct: 0.05 });
            sum += r.jitterPctApplied;
        }
        const mean = sum / N;
        expect(Math.abs(mean)).toBeLessThan(0.005);  // < 0.5%
    });

    test('size jitter respects pct bounds', () => {
        for (let i = 0; i < 100; i++) {
            const r = ama.applySizeJitter({ baseSize: 100, jitterPct: 0.05 });
            expect(r.size).toBeGreaterThanOrEqual(95);
            expect(r.size).toBeLessThanOrEqual(105);
        }
    });
});

describe('§62 selectOrderTypeRandom', () => {
    test('returns one of allowed types', () => {
        for (let i = 0; i < 50; i++) {
            const r = ama.selectOrderTypeRandom({ setupType: 'sweep' });
            expect(ama.ORDER_TYPES).toContain(r.orderType);
        }
    });

    test('distribution covers multiple types over many calls', () => {
        const seen = new Set();
        for (let i = 0; i < 100; i++) {
            const r = ama.selectOrderTypeRandom({ setupType: 'sweep' });
            seen.add(r.orderType);
        }
        expect(seen.size).toBeGreaterThan(1);  // not stuck on one
    });

    test('respects custom allowedTypes', () => {
        for (let i = 0; i < 50; i++) {
            const r = ama.selectOrderTypeRandom({
                setupType: 'sweep',
                allowedTypes: ['market', 'ioc']
            });
            expect(['market', 'ioc']).toContain(r.orderType);
        }
    });

    test('throws on invalid allowedTypes', () => {
        expect(() => ama.selectOrderTypeRandom({
            setupType: 'sweep', allowedTypes: ['BOGUS']
        })).toThrow();
    });
});

describe('§62 recordExecution', () => {
    test('persists with computed excess', () => {
        const r = ama.recordExecution({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep',
            entryDelayMs: 250, sizeJitter: 0.02,
            orderType: 'market',
            actualSlippage: 8.5, expectedSlippage: 5.0
        });
        expect(r.recorded).toBe(true);
        expect(r.excessBps).toBeCloseTo(3.5);
    });

    test('throws on invalid order type', () => {
        expect(() => ama.recordExecution({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep',
            entryDelayMs: 0, sizeJitter: 0,
            orderType: 'BOGUS',
            actualSlippage: 5, expectedSlippage: 5
        })).toThrow();
    });
});

describe('§62 detectFingerprintCompromise', () => {
    test('returns insufficient when below MIN_SAMPLES', () => {
        for (let i = 0; i < 3; i++) {
            ama.recordExecution({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'sweep',
                entryDelayMs: 0, sizeJitter: 0,
                orderType: 'market',
                actualSlippage: 10, expectedSlippage: 5
            });
        }
        const r = ama.detectFingerprintCompromise({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep'
        });
        expect(r.compromised).toBe(false);
        expect(r.reason).toBe('insufficient_samples');
    });

    test('detects compromise when slippage excess persistent', () => {
        for (let i = 0; i < 15; i++) {
            ama.recordExecution({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'sweep',
                entryDelayMs: 0, sizeJitter: 0,
                orderType: 'market',
                actualSlippage: 12, expectedSlippage: 5
            });
        }
        const r = ama.detectFingerprintCompromise({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep'
        });
        expect(r.compromised).toBe(true);
        expect(r.slippageTrendBps).toBeGreaterThan(5);
    });

    test('no compromise when slippage normal', () => {
        for (let i = 0; i < 15; i++) {
            ama.recordExecution({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'sweep',
                entryDelayMs: 0, sizeJitter: 0,
                orderType: 'market',
                actualSlippage: 5.1, expectedSlippage: 5
            });
        }
        const r = ama.detectFingerprintCompromise({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep'
        });
        expect(r.compromised).toBe(false);
    });

    test('high trend escalates to critical', () => {
        for (let i = 0; i < 15; i++) {
            ama.recordExecution({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'sweep',
                entryDelayMs: 0, sizeJitter: 0,
                orderType: 'market',
                actualSlippage: 20, expectedSlippage: 5
            });
        }
        const r = ama.detectFingerprintCompromise({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep'
        });
        expect(r.severity).toBe('critical');
    });
});

describe('§62 getFingerprintRisk', () => {
    test('aggregates per setup', () => {
        for (let i = 0; i < 5; i++) {
            ama.recordExecution({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'sweep',
                entryDelayMs: 0, sizeJitter: 0,
                orderType: 'market',
                actualSlippage: 5, expectedSlippage: 5
            });
            ama.recordExecution({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'breakout',
                entryDelayMs: 0, sizeJitter: 0,
                orderType: 'limit',
                actualSlippage: 15, expectedSlippage: 5
            });
        }
        const r = ama.getFingerprintRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.perSetup).toHaveLength(2);
        const breakout = r.perSetup.find(s => s.setupType === 'breakout');
        expect(breakout.atRisk).toBe(true);
    });
});

describe('§62 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9063;
        ama.recordExecution({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep',
            entryDelayMs: 0, sizeJitter: 0,
            orderType: 'market',
            actualSlippage: 5, expectedSlippage: 5
        });
        const r1 = ama.getFingerprintRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = ama.getFingerprintRisk({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.perSetup).toHaveLength(1);
        expect(r2.perSetup).toHaveLength(0);
    });
});
