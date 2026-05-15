'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p72-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ml = require('../../../server/services/ml/R5A_learning/metaLearning');

const TEST_USER = 9072;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_meta_adaptation_episodes WHERE user_id IN (?, ?)').run(TEST_USER, 9073);
    db.prepare('DELETE FROM ml_meta_baseline_speed WHERE user_id IN (?, ?)').run(TEST_USER, 9073);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§72 Migrations 135 + 136', () => {
    test('ml_meta_adaptation_episodes exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_meta_adaptation_episodes)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'episode_id', 'from_regime', 'to_regime',
            'detection_ts', 'recalibration_complete_ts',
            'samples_used', 'recalibration_quality_score', 'status'
        ]));
    });

    test('episode_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_meta_adaptation_episodes
             (user_id, resolved_env, episode_id, from_regime, to_regime,
              detection_ts, status, created_at)
             VALUES (?, ?, 'EP-UNIQ', 'range', 'trend_up', ?, 'DETECTING', ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_meta_adaptation_episodes
             (user_id, resolved_env, episode_id, from_regime, to_regime,
              detection_ts, status, created_at)
             VALUES (?, ?, 'EP-UNIQ', 'range', 'trend_up', ?, 'DETECTING', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK status restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_meta_adaptation_episodes
             (user_id, resolved_env, episode_id, from_regime, to_regime,
              detection_ts, status, created_at)
             VALUES (?, ?, 'EP-BAD', 'r', 't', ?, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts)).toThrow();
    });

    test('baseline UNIQUE per user×env', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_meta_baseline_speed
             (user_id, resolved_env, last_updated)
             VALUES (?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_meta_baseline_speed
             (user_id, resolved_env, last_updated)
             VALUES (?, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });
});

describe('§72 Constants', () => {
    test('EPISODE_STATUSES has 4 entries', () => {
        expect(ml.EPISODE_STATUSES).toEqual([
            'DETECTING', 'ADAPTING', 'CALIBRATED', 'FAILED'
        ]);
    });

    test('meta target < standard target', () => {
        expect(ml.META_ADAPTATION_TARGET_HOURS).toBeLessThan(
            ml.STANDARD_ADAPTATION_TARGET_HOURS
        );
    });

    test('meta samples << standard samples', () => {
        expect(ml.MIN_SAMPLES_META).toBeLessThan(ml.MIN_SAMPLES_STANDARD);
    });
});

describe('§72 recordRegimeTransition', () => {
    test('persists with DETECTING status', () => {
        ml.recordRegimeTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            episodeId: 'EP-001',
            fromRegime: 'range', toRegime: 'trend_up'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_meta_adaptation_episodes WHERE episode_id = 'EP-001'`
        ).all();
        expect(rows[0].status).toBe('DETECTING');
    });

    test('duplicate episodeId throws', () => {
        ml.recordRegimeTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            episodeId: 'EP-DUP', fromRegime: 'r', toRegime: 't'
        });
        expect(() => ml.recordRegimeTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            episodeId: 'EP-DUP', fromRegime: 'r', toRegime: 't'
        })).toThrow(/duplicate/i);
    });
});

describe('§72 recordAdaptationSample', () => {
    test('increments samples_used + transitions to ADAPTING', () => {
        ml.recordRegimeTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            episodeId: 'EP-S1', fromRegime: 'r', toRegime: 't'
        });
        ml.recordAdaptationSample({ episodeId: 'EP-S1' });
        ml.recordAdaptationSample({ episodeId: 'EP-S1' });
        const row = db.prepare(
            `SELECT * FROM ml_meta_adaptation_episodes WHERE episode_id = 'EP-S1'`
        ).get();
        expect(row.samples_used).toBe(2);
        expect(row.status).toBe('ADAPTING');
    });

    test('cannot add sample to CALIBRATED', () => {
        ml.recordRegimeTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            episodeId: 'EP-C1', fromRegime: 'r', toRegime: 't'
        });
        ml.completeAdaptation({
            episodeId: 'EP-C1', recalibrationQualityScore: 0.9
        });
        expect(() => ml.recordAdaptationSample({
            episodeId: 'EP-C1'
        })).toThrow(/CALIBRATED/);
    });
});

describe('§72 completeAdaptation', () => {
    test('marks CALIBRATED + records duration', () => {
        const detect = 1000;
        ml.recordRegimeTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            episodeId: 'EP-COMP',
            fromRegime: 'r', toRegime: 't',
            detectionTs: detect
        });
        const r = ml.completeAdaptation({
            episodeId: 'EP-COMP',
            recalibrationQualityScore: 0.85,
            completionTs: detect + 7200000   // 2h
        });
        expect(r.durationMs).toBe(7200000);

        const row = db.prepare(
            `SELECT * FROM ml_meta_adaptation_episodes WHERE episode_id = 'EP-COMP'`
        ).get();
        expect(row.status).toBe('CALIBRATED');
        expect(row.recalibration_quality_score).toBeCloseTo(0.85);
    });

    test('cannot re-complete', () => {
        ml.recordRegimeTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            episodeId: 'EP-RE', fromRegime: 'r', toRegime: 't'
        });
        ml.completeAdaptation({
            episodeId: 'EP-RE', recalibrationQualityScore: 0.8
        });
        expect(() => ml.completeAdaptation({
            episodeId: 'EP-RE', recalibrationQualityScore: 0.9
        })).toThrow();
    });
});

describe('§72 failAdaptation', () => {
    test('marks FAILED with reason', () => {
        ml.recordRegimeTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            episodeId: 'EP-FAIL', fromRegime: 'r', toRegime: 't'
        });
        ml.failAdaptation({
            episodeId: 'EP-FAIL', reason: 'timeout_no_convergence'
        });
        const row = db.prepare(
            `SELECT * FROM ml_meta_adaptation_episodes WHERE episode_id = 'EP-FAIL'`
        ).get();
        expect(row.status).toBe('FAILED');
        expect(row.failure_reason).toBe('timeout_no_convergence');
    });
});

describe('§72 getAdaptationSpeed', () => {
    test('insufficient episodes → sufficient=false', () => {
        const r = ml.getAdaptationSpeed({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.sufficient).toBe(false);
    });

    test('aggregates avg + percentiles after enough episodes', () => {
        for (let i = 0; i < 5; i++) {
            const detectTs = Date.now() - 86400000 * (i + 1);
            ml.recordRegimeTransition({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                episodeId: `EP-AGG-${i}`,
                fromRegime: 'r', toRegime: 't',
                detectionTs: detectTs,
                createdAt: detectTs
            });
            for (let s = 0; s < 20 + i * 5; s++) {
                ml.recordAdaptationSample({ episodeId: `EP-AGG-${i}` });
            }
            ml.completeAdaptation({
                episodeId: `EP-AGG-${i}`,
                recalibrationQualityScore: 0.8,
                completionTs: detectTs + 3 * 86400000  // 3 days
            });
        }
        const r = ml.getAdaptationSpeed({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.sufficient).toBe(true);
        expect(r.episodesObserved).toBe(5);
        expect(r.avgAdaptationHours).toBeCloseTo(72);  // 3 days
    });
});

describe('§72 compareToBaseline', () => {
    test('detects meta-learning when fast', () => {
        const r = ml.compareToBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentEpisodeSamples: 30,    // < 50
            currentEpisodeHours: 72       // < 120
        });
        expect(r.isMetaLearning).toBe(true);
        expect(r.speedupRatio).toBeGreaterThan(1);
    });

    test('NOT meta-learning when slow', () => {
        const r = ml.compareToBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentEpisodeSamples: 1500,
            currentEpisodeHours: 600
        });
        expect(r.isMetaLearning).toBe(false);
    });

    test('uses standard baseline when no observed baseline', () => {
        const r = ml.compareToBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentEpisodeSamples: 100,
            currentEpisodeHours: 24
        });
        expect(r.baselineHours).toBe(ml.STANDARD_ADAPTATION_TARGET_HOURS);
        expect(r.speedupRatio).toBeCloseTo(30);  // 720/24
    });
});

describe('§72 getAdaptationHistory', () => {
    test('filter by status', () => {
        ml.recordRegimeTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            episodeId: 'EP-H1', fromRegime: 'r', toRegime: 't'
        });
        ml.completeAdaptation({
            episodeId: 'EP-H1', recalibrationQualityScore: 0.9
        });
        ml.recordRegimeTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            episodeId: 'EP-H2', fromRegime: 'r', toRegime: 't'
        });
        const calibrated = ml.getAdaptationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            status: 'CALIBRATED'
        });
        const detecting = ml.getAdaptationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            status: 'DETECTING'
        });
        expect(calibrated).toHaveLength(1);
        expect(detecting).toHaveLength(1);
    });
});

describe('§72 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9073;
        ml.recordRegimeTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            episodeId: 'EP-ISO', fromRegime: 'r', toRegime: 't'
        });
        const h1 = ml.getAdaptationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const h2 = ml.getAdaptationHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(h1.length).toBe(1);
        expect(h2.length).toBe(0);
    });
});
