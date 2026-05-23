'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p45-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const lae = require('../../../server/services/ml/R4_execution/latencyAwareExecution');

const TEST_USER = 9045;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_latency_measurements WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_latency_modes WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§45 Migration 092', () => {
    test('table ml_latency_measurements exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_latency_measurements'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_latency_modes exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_latency_modes'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('measurements has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_latency_measurements)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'e2e_ms',
            'feed_to_decision_ms', 'decision_to_order_ms',
            'order_to_ack_ms', 'mode', 'created_at'
        ]));
    });

    test('modes has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_latency_modes)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'mode',
            'current_latency_ms', 'updated_at'
        ]));
    });

    test('CHECK mode restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_latency_modes
             (user_id, resolved_env, mode, current_latency_ms, updated_at)
             VALUES (?, ?, 'BOGUS', 50, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§45 Exported constants', () => {
    test('LATENCY_MODES has 3 spec entries', () => {
        expect(lae.LATENCY_MODES).toEqual([
            'SCALPING_ALLOWED', 'SWING_ONLY', 'OBSERVER_ONLY'
        ]);
    });

    test('MODE_THRESHOLDS_MS per spec', () => {
        expect(lae.MODE_THRESHOLDS_MS.scalping_max).toBe(50);
        expect(lae.MODE_THRESHOLDS_MS.swing_max).toBe(150);
    });

    test('ALLOWED_BEHAVIORS_BY_MODE complete', () => {
        for (const mode of lae.LATENCY_MODES) {
            expect(lae.ALLOWED_BEHAVIORS_BY_MODE[mode]).toBeDefined();
            expect(Array.isArray(lae.ALLOWED_BEHAVIORS_BY_MODE[mode])).toBe(true);
        }
    });
});

describe('§45 measureEndToEnd (pure)', () => {
    test('computes e2e and component breakdown', () => {
        const base = Date.now();
        const r = lae.measureEndToEnd({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feedTs: base,
            decisionTs: base + 20,
            orderTs: base + 30,
            ackTs: base + 45
        });
        expect(r.e2eMs).toBe(45);
        expect(r.components.feedToDecision).toBe(20);
        expect(r.components.decisionToOrder).toBe(10);
        expect(r.components.orderToAck).toBe(15);
    });

    test('classifies mode SCALPING_ALLOWED for <50ms', () => {
        const base = Date.now();
        const r = lae.measureEndToEnd({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feedTs: base, decisionTs: base + 10,
            orderTs: base + 20, ackTs: base + 40
        });
        expect(r.mode).toBe('SCALPING_ALLOWED');
    });

    test('classifies mode SWING_ONLY for 50-150ms', () => {
        const base = Date.now();
        const r = lae.measureEndToEnd({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feedTs: base, decisionTs: base + 50,
            orderTs: base + 70, ackTs: base + 100
        });
        expect(r.mode).toBe('SWING_ONLY');
    });

    test('classifies mode OBSERVER_ONLY for >150ms', () => {
        const base = Date.now();
        const r = lae.measureEndToEnd({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feedTs: base, decisionTs: base + 60,
            orderTs: base + 120, ackTs: base + 200
        });
        expect(r.mode).toBe('OBSERVER_ONLY');
    });
});

describe('§45 getCurrentLatencyMode', () => {
    test('returns default SCALPING_ALLOWED when no state', () => {
        const r = lae.getCurrentLatencyMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.mode).toBe('SCALPING_ALLOWED');
        expect(r.exists).toBe(false);
    });

    test('returns current mode after measurement', () => {
        const base = Date.now();
        lae.measureEndToEnd({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feedTs: base, decisionTs: base + 60,
            orderTs: base + 90, ackTs: base + 120
        });
        const r = lae.getCurrentLatencyMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.mode).toBe('SWING_ONLY');
        expect(r.currentLatencyMs).toBe(120);
    });
});

describe('§45 getAllowedBehaviors (pure)', () => {
    test('SCALPING_ALLOWED includes scalping', () => {
        const r = lae.getAllowedBehaviors({ mode: 'SCALPING_ALLOWED' });
        expect(r).toEqual(expect.arrayContaining(['scalp', 'swing', 'htf']));
    });

    test('SWING_ONLY excludes scalping', () => {
        const r = lae.getAllowedBehaviors({ mode: 'SWING_ONLY' });
        expect(r).not.toContain('scalp');
        expect(r).toContain('swing');
    });

    test('OBSERVER_ONLY only observe', () => {
        const r = lae.getAllowedBehaviors({ mode: 'OBSERVER_ONLY' });
        expect(r).toEqual(['observe']);
    });
});

describe('§45 getLatencyTrend', () => {
    beforeEach(() => {
        const base = Date.now();
        for (let i = 0; i < 5; i++) {
            lae.measureEndToEnd({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                feedTs: base + i * 100,
                decisionTs: base + i * 100 + 10,
                orderTs: base + i * 100 + 20,
                ackTs: base + i * 100 + 30
            });
        }
    });

    test('returns rolling stats', () => {
        const r = lae.getLatencyTrend({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.count).toBe(5);
        expect(r.avgE2eMs).toBeCloseTo(30);
        expect(r.maxE2eMs).toBe(30);
    });

    test('respects since filter', () => {
        const r = lae.getLatencyTrend({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            since: Date.now() + 60000
        });
        expect(r.count).toBe(0);
    });
});

describe('§45 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9046;
        const base = Date.now();
        lae.measureEndToEnd({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feedTs: base, decisionTs: base + 5,
            orderTs: base + 10, ackTs: base + 15
        });
        const r1 = lae.getCurrentLatencyMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = lae.getCurrentLatencyMode({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.exists).toBe(true);
        expect(r2.exists).toBe(false);
    });
});
