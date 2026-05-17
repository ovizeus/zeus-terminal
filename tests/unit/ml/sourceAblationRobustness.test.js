'use strict';

/**
 * OMEGA §153 SOURCE ABLATION ROBUSTNESS / BELIEF-SURVIVES-DELETION TEST.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5087-5129.
 *
 * "daca pierd exact dovezile pe care ma bazez cel mai mult,
 *  credinta mea mai are coloana?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p153-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_audit/sourceAblationRobustness');

const UID = 9153;
const UID_T = 9253;
const UID_S = 9353;
const UID_GET = 9453;
const UID_ISO_A = 9553;
const UID_ISO_B = 9653;
const UID_ENV = 9753;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_T, UID_S, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_belief_fragility_snapshots WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_belief_ablation_tests WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §153 SOURCE ABLATION ROBUSTNESS', () => {

    describe('Migrations 304+305', () => {
        test('304 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('304_ml_belief_ablation_tests')).toBeTruthy();
        });
        test('305 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('305_ml_belief_fragility_snapshots')).toBeTruthy();
        });
        test('ablation_category CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_belief_ablation_tests
                (user_id, resolved_env, test_id, belief_id, original_support_score,
                 supporting_sources_json, ablation_category, ablated_source_label,
                 post_ablation_support_score, survival_score, classification, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_bk', 'b1', 0.8, '[]', 'BOGUS', 'src',
                    0.5, 0.625, 'robust', _now())).toThrow();
        });
        test('classification CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_belief_ablation_tests
                (user_id, resolved_env, test_id, belief_id, original_support_score,
                 supporting_sources_json, ablation_category, ablated_source_label,
                 post_ablation_support_score, survival_score, classification, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_cl', 'b1', 0.8, '[]', 'top_source', 'src',
                    0.5, 0.625, 'BOGUS', _now())).toThrow();
        });
        test('test_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_belief_ablation_tests
                (user_id, resolved_env, test_id, belief_id, original_support_score,
                 supporting_sources_json, ablation_category, ablated_source_label,
                 post_ablation_support_score, survival_score, classification, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 't_dup', 'b1', 0.8, '[]', 'top_source', 'src',
                0.5, 0.625, 'robust', _now());
            expect(() => stmt.run(UID, ENV, 't_dup', 'b2', 0.7, '[]',
                'top_detector', 's2', 0.3, 0.43, 'brittle', _now())).toThrow();
        });
        test('snapshot_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_belief_fragility_snapshots
                (user_id, resolved_env, snapshot_id, belief_id,
                 ablation_tests_count, mean_survival_score, min_survival_score,
                 max_single_source_dependency, captured_by_source_label,
                 classification, boldness_penalty, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 's_dup', 'b1', 3, 0.6, 0.4, 0.5,
                null, 'robust', 0, _now());
            expect(() => stmt.run(UID, ENV, 's_dup', 'b2', 5, 0.5, 0.2, 0.8,
                'sourceX', 'source_captured', 0.5, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('ABLATION_CATEGORIES frozen 5 (canonical PDF list)', () => {
            expect(M.ABLATION_CATEGORIES).toEqual([
                'top_source', 'top_detector', 'top_venue',
                'top_macro', 'top_concept'
            ]);
            expect(Object.isFrozen(M.ABLATION_CATEGORIES)).toBe(true);
        });
        test('BELIEF_CLASSIFICATIONS frozen 3', () => {
            expect(M.BELIEF_CLASSIFICATIONS).toEqual([
                'robust', 'brittle', 'source_captured'
            ]);
            expect(Object.isFrozen(M.BELIEF_CLASSIFICATIONS)).toBe(true);
        });
        test('ROBUST_MIN_SURVIVAL = 0.70', () => {
            expect(M.ROBUST_MIN_SURVIVAL).toBe(0.70);
        });
        test('BRITTLE_MAX_SURVIVAL = 0.30', () => {
            expect(M.BRITTLE_MAX_SURVIVAL).toBe(0.30);
        });
        test('SOURCE_CAPTURED_MIN_DEPENDENCY = 0.60', () => {
            expect(M.SOURCE_CAPTURED_MIN_DEPENDENCY).toBe(0.60);
        });
        test('BOLDNESS_PENALTY_MAP per classification', () => {
            expect(M.BOLDNESS_PENALTY_MAP.robust).toBe(0);
            expect(M.BOLDNESS_PENALTY_MAP.brittle).toBe(0.50);
            expect(M.BOLDNESS_PENALTY_MAP.source_captured).toBe(0.70);
        });
    });

    describe('computeSurvivalScore (pure)', () => {
        test('post = original → survival 1.0 (full survival)', () => {
            const r = M.computeSurvivalScore({
                originalSupport: 0.80, postAblationSupport: 0.80
            });
            expect(r.survivalScore).toBeCloseTo(1, 5);
        });
        test('post = 0 → survival 0 (full collapse)', () => {
            const r = M.computeSurvivalScore({
                originalSupport: 0.80, postAblationSupport: 0
            });
            expect(r.survivalScore).toBe(0);
        });
        test('post = 0.50 * original → survival 0.50', () => {
            const r = M.computeSurvivalScore({
                originalSupport: 0.80, postAblationSupport: 0.40
            });
            expect(r.survivalScore).toBeCloseTo(0.50, 5);
        });
        test('original=0 → survival 1 (degenerate but defined)', () => {
            // No support to lose — survival is vacuously full
            const r = M.computeSurvivalScore({
                originalSupport: 0, postAblationSupport: 0
            });
            expect(r.survivalScore).toBe(1);
        });
        test('post > original (rare — ablation REVEALED hidden support) clamps to 1', () => {
            const r = M.computeSurvivalScore({
                originalSupport: 0.40, postAblationSupport: 0.60
            });
            expect(r.survivalScore).toBe(1);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeSurvivalScore({
                originalSupport: 1.5, postAblationSupport: 0.5
            })).toThrow();
        });
    });

    describe('classifyBeliefRobustness (pure)', () => {
        test('high survival + low max dependency → robust', () => {
            const r = M.classifyBeliefRobustness({
                survivalScore: 0.85, maxSingleSourceDependency: 0.30
            });
            expect(r.classification).toBe('robust');
        });
        test('low survival → brittle (regardless of dependency)', () => {
            const r = M.classifyBeliefRobustness({
                survivalScore: 0.20, maxSingleSourceDependency: 0.30
            });
            expect(r.classification).toBe('brittle');
        });
        test('high dependency on single source → source_captured', () => {
            const r = M.classifyBeliefRobustness({
                survivalScore: 0.50, maxSingleSourceDependency: 0.75
            });
            expect(r.classification).toBe('source_captured');
        });
        test('source_captured takes priority over brittle', () => {
            // Both conditions true → source_captured (more diagnostic)
            const r = M.classifyBeliefRobustness({
                survivalScore: 0.15, maxSingleSourceDependency: 0.80
            });
            expect(r.classification).toBe('source_captured');
        });
        test('middle band (no clear classification fits) → brittle by default', () => {
            // survival 0.50, dependency 0.40 — neither robust nor captured
            const r = M.classifyBeliefRobustness({
                survivalScore: 0.50, maxSingleSourceDependency: 0.40
            });
            expect(r.classification).toBe('brittle');
        });
        test('boundary survival 0.70 + low dependency → robust', () => {
            const r = M.classifyBeliefRobustness({
                survivalScore: 0.70, maxSingleSourceDependency: 0.30
            });
            expect(r.classification).toBe('robust');
        });
        test('boundary survival 0.30 → brittle', () => {
            const r = M.classifyBeliefRobustness({
                survivalScore: 0.30, maxSingleSourceDependency: 0.30
            });
            expect(r.classification).toBe('brittle');
        });
    });

    describe('computeBoldnessPenalty (pure)', () => {
        test('robust → 0 penalty', () => {
            expect(M.computeBoldnessPenalty({ classification: 'robust' }).penalty).toBe(0);
        });
        test('brittle → 0.50 penalty', () => {
            expect(M.computeBoldnessPenalty({ classification: 'brittle' }).penalty).toBe(0.50);
        });
        test('source_captured → 0.70 penalty (heaviest)', () => {
            expect(M.computeBoldnessPenalty({ classification: 'source_captured' }).penalty).toBe(0.70);
        });
        test('invalid throws', () => {
            expect(() => M.computeBoldnessPenalty({ classification: 'BOGUS' })).toThrow();
        });
    });

    describe('recordAblationTest', () => {
        test('persists test with auto-computed survival + classification', () => {
            const r = M.recordAblationTest({
                userId: UID_T, resolvedEnv: ENV,
                testId: 'rat_1', beliefId: 'belief_breakout_valid',
                originalSupportScore: 0.80,
                supportingSources: [
                    { source: 'cvd', weight: 0.40 },
                    { source: 'orderflow', weight: 0.25 },
                    { source: 'macro', weight: 0.15 },
                    { source: 'level_recheck', weight: 0.20 }
                ],
                ablationCategory: 'top_source',
                ablatedSourceLabel: 'cvd',
                postAblationSupportScore: 0.45,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.survivalScore).toBeCloseTo(0.5625, 4);
            // 0.45/0.80 = 0.5625 — middle band, max dep 0.40 < 0.60
            expect(r.classification).toBe('brittle');
        });
        test('strong belief survives → robust classification', () => {
            const r = M.recordAblationTest({
                userId: UID_T, resolvedEnv: ENV,
                testId: 'rat_2', beliefId: 'belief_robust',
                originalSupportScore: 0.80,
                supportingSources: [
                    { source: 'a', weight: 0.25 },
                    { source: 'b', weight: 0.25 },
                    { source: 'c', weight: 0.25 },
                    { source: 'd', weight: 0.25 }
                ],
                ablationCategory: 'top_source',
                ablatedSourceLabel: 'a',
                postAblationSupportScore: 0.65,
                ts: _now()
            });
            expect(r.survivalScore).toBeGreaterThanOrEqual(0.70);
            expect(r.classification).toBe('robust');
        });
        test('captured belief → source_captured', () => {
            const r = M.recordAblationTest({
                userId: UID_T, resolvedEnv: ENV,
                testId: 'rat_3', beliefId: 'belief_captured',
                originalSupportScore: 0.80,
                supportingSources: [
                    { source: 'dominant_source', weight: 0.80 },
                    { source: 'b', weight: 0.10 },
                    { source: 'c', weight: 0.10 }
                ],
                ablationCategory: 'top_source',
                ablatedSourceLabel: 'dominant_source',
                postAblationSupportScore: 0.15,
                ts: _now()
            });
            expect(r.classification).toBe('source_captured');
        });
        test('invalid ablation category throws', () => {
            expect(() => M.recordAblationTest({
                userId: UID_T, resolvedEnv: ENV,
                testId: 'rat_bad', beliefId: 'b',
                originalSupportScore: 0.5,
                supportingSources: [{ source: 's', weight: 1 }],
                ablationCategory: 'BOGUS',
                ablatedSourceLabel: 's',
                postAblationSupportScore: 0.3,
                ts: _now()
            })).toThrow();
        });
        test('duplicate testId throws', () => {
            M.recordAblationTest({
                userId: UID_T, resolvedEnv: ENV,
                testId: 'rat_dup', beliefId: 'b',
                originalSupportScore: 0.5,
                supportingSources: [{ source: 's', weight: 1 }],
                ablationCategory: 'top_source',
                ablatedSourceLabel: 's',
                postAblationSupportScore: 0.3,
                ts: _now()
            });
            expect(() => M.recordAblationTest({
                userId: UID_T, resolvedEnv: ENV,
                testId: 'rat_dup', beliefId: 'b',
                originalSupportScore: 0.5,
                supportingSources: [{ source: 's', weight: 1 }],
                ablationCategory: 'top_source',
                ablatedSourceLabel: 's',
                postAblationSupportScore: 0.3,
                ts: _now()
            })).toThrow(/duplicate/);
        });
        test('supportingSources must be array', () => {
            expect(() => M.recordAblationTest({
                userId: UID_T, resolvedEnv: ENV,
                testId: 'rat_arr', beliefId: 'b',
                originalSupportScore: 0.5,
                supportingSources: 'not an array',
                ablationCategory: 'top_source',
                ablatedSourceLabel: 's',
                postAblationSupportScore: 0.3,
                ts: _now()
            })).toThrow(/array/i);
        });
        test('out-of-range support score throws', () => {
            expect(() => M.recordAblationTest({
                userId: UID_T, resolvedEnv: ENV,
                testId: 'rat_br', beliefId: 'b',
                originalSupportScore: 1.5,
                supportingSources: [{ source: 's', weight: 1 }],
                ablationCategory: 'top_source',
                ablatedSourceLabel: 's',
                postAblationSupportScore: 0.3,
                ts: _now()
            })).toThrow();
        });
    });

    describe('recordFragilitySnapshot (integration)', () => {
        function _seedTests(uid, beliefId, configs) {
            for (let i = 0; i < configs.length; i++) {
                const c = configs[i];
                M.recordAblationTest({
                    userId: uid, resolvedEnv: ENV,
                    testId: `seed_${beliefId}_${i}_${Date.now()}`,
                    beliefId,
                    originalSupportScore: c.original ?? 0.80,
                    supportingSources: c.sources,
                    ablationCategory: c.category ?? 'top_source',
                    ablatedSourceLabel: c.ablated,
                    postAblationSupportScore: c.post,
                    ts: _now() + i
                });
            }
        }
        test('aggregates across multiple ablation tests for a belief', () => {
            const sources = [
                { source: 'a', weight: 0.25 },
                { source: 'b', weight: 0.25 },
                { source: 'c', weight: 0.25 },
                { source: 'd', weight: 0.25 }
            ];
            _seedTests(UID_S, 'b_agg', [
                { sources, ablated: 'a', post: 0.65, category: 'top_source' },
                { sources, ablated: 'b', post: 0.62, category: 'top_detector' },
                { sources, ablated: 'c', post: 0.60, category: 'top_venue' }
            ]);
            const r = M.recordFragilitySnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'snap_agg',
                beliefId: 'b_agg',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.ablationTestsCount).toBe(3);
            expect(r.classification).toBe('robust');
            expect(r.boldnessPenalty).toBe(0);
            expect(r.capturedBySourceLabel).toBeNull();
        });
        test('source_captured if top dominant source ablation killed it', () => {
            _seedTests(UID_S, 'b_cap', [
                {
                    sources: [
                        { source: 'whale_alert', weight: 0.80 },
                        { source: 'b', weight: 0.20 }
                    ],
                    ablated: 'whale_alert', post: 0.10, category: 'top_source'
                }
            ]);
            const r = M.recordFragilitySnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'snap_cap',
                beliefId: 'b_cap',
                ts: _now()
            });
            expect(r.classification).toBe('source_captured');
            expect(r.capturedBySourceLabel).toBe('whale_alert');
            expect(r.maxSingleSourceDependency).toBeCloseTo(0.80, 5);
            expect(r.boldnessPenalty).toBe(0.70);
        });
        test('throws if no ablation tests exist for belief', () => {
            expect(() => M.recordFragilitySnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'snap_none',
                beliefId: 'belief_with_no_tests',
                ts: _now()
            })).toThrow(/no.*ablation|tests.*required/i);
        });
        test('duplicate snapshotId throws', () => {
            _seedTests(UID_S, 'b_dup', [
                { sources: [{ source: 's', weight: 1 }],
                  ablated: 's', post: 0.5, category: 'top_source' }
            ]);
            M.recordFragilitySnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'snap_dup', beliefId: 'b_dup', ts: _now()
            });
            expect(() => M.recordFragilitySnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'snap_dup', beliefId: 'b_dup', ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getAblationTestsForBelief & getLatestFragilitySnapshot', () => {
        test('getAblationTestsForBelief returns all tests', () => {
            M.recordAblationTest({
                userId: UID_GET, resolvedEnv: ENV,
                testId: 'ga_1', beliefId: 'gb_1',
                originalSupportScore: 0.5,
                supportingSources: [{ source: 's', weight: 1 }],
                ablationCategory: 'top_source',
                ablatedSourceLabel: 's',
                postAblationSupportScore: 0.3, ts: _now()
            });
            M.recordAblationTest({
                userId: UID_GET, resolvedEnv: ENV,
                testId: 'ga_2', beliefId: 'gb_1',
                originalSupportScore: 0.5,
                supportingSources: [{ source: 's', weight: 1 }],
                ablationCategory: 'top_detector',
                ablatedSourceLabel: 's',
                postAblationSupportScore: 0.4, ts: _now()
            });
            const r = M.getAblationTestsForBelief({
                userId: UID_GET, resolvedEnv: ENV,
                beliefId: 'gb_1'
            });
            expect(r.length).toBe(2);
        });
        test('getLatestFragilitySnapshot returns most recent', () => {
            M.recordAblationTest({
                userId: UID_GET, resolvedEnv: ENV,
                testId: 'gl_t1', beliefId: 'gb_l',
                originalSupportScore: 0.5,
                supportingSources: [{ source: 's', weight: 1 }],
                ablationCategory: 'top_source',
                ablatedSourceLabel: 's',
                postAblationSupportScore: 0.4, ts: 1000
            });
            M.recordFragilitySnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gl_s1', beliefId: 'gb_l', ts: 2000
            });
            M.recordFragilitySnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gl_s2', beliefId: 'gb_l', ts: 3000
            });
            const r = M.getLatestFragilitySnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                beliefId: 'gb_l'
            });
            expect(r.snapshotId).toBe('gl_s2');
        });
        test('getLatestFragilitySnapshot returns null when none', () => {
            expect(M.getLatestFragilitySnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                beliefId: 'gb_nope'
            })).toBeNull();
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordAblationTest({
                userId: UID_ISO_A, resolvedEnv: ENV,
                testId: 'iso_a', beliefId: 'b_iso',
                originalSupportScore: 0.5,
                supportingSources: [{ source: 's', weight: 1 }],
                ablationCategory: 'top_source',
                ablatedSourceLabel: 's',
                postAblationSupportScore: 0.4, ts: _now()
            });
            M.recordAblationTest({
                userId: UID_ISO_B, resolvedEnv: ENV,
                testId: 'iso_b', beliefId: 'b_iso',
                originalSupportScore: 0.5,
                supportingSources: [{ source: 's', weight: 1 }],
                ablationCategory: 'top_source',
                ablatedSourceLabel: 's',
                postAblationSupportScore: 0.4, ts: _now()
            });
            const a = M.getAblationTestsForBelief({
                userId: UID_ISO_A, resolvedEnv: ENV,
                beliefId: 'b_iso'
            });
            expect(a.every(t => t.testId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordAblationTest({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                testId: 'env_d', beliefId: 'b_env',
                originalSupportScore: 0.5,
                supportingSources: [{ source: 's', weight: 1 }],
                ablationCategory: 'top_source',
                ablatedSourceLabel: 's',
                postAblationSupportScore: 0.4, ts: _now()
            });
            const testnet = M.getAblationTestsForBelief({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                beliefId: 'b_env'
            });
            expect(testnet).toEqual([]);
        });
    });
});
