'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p27-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const tp = require('../../../server/services/ml/R2_cognition/temporalPatterns');

const TEST_USER = 9027;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_temporal_observations WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§27 Migration 065 — temporal observations', () => {
    test('table ml_temporal_observations exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_temporal_observations'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_temporal_observations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'pattern',
            'sample_count', 'mean_outcome', 'regime',
            'last_seen_at', 'created_at', 'updated_at'
        ]));
    });

    test('UNIQUE per (user, env, pattern, regime)', () => {
        db.prepare(
            `INSERT INTO ml_temporal_observations
             (user_id, resolved_env, pattern, sample_count, mean_outcome, regime, last_seen_at, created_at, updated_at)
             VALUES (?, ?, 'london_open', 1, 0.5, 'trend', ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now(), Date.now());
        expect(() => db.prepare(
            `INSERT INTO ml_temporal_observations
             (user_id, resolved_env, pattern, sample_count, mean_outcome, regime, last_seen_at, created_at, updated_at)
             VALUES (?, ?, 'london_open', 1, 0.5, 'trend', ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now(), Date.now())).toThrow();
        cleanRows();
    });

    test('CHECK pattern restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_temporal_observations
             (user_id, resolved_env, pattern, sample_count, mean_outcome, last_seen_at, created_at, updated_at)
             VALUES (?, ?, 'BOGUS', 1, 0.5, ?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now(), Date.now())).toThrow();
    });
});

describe('§27 Exported constants', () => {
    test('TEMPORAL_PATTERNS has 10 spec entries', () => {
        expect(tp.TEMPORAL_PATTERNS).toHaveLength(10);
        expect(tp.TEMPORAL_PATTERNS).toEqual(expect.arrayContaining([
            'seasonality_intraday', 'day_of_week',
            'friday_evening', 'sunday_morning', 'wednesday_noon',
            'end_of_month', 'end_of_quarter',
            'london_open', 'new_york_open', 'asia_drift'
        ]));
    });

    test('SESSION_KEYS has 4 entries', () => {
        expect(tp.SESSION_KEYS).toEqual(expect.arrayContaining([
            'asia', 'london', 'ny', 'overlap'
        ]));
    });

    test('DAYS_OF_WEEK has 7 entries (0-6)', () => {
        expect(tp.DAYS_OF_WEEK).toHaveLength(7);
    });
});

describe('§27 getCurrentTemporalContext (pure)', () => {
    test('returns context object with required fields', () => {
        const r = tp.getCurrentTemporalContext({ timestampMs: Date.now() });
        expect(r.session).toBeDefined();
        expect(r.dayOfWeek).toBeDefined();
        expect(r.hourOfDay).toBeDefined();
        expect(Array.isArray(r.activePatterns)).toBe(true);
    });

    test('Monday London open detected (around 08:00 UTC)', () => {
        // Monday 2026-05-18 08:30 UTC
        const ts = new Date('2026-05-18T08:30:00Z').getTime();
        const r = tp.getCurrentTemporalContext({ timestampMs: ts });
        expect(r.activePatterns).toContain('london_open');
    });

    test('NYC open detected (around 13:30 UTC)', () => {
        const ts = new Date('2026-05-19T13:35:00Z').getTime();
        const r = tp.getCurrentTemporalContext({ timestampMs: ts });
        expect(r.activePatterns).toContain('new_york_open');
    });

    test('Asia session window matches', () => {
        // ~00:00-08:00 UTC Asian session
        const ts = new Date('2026-05-20T02:00:00Z').getTime();
        const r = tp.getCurrentTemporalContext({ timestampMs: ts });
        expect(r.session).toBe('asia');
    });

    test('Friday evening pattern detected', () => {
        // Friday 2026-05-22 20:00 UTC
        const ts = new Date('2026-05-22T20:00:00Z').getTime();
        const r = tp.getCurrentTemporalContext({ timestampMs: ts });
        expect(r.activePatterns).toContain('friday_evening');
    });

    test('Sunday morning pattern detected', () => {
        // Sunday 2026-05-24 06:00 UTC
        const ts = new Date('2026-05-24T06:00:00Z').getTime();
        const r = tp.getCurrentTemporalContext({ timestampMs: ts });
        expect(r.activePatterns).toContain('sunday_morning');
    });

    test('end_of_month detected on 29-31', () => {
        const ts = new Date('2026-05-30T12:00:00Z').getTime();
        const r = tp.getCurrentTemporalContext({ timestampMs: ts });
        expect(r.activePatterns).toContain('end_of_month');
    });

    test('end_of_quarter detected on 3/6/9/12 last 2 days', () => {
        const ts = new Date('2026-06-30T12:00:00Z').getTime();
        const r = tp.getCurrentTemporalContext({ timestampMs: ts });
        expect(r.activePatterns).toContain('end_of_quarter');
    });
});

describe('§27 evaluateScoreAdjustment (pure, invariant enforced)', () => {
    test('no active patterns → score unchanged', () => {
        const r = tp.evaluateScoreAdjustment({
            patterns: [],
            score: 0.7,
            aggressiveness: 0.5
        });
        expect(r.adjustedScore).toBeCloseTo(0.7);
        expect(r.adjustedAggressiveness).toBeCloseTo(0.5);
    });

    test('favorable patterns boost score modestly', () => {
        const r = tp.evaluateScoreAdjustment({
            patterns: ['london_open', 'new_york_open'],
            score: 0.7,
            aggressiveness: 0.5
        });
        expect(r.adjustedScore).toBeGreaterThan(0.7);
    });

    test('unfavorable patterns reduce score modestly', () => {
        const r = tp.evaluateScoreAdjustment({
            patterns: ['friday_evening', 'end_of_quarter'],
            score: 0.7,
            aggressiveness: 0.5
        });
        expect(r.adjustedScore).toBeLessThan(0.7);
    });

    test('INVARIANT: patterns alone cannot push score from 0 to >=0.5', () => {
        // Even with all favorable patterns active, score starting at 0 must NOT reach decision threshold
        const r = tp.evaluateScoreAdjustment({
            patterns: tp.TEMPORAL_PATTERNS.slice(0, 5),  // top 5 favorable
            score: 0,
            aggressiveness: 0.5
        });
        expect(r.adjustedScore).toBeLessThan(0.5);
    });

    test('INVARIANT: patterns are NEVER sufficient alone', () => {
        const r = tp.evaluateScoreAdjustment({
            patterns: tp.TEMPORAL_PATTERNS,  // ALL patterns active
            score: 0,
            aggressiveness: 0.5
        });
        // Must be capped — even all-active patterns can't make signal sufficient
        expect(r.adjustedScore).toBeLessThan(0.5);
    });

    test('adjustedScore clamped to [0, 1]', () => {
        const r1 = tp.evaluateScoreAdjustment({
            patterns: ['london_open'],
            score: 0.95,
            aggressiveness: 0.5
        });
        expect(r1.adjustedScore).toBeLessThanOrEqual(1.0);

        const r2 = tp.evaluateScoreAdjustment({
            patterns: ['friday_evening', 'end_of_quarter'],
            score: 0.05,
            aggressiveness: 0.5
        });
        expect(r2.adjustedScore).toBeGreaterThanOrEqual(0);
    });

    test('aggressiveness adjusted', () => {
        const r = tp.evaluateScoreAdjustment({
            patterns: ['friday_evening'],
            score: 0.6,
            aggressiveness: 0.7
        });
        expect(r.adjustedAggressiveness).toBeLessThan(0.7);  // reduce on risky window
    });
});

describe('§27 recordTemporalObservation', () => {
    test('records first observation for pattern', () => {
        tp.recordTemporalObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pattern: 'london_open', outcome: 1.5, regime: 'trend'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_temporal_observations WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].sample_count).toBe(1);
        expect(rows[0].mean_outcome).toBeCloseTo(1.5);
    });

    test('updates rolling mean on subsequent observations', () => {
        for (const v of [1.0, 1.5, 2.0]) {
            tp.recordTemporalObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                pattern: 'new_york_open', outcome: v, regime: 'trend'
            });
        }
        const row = db.prepare(
            `SELECT * FROM ml_temporal_observations WHERE user_id = ? AND pattern = ? AND regime = ?`
        ).get(TEST_USER, 'new_york_open', 'trend');
        expect(row.sample_count).toBe(3);
        expect(row.mean_outcome).toBeCloseTo(1.5, 1);
    });

    test('records correct pattern name (new_york_open not ny_open)', () => {
        tp.recordTemporalObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pattern: 'new_york_open', outcome: 1.0, regime: 'trend'
        });
        const row = db.prepare(
            `SELECT * FROM ml_temporal_observations WHERE user_id = ? AND pattern = ?`
        ).get(TEST_USER, 'new_york_open');
        expect(row).toBeDefined();
    });

    test('throws on invalid pattern', () => {
        expect(() => tp.recordTemporalObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pattern: 'bogus_pattern', outcome: 1.0
        })).toThrow(/pattern/i);
    });
});

describe('§27 getPatternStrength', () => {
    test('returns null for unseen pattern', () => {
        const r = tp.getPatternStrength({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pattern: 'london_open'
        });
        expect(r).toBeNull();
    });

    test('returns rolling stats after observations', () => {
        for (const v of [0.5, 1.0, 1.5]) {
            tp.recordTemporalObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                pattern: 'london_open', outcome: v, regime: 'trend'
            });
        }
        const r = tp.getPatternStrength({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pattern: 'london_open', regime: 'trend'
        });
        expect(r).not.toBeNull();
        expect(r.mean).toBeCloseTo(1.0, 1);
        expect(r.count).toBe(3);
    });

    test('respects minSamples filter', () => {
        for (let i = 0; i < 5; i++) {
            tp.recordTemporalObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                pattern: 'london_open', outcome: 1, regime: 'trend'
            });
        }
        const r = tp.getPatternStrength({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pattern: 'london_open',
            regime: 'trend',
            minSamples: 10
        });
        expect(r).toBeNull();  // not enough samples
    });
});

describe('§27 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9028;
        tp.recordTemporalObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pattern: 'london_open', outcome: 1.0
        });
        tp.recordTemporalObservation({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            pattern: 'london_open', outcome: 2.0
        });
        const r1 = tp.getPatternStrength({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pattern: 'london_open'
        });
        const r2 = tp.getPatternStrength({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            pattern: 'london_open'
        });
        expect(r1.mean).toBeCloseTo(1.0);
        expect(r2.mean).toBeCloseTo(2.0);
        db.prepare(`DELETE FROM ml_temporal_observations WHERE user_id = ?`).run(OTHER_USER);
    });
});
