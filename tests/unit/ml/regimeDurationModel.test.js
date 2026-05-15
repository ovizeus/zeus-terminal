'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p64-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const rdm = require('../../../server/services/ml/R2_cognition/regimeDurationModel');

const TEST_USER = 9064;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_regime_history WHERE user_id IN (?, ?)').run(TEST_USER, 9065);
    db.prepare('DELETE FROM ml_regime_current_state WHERE user_id IN (?, ?)').run(TEST_USER, 9065);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§64 Migrations 113 + 114', () => {
    test('ml_regime_history exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_regime_history)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'user_id', 'resolved_env', 'regime_type', 'start_ts', 'end_ts',
            'duration_ms', 'terminated_naturally', 'created_at'
        ]));
    });

    test('CHECK regime_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_regime_history
             (user_id, resolved_env, regime_type, start_ts, created_at)
             VALUES (?, ?, 'BOGUS', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('ml_regime_current_state UNIQUE per user×env', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_regime_current_state
             (user_id, resolved_env, regime_type, started_at, last_updated)
             VALUES (?, ?, 'trend_up', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_regime_current_state
             (user_id, resolved_env, regime_type, started_at, last_updated)
             VALUES (?, ?, 'trend_down', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts)).toThrow();
    });
});

describe('§64 Constants', () => {
    test('REGIME_TYPES has 5 entries', () => {
        expect(rdm.REGIME_TYPES).toEqual([
            'trend_up', 'trend_down', 'range', 'chop', 'volatile_expansion'
        ]);
    });

    test('AGGRESSIVENESS_LEVELS has 4 entries', () => {
        expect(rdm.AGGRESSIVENESS_LEVELS).toEqual(
            ['high', 'normal', 'reduced', 'minimal']
        );
    });
});

describe('§64 recordRegimeStart', () => {
    test('first start opens history + current', () => {
        const r = rdm.recordRegimeStart({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'trend_up'
        });
        expect(r.started).toBe(true);
        expect(r.historyId).toBeGreaterThan(0);

        const c = rdm.getCurrentRegime({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(c.exists).toBe(true);
        expect(c.regimeType).toBe('trend_up');
    });

    test('starting new regime closes prior', () => {
        const t1 = Date.now() - 10 * 86400000;
        const t2 = t1 + 3600000;  // +1h
        rdm.recordRegimeStart({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'range', startTs: t1
        });
        rdm.recordRegimeStart({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'trend_up', startTs: t2
        });
        const rows = db.prepare(
            `SELECT * FROM ml_regime_history WHERE user_id = ? ORDER BY start_ts`
        ).all(TEST_USER);
        expect(rows[0].regime_type).toBe('range');
        expect(rows[0].end_ts).toBe(t2);
        expect(rows[0].duration_ms).toBe(3600000);
        expect(rows[1].regime_type).toBe('trend_up');
        expect(rows[1].end_ts).toBe(null);
    });

    test('throws on invalid regimeType', () => {
        expect(() => rdm.recordRegimeStart({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'BOGUS'
        })).toThrow();
    });
});

describe('§64 recordRegimeEnd', () => {
    test('closes current + clears state', () => {
        const t0 = Date.now();
        rdm.recordRegimeStart({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'range', startTs: t0
        });
        const r = rdm.recordRegimeEnd({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            endTs: t0 + 6000, terminatedNaturally: true
        });
        expect(r.ended).toBe(true);
        expect(r.durationMs).toBe(6000);
        const c = rdm.getCurrentRegime({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(c.exists).toBe(false);
    });

    test('returns ended=false if no current regime', () => {
        const r = rdm.recordRegimeEnd({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.ended).toBe(false);
    });
});

describe('§64 getRegimeAge', () => {
    test('returns age in ms from start', () => {
        const t0 = Date.now();
        rdm.recordRegimeStart({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'trend_up', startTs: t0
        });
        const a = rdm.getRegimeAge({
            userId: TEST_USER, resolvedEnv: TEST_ENV, now: t0 + 4000
        });
        expect(a.exists).toBe(true);
        expect(a.ageMs).toBe(4000);
    });

    test('returns exists=false when no regime', () => {
        const a = rdm.getRegimeAge({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(a.exists).toBe(false);
    });
});

describe('§64 getDurationDistribution', () => {
    function seedHistory(durationsMs) {
        // Seed within last 30 days so default lookbackDays=90 filter catches them.
        let t = Date.now() - 30 * 86400000;
        for (const d of durationsMs) {
            rdm.recordRegimeStart({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                regimeType: 'range', startTs: t
            });
            rdm.recordRegimeEnd({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                endTs: t + d, terminatedNaturally: true
            });
            t += d + 100;
        }
    }

    test('insufficient samples returns sufficient=false', () => {
        seedHistory([1000, 2000]);
        const r = rdm.getDurationDistribution({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'range'
        });
        expect(r.sufficient).toBe(false);
        expect(r.samples).toBe(2);
    });

    test('sufficient samples returns stats', () => {
        seedHistory([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
        const r = rdm.getDurationDistribution({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'range'
        });
        expect(r.sufficient).toBe(true);
        expect(r.samples).toBe(10);
        expect(r.meanMs).toBeCloseTo(550);
        expect(r.medianMs).toBeGreaterThan(0);
        expect(r.p25Ms).toBeLessThan(r.medianMs);
        expect(r.p95Ms).toBeGreaterThan(r.medianMs);
    });

    test('throws on invalid regimeType', () => {
        expect(() => rdm.getDurationDistribution({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'BOGUS'
        })).toThrow();
    });
});

describe('§64 getMaturityScore', () => {
    function seedTenRangeRegimes(medianApproxMs) {
        let t = Date.now() - 30 * 86400000;  // 30 days ago start
        for (let i = 0; i < 10; i++) {
            rdm.recordRegimeStart({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                regimeType: 'range', startTs: t
            });
            const d = medianApproxMs * (0.8 + (i % 5) * 0.1);
            rdm.recordRegimeEnd({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                endTs: t + d, terminatedNaturally: true
            });
            t += d + 1000;
        }
    }

    test('insufficient history → score null', () => {
        rdm.recordRegimeStart({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'trend_up'
        });
        const r = rdm.getMaturityScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.exists).toBe(true);
        expect(r.score).toBe(null);
    });

    test('early in lifetime → low score', () => {
        seedTenRangeRegimes(1000000);
        const now = Date.now();
        rdm.recordRegimeStart({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'range', startTs: now - 100000
        });
        const r = rdm.getMaturityScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV, now
        });
        expect(r.score).toBeLessThan(0.5);
    });

    test('past expected lifetime → score > 1', () => {
        seedTenRangeRegimes(100000);
        const now = Date.now();
        rdm.recordRegimeStart({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'range', startTs: now - 200000  // 2x median
        });
        const r = rdm.getMaturityScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV, now
        });
        expect(r.score).toBeGreaterThan(1);
    });
});

describe('§64 recommendAggressiveness', () => {
    function seedHistoryAndStart(medianMs, ageMs) {
        let t = Date.now() - 30 * 86400000;
        for (let i = 0; i < 10; i++) {
            rdm.recordRegimeStart({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                regimeType: 'range', startTs: t
            });
            rdm.recordRegimeEnd({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                endTs: t + medianMs, terminatedNaturally: true
            });
            t += medianMs + 1000;
        }
        const now = Date.now();
        rdm.recordRegimeStart({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'range', startTs: now - ageMs
        });
        return now;
    }

    test('no data → normal', () => {
        const r = rdm.recommendAggressiveness({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.level).toBe('normal');
        expect(r.reason).toBe('no_data');
    });

    test('high when early', () => {
        const now = seedHistoryAndStart(1000000, 100000);  // 10% maturity
        const r = rdm.recommendAggressiveness({
            userId: TEST_USER, resolvedEnv: TEST_ENV, now
        });
        expect(r.level).toBe('high');
    });

    test('reduced when near end (~90% lifetime)', () => {
        const now = seedHistoryAndStart(1000000, 900000);  // 90%
        const r = rdm.recommendAggressiveness({
            userId: TEST_USER, resolvedEnv: TEST_ENV, now
        });
        expect(r.level).toBe('reduced');
    });

    test('minimal when past lifetime', () => {
        const now = seedHistoryAndStart(1000000, 1500000);  // 150%
        const r = rdm.recommendAggressiveness({
            userId: TEST_USER, resolvedEnv: TEST_ENV, now
        });
        expect(r.level).toBe('minimal');
    });
});

describe('§64 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9065;
        rdm.recordRegimeStart({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regimeType: 'trend_up'
        });
        const c1 = rdm.getCurrentRegime({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const c2 = rdm.getCurrentRegime({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(c1.exists).toBe(true);
        expect(c2.exists).toBe(false);
    });
});
