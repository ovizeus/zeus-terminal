'use strict';

/**
 * OMEGA §142 METACOGNITIVE LOAD MONITOR.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 4709-4710.
 *
 * "complexitatea excesiva in momente de incertitudine inalta NU e
 *  intelepciune — e RISC"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p142-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/metacognitiveLoadMonitor');

const UID = 9142;
const UID_LATEST = 9242;
const UID_HIST = 9342;
const UID_DIST = 9442;
const UID_ISO_A = 9542;
const UID_ISO_B = 9642;
const UID_ENV = 9742;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_LATEST, UID_HIST, UID_DIST,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_metacognitive_load_assessments WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §142 METACOGNITIVE LOAD MONITOR', () => {

    describe('Migration 269', () => {
        test('269_ml_metacognitive_load_assessments migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('269_ml_metacognitive_load_assessments')).toBeTruthy();
        });

        test('assessment_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_metacognitive_load_assessments
                (user_id, resolved_env, assessment_id,
                 active_hypotheses_count, managed_positions_count,
                 degraded_modules_count, scenario_tree_depth,
                 belief_updates_queue_size, load_score,
                 cognitive_mode, intervention_applied, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p142_a_dup', 2, 1, 0, 2, 10, 0.2,
                'normal', 'none', _now());
            expect(() => stmt.run(UID, ENV, 'p142_a_dup', 8, 5, 3, 6, 80, 0.8,
                'overloaded', 'simple_rules_mode', _now())).toThrow();
        });

        test('cognitive_mode CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_metacognitive_load_assessments
                (user_id, resolved_env, assessment_id,
                 active_hypotheses_count, managed_positions_count,
                 degraded_modules_count, scenario_tree_depth,
                 belief_updates_queue_size, load_score,
                 cognitive_mode, intervention_applied, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p142_bad_mode', 2, 1, 0, 2, 10, 0.2,
                'BOGUS', 'none', _now())).toThrow();
        });

        test('intervention_applied CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_metacognitive_load_assessments
                (user_id, resolved_env, assessment_id,
                 active_hypotheses_count, managed_positions_count,
                 degraded_modules_count, scenario_tree_depth,
                 belief_updates_queue_size, load_score,
                 cognitive_mode, intervention_applied, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p142_bad_int', 2, 1, 0, 2, 10, 0.2,
                'normal', 'BOGUS', _now())).toThrow();
        });

        test('load_score CHECK range enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_metacognitive_load_assessments
                (user_id, resolved_env, assessment_id,
                 active_hypotheses_count, managed_positions_count,
                 degraded_modules_count, scenario_tree_depth,
                 belief_updates_queue_size, load_score,
                 cognitive_mode, intervention_applied, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p142_bad_score',
                2, 1, 0, 2, 10, 1.5,
                'normal', 'none', _now())).toThrow();
        });

        test('counts CHECK ≥ 0 enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_metacognitive_load_assessments
                (user_id, resolved_env, assessment_id,
                 active_hypotheses_count, managed_positions_count,
                 degraded_modules_count, scenario_tree_depth,
                 belief_updates_queue_size, load_score,
                 cognitive_mode, intervention_applied, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p142_bad_count',
                -1, 1, 0, 2, 10, 0.2,
                'normal', 'none', _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('COGNITIVE_MODES frozen 3 entries', () => {
            expect(M.COGNITIVE_MODES).toEqual([
                'normal', 'elevated', 'overloaded'
            ]);
            expect(Object.isFrozen(M.COGNITIVE_MODES)).toBe(true);
        });

        test('INTERVENTIONS frozen 3 entries', () => {
            expect(M.INTERVENTIONS).toEqual([
                'none', 'simplify_hypotheses', 'simple_rules_mode'
            ]);
            expect(Object.isFrozen(M.INTERVENTIONS)).toBe(true);
        });

        test('LOAD_THRESHOLDS ordered', () => {
            expect(M.LOAD_THRESHOLDS.overloaded).toBe(0.75);
            expect(M.LOAD_THRESHOLDS.elevated).toBe(0.45);
            expect(M.LOAD_THRESHOLDS.elevated)
                .toBeLessThan(M.LOAD_THRESHOLDS.overloaded);
        });

        test('INPUT_NORM_THRESHOLDS has all 5 axes', () => {
            expect(M.INPUT_NORM_THRESHOLDS.active_hypotheses).toBe(10);
            expect(M.INPUT_NORM_THRESHOLDS.managed_positions).toBe(8);
            expect(M.INPUT_NORM_THRESHOLDS.degraded_modules).toBe(5);
            expect(M.INPUT_NORM_THRESHOLDS.scenario_tree_depth).toBe(8);
            expect(M.INPUT_NORM_THRESHOLDS.belief_updates_queue).toBe(100);
        });

        test('INPUT_WEIGHTS sum to 1.0', () => {
            const sum = Object.values(M.INPUT_WEIGHTS)
                .reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0, 6);
        });

        test('MAX_HYPOTHESES_IN_SIMPLE_RULES = 2 (per PDF)', () => {
            expect(M.MAX_HYPOTHESES_IN_SIMPLE_RULES).toBe(2);
        });
    });

    describe('computeLoadScore (pure)', () => {
        test('all-zero signals → 0', () => {
            const r = M.computeLoadScore({
                activeHypotheses: 0,
                managedPositions: 0,
                degradedModules: 0,
                scenarioTreeDepth: 0,
                beliefUpdatesQueueSize: 0
            });
            expect(r.loadScore).toBe(0);
        });

        test('all-max signals → 1.0', () => {
            const r = M.computeLoadScore({
                activeHypotheses: 20,
                managedPositions: 16,
                degradedModules: 10,
                scenarioTreeDepth: 16,
                beliefUpdatesQueueSize: 200
            });
            expect(r.loadScore).toBe(1.0);
        });

        test('signals at threshold → 1.0 normalized', () => {
            const r = M.computeLoadScore({
                activeHypotheses: 10,
                managedPositions: 8,
                degradedModules: 5,
                scenarioTreeDepth: 8,
                beliefUpdatesQueueSize: 100
            });
            expect(r.loadScore).toBe(1.0);
        });

        test('only active_hypotheses at threshold → 0.25 (its weight)', () => {
            const r = M.computeLoadScore({
                activeHypotheses: 10,
                managedPositions: 0,
                degradedModules: 0,
                scenarioTreeDepth: 0,
                beliefUpdatesQueueSize: 0
            });
            expect(r.loadScore).toBeCloseTo(0.25, 6);
        });

        test('half threshold gives half weight', () => {
            const r = M.computeLoadScore({
                activeHypotheses: 5,  // half
                managedPositions: 0,
                degradedModules: 0,
                scenarioTreeDepth: 0,
                beliefUpdatesQueueSize: 0
            });
            // 0.5 × 0.25 = 0.125
            expect(r.loadScore).toBeCloseTo(0.125, 6);
        });

        test('combined elevated load', () => {
            // hypotheses 8/10 = 0.8 × 0.25 = 0.20
            // positions 4/8 = 0.5 × 0.20 = 0.10
            // degraded 2/5 = 0.4 × 0.20 = 0.08
            // belief_updates 50/100 = 0.5 × 0.20 = 0.10
            // scenario 4/8 = 0.5 × 0.15 = 0.075
            // total = 0.555
            const r = M.computeLoadScore({
                activeHypotheses: 8,
                managedPositions: 4,
                degradedModules: 2,
                scenarioTreeDepth: 4,
                beliefUpdatesQueueSize: 50
            });
            expect(r.loadScore).toBeCloseTo(0.555, 3);
        });

        test('negative count throws', () => {
            expect(() => M.computeLoadScore({
                activeHypotheses: -1,
                managedPositions: 0, degradedModules: 0,
                scenarioTreeDepth: 0, beliefUpdatesQueueSize: 0
            })).toThrow();
        });
    });

    describe('classifyCognitiveMode (pure)', () => {
        test('score < 0.45 → normal', () => {
            expect(M.classifyCognitiveMode({ loadScore: 0.30 })
                .cognitiveMode).toBe('normal');
        });

        test('score 0.45..0.75 → elevated', () => {
            expect(M.classifyCognitiveMode({ loadScore: 0.55 })
                .cognitiveMode).toBe('elevated');
        });

        test('score ≥ 0.75 → overloaded', () => {
            expect(M.classifyCognitiveMode({ loadScore: 0.85 })
                .cognitiveMode).toBe('overloaded');
        });

        test('boundary 0.45 → elevated', () => {
            expect(M.classifyCognitiveMode({ loadScore: 0.45 })
                .cognitiveMode).toBe('elevated');
        });

        test('boundary 0.75 → overloaded', () => {
            expect(M.classifyCognitiveMode({ loadScore: 0.75 })
                .cognitiveMode).toBe('overloaded');
        });

        test('out-of-range throws', () => {
            expect(() => M.classifyCognitiveMode({
                loadScore: 1.5
            })).toThrow();
        });
    });

    describe('selectIntervention (pure)', () => {
        test('normal → none', () => {
            expect(M.selectIntervention({
                cognitiveMode: 'normal'
            }).intervention).toBe('none');
        });

        test('elevated → simplify_hypotheses', () => {
            expect(M.selectIntervention({
                cognitiveMode: 'elevated'
            }).intervention).toBe('simplify_hypotheses');
        });

        test('overloaded → simple_rules_mode', () => {
            expect(M.selectIntervention({
                cognitiveMode: 'overloaded'
            }).intervention).toBe('simple_rules_mode');
        });

        test('invalid mode throws', () => {
            expect(() => M.selectIntervention({
                cognitiveMode: 'BOGUS'
            })).toThrow(/invalid cognitiveMode/);
        });
    });

    describe('recommendedActiveHypothesesLimit (pure)', () => {
        test('normal → very large limit (effectively no limit)', () => {
            const r = M.recommendedActiveHypothesesLimit({
                cognitiveMode: 'normal'
            });
            expect(r.limit).toBeGreaterThanOrEqual(1000);
        });

        test('elevated → 5', () => {
            expect(M.recommendedActiveHypothesesLimit({
                cognitiveMode: 'elevated'
            }).limit).toBe(5);
        });

        test('overloaded → 2 (per PDF)', () => {
            expect(M.recommendedActiveHypothesesLimit({
                cognitiveMode: 'overloaded'
            }).limit).toBe(2);
        });
    });

    describe('recordLoadAssessment (integration)', () => {
        test('low load → normal + none intervention', () => {
            const r = M.recordLoadAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p142_rec_normal',
                activeHypotheses: 2,
                managedPositions: 1,
                degradedModules: 0,
                scenarioTreeDepth: 2,
                beliefUpdatesQueueSize: 5,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.cognitiveMode).toBe('normal');
            expect(r.intervention).toBe('none');
        });

        test('mid load → elevated + simplify_hypotheses', () => {
            // tuned to hit elevated band [0.45, 0.75)
            const r = M.recordLoadAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p142_rec_elevated',
                activeHypotheses: 8,
                managedPositions: 4,
                degradedModules: 2,
                scenarioTreeDepth: 4,
                beliefUpdatesQueueSize: 50,
                ts: _now()
            });
            // expected ~0.555
            expect(r.cognitiveMode).toBe('elevated');
            expect(r.intervention).toBe('simplify_hypotheses');
        });

        test('high load → overloaded + simple_rules_mode', () => {
            const r = M.recordLoadAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p142_rec_overloaded',
                activeHypotheses: 15,
                managedPositions: 10,
                degradedModules: 6,
                scenarioTreeDepth: 9,
                beliefUpdatesQueueSize: 120,
                ts: _now()
            });
            expect(r.cognitiveMode).toBe('overloaded');
            expect(r.intervention).toBe('simple_rules_mode');
        });

        test('duplicate assessmentId throws', () => {
            M.recordLoadAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p142_rec_dup',
                activeHypotheses: 2, managedPositions: 1,
                degradedModules: 0, scenarioTreeDepth: 2,
                beliefUpdatesQueueSize: 5, ts: _now()
            });
            expect(() => M.recordLoadAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p142_rec_dup',
                activeHypotheses: 5, managedPositions: 2,
                degradedModules: 1, scenarioTreeDepth: 3,
                beliefUpdatesQueueSize: 20, ts: _now()
            })).toThrow(/duplicate/);
        });

        test('negative count throws', () => {
            expect(() => M.recordLoadAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p142_rec_bad',
                activeHypotheses: -1, managedPositions: 1,
                degradedModules: 0, scenarioTreeDepth: 2,
                beliefUpdatesQueueSize: 5, ts: _now()
            })).toThrow();
        });
    });

    describe('getLatestAssessment', () => {
        test('returns most recent', () => {
            const u = UID_LATEST;
            M.recordLoadAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p142_lat_old',
                activeHypotheses: 2, managedPositions: 1,
                degradedModules: 0, scenarioTreeDepth: 2,
                beliefUpdatesQueueSize: 5, ts: 1000
            });
            M.recordLoadAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p142_lat_new',
                activeHypotheses: 15, managedPositions: 10,
                degradedModules: 6, scenarioTreeDepth: 9,
                beliefUpdatesQueueSize: 120, ts: 2000
            });
            const r = M.getLatestAssessment({
                userId: u, resolvedEnv: ENV
            });
            expect(r).not.toBeNull();
            expect(r.assessmentId).toBe('p142_lat_new');
            expect(r.cognitiveMode).toBe('overloaded');
        });

        test('returns null when no assessments', () => {
            const r = M.getLatestAssessment({
                userId: UID_LATEST, resolvedEnv: 'REAL'
            });
            expect(r).toBeNull();
        });
    });

    describe('getLoadHistory', () => {
        test('returns history DESC by ts with limit', () => {
            const u = UID_HIST;
            for (let i = 0; i < 4; i++) {
                M.recordLoadAssessment({
                    userId: u, resolvedEnv: ENV,
                    assessmentId: `p142_h_${i}`,
                    activeHypotheses: 2, managedPositions: 1,
                    degradedModules: 0, scenarioTreeDepth: 2,
                    beliefUpdatesQueueSize: 5,
                    ts: 1000 + i * 100
                });
            }
            const rows = M.getLoadHistory({
                userId: u, resolvedEnv: ENV, limit: 10
            });
            expect(rows.length).toBe(4);
            expect(rows[0].assessmentId).toBe('p142_h_3');
            expect(rows[3].assessmentId).toBe('p142_h_0');
        });
    });

    describe('getInterventionDistribution', () => {
        test('counts per intervention since ts', () => {
            const u = UID_DIST;
            // 2 normal
            for (let i = 0; i < 2; i++) {
                M.recordLoadAssessment({
                    userId: u, resolvedEnv: ENV,
                    assessmentId: `p142_dist_n_${i}`,
                    activeHypotheses: 2, managedPositions: 1,
                    degradedModules: 0, scenarioTreeDepth: 2,
                    beliefUpdatesQueueSize: 5,
                    ts: 1000 + i
                });
            }
            // 1 overloaded
            M.recordLoadAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p142_dist_o',
                activeHypotheses: 15, managedPositions: 10,
                degradedModules: 6, scenarioTreeDepth: 9,
                beliefUpdatesQueueSize: 120,
                ts: 2000
            });
            const dist = M.getInterventionDistribution({
                userId: u, resolvedEnv: ENV, sinceTs: 500
            });
            expect(dist.none).toBe(2);
            expect(dist.simple_rules_mode).toBe(1);
            expect(dist.simplify_hypotheses || 0).toBe(0);
        });

        test('respects sinceTs filter', () => {
            const u = UID_DIST;
            M.recordLoadAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p142_dist_old',
                activeHypotheses: 2, managedPositions: 1,
                degradedModules: 0, scenarioTreeDepth: 2,
                beliefUpdatesQueueSize: 5,
                ts: 100
            });
            M.recordLoadAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p142_dist_new',
                activeHypotheses: 15, managedPositions: 10,
                degradedModules: 6, scenarioTreeDepth: 9,
                beliefUpdatesQueueSize: 120,
                ts: 5000
            });
            const dist = M.getInterventionDistribution({
                userId: u, resolvedEnv: ENV, sinceTs: 1000
            });
            expect(dist.none || 0).toBe(0);
            expect(dist.simple_rules_mode).toBe(1);
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B assessments', () => {
            M.recordLoadAssessment({
                userId: UID_ISO_A, resolvedEnv: ENV,
                assessmentId: 'p142_iso_a',
                activeHypotheses: 2, managedPositions: 1,
                degradedModules: 0, scenarioTreeDepth: 2,
                beliefUpdatesQueueSize: 5, ts: 1000
            });
            M.recordLoadAssessment({
                userId: UID_ISO_B, resolvedEnv: ENV,
                assessmentId: 'p142_iso_b',
                activeHypotheses: 2, managedPositions: 1,
                degradedModules: 0, scenarioTreeDepth: 2,
                beliefUpdatesQueueSize: 5, ts: 1000
            });
            const rows = M.getLoadHistory({
                userId: UID_ISO_A, resolvedEnv: ENV, limit: 10
            });
            expect(rows.every(r => r.assessmentId !== 'p142_iso_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.recordLoadAssessment({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                assessmentId: 'p142_env_demo',
                activeHypotheses: 2, managedPositions: 1,
                degradedModules: 0, scenarioTreeDepth: 2,
                beliefUpdatesQueueSize: 5, ts: 1000
            });
            M.recordLoadAssessment({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                assessmentId: 'p142_env_testnet',
                activeHypotheses: 2, managedPositions: 1,
                degradedModules: 0, scenarioTreeDepth: 2,
                beliefUpdatesQueueSize: 5, ts: 1000
            });
            const rows = M.getLoadHistory({
                userId: UID_ENV, resolvedEnv: 'DEMO', limit: 10
            });
            expect(rows.every(r => r.assessmentId !== 'p142_env_testnet')).toBe(true);
        });
    });
});
