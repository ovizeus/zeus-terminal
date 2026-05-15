'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p47-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const id = require('../../../server/services/ml/_meta/inactivityDecay');

const TEST_USER = 9047;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_inactivity_state WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§47 Migration 094', () => {
    test('table ml_inactivity_state exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_inactivity_state'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('UNIQUE per (user, env)', () => {
        const now = Date.now();
        db.prepare(
            `INSERT INTO ml_inactivity_state
             (user_id, resolved_env, last_trade_at, updated_at)
             VALUES (?, ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, now, now);
        expect(() => db.prepare(
            `INSERT INTO ml_inactivity_state
             (user_id, resolved_env, last_trade_at, updated_at)
             VALUES (?, ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, now, now)).toThrow();
        cleanRows();
    });
});

describe('§47 Exported constants', () => {
    test('INACTIVITY_DAYS_TRIGGER = 3 per spec', () => {
        expect(id.INACTIVITY_DAYS_TRIGGER).toBe(3);
    });

    test('THRESHOLD_INCREASE_PCT = 0.10 per spec', () => {
        expect(id.THRESHOLD_INCREASE_PCT).toBeCloseTo(0.10);
    });

    test('MAX_THRESHOLD_INCREASE positive cap', () => {
        expect(id.MAX_THRESHOLD_INCREASE).toBeGreaterThan(0);
    });
});

describe('§47 computeThresholdAdjustment (pure)', () => {
    test('0-2 days → no adjustment', () => {
        const r = id.computeThresholdAdjustment({
            daysSinceLastTrade: 2,
            baseThreshold: 0.65
        });
        expect(r.adjustedThreshold).toBeCloseTo(0.65);
        expect(r.increasePct).toBe(0);
    });

    test('3 days → 10% increase per spec', () => {
        const r = id.computeThresholdAdjustment({
            daysSinceLastTrade: 3,
            baseThreshold: 0.65
        });
        expect(r.increasePct).toBeCloseTo(0.10);
        expect(r.adjustedThreshold).toBeCloseTo(0.65 * 1.10);
    });

    test('5 days → larger increase', () => {
        const r = id.computeThresholdAdjustment({
            daysSinceLastTrade: 5,
            baseThreshold: 0.65
        });
        expect(r.increasePct).toBeGreaterThan(0.10);
    });

    test('Many days → capped at MAX_THRESHOLD_INCREASE', () => {
        const r = id.computeThresholdAdjustment({
            daysSinceLastTrade: 100,
            baseThreshold: 0.65
        });
        expect(r.increasePct).toBeLessThanOrEqual(id.MAX_THRESHOLD_INCREASE);
    });

    test('Threshold capped at 1.0 absolute', () => {
        const r = id.computeThresholdAdjustment({
            daysSinceLastTrade: 100,
            baseThreshold: 0.95
        });
        expect(r.adjustedThreshold).toBeLessThanOrEqual(1.0);
    });
});

describe('§47 recordTradeEntry', () => {
    test('creates state on first entry', () => {
        id.recordTradeEntry({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const s = id.getInactivityState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.exists).toBe(true);
    });

    test('resets timer on subsequent entries', () => {
        id.recordTradeEntry({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        // Backdate
        db.prepare(`UPDATE ml_inactivity_state
                    SET last_trade_at = ?
                    WHERE user_id = ?`)
            .run(Date.now() - 5 * 86400000, TEST_USER);
        id.recordTradeEntry({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const s = id.getInactivityState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.daysSinceLastTrade).toBeLessThan(1);
    });
});

describe('§47 getInactivityState', () => {
    test('returns 0 days when no state', () => {
        const r = id.getInactivityState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.exists).toBe(false);
        expect(r.daysSinceLastTrade).toBe(0);
    });

    test('returns correct days since last trade', () => {
        id.recordTradeEntry({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        db.prepare(`UPDATE ml_inactivity_state SET last_trade_at = ? WHERE user_id = ?`)
            .run(Date.now() - 4 * 86400000, TEST_USER);
        const r = id.getInactivityState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.daysSinceLastTrade).toBeGreaterThanOrEqual(3);
    });

    test('returns threshold adjustment info', () => {
        id.recordTradeEntry({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        db.prepare(`UPDATE ml_inactivity_state SET last_trade_at = ? WHERE user_id = ?`)
            .run(Date.now() - 4 * 86400000, TEST_USER);
        const r = id.getInactivityState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.thresholdAdjustmentInfo.increasePct).toBeGreaterThan(0);
    });
});

describe('§47 resetInactivity', () => {
    test('removes state entry', () => {
        id.recordTradeEntry({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        id.resetInactivity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'manual', actor: 'operator'
        });
        const r = id.getInactivityState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.exists).toBe(false);
    });
});

describe('§47 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9048;
        id.recordTradeEntry({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r1 = id.getInactivityState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = id.getInactivityState({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.exists).toBe(true);
        expect(r2.exists).toBe(false);
    });
});
