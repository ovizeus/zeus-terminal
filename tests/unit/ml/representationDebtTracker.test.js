'use strict';

/**
 * OMEGA §134 REPRESENTATION DEBT TRACKER / MAP-TERRITORY MISFIT ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 3913-3953.
 *
 * "harta mea despre piata incepe sa ramana in urma realitatii?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p134-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/representationDebtTracker');

const UID = 9134;
const UID_SNAP = 9234;
const UID_TREND = 9334;
const UID_ISO_A = 9434;
const UID_ISO_B = 9534;
const UID_ENV = 9634;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_SNAP, UID_TREND,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_representation_observations WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_representation_debt_snapshots WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §134 REPRESENTATION DEBT TRACKER', () => {

    describe('Migrations 256+257', () => {
        test('256_ml_representation_observations migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('256_ml_representation_observations')).toBeTruthy();
        });

        test('257_ml_representation_debt_snapshots migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('257_ml_representation_debt_snapshots')).toBeTruthy();
        });

        test('observation_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_representation_observations
                (user_id, resolved_env, observation_id, representation_kind,
                 representation_id, predicted_outcome_json, actual_outcome_json,
                 misfit_score, misfit_kind, prediction_confidence,
                 explanatory_power, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p134_o_dup', 'concept', 'r1',
                '0', '0', 0.1, 'no_misfit', 0.5, 0.5, _now());
            expect(() => stmt.run(UID, ENV, 'p134_o_dup', 'regime', 'r2',
                '0', '0', 0.2, 'no_misfit', 0.5, 0.5, _now())).toThrow();
        });

        test('representation_kind CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_representation_observations
                (user_id, resolved_env, observation_id, representation_kind,
                 representation_id, predicted_outcome_json, actual_outcome_json,
                 misfit_score, misfit_kind, prediction_confidence,
                 explanatory_power, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p134_o_bad', 'BOGUS', 'r1',
                '0', '0', 0.1, 'no_misfit', 0.5, 0.5, _now())).toThrow();
        });

        test('misfit_kind CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_representation_observations
                (user_id, resolved_env, observation_id, representation_kind,
                 representation_id, predicted_outcome_json, actual_outcome_json,
                 misfit_score, misfit_kind, prediction_confidence,
                 explanatory_power, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p134_o_bad2', 'concept', 'r1',
                '0', '0', 0.1, 'BOGUS', 0.5, 0.5, _now())).toThrow();
        });

        test('debt_verdict CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_representation_debt_snapshots
                (user_id, resolved_env, snapshot_id, representation_kind,
                 window_start_ts, window_end_ts, observations_count,
                 mean_misfit, debt_score, debt_verdict,
                 revision_recommendation, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p134_s_bad', 'concept',
                100, 200, 10, 0.5, 0.5, 'BOGUS', 'rec', _now())).toThrow();
        });

        test('misfit_score CHECK range enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_representation_observations
                (user_id, resolved_env, observation_id, representation_kind,
                 representation_id, predicted_outcome_json, actual_outcome_json,
                 misfit_score, misfit_kind, prediction_confidence,
                 explanatory_power, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p134_o_bad3', 'concept', 'r1',
                '0', '0', 1.5, 'no_misfit', 0.5, 0.5, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('REPRESENTATION_KINDS frozen 5 entries', () => {
            expect(M.REPRESENTATION_KINDS).toEqual([
                'concept', 'regime', 'primitive',
                'explanation', 'ontology'
            ]);
            expect(Object.isFrozen(M.REPRESENTATION_KINDS)).toBe(true);
        });

        test('MISFIT_KINDS frozen 4 entries', () => {
            expect(M.MISFIT_KINDS).toEqual([
                'no_misfit', 'compression_excessive',
                'forced_category', 'over_confident_under_explanatory'
            ]);
            expect(Object.isFrozen(M.MISFIT_KINDS)).toBe(true);
        });

        test('DEBT_VERDICTS frozen 3 entries', () => {
            expect(M.DEBT_VERDICTS).toEqual([
                'healthy', 'accumulating', 'critical'
            ]);
            expect(Object.isFrozen(M.DEBT_VERDICTS)).toBe(true);
        });

        test('DEBT_THRESHOLDS ordered', () => {
            expect(M.DEBT_THRESHOLDS.critical).toBe(0.70);
            expect(M.DEBT_THRESHOLDS.accumulating).toBe(0.40);
            expect(M.DEBT_THRESHOLDS.accumulating)
                .toBeLessThan(M.DEBT_THRESHOLDS.critical);
        });

        test('MIN_OBSERVATIONS_FOR_SNAPSHOT = 10', () => {
            expect(M.MIN_OBSERVATIONS_FOR_SNAPSHOT).toBe(10);
        });
    });

    describe('computeMisfitScore (pure)', () => {
        test('numeric perfect match → 0', () => {
            const r = M.computeMisfitScore({
                predicted: 100, actual: 100
            });
            expect(r.misfitScore).toBe(0);
        });

        test('numeric total miss → near 1', () => {
            const r = M.computeMisfitScore({
                predicted: 100, actual: 200
            });
            expect(r.misfitScore).toBeCloseTo(0.5, 2);
        });

        test('numeric half miss', () => {
            const r = M.computeMisfitScore({
                predicted: 100, actual: 150
            });
            // |100-150| / max(100, 150) = 50/150 ≈ 0.333
            expect(r.misfitScore).toBeCloseTo(0.333, 2);
        });

        test('numeric both near zero → uses epsilon', () => {
            const r = M.computeMisfitScore({
                predicted: 0, actual: 0
            });
            expect(r.misfitScore).toBe(0);
        });

        test('categorical same → 0', () => {
            const r = M.computeMisfitScore({
                predicted: 'bull_regime', actual: 'bull_regime'
            });
            expect(r.misfitScore).toBe(0);
        });

        test('categorical different → 1', () => {
            const r = M.computeMisfitScore({
                predicted: 'bull_regime', actual: 'bear_regime'
            });
            expect(r.misfitScore).toBe(1);
        });

        test('clamps to [0,1]', () => {
            const r = M.computeMisfitScore({
                predicted: 1, actual: 1000
            });
            expect(r.misfitScore).toBeLessThanOrEqual(1);
        });
    });

    describe('classifyMisfitKind (pure)', () => {
        test('low misfit → no_misfit', () => {
            const r = M.classifyMisfitKind({
                misfitScore: 0.10,
                predictionConfidence: 0.5,
                explanatoryPower: 0.5
            });
            expect(r.misfitKind).toBe('no_misfit');
        });

        test('high confidence + high misfit + low explanatory → over_confident_under_explanatory', () => {
            const r = M.classifyMisfitKind({
                misfitScore: 0.75,
                predictionConfidence: 0.85,
                explanatoryPower: 0.20
            });
            expect(r.misfitKind).toBe('over_confident_under_explanatory');
        });

        test('high explanatory + low misfit but forcing → compression_excessive', () => {
            // explanatory_power says "I explain everything" but misfit moderate
            const r = M.classifyMisfitKind({
                misfitScore: 0.45,
                predictionConfidence: 0.5,
                explanatoryPower: 0.85
            });
            expect(r.misfitKind).toBe('compression_excessive');
        });

        test('categorical mismatch high score → forced_category', () => {
            const r = M.classifyMisfitKind({
                misfitScore: 1.0,
                predictionConfidence: 0.5,
                explanatoryPower: 0.4,
                isCategorical: true
            });
            expect(r.misfitKind).toBe('forced_category');
        });
    });

    describe('computeDebtScore (pure)', () => {
        test('full obs + high misfit → high debt', () => {
            const r = M.computeDebtScore({
                meanMisfit: 0.8,
                observationsCount: 20,
                minObservations: 10
            });
            // meanMisfit × min(1, 20/10) = 0.8 × 1.0 = 0.8
            expect(r.debtScore).toBeCloseTo(0.8, 6);
        });

        test('partial obs (below min) discounts debt', () => {
            const r = M.computeDebtScore({
                meanMisfit: 0.8,
                observationsCount: 5,
                minObservations: 10
            });
            // 0.8 × (5/10) = 0.4
            expect(r.debtScore).toBeCloseTo(0.4, 6);
        });

        test('zero obs → zero debt', () => {
            const r = M.computeDebtScore({
                meanMisfit: 0.9,
                observationsCount: 0,
                minObservations: 10
            });
            expect(r.debtScore).toBe(0);
        });

        test('clamps to [0,1]', () => {
            const r = M.computeDebtScore({
                meanMisfit: 1.0,
                observationsCount: 100,
                minObservations: 10
            });
            expect(r.debtScore).toBe(1.0);
        });
    });

    describe('classifyDebt (pure)', () => {
        test('debt ≥ 0.70 → critical', () => {
            expect(M.classifyDebt({ debtScore: 0.85 })
                .debtVerdict).toBe('critical');
        });

        test('debt 0.40..0.70 → accumulating', () => {
            expect(M.classifyDebt({ debtScore: 0.55 })
                .debtVerdict).toBe('accumulating');
        });

        test('debt < 0.40 → healthy', () => {
            expect(M.classifyDebt({ debtScore: 0.20 })
                .debtVerdict).toBe('healthy');
        });

        test('boundary 0.70 → critical', () => {
            expect(M.classifyDebt({ debtScore: 0.70 })
                .debtVerdict).toBe('critical');
        });

        test('boundary 0.40 → accumulating', () => {
            expect(M.classifyDebt({ debtScore: 0.40 })
                .debtVerdict).toBe('accumulating');
        });
    });

    describe('recommendRevision (pure)', () => {
        test('healthy → parameter_tune', () => {
            expect(M.recommendRevision({
                debtVerdict: 'healthy',
                representationKind: 'concept'
            }).recommendation).toBe('parameter_tune');
        });

        test('accumulating + concept → concept_re_anchor', () => {
            expect(M.recommendRevision({
                debtVerdict: 'accumulating',
                representationKind: 'concept'
            }).recommendation).toBe('concept_re_anchor');
        });

        test('critical + ontology → ontology_revision', () => {
            expect(M.recommendRevision({
                debtVerdict: 'critical',
                representationKind: 'ontology'
            }).recommendation).toBe('ontology_revision');
        });

        test('critical + regime → regime_redefinition', () => {
            expect(M.recommendRevision({
                debtVerdict: 'critical',
                representationKind: 'regime'
            }).recommendation).toBe('regime_redefinition');
        });

        test('invalid verdict throws', () => {
            expect(() => M.recommendRevision({
                debtVerdict: 'BOGUS',
                representationKind: 'concept'
            })).toThrow(/invalid debtVerdict/);
        });
    });

    describe('recordObservation', () => {
        test('persists numeric observation with auto-classified misfit', () => {
            const r = M.recordObservation({
                userId: UID, resolvedEnv: ENV,
                observationId: 'p134_obs_1',
                representationKind: 'regime',
                representationId: 'bull_regime',
                predicted: 100,
                actual: 95,
                predictionConfidence: 0.6,
                explanatoryPower: 0.5,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.misfitScore).toBeLessThan(0.2);
            expect(r.misfitKind).toBe('no_misfit');
        });

        test('persists categorical mismatch', () => {
            const r = M.recordObservation({
                userId: UID, resolvedEnv: ENV,
                observationId: 'p134_obs_cat',
                representationKind: 'regime',
                representationId: 'bull_regime',
                predicted: 'bull_regime',
                actual: 'bear_regime',
                predictionConfidence: 0.7,
                explanatoryPower: 0.5,
                ts: _now()
            });
            expect(r.misfitScore).toBe(1);
            expect(r.misfitKind).toBe('forced_category');
        });

        test('duplicate observationId throws', () => {
            M.recordObservation({
                userId: UID, resolvedEnv: ENV,
                observationId: 'p134_obs_dup',
                representationKind: 'concept',
                representationId: 'c1',
                predicted: 50, actual: 50,
                predictionConfidence: 0.5,
                explanatoryPower: 0.5,
                ts: _now()
            });
            expect(() => M.recordObservation({
                userId: UID, resolvedEnv: ENV,
                observationId: 'p134_obs_dup',
                representationKind: 'concept',
                representationId: 'c2',
                predicted: 50, actual: 60,
                predictionConfidence: 0.5,
                explanatoryPower: 0.5,
                ts: _now()
            })).toThrow(/duplicate/);
        });

        test('invalid representationKind throws', () => {
            expect(() => M.recordObservation({
                userId: UID, resolvedEnv: ENV,
                observationId: 'p134_obs_bad',
                representationKind: 'BOGUS',
                representationId: 'c1',
                predicted: 50, actual: 50,
                predictionConfidence: 0.5,
                explanatoryPower: 0.5,
                ts: _now()
            })).toThrow(/invalid representationKind/);
        });

        test('out-of-range predictionConfidence throws', () => {
            expect(() => M.recordObservation({
                userId: UID, resolvedEnv: ENV,
                observationId: 'p134_obs_bad2',
                representationKind: 'concept',
                representationId: 'c1',
                predicted: 50, actual: 50,
                predictionConfidence: 1.5,
                explanatoryPower: 0.5,
                ts: _now()
            })).toThrow();
        });
    });

    describe('computeDebtSnapshot (integration)', () => {
        test('10 high-misfit observations → critical debt', () => {
            const u = UID_SNAP;
            for (let i = 0; i < 10; i++) {
                M.recordObservation({
                    userId: u, resolvedEnv: ENV,
                    observationId: `p134_snap_crit_${i}`,
                    representationKind: 'regime',
                    representationId: 'r_bull',
                    predicted: 'bull', actual: 'bear',  // cat mismatch = 1
                    predictionConfidence: 0.8,
                    explanatoryPower: 0.4,
                    ts: 1000 + i
                });
            }
            const r = M.computeDebtSnapshot({
                userId: u, resolvedEnv: ENV,
                snapshotId: 'p134_snap_critical',
                representationKind: 'regime',
                windowStartTs: 500,
                windowEndTs: 5000,
                ts: 6000
            });
            expect(r.observationsCount).toBe(10);
            expect(r.meanMisfit).toBeCloseTo(1.0, 1);
            expect(r.debtVerdict).toBe('critical');
            expect(r.revisionRecommendation).toBe('regime_redefinition');
        });

        test('10 low-misfit observations → healthy debt', () => {
            const u = UID_SNAP;
            for (let i = 0; i < 10; i++) {
                M.recordObservation({
                    userId: u, resolvedEnv: ENV,
                    observationId: `p134_snap_healthy_${i}`,
                    representationKind: 'concept',
                    representationId: 'c_grounded',
                    predicted: 100, actual: 102,  // small numeric miss
                    predictionConfidence: 0.5,
                    explanatoryPower: 0.5,
                    ts: 1000 + i
                });
            }
            const r = M.computeDebtSnapshot({
                userId: u, resolvedEnv: ENV,
                snapshotId: 'p134_snap_healthy',
                representationKind: 'concept',
                windowStartTs: 500,
                windowEndTs: 5000,
                ts: 6000
            });
            expect(r.debtVerdict).toBe('healthy');
            expect(r.revisionRecommendation).toBe('parameter_tune');
        });

        test('5 high-misfit observations (below min) → discounted debt', () => {
            const u = UID_SNAP;
            for (let i = 0; i < 5; i++) {
                M.recordObservation({
                    userId: u, resolvedEnv: ENV,
                    observationId: `p134_snap_partial_${i}`,
                    representationKind: 'ontology',
                    representationId: 'o_test',
                    predicted: 'A', actual: 'B',  // cat mismatch
                    predictionConfidence: 0.7,
                    explanatoryPower: 0.4,
                    ts: 1000 + i
                });
            }
            const r = M.computeDebtSnapshot({
                userId: u, resolvedEnv: ENV,
                snapshotId: 'p134_snap_partial',
                representationKind: 'ontology',
                windowStartTs: 500,
                windowEndTs: 5000,
                ts: 6000
            });
            expect(r.observationsCount).toBe(5);
            // meanMisfit=1.0, discount = 5/10 = 0.5, debt=0.5 → accumulating
            expect(r.debtScore).toBeCloseTo(0.5, 2);
            expect(r.debtVerdict).toBe('accumulating');
        });

        test('duplicate snapshotId throws', () => {
            const u = UID_SNAP;
            M.recordObservation({
                userId: u, resolvedEnv: ENV,
                observationId: 'p134_snap_dup_obs',
                representationKind: 'concept', representationId: 'c',
                predicted: 50, actual: 50,
                predictionConfidence: 0.5,
                explanatoryPower: 0.5, ts: 1000
            });
            M.computeDebtSnapshot({
                userId: u, resolvedEnv: ENV,
                snapshotId: 'p134_snap_dup',
                representationKind: 'concept',
                windowStartTs: 500, windowEndTs: 5000,
                ts: 6000
            });
            expect(() => M.computeDebtSnapshot({
                userId: u, resolvedEnv: ENV,
                snapshotId: 'p134_snap_dup',
                representationKind: 'regime',
                windowStartTs: 500, windowEndTs: 5000,
                ts: 7000
            })).toThrow(/duplicate/);
        });
    });

    describe('getObservationsByKind', () => {
        test('filters by representation_kind + sinceTs + limit', () => {
            const u = UID_TREND;
            for (let i = 0; i < 5; i++) {
                M.recordObservation({
                    userId: u, resolvedEnv: ENV,
                    observationId: `p134_get_r_${i}`,
                    representationKind: 'regime',
                    representationId: 'r1',
                    predicted: 'A', actual: 'A',
                    predictionConfidence: 0.5,
                    explanatoryPower: 0.5,
                    ts: 1000 + i * 100
                });
            }
            for (let i = 0; i < 3; i++) {
                M.recordObservation({
                    userId: u, resolvedEnv: ENV,
                    observationId: `p134_get_c_${i}`,
                    representationKind: 'concept',
                    representationId: 'c1',
                    predicted: 50, actual: 51,
                    predictionConfidence: 0.5,
                    explanatoryPower: 0.5,
                    ts: 2000 + i * 100
                });
            }
            const regimes = M.getObservationsByKind({
                userId: u, resolvedEnv: ENV,
                representationKind: 'regime',
                sinceTs: 0, limit: 20
            });
            expect(regimes.length).toBe(5);
            expect(regimes.every(r => r.representationKind === 'regime')).toBe(true);

            const concepts = M.getObservationsByKind({
                userId: u, resolvedEnv: ENV,
                representationKind: 'concept',
                sinceTs: 0, limit: 20
            });
            expect(concepts.length).toBe(3);
        });
    });

    describe('getDebtTrend', () => {
        test('returns snapshots for kind ASC by ts', () => {
            const u = UID_TREND;
            for (let i = 0; i < 12; i++) {
                M.recordObservation({
                    userId: u, resolvedEnv: ENV,
                    observationId: `p134_trend_obs_${i}`,
                    representationKind: 'primitive',
                    representationId: 'p1',
                    predicted: 'A', actual: i < 6 ? 'A' : 'B',  // first half match, second miss
                    predictionConfidence: 0.5,
                    explanatoryPower: 0.5,
                    ts: 1000 + i * 100
                });
            }
            M.computeDebtSnapshot({
                userId: u, resolvedEnv: ENV,
                snapshotId: 'p134_trend_s1',
                representationKind: 'primitive',
                windowStartTs: 500, windowEndTs: 2000, ts: 3000
            });
            M.computeDebtSnapshot({
                userId: u, resolvedEnv: ENV,
                snapshotId: 'p134_trend_s2',
                representationKind: 'primitive',
                windowStartTs: 500, windowEndTs: 3000, ts: 4000
            });
            const trend = M.getDebtTrend({
                userId: u, resolvedEnv: ENV,
                representationKind: 'primitive', limit: 10
            });
            expect(trend.length).toBe(2);
            expect(trend[0].snapshotId).toBe('p134_trend_s1');
            expect(trend[1].snapshotId).toBe('p134_trend_s2');
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B observations', () => {
            M.recordObservation({
                userId: UID_ISO_A, resolvedEnv: ENV,
                observationId: 'p134_iso_a_obs',
                representationKind: 'concept', representationId: 'c',
                predicted: 50, actual: 50,
                predictionConfidence: 0.5,
                explanatoryPower: 0.5, ts: 1000
            });
            M.recordObservation({
                userId: UID_ISO_B, resolvedEnv: ENV,
                observationId: 'p134_iso_b_obs',
                representationKind: 'concept', representationId: 'c',
                predicted: 50, actual: 60,
                predictionConfidence: 0.5,
                explanatoryPower: 0.5, ts: 1000
            });
            const rows = M.getObservationsByKind({
                userId: UID_ISO_A, resolvedEnv: ENV,
                representationKind: 'concept',
                sinceTs: 0, limit: 10
            });
            expect(rows.every(r => r.observationId !== 'p134_iso_b_obs')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.recordObservation({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                observationId: 'p134_env_demo_obs',
                representationKind: 'concept', representationId: 'c',
                predicted: 50, actual: 50,
                predictionConfidence: 0.5,
                explanatoryPower: 0.5, ts: 1000
            });
            M.recordObservation({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                observationId: 'p134_env_testnet_obs',
                representationKind: 'concept', representationId: 'c',
                predicted: 50, actual: 60,
                predictionConfidence: 0.5,
                explanatoryPower: 0.5, ts: 1000
            });
            const rows = M.getObservationsByKind({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                representationKind: 'concept',
                sinceTs: 0, limit: 10
            });
            expect(rows.every(r => r.observationId !== 'p134_env_testnet_obs')).toBe(true);
        });
    });
});
