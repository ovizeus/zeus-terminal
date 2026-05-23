'use strict';

/**
 * OMEGA §128 FALSE CONSENSUS DETECTOR / EPISTEMIC DEPENDENCE PENALTY.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 3665-3722.
 *
 * "am multe dovezi diferite sau doar mai multe ecouri ale aceleiasi dovezi?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p128-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R6_shadowMeta/falseConsensusDetector');

const UID = 9128;
const UID_B = 9129;
const UID_HISTORY = 9130;
const UID_FILTER = 9131;
const UID_ISO_A = 9132;
const UID_ISO_B = 9133;
const UID_ENV = 9134;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_B, UID_HISTORY, UID_FILTER,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_consensus_dependence_edges WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_consensus_assessments WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §128 FALSE CONSENSUS DETECTOR', () => {

    describe('Migrations 245+246', () => {
        test('245_ml_consensus_dependence_edges migration applied', () => {
            const row = db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('245_ml_consensus_dependence_edges');
            expect(row).toBeTruthy();
        });

        test('246_ml_consensus_assessments migration applied', () => {
            const row = db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('246_ml_consensus_assessments');
            expect(row).toBeTruthy();
        });

        test('edge_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_consensus_dependence_edges
                (user_id, resolved_env, edge_id, signal_id,
                 upstream_source_id, ts)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p128_e_dup_1', 's1', 'src1', _now());
            expect(() => {
                stmt.run(UID, ENV, 'p128_e_dup_1', 's2', 'src2', _now());
            }).toThrow();
        });

        test('verdict CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_consensus_assessments
                (user_id, resolved_env, assessment_id, signals_json,
                 raw_count, effective_count, mean_pairwise_dependence,
                 inflation_factor, verdict, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => {
                stmt.run(UID, ENV, 'a_bad_verdict', '[]',
                    3, 2.0, 0.3, 0.3, 'BOGUS', _now());
            }).toThrow();
        });

        test('inflation_factor CHECK range enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_consensus_assessments
                (user_id, resolved_env, assessment_id, signals_json,
                 raw_count, effective_count, mean_pairwise_dependence,
                 inflation_factor, verdict, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => {
                stmt.run(UID, ENV, 'a_bad_inflation', '[]',
                    3, 2.0, 0.3, 1.5, 'partially_shared', _now());
            }).toThrow();
        });
    });

    describe('Constants', () => {
        test('CONSENSUS_VERDICTS frozen 3 entries', () => {
            expect(M.CONSENSUS_VERDICTS).toEqual([
                'robust_independent',
                'partially_shared',
                'highly_coupled_pseudo'
            ]);
            expect(Object.isFrozen(M.CONSENSUS_VERDICTS)).toBe(true);
        });

        test('DEPENDENCE_THRESHOLDS ordered', () => {
            expect(M.DEPENDENCE_THRESHOLDS.robust).toBe(0.30);
            expect(M.DEPENDENCE_THRESHOLDS.pseudo).toBe(0.70);
            expect(M.DEPENDENCE_THRESHOLDS.robust)
                .toBeLessThan(M.DEPENDENCE_THRESHOLDS.pseudo);
        });

        test('MIN_SIGNALS = 2', () => {
            expect(M.MIN_SIGNALS).toBe(2);
        });
    });

    describe('computePairwiseDependence (pure)', () => {
        test('disjoint ancestor sets → 0', () => {
            const r = M.computePairwiseDependence({
                ancestorsA: new Set(['x', 'y']),
                ancestorsB: new Set(['p', 'q'])
            });
            expect(r.dependence).toBe(0);
        });

        test('identical ancestor sets → 1', () => {
            const r = M.computePairwiseDependence({
                ancestorsA: new Set(['x', 'y', 'z']),
                ancestorsB: new Set(['x', 'y', 'z'])
            });
            expect(r.dependence).toBe(1);
        });

        test('Jaccard half-overlap (1/3)', () => {
            // A = {x,y}, B = {y,z} → intersection={y}=1, union={x,y,z}=3
            const r = M.computePairwiseDependence({
                ancestorsA: new Set(['x', 'y']),
                ancestorsB: new Set(['y', 'z'])
            });
            expect(r.dependence).toBeCloseTo(1 / 3, 6);
        });

        test('both empty → 0 (no shared info)', () => {
            const r = M.computePairwiseDependence({
                ancestorsA: new Set(),
                ancestorsB: new Set()
            });
            expect(r.dependence).toBe(0);
        });
    });

    describe('computeEffectiveCount (pure)', () => {
        test('independent signals (dep=0) → effective = raw', () => {
            const r = M.computeEffectiveCount({
                rawCount: 5, meanPairwiseDependence: 0
            });
            expect(r.effectiveCount).toBe(5);
        });

        test('fully coupled (dep=1) → effective = 1 (floor)', () => {
            const r = M.computeEffectiveCount({
                rawCount: 5, meanPairwiseDependence: 1
            });
            expect(r.effectiveCount).toBe(1);
        });

        test('half-coupled (dep=0.5) → effective = 2.5', () => {
            const r = M.computeEffectiveCount({
                rawCount: 5, meanPairwiseDependence: 0.5
            });
            expect(r.effectiveCount).toBeCloseTo(2.5, 6);
        });
    });

    describe('classifyConsensus (pure)', () => {
        test('mean dep < 0.30 → robust_independent', () => {
            const r = M.classifyConsensus({ meanPairwiseDependence: 0.10 });
            expect(r.verdict).toBe('robust_independent');
        });

        test('mean dep 0.30..0.70 → partially_shared', () => {
            const r = M.classifyConsensus({ meanPairwiseDependence: 0.50 });
            expect(r.verdict).toBe('partially_shared');
        });

        test('mean dep > 0.70 → highly_coupled_pseudo', () => {
            const r = M.classifyConsensus({ meanPairwiseDependence: 0.85 });
            expect(r.verdict).toBe('highly_coupled_pseudo');
        });

        test('exact 0.30 boundary → partially_shared', () => {
            const r = M.classifyConsensus({ meanPairwiseDependence: 0.30 });
            expect(r.verdict).toBe('partially_shared');
        });
    });

    describe('computeInflationPenalty (pure)', () => {
        test('no inflation (raw=effective) → 0', () => {
            const r = M.computeInflationPenalty({
                rawCount: 5, effectiveCount: 5
            });
            expect(r.inflationFactor).toBe(0);
        });

        test('full collapse (effective=1, raw=5) → 0.8', () => {
            const r = M.computeInflationPenalty({
                rawCount: 5, effectiveCount: 1
            });
            expect(r.inflationFactor).toBeCloseTo(0.8, 6);
        });

        test('rawCount=0 → 0 (no inflation)', () => {
            const r = M.computeInflationPenalty({
                rawCount: 0, effectiveCount: 0
            });
            expect(r.inflationFactor).toBe(0);
        });
    });

    describe('recordDependenceEdge', () => {
        test('persists edge', () => {
            const r = M.recordDependenceEdge({
                userId: UID, resolvedEnv: ENV,
                edgeId: 'e_persist_1',
                signalId: 'signal_A',
                upstreamSourceId: 'macro_pulse',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
        });

        test('duplicate edgeId throws', () => {
            M.recordDependenceEdge({
                userId: UID, resolvedEnv: ENV,
                edgeId: 'e_dup_2',
                signalId: 'signal_B',
                upstreamSourceId: 'macro_pulse',
                ts: _now()
            });
            expect(() => M.recordDependenceEdge({
                userId: UID, resolvedEnv: ENV,
                edgeId: 'e_dup_2',
                signalId: 'signal_C',
                upstreamSourceId: 'oi_flow',
                ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('assessConsensus', () => {
        test('3 signals fully sharing 1 ancestor → highly_coupled_pseudo', () => {
            const r = M.assessConsensus({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'a_pseudo_1',
                signalAncestorsMap: {
                    sig_x: ['macro_pulse'],
                    sig_y: ['macro_pulse'],
                    sig_z: ['macro_pulse']
                },
                ts: _now()
            });
            expect(r.assessed).toBe(true);
            expect(r.verdict).toBe('highly_coupled_pseudo');
            expect(r.rawCount).toBe(3);
            expect(r.meanPairwiseDependence).toBe(1);
            expect(r.effectiveCount).toBe(1);
        });

        test('3 signals fully independent → robust_independent', () => {
            const r = M.assessConsensus({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'a_robust_1',
                signalAncestorsMap: {
                    sig_a: ['source_alpha'],
                    sig_b: ['source_beta'],
                    sig_c: ['source_gamma']
                },
                ts: _now()
            });
            expect(r.verdict).toBe('robust_independent');
            expect(r.meanPairwiseDependence).toBe(0);
            expect(r.effectiveCount).toBe(3);
            expect(r.inflationFactor).toBe(0);
        });

        test('2 signals share 1 of 2 ancestors each → partially_shared', () => {
            // sig_a = {x, y}, sig_b = {y, z} → dep = 1/3 ≈ 0.333
            const r = M.assessConsensus({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'a_partial_1',
                signalAncestorsMap: {
                    sig_a: ['x', 'y'],
                    sig_b: ['y', 'z']
                },
                ts: _now()
            });
            expect(r.verdict).toBe('partially_shared');
            expect(r.meanPairwiseDependence).toBeCloseTo(1 / 3, 6);
        });

        test('duplicate assessmentId throws', () => {
            M.assessConsensus({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'a_dup_1',
                signalAncestorsMap: {
                    s1: ['x'], s2: ['y']
                },
                ts: _now()
            });
            expect(() => M.assessConsensus({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'a_dup_1',
                signalAncestorsMap: {
                    s3: ['p'], s4: ['q']
                },
                ts: _now()
            })).toThrow(/duplicate/);
        });

        test('below MIN_SIGNALS throws', () => {
            expect(() => M.assessConsensus({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'a_too_few',
                signalAncestorsMap: { sig_only: ['x'] },
                ts: _now()
            })).toThrow(/MIN_SIGNALS|at least 2/);
        });
    });

    describe('getAssessmentHistory', () => {
        test('returns assessments DESC by ts', () => {
            const u = UID_HISTORY;
            M.assessConsensus({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'h1',
                signalAncestorsMap: { a: ['x'], b: ['x'] },
                ts: 1000
            });
            M.assessConsensus({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'h2',
                signalAncestorsMap: { a: ['x'], b: ['y'] },
                ts: 2000
            });
            const rows = M.getAssessmentHistory({
                userId: u, resolvedEnv: ENV, limit: 10
            });
            expect(rows.length).toBe(2);
            expect(rows[0].assessmentId).toBe('h2');
            expect(rows[1].assessmentId).toBe('h1');
        });

        test('verdict filter works', () => {
            const u = UID_FILTER;
            M.assessConsensus({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'f_pseudo',
                signalAncestorsMap: {
                    a: ['z'], b: ['z'], c: ['z']
                },
                ts: 3000
            });
            M.assessConsensus({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'f_robust',
                signalAncestorsMap: {
                    a: ['alpha'], b: ['beta'], c: ['gamma']
                },
                ts: 4000
            });
            const rows = M.getAssessmentHistory({
                userId: u, resolvedEnv: ENV,
                verdictFilter: 'highly_coupled_pseudo',
                limit: 10
            });
            expect(rows.length).toBe(1);
            expect(rows[0].assessmentId).toBe('f_pseudo');
        });

        test('invalid verdictFilter throws', () => {
            expect(() => M.getAssessmentHistory({
                userId: UID, resolvedEnv: ENV,
                verdictFilter: 'BOGUS'
            })).toThrow(/invalid verdictFilter/);
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B assessments', () => {
            const u1 = UID_ISO_A, u2 = UID_ISO_B;
            M.assessConsensus({
                userId: u1, resolvedEnv: ENV,
                assessmentId: 'iso_u1',
                signalAncestorsMap: { a: ['x'], b: ['y'] },
                ts: _now()
            });
            M.assessConsensus({
                userId: u2, resolvedEnv: ENV,
                assessmentId: 'iso_u2',
                signalAncestorsMap: { a: ['p'], b: ['q'] },
                ts: _now()
            });
            const rows1 = M.getAssessmentHistory({
                userId: u1, resolvedEnv: ENV, limit: 10
            });
            expect(rows1.every(r => r.assessmentId !== 'iso_u2')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env for same uid', () => {
            const u = UID_ENV;
            M.assessConsensus({
                userId: u, resolvedEnv: 'DEMO',
                assessmentId: 'env_demo',
                signalAncestorsMap: { a: ['x'], b: ['y'] },
                ts: _now()
            });
            M.assessConsensus({
                userId: u, resolvedEnv: 'TESTNET',
                assessmentId: 'env_testnet',
                signalAncestorsMap: { a: ['p'], b: ['q'] },
                ts: _now()
            });
            const rowsDemo = M.getAssessmentHistory({
                userId: u, resolvedEnv: 'DEMO', limit: 10
            });
            expect(rowsDemo.every(r => r.assessmentId !== 'env_testnet')).toBe(true);
        });
    });
});
