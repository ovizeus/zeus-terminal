'use strict';

/**
 * OMEGA §129 ASSUMPTION SURFACE MAPPER / LOAD-BEARING PREMISE ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 3714-3759.
 *
 * "pe ce anume ma bazez, chiar daca nu am spus-o explicit?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p129-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/assumptionSurfaceMapper');

const UID = 9129;
const UID_B = 9229;
const UID_DECISION = 9329;
const UID_LB = 9429;
const UID_ISO_A = 9529;
const UID_ISO_B = 9629;
const UID_ENV = 9729;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_B, UID_DECISION, UID_LB,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_assumptions WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_assumption_dependencies WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §129 ASSUMPTION SURFACE MAPPER', () => {

    describe('Migrations 247+248', () => {
        test('247_ml_assumptions migration applied', () => {
            const row = db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('247_ml_assumptions');
            expect(row).toBeTruthy();
        });

        test('248_ml_assumption_dependencies migration applied', () => {
            const row = db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('248_ml_assumption_dependencies');
            expect(row).toBeTruthy();
        });

        test('assumption_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_assumptions
                (user_id, resolved_env, assumption_id, decision_id,
                 premise_type, strength_level, fragility_score,
                 statement, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p129_a_dup_1', 'd1', 'structural',
                     'strong', 0.1, 's', _now());
            expect(() => {
                stmt.run(UID, ENV, 'p129_a_dup_1', 'd2', 'causal',
                         'fragile', 0.5, 's2', _now());
            }).toThrow();
        });

        test('premise_type CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_assumptions
                (user_id, resolved_env, assumption_id, decision_id,
                 premise_type, strength_level, fragility_score,
                 statement, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p129_a_bad_type', 'd1',
                'BOGUS', 'strong', 0.1, 's', _now())).toThrow();
        });

        test('strength_level CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_assumptions
                (user_id, resolved_env, assumption_id, decision_id,
                 premise_type, strength_level, fragility_score,
                 statement, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p129_a_bad_strength', 'd1',
                'structural', 'BOGUS', 0.1, 's', _now())).toThrow();
        });

        test('fragility_score CHECK range enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_assumptions
                (user_id, resolved_env, assumption_id, decision_id,
                 premise_type, strength_level, fragility_score,
                 statement, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p129_a_bad_frag', 'd1',
                'structural', 'strong', 1.5, 's', _now())).toThrow();
        });

        test('self-dependency CHECK enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_assumption_dependencies
                (user_id, resolved_env, dependency_id,
                 parent_assumption_id, child_assumption_id, ts)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p129_d_self', 'a1', 'a1', _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('PREMISE_TYPES frozen 6 canonical entries', () => {
            expect(M.PREMISE_TYPES).toEqual([
                'structural', 'causal', 'execution',
                'data_integrity', 'regime_persistence',
                'cross_venue_validity'
            ]);
            expect(Object.isFrozen(M.PREMISE_TYPES)).toBe(true);
        });

        test('STRENGTH_LEVELS frozen 3 entries', () => {
            expect(M.STRENGTH_LEVELS).toEqual(['strong', 'fragile', 'speculative']);
            expect(Object.isFrozen(M.STRENGTH_LEVELS)).toBe(true);
        });

        test('FRAGILITY_THRESHOLDS ordered', () => {
            expect(M.FRAGILITY_THRESHOLDS.strong).toBe(0.30);
            expect(M.FRAGILITY_THRESHOLDS.fragile).toBe(0.70);
            expect(M.FRAGILITY_THRESHOLDS.strong)
                .toBeLessThan(M.FRAGILITY_THRESHOLDS.fragile);
        });

        test('LOAD_BEARING_THRESHOLD = 0.50', () => {
            expect(M.LOAD_BEARING_THRESHOLD).toBe(0.50);
        });
    });

    describe('classifyStrength (pure)', () => {
        test('fragility < 0.30 → strong', () => {
            expect(M.classifyStrength({ fragilityScore: 0.20 }).strengthLevel).toBe('strong');
        });

        test('fragility 0.30..0.70 → fragile', () => {
            expect(M.classifyStrength({ fragilityScore: 0.50 }).strengthLevel).toBe('fragile');
        });

        test('fragility > 0.70 → speculative', () => {
            expect(M.classifyStrength({ fragilityScore: 0.85 }).strengthLevel).toBe('speculative');
        });

        test('boundary 0.30 → fragile', () => {
            expect(M.classifyStrength({ fragilityScore: 0.30 }).strengthLevel).toBe('fragile');
        });

        test('fragility out of range throws', () => {
            expect(() => M.classifyStrength({ fragilityScore: 1.5 })).toThrow();
            expect(() => M.classifyStrength({ fragilityScore: -0.1 })).toThrow();
        });
    });

    describe('computeLoadBearingScore (pure)', () => {
        test('no downstream → 0', () => {
            const r = M.computeLoadBearingScore({
                fragilityScore: 0.9,
                downstreamCount: 0,
                totalAssumptions: 5
            });
            expect(r.loadBearingScore).toBe(0);
        });

        test('high fragility + max downstream → near 1', () => {
            // frag=0.9, downstream=4, total=5 → frag × (4/4) = 0.9
            const r = M.computeLoadBearingScore({
                fragilityScore: 0.9,
                downstreamCount: 4,
                totalAssumptions: 5
            });
            expect(r.loadBearingScore).toBeCloseTo(0.9, 6);
        });

        test('low fragility + high downstream → low', () => {
            // frag=0.1, downstream=4, total=5 → 0.1 × 1 = 0.1
            const r = M.computeLoadBearingScore({
                fragilityScore: 0.1,
                downstreamCount: 4,
                totalAssumptions: 5
            });
            expect(r.loadBearingScore).toBeCloseTo(0.1, 6);
        });

        test('totalAssumptions=1 → 0 (no others to depend on it)', () => {
            const r = M.computeLoadBearingScore({
                fragilityScore: 0.9,
                downstreamCount: 0,
                totalAssumptions: 1
            });
            expect(r.loadBearingScore).toBe(0);
        });
    });

    describe('isLoadBearing (pure)', () => {
        test('score above threshold → true', () => {
            expect(M.isLoadBearing({ loadBearingScore: 0.6 }).loadBearing).toBe(true);
        });

        test('score below threshold → false', () => {
            expect(M.isLoadBearing({ loadBearingScore: 0.3 }).loadBearing).toBe(false);
        });

        test('score exact threshold → true', () => {
            expect(M.isLoadBearing({ loadBearingScore: 0.5 }).loadBearing).toBe(true);
        });
    });

    describe('computeSizePenalty (pure)', () => {
        test('empty list → 0', () => {
            const r = M.computeSizePenalty({ loadBearingFragilityScores: [] });
            expect(r.sizePenalty).toBe(0);
        });

        test('selects max fragility', () => {
            const r = M.computeSizePenalty({
                loadBearingFragilityScores: [0.5, 0.8, 0.65]
            });
            expect(r.sizePenalty).toBe(0.8);
        });

        test('clamps to [0,1]', () => {
            const r = M.computeSizePenalty({
                loadBearingFragilityScores: [0.95]
            });
            expect(r.sizePenalty).toBe(0.95);
        });
    });

    describe('registerAssumption', () => {
        test('persists + auto-classifies strength', () => {
            const r = M.registerAssumption({
                userId: UID, resolvedEnv: ENV,
                assumptionId: 'p129_reg_1',
                decisionId: 'dec_a',
                premiseType: 'structural',
                fragilityScore: 0.20,
                statement: 'venue divergence relevant',
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.strengthLevel).toBe('strong');
        });

        test('duplicate assumptionId throws', () => {
            M.registerAssumption({
                userId: UID, resolvedEnv: ENV,
                assumptionId: 'p129_reg_dup',
                decisionId: 'dec_a',
                premiseType: 'causal',
                fragilityScore: 0.5,
                statement: 's',
                ts: _now()
            });
            expect(() => M.registerAssumption({
                userId: UID, resolvedEnv: ENV,
                assumptionId: 'p129_reg_dup',
                decisionId: 'dec_b',
                premiseType: 'execution',
                fragilityScore: 0.3,
                statement: 's2',
                ts: _now()
            })).toThrow(/duplicate/);
        });

        test('invalid premiseType throws', () => {
            expect(() => M.registerAssumption({
                userId: UID, resolvedEnv: ENV,
                assumptionId: 'p129_reg_bad',
                decisionId: 'dec_a',
                premiseType: 'BOGUS',
                fragilityScore: 0.5,
                statement: 's',
                ts: _now()
            })).toThrow(/invalid premiseType/);
        });

        test('fragilityScore out of [0,1] throws', () => {
            expect(() => M.registerAssumption({
                userId: UID, resolvedEnv: ENV,
                assumptionId: 'p129_reg_bad2',
                decisionId: 'dec_a',
                premiseType: 'structural',
                fragilityScore: 1.5,
                statement: 's',
                ts: _now()
            })).toThrow();
        });
    });

    describe('linkAssumptions', () => {
        test('persists directed dependency', () => {
            const r = M.linkAssumptions({
                userId: UID, resolvedEnv: ENV,
                dependencyId: 'p129_dep_1',
                parentAssumptionId: 'p129_parent',
                childAssumptionId: 'p129_child',
                ts: _now()
            });
            expect(r.linked).toBe(true);
        });

        test('duplicate dependencyId throws', () => {
            M.linkAssumptions({
                userId: UID, resolvedEnv: ENV,
                dependencyId: 'p129_dep_dup',
                parentAssumptionId: 'a1',
                childAssumptionId: 'a2',
                ts: _now()
            });
            expect(() => M.linkAssumptions({
                userId: UID, resolvedEnv: ENV,
                dependencyId: 'p129_dep_dup',
                parentAssumptionId: 'b1',
                childAssumptionId: 'b2',
                ts: _now()
            })).toThrow(/duplicate/);
        });

        test('self-dependency rejected at module layer', () => {
            expect(() => M.linkAssumptions({
                userId: UID, resolvedEnv: ENV,
                dependencyId: 'p129_dep_self',
                parentAssumptionId: 'a_same',
                childAssumptionId: 'a_same',
                ts: _now()
            })).toThrow(/self-dependency|same/);
        });
    });

    describe('getAssumptionsForDecision', () => {
        test('returns all assumptions for a decision', () => {
            const u = UID_DECISION;
            M.registerAssumption({
                userId: u, resolvedEnv: ENV,
                assumptionId: 'p129_d1_a1',
                decisionId: 'dec_42',
                premiseType: 'structural',
                fragilityScore: 0.2,
                statement: 's1',
                ts: 1000
            });
            M.registerAssumption({
                userId: u, resolvedEnv: ENV,
                assumptionId: 'p129_d1_a2',
                decisionId: 'dec_42',
                premiseType: 'causal',
                fragilityScore: 0.6,
                statement: 's2',
                ts: 2000
            });
            M.registerAssumption({
                userId: u, resolvedEnv: ENV,
                assumptionId: 'p129_d1_other',
                decisionId: 'dec_OTHER',
                premiseType: 'structural',
                fragilityScore: 0.2,
                statement: 's_other',
                ts: 3000
            });
            const rows = M.getAssumptionsForDecision({
                userId: u, resolvedEnv: ENV, decisionId: 'dec_42'
            });
            expect(rows.length).toBe(2);
            expect(rows.every(r => r.decisionId === 'dec_42')).toBe(true);
        });
    });

    describe('getLoadBearingAssumptions (integration)', () => {
        test('flags load-bearing fragile assumptions', () => {
            const u = UID_LB;
            const dec = 'dec_lb_test';
            // 3 assumptions for this decision:
            //  a1 (parent) has fragility=0.9, 2 children (a2, a3)
            //  a2, a3 leaf children (no downstream)
            M.registerAssumption({
                userId: u, resolvedEnv: ENV,
                assumptionId: 'p129_lb_a1',
                decisionId: dec, premiseType: 'structural',
                fragilityScore: 0.9, statement: 'fragile root',
                ts: 1000
            });
            M.registerAssumption({
                userId: u, resolvedEnv: ENV,
                assumptionId: 'p129_lb_a2',
                decisionId: dec, premiseType: 'causal',
                fragilityScore: 0.2, statement: 'strong child',
                ts: 1001
            });
            M.registerAssumption({
                userId: u, resolvedEnv: ENV,
                assumptionId: 'p129_lb_a3',
                decisionId: dec, premiseType: 'execution',
                fragilityScore: 0.4, statement: 'mid child',
                ts: 1002
            });
            // a1 → a2, a1 → a3
            M.linkAssumptions({
                userId: u, resolvedEnv: ENV,
                dependencyId: 'p129_lb_d1',
                parentAssumptionId: 'p129_lb_a1',
                childAssumptionId: 'p129_lb_a2',
                ts: 1003
            });
            M.linkAssumptions({
                userId: u, resolvedEnv: ENV,
                dependencyId: 'p129_lb_d2',
                parentAssumptionId: 'p129_lb_a1',
                childAssumptionId: 'p129_lb_a3',
                ts: 1004
            });

            const lb = M.getLoadBearingAssumptions({
                userId: u, resolvedEnv: ENV, decisionId: dec
            });
            // a1 has frag=0.9, downstream=2, total=3 → score = 0.9 × (2/2) = 0.9 ≥ 0.50
            expect(lb.length).toBe(1);
            expect(lb[0].assumptionId).toBe('p129_lb_a1');
            expect(lb[0].loadBearingScore).toBeCloseTo(0.9, 6);
        });

        test('no load-bearing → empty array', () => {
            const u = UID_LB;
            M.registerAssumption({
                userId: u, resolvedEnv: ENV,
                assumptionId: 'p129_lb_solo_a',
                decisionId: 'dec_solo',
                premiseType: 'structural',
                fragilityScore: 0.2,
                statement: 's',
                ts: _now()
            });
            M.registerAssumption({
                userId: u, resolvedEnv: ENV,
                assumptionId: 'p129_lb_solo_b',
                decisionId: 'dec_solo',
                premiseType: 'causal',
                fragilityScore: 0.1,
                statement: 's',
                ts: _now()
            });
            const lb = M.getLoadBearingAssumptions({
                userId: u, resolvedEnv: ENV, decisionId: 'dec_solo'
            });
            expect(lb.length).toBe(0);
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B assumptions', () => {
            M.registerAssumption({
                userId: UID_ISO_A, resolvedEnv: ENV,
                assumptionId: 'p129_iso_a',
                decisionId: 'dec_x',
                premiseType: 'structural',
                fragilityScore: 0.2,
                statement: 's',
                ts: _now()
            });
            M.registerAssumption({
                userId: UID_ISO_B, resolvedEnv: ENV,
                assumptionId: 'p129_iso_b',
                decisionId: 'dec_x',
                premiseType: 'structural',
                fragilityScore: 0.2,
                statement: 's',
                ts: _now()
            });
            const rows = M.getAssumptionsForDecision({
                userId: UID_ISO_A, resolvedEnv: ENV,
                decisionId: 'dec_x'
            });
            expect(rows.every(r => r.assumptionId !== 'p129_iso_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env for same uid', () => {
            M.registerAssumption({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                assumptionId: 'p129_env_demo',
                decisionId: 'dec_e',
                premiseType: 'structural',
                fragilityScore: 0.2,
                statement: 's',
                ts: _now()
            });
            M.registerAssumption({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                assumptionId: 'p129_env_testnet',
                decisionId: 'dec_e',
                premiseType: 'structural',
                fragilityScore: 0.2,
                statement: 's',
                ts: _now()
            });
            const rowsDemo = M.getAssumptionsForDecision({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                decisionId: 'dec_e'
            });
            expect(rowsDemo.every(r => r.assumptionId !== 'p129_env_testnet')).toBe(true);
        });
    });
});
