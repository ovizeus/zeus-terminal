'use strict';

/**
 * OMEGA §132 SEMANTIC GROUNDING CHECK / WORD-TO-WORLD ALIGNMENT ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 3843-3880.
 *
 * "cand spun 'trend puternic', ce inseamna exact ACUM, in date?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p132-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/semanticGroundingCheck');

const UID = 9132;
const UID_CHECK = 9232;
const UID_HISTORY = 9332;
const UID_DRIFT = 9432;
const UID_ISO_A = 9532;
const UID_ISO_B = 9632;
const UID_ENV = 9732;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_CHECK, UID_HISTORY, UID_DRIFT,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_grounding_anchors WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_grounding_checks WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §132 SEMANTIC GROUNDING CHECK', () => {

    describe('Migrations 252+253', () => {
        test('252_ml_grounding_anchors migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('252_ml_grounding_anchors')).toBeTruthy();
        });

        test('253_ml_grounding_checks migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('253_ml_grounding_checks')).toBeTruthy();
        });

        test('anchor_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_grounding_anchors
                (user_id, resolved_env, anchor_id, concept_name,
                 metric_name, threshold_min, threshold_max, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p132_a_dup', 'trend', 'RSI', 30, 70, 1, _now());
            expect(() => stmt.run(UID, ENV, 'p132_a_dup', 'trend',
                'ATR', 0.5, 2, 1, _now())).toThrow();
        });

        test('active CHECK 0/1 enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_grounding_anchors
                (user_id, resolved_env, anchor_id, concept_name,
                 metric_name, threshold_min, threshold_max, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p132_a_bad_active', 'trend',
                'RSI', 30, 70, 5, _now())).toThrow();
        });

        test('grounding_status CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_grounding_checks
                (user_id, resolved_env, check_id, concept_name,
                 actual_metrics_json, matched_anchors_count,
                 total_anchors_count, grounding_score,
                 grounding_status, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p132_c_bad_status', 'trend',
                '{}', 1, 2, 0.5, 'BOGUS', _now())).toThrow();
        });

        test('grounding_score CHECK range enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_grounding_checks
                (user_id, resolved_env, check_id, concept_name,
                 actual_metrics_json, matched_anchors_count,
                 total_anchors_count, grounding_score,
                 grounding_status, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p132_c_bad_score', 'trend',
                '{}', 1, 2, 1.5, 'partial_grounded', _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('GROUNDING_STATUSES frozen 3 entries', () => {
            expect(M.GROUNDING_STATUSES).toEqual([
                'well_grounded', 'partial_grounded', 'rhetorical'
            ]);
            expect(Object.isFrozen(M.GROUNDING_STATUSES)).toBe(true);
        });

        test('GROUNDING_THRESHOLDS ordered', () => {
            expect(M.GROUNDING_THRESHOLDS.well).toBe(0.80);
            expect(M.GROUNDING_THRESHOLDS.partial).toBe(0.40);
            expect(M.GROUNDING_THRESHOLDS.partial)
                .toBeLessThan(M.GROUNDING_THRESHOLDS.well);
        });

        test('DECISION_PENALTY map 3 statuses', () => {
            expect(M.DECISION_PENALTY.well_grounded).toBe(0);
            expect(M.DECISION_PENALTY.partial_grounded).toBe(0.25);
            expect(M.DECISION_PENALTY.rhetorical).toBe(0.75);
        });

        test('DRIFT_THRESHOLD = 0.30', () => {
            expect(M.DRIFT_THRESHOLD).toBe(0.30);
        });
    });

    describe('evaluateAnchor (pure)', () => {
        test('both bounds, value inside → true', () => {
            const r = M.evaluateAnchor({
                thresholdMin: 30, thresholdMax: 70, actualValue: 50
            });
            expect(r.matched).toBe(true);
        });

        test('both bounds, value below → false', () => {
            const r = M.evaluateAnchor({
                thresholdMin: 30, thresholdMax: 70, actualValue: 20
            });
            expect(r.matched).toBe(false);
        });

        test('both bounds, value above → false', () => {
            const r = M.evaluateAnchor({
                thresholdMin: 30, thresholdMax: 70, actualValue: 80
            });
            expect(r.matched).toBe(false);
        });

        test('min only, value >= min → true', () => {
            const r = M.evaluateAnchor({
                thresholdMin: 30, thresholdMax: null, actualValue: 100
            });
            expect(r.matched).toBe(true);
        });

        test('max only, value <= max → true', () => {
            const r = M.evaluateAnchor({
                thresholdMin: null, thresholdMax: 70, actualValue: 30
            });
            expect(r.matched).toBe(true);
        });

        test('both null → throws (degenerate anchor)', () => {
            expect(() => M.evaluateAnchor({
                thresholdMin: null, thresholdMax: null, actualValue: 50
            })).toThrow(/threshold/);
        });
    });

    describe('computeGroundingScore (pure)', () => {
        test('matched/total ratio', () => {
            expect(M.computeGroundingScore({
                matchedCount: 3, totalCount: 4
            }).groundingScore).toBeCloseTo(0.75, 6);
        });

        test('all matched → 1.0', () => {
            expect(M.computeGroundingScore({
                matchedCount: 5, totalCount: 5
            }).groundingScore).toBe(1.0);
        });

        test('zero matched → 0', () => {
            expect(M.computeGroundingScore({
                matchedCount: 0, totalCount: 5
            }).groundingScore).toBe(0);
        });

        test('totalCount=0 → 0 (no anchors = no grounding)', () => {
            expect(M.computeGroundingScore({
                matchedCount: 0, totalCount: 0
            }).groundingScore).toBe(0);
        });
    });

    describe('classifyGrounding (pure)', () => {
        test('score ≥ 0.80 → well_grounded', () => {
            expect(M.classifyGrounding({ groundingScore: 0.85 })
                .groundingStatus).toBe('well_grounded');
        });

        test('score 0.40..0.80 → partial_grounded', () => {
            expect(M.classifyGrounding({ groundingScore: 0.60 })
                .groundingStatus).toBe('partial_grounded');
        });

        test('score < 0.40 → rhetorical', () => {
            expect(M.classifyGrounding({ groundingScore: 0.20 })
                .groundingStatus).toBe('rhetorical');
        });

        test('exact 0.80 boundary → well_grounded', () => {
            expect(M.classifyGrounding({ groundingScore: 0.80 })
                .groundingStatus).toBe('well_grounded');
        });

        test('exact 0.40 boundary → partial_grounded', () => {
            expect(M.classifyGrounding({ groundingScore: 0.40 })
                .groundingStatus).toBe('partial_grounded');
        });
    });

    describe('computeDecisionPenalty (pure)', () => {
        test('well_grounded → 0', () => {
            expect(M.computeDecisionPenalty({
                groundingStatus: 'well_grounded'
            }).penalty).toBe(0);
        });

        test('partial_grounded → 0.25', () => {
            expect(M.computeDecisionPenalty({
                groundingStatus: 'partial_grounded'
            }).penalty).toBe(0.25);
        });

        test('rhetorical → 0.75', () => {
            expect(M.computeDecisionPenalty({
                groundingStatus: 'rhetorical'
            }).penalty).toBe(0.75);
        });

        test('invalid status throws', () => {
            expect(() => M.computeDecisionPenalty({
                groundingStatus: 'BOGUS'
            })).toThrow(/invalid groundingStatus/);
        });
    });

    describe('detectSemanticDrift (pure)', () => {
        test('no drift when means are close', () => {
            const r = M.detectSemanticDrift({
                recentScores: [0.8, 0.85, 0.82],
                baselineScores: [0.81, 0.83, 0.80]
            });
            expect(r.driftDetected).toBe(false);
        });

        test('positive drift detected', () => {
            // baseline mean ≈ 0.30, recent ≈ 0.85 → delta = 0.55 ≥ 0.30
            const r = M.detectSemanticDrift({
                recentScores: [0.85, 0.85, 0.85],
                baselineScores: [0.30, 0.30, 0.30]
            });
            expect(r.driftDetected).toBe(true);
            expect(r.driftMagnitude).toBeCloseTo(0.55, 6);
        });

        test('negative drift detected', () => {
            const r = M.detectSemanticDrift({
                recentScores: [0.20, 0.25, 0.22],
                baselineScores: [0.85, 0.80, 0.82]
            });
            expect(r.driftDetected).toBe(true);
            expect(r.driftMagnitude).toBeGreaterThanOrEqual(0.30);
        });

        test('empty arrays → no drift', () => {
            const r = M.detectSemanticDrift({
                recentScores: [], baselineScores: []
            });
            expect(r.driftDetected).toBe(false);
        });
    });

    describe('registerAnchor', () => {
        test('persists anchor with both bounds', () => {
            const r = M.registerAnchor({
                userId: UID, resolvedEnv: ENV,
                anchorId: 'p132_reg_1',
                conceptName: 'trend_strong',
                metricName: 'RSI',
                thresholdMin: 60,
                thresholdMax: 90,
                ts: _now()
            });
            expect(r.registered).toBe(true);
        });

        test('persists anchor with min only', () => {
            const r = M.registerAnchor({
                userId: UID, resolvedEnv: ENV,
                anchorId: 'p132_reg_min_only',
                conceptName: 'volume_high',
                metricName: 'volume_24h',
                thresholdMin: 1000000,
                ts: _now()
            });
            expect(r.registered).toBe(true);
        });

        test('rejects anchor with no thresholds', () => {
            expect(() => M.registerAnchor({
                userId: UID, resolvedEnv: ENV,
                anchorId: 'p132_reg_bad',
                conceptName: 'trend',
                metricName: 'RSI',
                ts: _now()
            })).toThrow(/at least one threshold/);
        });

        test('duplicate anchorId throws', () => {
            M.registerAnchor({
                userId: UID, resolvedEnv: ENV,
                anchorId: 'p132_reg_dup',
                conceptName: 'c', metricName: 'm',
                thresholdMin: 10, ts: _now()
            });
            expect(() => M.registerAnchor({
                userId: UID, resolvedEnv: ENV,
                anchorId: 'p132_reg_dup',
                conceptName: 'c2', metricName: 'm2',
                thresholdMin: 20, ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('recordGroundingCheck (integration)', () => {
        test('all anchors match → well_grounded', () => {
            const u = UID_CHECK;
            // Register 3 anchors for "trend_strong"
            M.registerAnchor({
                userId: u, resolvedEnv: ENV,
                anchorId: 'p132_chk_a1',
                conceptName: 'trend_strong',
                metricName: 'RSI',
                thresholdMin: 60, thresholdMax: 90,
                ts: 1000
            });
            M.registerAnchor({
                userId: u, resolvedEnv: ENV,
                anchorId: 'p132_chk_a2',
                conceptName: 'trend_strong',
                metricName: 'ADX',
                thresholdMin: 25,
                ts: 1001
            });
            M.registerAnchor({
                userId: u, resolvedEnv: ENV,
                anchorId: 'p132_chk_a3',
                conceptName: 'trend_strong',
                metricName: 'volume_ratio',
                thresholdMin: 1.5,
                ts: 1002
            });

            const r = M.recordGroundingCheck({
                userId: u, resolvedEnv: ENV,
                checkId: 'p132_chk_well',
                conceptName: 'trend_strong',
                actualMetrics: { RSI: 75, ADX: 30, volume_ratio: 2.0 },
                ts: 2000
            });
            expect(r.groundingStatus).toBe('well_grounded');
            expect(r.matchedCount).toBe(3);
            expect(r.totalCount).toBe(3);
            expect(r.groundingScore).toBe(1.0);
        });

        test('partial match → partial_grounded', () => {
            const u = UID_CHECK;
            M.registerAnchor({
                userId: u, resolvedEnv: ENV,
                anchorId: 'p132_chk_p1',
                conceptName: 'squeeze',
                metricName: 'BB_width',
                thresholdMin: null, thresholdMax: 0.05,
                ts: 1000
            });
            M.registerAnchor({
                userId: u, resolvedEnv: ENV,
                anchorId: 'p132_chk_p2',
                conceptName: 'squeeze',
                metricName: 'ATR',
                thresholdMax: 0.5,
                ts: 1001
            });
            // 1 of 2 matches → score 0.5 → partial (≥0.40, <0.80)
            const r = M.recordGroundingCheck({
                userId: u, resolvedEnv: ENV,
                checkId: 'p132_chk_partial',
                conceptName: 'squeeze',
                actualMetrics: { BB_width: 0.03, ATR: 1.5 },
                ts: 2000
            });
            expect(r.groundingStatus).toBe('partial_grounded');
            expect(r.matchedCount).toBe(1);
            expect(r.totalCount).toBe(2);
        });

        test('no anchors match → rhetorical', () => {
            const u = UID_CHECK;
            M.registerAnchor({
                userId: u, resolvedEnv: ENV,
                anchorId: 'p132_chk_r1',
                conceptName: 'toxic',
                metricName: 'OFI',
                thresholdMin: 0.8,
                ts: 1000
            });
            const r = M.recordGroundingCheck({
                userId: u, resolvedEnv: ENV,
                checkId: 'p132_chk_rhet',
                conceptName: 'toxic',
                actualMetrics: { OFI: 0.2 },
                ts: 2000
            });
            expect(r.groundingStatus).toBe('rhetorical');
            expect(r.matchedCount).toBe(0);
        });

        test('concept with zero anchors → rhetorical', () => {
            const u = UID_CHECK;
            const r = M.recordGroundingCheck({
                userId: u, resolvedEnv: ENV,
                checkId: 'p132_chk_noanch',
                conceptName: 'undefined_concept',
                actualMetrics: { something: 42 },
                ts: 2000
            });
            expect(r.groundingStatus).toBe('rhetorical');
            expect(r.totalCount).toBe(0);
        });

        test('inactive anchors are ignored', () => {
            const u = UID_CHECK;
            // Active anchor matching
            M.registerAnchor({
                userId: u, resolvedEnv: ENV,
                anchorId: 'p132_chk_active',
                conceptName: 'fragile',
                metricName: 'spread',
                thresholdMax: 0.5,
                ts: 1000
            });
            // Inactive anchor that would NOT match (would lower score)
            db.prepare(`
                INSERT INTO ml_grounding_anchors
                (user_id, resolved_env, anchor_id, concept_name,
                 metric_name, threshold_min, threshold_max, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(u, ENV, 'p132_chk_inactive', 'fragile',
                'depth', 100, null, 0, _now());

            const r = M.recordGroundingCheck({
                userId: u, resolvedEnv: ENV,
                checkId: 'p132_chk_ignore_inactive',
                conceptName: 'fragile',
                actualMetrics: { spread: 0.3, depth: 50 },
                ts: 3000
            });
            // Only 1 active anchor, matched → score 1.0
            expect(r.groundingStatus).toBe('well_grounded');
            expect(r.totalCount).toBe(1);
        });

        test('duplicate checkId throws', () => {
            const u = UID_CHECK;
            M.registerAnchor({
                userId: u, resolvedEnv: ENV,
                anchorId: 'p132_dup_anc',
                conceptName: 'dup_concept',
                metricName: 'm', thresholdMin: 0, ts: 1000
            });
            M.recordGroundingCheck({
                userId: u, resolvedEnv: ENV,
                checkId: 'p132_chk_dup',
                conceptName: 'dup_concept',
                actualMetrics: { m: 5 }, ts: 2000
            });
            expect(() => M.recordGroundingCheck({
                userId: u, resolvedEnv: ENV,
                checkId: 'p132_chk_dup',
                conceptName: 'dup_concept',
                actualMetrics: { m: 6 }, ts: 3000
            })).toThrow(/duplicate/);
        });
    });

    describe('getConceptHistory', () => {
        test('returns checks ASC by ts with limit', () => {
            const u = UID_HISTORY;
            M.registerAnchor({
                userId: u, resolvedEnv: ENV,
                anchorId: 'p132_h_anc',
                conceptName: 'hist_concept',
                metricName: 'm', thresholdMin: 10, ts: 1000
            });
            M.recordGroundingCheck({
                userId: u, resolvedEnv: ENV,
                checkId: 'p132_h_c1',
                conceptName: 'hist_concept',
                actualMetrics: { m: 20 }, ts: 2000
            });
            M.recordGroundingCheck({
                userId: u, resolvedEnv: ENV,
                checkId: 'p132_h_c2',
                conceptName: 'hist_concept',
                actualMetrics: { m: 5 }, ts: 3000
            });
            const rows = M.getConceptHistory({
                userId: u, resolvedEnv: ENV,
                conceptName: 'hist_concept', limit: 10
            });
            expect(rows.length).toBe(2);
            expect(rows[0].checkId).toBe('p132_h_c1');
            expect(rows[1].checkId).toBe('p132_h_c2');
        });
    });

    describe('detectConceptDrift (integration)', () => {
        test('detects drift over time', () => {
            const u = UID_DRIFT;
            M.registerAnchor({
                userId: u, resolvedEnv: ENV,
                anchorId: 'p132_d_anc1',
                conceptName: 'drift_concept',
                metricName: 'm', thresholdMin: 50,
                ts: 100
            });

            // 3 well-grounded checks (score 1.0)
            for (let i = 0; i < 3; i++) {
                M.recordGroundingCheck({
                    userId: u, resolvedEnv: ENV,
                    checkId: `p132_d_baseline_${i}`,
                    conceptName: 'drift_concept',
                    actualMetrics: { m: 100 },
                    ts: 1000 + i * 100
                });
            }
            // 3 rhetorical checks (score 0)
            for (let i = 0; i < 3; i++) {
                M.recordGroundingCheck({
                    userId: u, resolvedEnv: ENV,
                    checkId: `p132_d_recent_${i}`,
                    conceptName: 'drift_concept',
                    actualMetrics: { m: 10 },
                    ts: 5000 + i * 100
                });
            }
            const r = M.detectConceptDrift({
                userId: u, resolvedEnv: ENV,
                conceptName: 'drift_concept',
                windowSize: 3
            });
            expect(r.driftDetected).toBe(true);
            expect(r.driftMagnitude).toBeGreaterThanOrEqual(0.30);
        });

        test('returns no drift when insufficient data', () => {
            const u = UID_DRIFT;
            M.registerAnchor({
                userId: u, resolvedEnv: ENV,
                anchorId: 'p132_d_anc2',
                conceptName: 'low_data_concept',
                metricName: 'm', thresholdMin: 0,
                ts: 100
            });
            M.recordGroundingCheck({
                userId: u, resolvedEnv: ENV,
                checkId: 'p132_d_only_1',
                conceptName: 'low_data_concept',
                actualMetrics: { m: 5 }, ts: 200
            });
            const r = M.detectConceptDrift({
                userId: u, resolvedEnv: ENV,
                conceptName: 'low_data_concept',
                windowSize: 3
            });
            expect(r.driftDetected).toBe(false);
            expect(r.reason).toMatch(/insufficient/);
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B checks', () => {
            M.registerAnchor({
                userId: UID_ISO_A, resolvedEnv: ENV,
                anchorId: 'p132_iso_a_anc',
                conceptName: 'iso_concept',
                metricName: 'm', thresholdMin: 0, ts: 100
            });
            M.registerAnchor({
                userId: UID_ISO_B, resolvedEnv: ENV,
                anchorId: 'p132_iso_b_anc',
                conceptName: 'iso_concept',
                metricName: 'm', thresholdMin: 0, ts: 100
            });
            M.recordGroundingCheck({
                userId: UID_ISO_A, resolvedEnv: ENV,
                checkId: 'p132_iso_chk_a',
                conceptName: 'iso_concept',
                actualMetrics: { m: 5 }, ts: 200
            });
            M.recordGroundingCheck({
                userId: UID_ISO_B, resolvedEnv: ENV,
                checkId: 'p132_iso_chk_b',
                conceptName: 'iso_concept',
                actualMetrics: { m: 10 }, ts: 200
            });
            const rows = M.getConceptHistory({
                userId: UID_ISO_A, resolvedEnv: ENV,
                conceptName: 'iso_concept', limit: 10
            });
            expect(rows.every(r => r.checkId !== 'p132_iso_chk_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.registerAnchor({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                anchorId: 'p132_env_anc_demo',
                conceptName: 'env_concept',
                metricName: 'm', thresholdMin: 0, ts: 100
            });
            M.registerAnchor({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                anchorId: 'p132_env_anc_testnet',
                conceptName: 'env_concept',
                metricName: 'm', thresholdMin: 0, ts: 100
            });
            M.recordGroundingCheck({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                checkId: 'p132_env_chk_demo',
                conceptName: 'env_concept',
                actualMetrics: { m: 5 }, ts: 200
            });
            M.recordGroundingCheck({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                checkId: 'p132_env_chk_testnet',
                conceptName: 'env_concept',
                actualMetrics: { m: 10 }, ts: 200
            });
            const rows = M.getConceptHistory({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                conceptName: 'env_concept', limit: 10
            });
            expect(rows.every(r => r.checkId !== 'p132_env_chk_testnet')).toBe(true);
        });
    });
});
