'use strict';

/**
 * OMEGA §144 ADAPTIVE SOURCE TRUST CALIBRATION.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt line 4713.
 *
 * "fiecare sursă de informație își câștigă și pierde credibilitate dinamic"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p144-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/adaptiveSourceTrustCalibration');

const UID = 9144;
const UID_PRED = 9244;
const UID_UPDATE = 9344;
const UID_GET = 9444;
const UID_TOP = 9544;
const UID_ISO_A = 9644;
const UID_ISO_B = 9744;
const UID_ENV = 9844;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_PRED, UID_UPDATE, UID_GET, UID_TOP,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_source_trust_predictions WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_source_trust_scores WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §144 ADAPTIVE SOURCE TRUST CALIBRATION', () => {

    describe('Migrations 286+287', () => {
        test('286 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('286_ml_source_trust_predictions')).toBeTruthy();
        });
        test('287 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('287_ml_source_trust_scores')).toBeTruthy();
        });
        test('regime CHECK enum on predictions', () => {
            expect(() => db.prepare(`INSERT INTO ml_source_trust_predictions
                (user_id, resolved_env, prediction_id, source_name, regime,
                 setup_kind, predicted_value_json, actual_value_json,
                 accuracy_score, prediction_was_correct, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_bk', 'src', 'BOGUS', 'sweep',
                    '0', '0', 0.5, 1, _now())).toThrow();
        });
        test('accuracy_score range', () => {
            expect(() => db.prepare(`INSERT INTO ml_source_trust_predictions
                (user_id, resolved_env, prediction_id, source_name, regime,
                 setup_kind, predicted_value_json, actual_value_json,
                 accuracy_score, prediction_was_correct, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_br', 'src', 'trend', 'sweep',
                    '0', '0', 1.5, 1, _now())).toThrow();
        });
        test('composite UNIQUE on scores (source × regime per user × env)', () => {
            const stmt = db.prepare(`INSERT INTO ml_source_trust_scores
                (user_id, resolved_env, score_id, source_name, regime,
                 trust_score, sample_count, decayed_accuracy,
                 confidence_in_score, last_updated_ts, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 's_1', 'santiment', 'trend',
                0.7, 10, 0.8, 0.5, _now(), _now());
            expect(() => stmt.run(UID, ENV, 's_2', 'santiment', 'trend',
                0.8, 12, 0.85, 0.6, _now(), _now())).toThrow();
        });
        test('different source or regime → ok', () => {
            const stmt = db.prepare(`INSERT INTO ml_source_trust_scores
                (user_id, resolved_env, score_id, source_name, regime,
                 trust_score, sample_count, decayed_accuracy,
                 confidence_in_score, last_updated_ts, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 's_diff1', 'santiment', 'range',
                0.5, 5, 0.5, 0.3, _now(), _now());
            stmt.run(UID, ENV, 's_diff2', 'cvd', 'range',
                0.6, 8, 0.65, 0.4, _now(), _now());
            // Should not throw
            expect(true).toBe(true);
        });
    });

    describe('Constants', () => {
        test('REGIMES frozen 4', () => {
            expect(M.REGIMES).toEqual(['trend', 'range', 'chop', 'breakout']);
            expect(Object.isFrozen(M.REGIMES)).toBe(true);
        });
        test('TRUST_LEVELS frozen 3', () => {
            expect(M.TRUST_LEVELS).toEqual(['low', 'moderate', 'high']);
            expect(Object.isFrozen(M.TRUST_LEVELS)).toBe(true);
        });
        test('TRUST_THRESHOLDS ordered', () => {
            expect(M.TRUST_THRESHOLDS.high).toBe(0.70);
            expect(M.TRUST_THRESHOLDS.low).toBe(0.30);
        });
        test('DECAY_FACTOR = 0.95', () => {
            expect(M.DECAY_FACTOR).toBe(0.95);
        });
        test('MIN_SAMPLES_FOR_FULL_CONFIDENCE = 20', () => {
            expect(M.MIN_SAMPLES_FOR_FULL_CONFIDENCE).toBe(20);
        });
        test('DEFAULT_TRUST_BASELINE = 0.50', () => {
            expect(M.DEFAULT_TRUST_BASELINE).toBe(0.50);
        });
    });

    describe('computeDecayedAccuracy (pure)', () => {
        test('empty predictions → 0', () => {
            expect(M.computeDecayedAccuracy({
                predictions: [], decayFactor: 0.95
            }).decayedAccuracy).toBe(0);
        });
        test('single prediction → its accuracy', () => {
            expect(M.computeDecayedAccuracy({
                predictions: [{ accuracy_score: 0.8 }],
                decayFactor: 0.95
            }).decayedAccuracy).toBeCloseTo(0.8, 6);
        });
        test('newest weighted more than oldest (DB DESC order: newest first)', () => {
            // Array is DB-returned order: [newest=1.0, newer=0.5, oldest=0.0]
            // Weights: newest×1.0 + newer×0.95 + oldest×0.9025
            //        = 1.0 + 0.475 + 0 = 1.475
            // Sum weights = 1.0 + 0.95 + 0.9025 = 2.8525
            // → 1.475 / 2.8525 ≈ 0.517 (biased toward 1.0 = newest)
            const r = M.computeDecayedAccuracy({
                predictions: [
                    { accuracy_score: 1.0 },  // newest (DB DESC first)
                    { accuracy_score: 0.5 },
                    { accuracy_score: 0.0 }   // oldest
                ],
                decayFactor: 0.95
            });
            expect(r.decayedAccuracy).toBeGreaterThan(0.4);
            expect(r.decayedAccuracy).toBeLessThan(0.6);
            // Decayed biases toward newest (1.0), so above simple avg 0.5
            expect(r.decayedAccuracy).toBeGreaterThan(0.5);
        });
        test('uniform accuracy → that value', () => {
            const r = M.computeDecayedAccuracy({
                predictions: [
                    { accuracy_score: 0.7 },
                    { accuracy_score: 0.7 },
                    { accuracy_score: 0.7 }
                ],
                decayFactor: 0.95
            });
            expect(r.decayedAccuracy).toBeCloseTo(0.7, 4);
        });
        test('decayFactor=1.0 → simple average', () => {
            const r = M.computeDecayedAccuracy({
                predictions: [
                    { accuracy_score: 0.0 },
                    { accuracy_score: 1.0 }
                ],
                decayFactor: 1.0
            });
            expect(r.decayedAccuracy).toBeCloseTo(0.5, 6);
        });
    });

    describe('computeConfidenceInScore (pure)', () => {
        test('zero samples → 0', () => {
            expect(M.computeConfidenceInScore({
                sampleCount: 0, minSamples: 20
            }).confidence).toBe(0);
        });
        test('half samples → 0.5', () => {
            expect(M.computeConfidenceInScore({
                sampleCount: 10, minSamples: 20
            }).confidence).toBeCloseTo(0.5, 6);
        });
        test('full samples → 1.0', () => {
            expect(M.computeConfidenceInScore({
                sampleCount: 20, minSamples: 20
            }).confidence).toBe(1.0);
        });
        test('over samples clamped 1.0', () => {
            expect(M.computeConfidenceInScore({
                sampleCount: 100, minSamples: 20
            }).confidence).toBe(1.0);
        });
    });

    describe('combineTrust (pure)', () => {
        test('zero confidence → baseline', () => {
            const r = M.combineTrust({
                decayedAccuracy: 0.9,
                confidenceInScore: 0,
                defaultBaseline: 0.5
            });
            expect(r.trustScore).toBe(0.5);
        });
        test('full confidence → accuracy', () => {
            const r = M.combineTrust({
                decayedAccuracy: 0.85,
                confidenceInScore: 1.0,
                defaultBaseline: 0.5
            });
            expect(r.trustScore).toBeCloseTo(0.85, 6);
        });
        test('mid confidence → blend', () => {
            // 0.8 × 0.5 + 0.5 × 0.5 = 0.65
            const r = M.combineTrust({
                decayedAccuracy: 0.8,
                confidenceInScore: 0.5,
                defaultBaseline: 0.5
            });
            expect(r.trustScore).toBeCloseTo(0.65, 6);
        });
        test('clamped [0,1]', () => {
            const r = M.combineTrust({
                decayedAccuracy: 1.0,
                confidenceInScore: 1.0,
                defaultBaseline: 0.5
            });
            expect(r.trustScore).toBe(1.0);
        });
    });

    describe('classifyTrustLevel (pure)', () => {
        test('≥0.70 → high', () => {
            expect(M.classifyTrustLevel({ trustScore: 0.85 }).trustLevel).toBe('high');
        });
        test('0.30-0.70 → moderate', () => {
            expect(M.classifyTrustLevel({ trustScore: 0.50 }).trustLevel).toBe('moderate');
        });
        test('<0.30 → low', () => {
            expect(M.classifyTrustLevel({ trustScore: 0.20 }).trustLevel).toBe('low');
        });
        test('boundary 0.70', () => {
            expect(M.classifyTrustLevel({ trustScore: 0.70 }).trustLevel).toBe('high');
        });
        test('boundary 0.30', () => {
            expect(M.classifyTrustLevel({ trustScore: 0.30 }).trustLevel).toBe('moderate');
        });
    });

    describe('recordPrediction', () => {
        test('high accuracy → prediction_was_correct=1', () => {
            const r = M.recordPrediction({
                userId: UID_PRED, resolvedEnv: ENV,
                predictionId: 'pp_high', sourceName: 'santiment',
                regime: 'trend', setupKind: 'sweep_reclaim',
                predictedValue: { direction: 'up' },
                actualValue: { direction: 'up' },
                accuracyScore: 0.85, ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.predictionWasCorrect).toBe(true);
        });
        test('low accuracy → prediction_was_correct=0', () => {
            const r = M.recordPrediction({
                userId: UID_PRED, resolvedEnv: ENV,
                predictionId: 'pp_low', sourceName: 'santiment',
                regime: 'trend', setupKind: 'sweep_reclaim',
                predictedValue: { direction: 'up' },
                actualValue: { direction: 'down' },
                accuracyScore: 0.30, ts: _now()
            });
            expect(r.predictionWasCorrect).toBe(false);
        });
        test('duplicate predictionId throws', () => {
            M.recordPrediction({
                userId: UID_PRED, resolvedEnv: ENV,
                predictionId: 'pp_dup', sourceName: 'santiment',
                regime: 'trend', setupKind: 's', predictedValue: {},
                actualValue: {}, accuracyScore: 0.5, ts: _now()
            });
            expect(() => M.recordPrediction({
                userId: UID_PRED, resolvedEnv: ENV,
                predictionId: 'pp_dup', sourceName: 'cvd',
                regime: 'range', setupKind: 's', predictedValue: {},
                actualValue: {}, accuracyScore: 0.5, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('invalid regime throws', () => {
            expect(() => M.recordPrediction({
                userId: UID_PRED, resolvedEnv: ENV,
                predictionId: 'pp_bad', sourceName: 'src',
                regime: 'BOGUS', setupKind: 's', predictedValue: {},
                actualValue: {}, accuracyScore: 0.5, ts: _now()
            })).toThrow(/invalid regime/);
        });
        test('out-of-range accuracy throws', () => {
            expect(() => M.recordPrediction({
                userId: UID_PRED, resolvedEnv: ENV,
                predictionId: 'pp_br', sourceName: 'src',
                regime: 'trend', setupKind: 's', predictedValue: {},
                actualValue: {}, accuracyScore: 1.5, ts: _now()
            })).toThrow();
        });
    });

    describe('updateSourceTrust (integration)', () => {
        test('3 high-accuracy predictions → high trust upserted', () => {
            for (let i = 0; i < 3; i++) {
                M.recordPrediction({
                    userId: UID_UPDATE, resolvedEnv: ENV,
                    predictionId: `pu_h_${i}`, sourceName: 'santiment',
                    regime: 'trend', setupKind: 's',
                    predictedValue: {}, actualValue: {},
                    accuracyScore: 0.9, ts: 1000 + i
                });
            }
            const r = M.updateSourceTrust({
                userId: UID_UPDATE, resolvedEnv: ENV,
                sourceName: 'santiment', regime: 'trend',
                ts: _now()
            });
            expect(r.updated).toBe(true);
            expect(r.sampleCount).toBe(3);
            expect(r.decayedAccuracy).toBeGreaterThan(0.85);
            // Low confidence (3 < 20 min) → trust ≈ accuracy×0.15 + 0.5×0.85
            expect(r.trustScore).toBeGreaterThan(0.50);
            expect(r.trustScore).toBeLessThan(0.85);
        });
        test('3 low-accuracy → low trust + baseline shrinkage', () => {
            for (let i = 0; i < 3; i++) {
                M.recordPrediction({
                    userId: UID_UPDATE, resolvedEnv: ENV,
                    predictionId: `pu_l_${i}`, sourceName: 'santiment',
                    regime: 'chop', setupKind: 's',
                    predictedValue: {}, actualValue: {},
                    accuracyScore: 0.1, ts: 1000 + i
                });
            }
            const r = M.updateSourceTrust({
                userId: UID_UPDATE, resolvedEnv: ENV,
                sourceName: 'santiment', regime: 'chop',
                ts: _now()
            });
            expect(r.decayedAccuracy).toBeLessThan(0.15);
            // Low confidence pulls toward baseline 0.5; but still below 0.5
            expect(r.trustScore).toBeLessThan(0.50);
        });
        test('20+ predictions → full confidence + close to accuracy', () => {
            for (let i = 0; i < 25; i++) {
                M.recordPrediction({
                    userId: UID_UPDATE, resolvedEnv: ENV,
                    predictionId: `pu_full_${i}`, sourceName: 'cvd',
                    regime: 'trend', setupKind: 's',
                    predictedValue: {}, actualValue: {},
                    accuracyScore: 0.8, ts: 1000 + i
                });
            }
            const r = M.updateSourceTrust({
                userId: UID_UPDATE, resolvedEnv: ENV,
                sourceName: 'cvd', regime: 'trend', ts: _now()
            });
            expect(r.confidenceInScore).toBe(1.0);
            expect(r.trustScore).toBeCloseTo(0.8, 1);
        });
        test('UPSERT: re-running update overwrites previous score', () => {
            // First batch low
            for (let i = 0; i < 3; i++) {
                M.recordPrediction({
                    userId: UID_UPDATE, resolvedEnv: ENV,
                    predictionId: `pu_up_1_${i}`, sourceName: 'div',
                    regime: 'range', setupKind: 's',
                    predictedValue: {}, actualValue: {},
                    accuracyScore: 0.2, ts: 1000 + i
                });
            }
            M.updateSourceTrust({
                userId: UID_UPDATE, resolvedEnv: ENV,
                sourceName: 'div', regime: 'range', ts: 2000
            });
            // Second batch high
            for (let i = 0; i < 5; i++) {
                M.recordPrediction({
                    userId: UID_UPDATE, resolvedEnv: ENV,
                    predictionId: `pu_up_2_${i}`, sourceName: 'div',
                    regime: 'range', setupKind: 's',
                    predictedValue: {}, actualValue: {},
                    accuracyScore: 0.95, ts: 3000 + i
                });
            }
            const r = M.updateSourceTrust({
                userId: UID_UPDATE, resolvedEnv: ENV,
                sourceName: 'div', regime: 'range', ts: 4000
            });
            // 8 total predictions, mix
            expect(r.sampleCount).toBe(8);
            // Only ONE row should exist (UNIQUE)
            const rows = db.prepare("SELECT COUNT(*) AS c FROM ml_source_trust_scores WHERE user_id=? AND source_name=? AND regime=?")
                .get(UID_UPDATE, 'div', 'range');
            expect(rows.c).toBe(1);
        });
    });

    describe('getSourceTrust', () => {
        test('returns stored trust if exists', () => {
            for (let i = 0; i < 3; i++) {
                M.recordPrediction({
                    userId: UID_GET, resolvedEnv: ENV,
                    predictionId: `pg_${i}`, sourceName: 'santiment',
                    regime: 'trend', setupKind: 's',
                    predictedValue: {}, actualValue: {},
                    accuracyScore: 0.9, ts: 1000 + i
                });
            }
            M.updateSourceTrust({
                userId: UID_GET, resolvedEnv: ENV,
                sourceName: 'santiment', regime: 'trend', ts: 2000
            });
            const r = M.getSourceTrust({
                userId: UID_GET, resolvedEnv: ENV,
                sourceName: 'santiment', regime: 'trend'
            });
            expect(r).not.toBeNull();
            expect(r.trustScore).toBeGreaterThan(0.5);
            expect(r.sampleCount).toBe(3);
        });
        test('returns default when no entry', () => {
            const r = M.getSourceTrust({
                userId: UID_GET, resolvedEnv: ENV,
                sourceName: 'NONEXISTENT', regime: 'trend'
            });
            expect(r).not.toBeNull();
            expect(r.trustScore).toBe(M.DEFAULT_TRUST_BASELINE);
            expect(r.sampleCount).toBe(0);
            expect(r.isDefault).toBe(true);
        });
    });

    describe('getSourceTrustAcrossRegimes', () => {
        test('returns all 4 regimes for source', () => {
            const u = UID_GET;
            for (const regime of M.REGIMES) {
                for (let i = 0; i < 3; i++) {
                    M.recordPrediction({
                        userId: u, resolvedEnv: ENV,
                        predictionId: `par_${regime}_${i}`,
                        sourceName: 'multi', regime, setupKind: 's',
                        predictedValue: {}, actualValue: {},
                        accuracyScore: 0.6, ts: 1000 + i
                    });
                }
                M.updateSourceTrust({
                    userId: u, resolvedEnv: ENV,
                    sourceName: 'multi', regime, ts: 2000
                });
            }
            const r = M.getSourceTrustAcrossRegimes({
                userId: u, resolvedEnv: ENV, sourceName: 'multi'
            });
            expect(Object.keys(r).sort()).toEqual(M.REGIMES.slice().sort());
            for (const regime of M.REGIMES) {
                expect(r[regime]).not.toBeNull();
            }
        });
    });

    describe('getTopSourcesForRegime', () => {
        test('returns sources ranked DESC by trust for regime', () => {
            const u = UID_TOP;
            // 3 sources, varying accuracy in 'trend'
            const sources = [
                { name: 'best', acc: 0.9 },
                { name: 'mid', acc: 0.6 },
                { name: 'worst', acc: 0.2 }
            ];
            let predIdx = 0;
            for (const s of sources) {
                for (let i = 0; i < 25; i++) {
                    M.recordPrediction({
                        userId: u, resolvedEnv: ENV,
                        predictionId: `top_${predIdx++}`,
                        sourceName: s.name, regime: 'trend', setupKind: 's',
                        predictedValue: {}, actualValue: {},
                        accuracyScore: s.acc, ts: 1000 + i
                    });
                }
                M.updateSourceTrust({
                    userId: u, resolvedEnv: ENV,
                    sourceName: s.name, regime: 'trend', ts: 2000
                });
            }
            const top = M.getTopSourcesForRegime({
                userId: u, resolvedEnv: ENV,
                regime: 'trend', limit: 10
            });
            expect(top.length).toBe(3);
            // Sorted DESC by trustScore
            expect(top[0].sourceName).toBe('best');
            expect(top[1].sourceName).toBe('mid');
            expect(top[2].sourceName).toBe('worst');
        });
        test('invalid regime throws', () => {
            expect(() => M.getTopSourcesForRegime({
                userId: UID_TOP, resolvedEnv: ENV,
                regime: 'BOGUS', limit: 10
            })).toThrow();
        });
    });

    describe('isolation per user × env', () => {
        test('uid', () => {
            for (let i = 0; i < 3; i++) {
                M.recordPrediction({
                    userId: UID_ISO_A, resolvedEnv: ENV,
                    predictionId: `iso_a_${i}`, sourceName: 'src',
                    regime: 'trend', setupKind: 's',
                    predictedValue: {}, actualValue: {},
                    accuracyScore: 0.9, ts: 1000 + i
                });
                M.recordPrediction({
                    userId: UID_ISO_B, resolvedEnv: ENV,
                    predictionId: `iso_b_${i}`, sourceName: 'src',
                    regime: 'trend', setupKind: 's',
                    predictedValue: {}, actualValue: {},
                    accuracyScore: 0.1, ts: 1000 + i
                });
            }
            M.updateSourceTrust({
                userId: UID_ISO_A, resolvedEnv: ENV,
                sourceName: 'src', regime: 'trend', ts: 2000
            });
            M.updateSourceTrust({
                userId: UID_ISO_B, resolvedEnv: ENV,
                sourceName: 'src', regime: 'trend', ts: 2000
            });
            const aTrust = M.getSourceTrust({
                userId: UID_ISO_A, resolvedEnv: ENV,
                sourceName: 'src', regime: 'trend'
            });
            const bTrust = M.getSourceTrust({
                userId: UID_ISO_B, resolvedEnv: ENV,
                sourceName: 'src', regime: 'trend'
            });
            expect(aTrust.decayedAccuracy).toBeGreaterThan(0.85);
            expect(bTrust.decayedAccuracy).toBeLessThan(0.15);
        });
        test('env', () => {
            for (let i = 0; i < 3; i++) {
                M.recordPrediction({
                    userId: UID_ENV, resolvedEnv: 'DEMO',
                    predictionId: `env_d_${i}`, sourceName: 'src',
                    regime: 'trend', setupKind: 's',
                    predictedValue: {}, actualValue: {},
                    accuracyScore: 0.9, ts: 1000 + i
                });
                M.recordPrediction({
                    userId: UID_ENV, resolvedEnv: 'TESTNET',
                    predictionId: `env_t_${i}`, sourceName: 'src',
                    regime: 'trend', setupKind: 's',
                    predictedValue: {}, actualValue: {},
                    accuracyScore: 0.1, ts: 1000 + i
                });
            }
            M.updateSourceTrust({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                sourceName: 'src', regime: 'trend', ts: 2000
            });
            const demo = M.getSourceTrust({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                sourceName: 'src', regime: 'trend'
            });
            expect(demo.decayedAccuracy).toBeGreaterThan(0.85);
        });
    });
});
