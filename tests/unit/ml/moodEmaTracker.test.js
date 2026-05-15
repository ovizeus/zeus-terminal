'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-raidm-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const mt = require('../../../server/services/ml/_crosscutting/moodEmaTracker');

const TEST_USER = 9410;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_mood_state WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_mood_history WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('Raid-M Migration 083', () => {
    test('table ml_mood_state exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_mood_state'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_mood_history exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_mood_history'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('mood_state UNIQUE per (user, env)', () => {
        const now = Date.now();
        db.prepare(
            `INSERT INTO ml_mood_state
             (user_id, resolved_env, smoothed_score, sample_count, last_raw_score, updated_at)
             VALUES (?, ?, 0.5, 1, 0.5, ?)`
        ).run(TEST_USER, TEST_ENV, now);
        expect(() => db.prepare(
            `INSERT INTO ml_mood_state
             (user_id, resolved_env, smoothed_score, sample_count, last_raw_score, updated_at)
             VALUES (?, ?, 0.7, 1, 0.7, ?)`
        ).run(TEST_USER, TEST_ENV, now)).toThrow();
        cleanRows();
    });
});

describe('Raid-M Exported constants', () => {
    test('DEFAULT_EMA_ALPHA in (0, 1)', () => {
        expect(mt.DEFAULT_EMA_ALPHA).toBeGreaterThan(0);
        expect(mt.DEFAULT_EMA_ALPHA).toBeLessThan(1);
    });

    test('MOOD_RANGE has min/max', () => {
        expect(mt.MOOD_RANGE.min).toBeDefined();
        expect(mt.MOOD_RANGE.max).toBeDefined();
        expect(mt.MOOD_RANGE.max).toBeGreaterThan(mt.MOOD_RANGE.min);
    });

    test('FLICKER_THRESHOLD positive', () => {
        expect(mt.FLICKER_THRESHOLD).toBeGreaterThan(0);
    });
});

describe('Raid-M updateMood', () => {
    test('first update sets smoothed = raw', () => {
        const r = mt.updateMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rawMoodScore: 0.7
        });
        expect(r.smoothed).toBeCloseTo(0.7);
        expect(r.sampleCount).toBe(1);
    });

    test('subsequent updates apply EMA smoothing', () => {
        mt.updateMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rawMoodScore: 0.5
        });
        const r = mt.updateMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rawMoodScore: 0.9
        });
        // EMA: alpha=0.3 → 0.3 * 0.9 + 0.7 * 0.5 = 0.62
        expect(r.smoothed).toBeGreaterThan(0.5);
        expect(r.smoothed).toBeLessThan(0.9);
    });

    test('many updates converge toward true value', () => {
        for (let i = 0; i < 20; i++) {
            mt.updateMood({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                rawMoodScore: 0.8
            });
        }
        const r = mt.getCurrentMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.smoothed).toBeCloseTo(0.8, 1);
    });

    test('clamps to MOOD_RANGE', () => {
        mt.updateMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rawMoodScore: 999  // out of range
        });
        const r = mt.getCurrentMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.smoothed).toBeLessThanOrEqual(mt.MOOD_RANGE.max);
    });

    test('custom alpha overrides default', () => {
        mt.updateMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rawMoodScore: 0.5
        });
        const r = mt.updateMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rawMoodScore: 0.9,
            alpha: 0.9  // weighted heavily toward new
        });
        // Should be close to 0.9 since alpha=0.9
        expect(r.smoothed).toBeGreaterThan(0.85);
    });
});

describe('Raid-M getCurrentMood', () => {
    test('returns null when no state', () => {
        const r = mt.getCurrentMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.exists).toBe(false);
    });

    test('returns current smoothed value', () => {
        mt.updateMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rawMoodScore: 0.6
        });
        const r = mt.getCurrentMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.smoothed).toBeCloseTo(0.6);
        expect(r.exists).toBe(true);
    });
});

describe('Raid-M resetMood', () => {
    test('resets state to neutral', () => {
        mt.updateMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rawMoodScore: 0.8
        });
        mt.resetMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'manual', actor: 'op'
        });
        const r = mt.getCurrentMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.smoothed).toBe(0);
        expect(r.sampleCount).toBe(0);
    });

    test('returns false when no state to reset', () => {
        const r = mt.resetMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'r', actor: 'op'
        });
        expect(r.reset).toBe(false);
    });
});

describe('Raid-M getMoodHistory', () => {
    test('records history entries', () => {
        for (const v of [0.3, 0.5, 0.7]) {
            mt.updateMood({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                rawMoodScore: v
            });
        }
        const r = mt.getMoodHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(3);
    });

    test('respects limit', () => {
        for (let i = 0; i < 5; i++) {
            mt.updateMood({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                rawMoodScore: 0.5
            });
        }
        const r = mt.getMoodHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, limit: 2
        });
        expect(r).toHaveLength(2);
    });
});

describe('Raid-M isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9411;
        mt.updateMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rawMoodScore: 0.8
        });
        mt.updateMood({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            rawMoodScore: 0.3
        });
        const r1 = mt.getCurrentMood({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = mt.getCurrentMood({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.smoothed).toBeCloseTo(0.8);
        expect(r2.smoothed).toBeCloseTo(0.3);
        db.prepare(`DELETE FROM ml_mood_state WHERE user_id = ?`).run(OTHER_USER);
        db.prepare(`DELETE FROM ml_mood_history WHERE user_id = ?`).run(OTHER_USER);
    });
});
