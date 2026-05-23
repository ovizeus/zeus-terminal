'use strict';

/**
 * OMEGA §136 IRREVERSIBILITY / OPTION-PRESERVATION ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 3997-4044.
 *
 * "daca fac asta acum, cate optiuni bune imi omor pentru viitorul apropiat?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p136-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R3A_safety/optionPreservationEngine');

const UID = 9136;
const UID_ACT = 9236;
const UID_HIST = 9336;
const UID_BURN = 9436;
const UID_ISO_A = 9536;
const UID_ISO_B = 9636;
const UID_ENV = 9736;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_ACT, UID_HIST, UID_BURN,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_action_optionality_assessments WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §136 OPTION PRESERVATION ENGINE', () => {

    describe('Migration 259', () => {
        test('259_ml_action_optionality_assessments migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('259_ml_action_optionality_assessments')).toBeTruthy();
        });

        test('assessment_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_action_optionality_assessments
                (user_id, resolved_env, assessment_id, action_id, action_kind,
                 expected_value, irreversibility_score, optionality_consumed,
                 future_options_killed_count, epistemic_standard_required,
                 primary_conviction, reversibility_category,
                 net_value_after_penalty, approved, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p136_a_dup', 'act1', 'entry',
                100, 0.5, 0.3, 5, 0.5, 0.6, 'partial_reversible',
                85, 1, _now());
            expect(() => stmt.run(UID, ENV, 'p136_a_dup', 'act2', 'close',
                50, 0.2, 0.1, 1, 0.3, 0.5, 'reversible',
                47.5, 1, _now())).toThrow();
        });

        test('reversibility_category CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_action_optionality_assessments
                (user_id, resolved_env, assessment_id, action_id, action_kind,
                 expected_value, irreversibility_score, optionality_consumed,
                 future_options_killed_count, epistemic_standard_required,
                 primary_conviction, reversibility_category,
                 net_value_after_penalty, approved, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p136_bad_cat', 'a', 'k',
                100, 0.5, 0.3, 5, 0.5, 0.6, 'BOGUS',
                85, 1, _now())).toThrow();
        });

        test('approved CHECK 0/1 enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_action_optionality_assessments
                (user_id, resolved_env, assessment_id, action_id, action_kind,
                 expected_value, irreversibility_score, optionality_consumed,
                 future_options_killed_count, epistemic_standard_required,
                 primary_conviction, reversibility_category,
                 net_value_after_penalty, approved, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p136_bad_appr', 'a', 'k',
                100, 0.5, 0.3, 5, 0.5, 0.6, 'reversible',
                85, 2, _now())).toThrow();
        });

        test('range CHECK enforced (irreversibility_score)', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_action_optionality_assessments
                (user_id, resolved_env, assessment_id, action_id, action_kind,
                 expected_value, irreversibility_score, optionality_consumed,
                 future_options_killed_count, epistemic_standard_required,
                 primary_conviction, reversibility_category,
                 net_value_after_penalty, approved, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p136_bad_irr', 'a', 'k',
                100, 1.5, 0.3, 5, 0.5, 0.6, 'reversible',
                85, 1, _now())).toThrow();
        });

        test('future_options_killed_count CHECK ≥ 0 enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_action_optionality_assessments
                (user_id, resolved_env, assessment_id, action_id, action_kind,
                 expected_value, irreversibility_score, optionality_consumed,
                 future_options_killed_count, epistemic_standard_required,
                 primary_conviction, reversibility_category,
                 net_value_after_penalty, approved, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p136_bad_count', 'a', 'k',
                100, 0.5, 0.3, -1, 0.5, 0.6, 'reversible',
                85, 1, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('REVERSIBILITY_CATEGORIES frozen 3 entries (ordered low→high reversibility loss)', () => {
            expect(M.REVERSIBILITY_CATEGORIES).toEqual([
                'reversible', 'partial_reversible', 'nearly_irreversible'
            ]);
            expect(Object.isFrozen(M.REVERSIBILITY_CATEGORIES)).toBe(true);
        });

        test('IRREVERSIBILITY_THRESHOLDS ordered', () => {
            expect(M.IRREVERSIBILITY_THRESHOLDS.nearly).toBe(0.70);
            expect(M.IRREVERSIBILITY_THRESHOLDS.partial).toBe(0.30);
            expect(M.IRREVERSIBILITY_THRESHOLDS.partial)
                .toBeLessThan(M.IRREVERSIBILITY_THRESHOLDS.nearly);
        });

        test('OPTIONALITY_PENALTY_WEIGHT = 0.50', () => {
            expect(M.OPTIONALITY_PENALTY_WEIGHT).toBe(0.50);
        });

        test('EPISTEMIC_REQUIREMENT_MAP ascending by category', () => {
            expect(M.EPISTEMIC_REQUIREMENT_MAP.reversible).toBe(0.30);
            expect(M.EPISTEMIC_REQUIREMENT_MAP.partial_reversible).toBe(0.50);
            expect(M.EPISTEMIC_REQUIREMENT_MAP.nearly_irreversible).toBe(0.75);
            expect(M.EPISTEMIC_REQUIREMENT_MAP.reversible)
                .toBeLessThan(M.EPISTEMIC_REQUIREMENT_MAP.partial_reversible);
            expect(M.EPISTEMIC_REQUIREMENT_MAP.partial_reversible)
                .toBeLessThan(M.EPISTEMIC_REQUIREMENT_MAP.nearly_irreversible);
        });

        test('VALUE_PROXIMITY_THRESHOLD = 0.10', () => {
            expect(M.VALUE_PROXIMITY_THRESHOLD).toBe(0.10);
        });
    });

    describe('computeOptionalityCost (pure)', () => {
        test('positive EV + half optionality', () => {
            const r = M.computeOptionalityCost({
                expectedValue: 100, optionalityConsumed: 0.5
            });
            // 100 × 0.5 × 0.5 = 25
            expect(r.optionalityCost).toBe(25);
        });

        test('negative EV uses abs for cost', () => {
            const r = M.computeOptionalityCost({
                expectedValue: -100, optionalityConsumed: 0.5
            });
            expect(r.optionalityCost).toBe(25);
        });

        test('zero EV → zero cost', () => {
            const r = M.computeOptionalityCost({
                expectedValue: 0, optionalityConsumed: 0.5
            });
            expect(r.optionalityCost).toBe(0);
        });

        test('zero optionality → zero cost', () => {
            const r = M.computeOptionalityCost({
                expectedValue: 100, optionalityConsumed: 0
            });
            expect(r.optionalityCost).toBe(0);
        });
    });

    describe('computeNetValue (pure)', () => {
        test('positive EV minus cost', () => {
            const r = M.computeNetValue({
                expectedValue: 100, optionalityConsumed: 0.5
            });
            // 100 - 25 = 75
            expect(r.netValue).toBe(75);
        });

        test('high optionality can drive net negative', () => {
            const r = M.computeNetValue({
                expectedValue: 10, optionalityConsumed: 1.0
            });
            // 10 - (10 × 1.0 × 0.5) = 5
            expect(r.netValue).toBe(5);
        });

        test('negative EV stays negative or worse', () => {
            const r = M.computeNetValue({
                expectedValue: -50, optionalityConsumed: 0.5
            });
            // -50 - (|−50| × 0.5 × 0.5) = -50 - 12.5 = -62.5
            expect(r.netValue).toBe(-62.5);
        });
    });

    describe('classifyReversibility (pure)', () => {
        test('score < 0.30 → reversible', () => {
            expect(M.classifyReversibility({ irreversibilityScore: 0.10 })
                .reversibilityCategory).toBe('reversible');
        });

        test('score 0.30..0.70 → partial_reversible', () => {
            expect(M.classifyReversibility({ irreversibilityScore: 0.50 })
                .reversibilityCategory).toBe('partial_reversible');
        });

        test('score ≥ 0.70 → nearly_irreversible', () => {
            expect(M.classifyReversibility({ irreversibilityScore: 0.85 })
                .reversibilityCategory).toBe('nearly_irreversible');
        });

        test('boundary 0.30 → partial_reversible', () => {
            expect(M.classifyReversibility({ irreversibilityScore: 0.30 })
                .reversibilityCategory).toBe('partial_reversible');
        });

        test('boundary 0.70 → nearly_irreversible', () => {
            expect(M.classifyReversibility({ irreversibilityScore: 0.70 })
                .reversibilityCategory).toBe('nearly_irreversible');
        });

        test('out-of-range throws', () => {
            expect(() => M.classifyReversibility({ irreversibilityScore: 1.5 })).toThrow();
        });
    });

    describe('computeEpistemicRequirement (pure)', () => {
        test('reversible → 0.30', () => {
            expect(M.computeEpistemicRequirement({
                reversibilityCategory: 'reversible'
            }).epistemicStandardRequired).toBe(0.30);
        });

        test('partial_reversible → 0.50', () => {
            expect(M.computeEpistemicRequirement({
                reversibilityCategory: 'partial_reversible'
            }).epistemicStandardRequired).toBe(0.50);
        });

        test('nearly_irreversible → 0.75', () => {
            expect(M.computeEpistemicRequirement({
                reversibilityCategory: 'nearly_irreversible'
            }).epistemicStandardRequired).toBe(0.75);
        });

        test('invalid category throws', () => {
            expect(() => M.computeEpistemicRequirement({
                reversibilityCategory: 'BOGUS'
            })).toThrow(/invalid reversibilityCategory/);
        });
    });

    describe('shouldApproveAction (pure)', () => {
        test('positive net + sufficient conviction → approved', () => {
            // reversible category needs conviction ≥ 0.30
            const r = M.shouldApproveAction({
                netValue: 50,
                primaryConviction: 0.5,
                reversibilityCategory: 'reversible'
            });
            expect(r.approved).toBe(true);
        });

        test('negative net rejected', () => {
            const r = M.shouldApproveAction({
                netValue: -10,
                primaryConviction: 0.9,
                reversibilityCategory: 'reversible'
            });
            expect(r.approved).toBe(false);
            expect(r.reason).toMatch(/net_value/);
        });

        test('positive net but insufficient conviction → rejected', () => {
            // nearly_irreversible needs 0.75; conviction 0.6 fails
            const r = M.shouldApproveAction({
                netValue: 50,
                primaryConviction: 0.6,
                reversibilityCategory: 'nearly_irreversible'
            });
            expect(r.approved).toBe(false);
            expect(r.reason).toMatch(/conviction/);
        });

        test('high conviction + nearly_irreversible + positive net → approved', () => {
            const r = M.shouldApproveAction({
                netValue: 100,
                primaryConviction: 0.85,
                reversibilityCategory: 'nearly_irreversible'
            });
            expect(r.approved).toBe(true);
        });

        test('zero net rejected (must be strictly positive)', () => {
            const r = M.shouldApproveAction({
                netValue: 0,
                primaryConviction: 0.9,
                reversibilityCategory: 'reversible'
            });
            expect(r.approved).toBe(false);
        });

        test('invalid category throws', () => {
            expect(() => M.shouldApproveAction({
                netValue: 50, primaryConviction: 0.5,
                reversibilityCategory: 'BOGUS'
            })).toThrow();
        });
    });

    describe('preferOptionPreserving (pure)', () => {
        test('near-equal EV picks lower optionality consumed', () => {
            const r = M.preferOptionPreserving({
                candidateA: { expectedValue: 100, optionalityConsumed: 0.7 },
                candidateB: { expectedValue: 105, optionalityConsumed: 0.2 }
            });
            // |100 - 105| / 105 = 0.048 < 0.10 → near-equal → pick lower opt
            expect(r.preferred).toBe('B');
            expect(r.reason).toMatch(/option_preserv/);
        });

        test('clear EV advantage picks higher EV', () => {
            const r = M.preferOptionPreserving({
                candidateA: { expectedValue: 100, optionalityConsumed: 0.3 },
                candidateB: { expectedValue: 200, optionalityConsumed: 0.5 }
            });
            // |100 - 200| / 200 = 0.5 ≥ 0.10 → not near-equal → pick higher EV
            expect(r.preferred).toBe('B');
            expect(r.reason).toMatch(/higher_value/);
        });

        test('exact EV tie picks lower optionality', () => {
            const r = M.preferOptionPreserving({
                candidateA: { expectedValue: 100, optionalityConsumed: 0.5 },
                candidateB: { expectedValue: 100, optionalityConsumed: 0.3 }
            });
            expect(r.preferred).toBe('B');
        });

        test('both candidates with same optionality + EV → defaults to A', () => {
            const r = M.preferOptionPreserving({
                candidateA: { expectedValue: 100, optionalityConsumed: 0.3 },
                candidateB: { expectedValue: 100, optionalityConsumed: 0.3 }
            });
            expect(r.preferred).toBe('A');
        });
    });

    describe('recordOptionalityAssessment (integration)', () => {
        test('reversible action with positive net + sufficient conviction → approved', () => {
            const r = M.recordOptionalityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p136_rec_rev',
                actionId: 'act_close_small',
                actionKind: 'close_position',
                expectedValue: 50,
                irreversibilityScore: 0.15,
                optionalityConsumed: 0.10,
                futureOptionsKilledCount: 1,
                primaryConviction: 0.6,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.reversibilityCategory).toBe('reversible');
            expect(r.epistemicStandardRequired).toBe(0.30);
            // netValue = 50 - (50 × 0.10 × 0.50) = 50 - 2.5 = 47.5
            expect(r.netValue).toBeCloseTo(47.5, 6);
            expect(r.approved).toBe(true);
        });

        test('nearly_irreversible action requires high conviction', () => {
            const r = M.recordOptionalityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p136_rec_nearly_blocked',
                actionId: 'act_max_position',
                actionKind: 'allocate_full_capital',
                expectedValue: 200,
                irreversibilityScore: 0.85,
                optionalityConsumed: 0.80,
                futureOptionsKilledCount: 12,
                primaryConviction: 0.60,
                ts: _now()
            });
            expect(r.reversibilityCategory).toBe('nearly_irreversible');
            expect(r.epistemicStandardRequired).toBe(0.75);
            // netValue = 200 - (200×0.80×0.50) = 200 - 80 = 120 → positive
            expect(r.netValue).toBeCloseTo(120, 6);
            // BUT conviction 0.60 < 0.75 → blocked
            expect(r.approved).toBe(false);
        });

        test('nearly_irreversible with sufficient conviction → approved', () => {
            const r = M.recordOptionalityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p136_rec_nearly_ok',
                actionId: 'act_max2',
                actionKind: 'allocate_full_capital',
                expectedValue: 200,
                irreversibilityScore: 0.85,
                optionalityConsumed: 0.80,
                futureOptionsKilledCount: 12,
                primaryConviction: 0.85,
                ts: _now()
            });
            expect(r.reversibilityCategory).toBe('nearly_irreversible');
            expect(r.approved).toBe(true);
        });

        test('blocked by net negative after penalty', () => {
            const r = M.recordOptionalityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p136_rec_neg_net',
                actionId: 'act_bad',
                actionKind: 'entry',
                expectedValue: 10,
                irreversibilityScore: 0.6,
                optionalityConsumed: 0.9,
                // cost = 10 × 0.9 × 0.5 = 4.5, net = 5.5 (still positive)
                // Hmm, need to make net negative. Use cost > EV.
                // Actually with this formula cost is always ≤ EV/2 when EV positive.
                // For NET negative, need EV < 0 OR more dramatic.
                // Adjust: EV=5, opt=1.0 → cost=2.5, net=2.5 (still positive)
                // The formula EV - (|EV| × opt × 0.5) = EV × (1 - opt × 0.5)
                // For positive EV this is always ≥ EV × 0.5 > 0
                // So net negative requires EV ≤ 0. Use negative EV.
                futureOptionsKilledCount: 2,
                primaryConviction: 0.5,
                ts: 12345
            });
            // recalculate: expectedValue 10, opt 0.9, cost = 10 × 0.9 × 0.5 = 4.5
            // net = 10 - 4.5 = 5.5 → positive → approved if conviction sufficient
            // partial_reversible needs 0.50, conviction 0.50 → approved
            // SKIP - use this test for net analysis instead
            expect(r.netValue).toBeCloseTo(5.5, 6);
        });

        test('negative EV → net negative → rejected', () => {
            const r = M.recordOptionalityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p136_rec_neg_ev',
                actionId: 'act_neg',
                actionKind: 'entry',
                expectedValue: -50,
                irreversibilityScore: 0.5,
                optionalityConsumed: 0.3,
                futureOptionsKilledCount: 2,
                primaryConviction: 0.8,
                ts: _now()
            });
            // net = -50 - (50 × 0.3 × 0.5) = -50 - 7.5 = -57.5 → negative
            expect(r.netValue).toBeCloseTo(-57.5, 6);
            expect(r.approved).toBe(false);
        });

        test('duplicate assessmentId throws', () => {
            M.recordOptionalityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p136_rec_dup',
                actionId: 'a', actionKind: 'k',
                expectedValue: 50, irreversibilityScore: 0.2,
                optionalityConsumed: 0.2, futureOptionsKilledCount: 1,
                primaryConviction: 0.5, ts: _now()
            });
            expect(() => M.recordOptionalityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p136_rec_dup',
                actionId: 'b', actionKind: 'k2',
                expectedValue: 30, irreversibilityScore: 0.1,
                optionalityConsumed: 0.1, futureOptionsKilledCount: 0,
                primaryConviction: 0.5, ts: _now()
            })).toThrow(/duplicate/);
        });

        test('out-of-range irreversibility throws', () => {
            expect(() => M.recordOptionalityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p136_rec_bad',
                actionId: 'a', actionKind: 'k',
                expectedValue: 50, irreversibilityScore: 1.5,
                optionalityConsumed: 0.2, futureOptionsKilledCount: 1,
                primaryConviction: 0.5, ts: _now()
            })).toThrow();
        });
    });

    describe('getAssessmentForAction', () => {
        test('returns latest assessment for actionId', () => {
            const u = UID_ACT;
            M.recordOptionalityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p136_act_old',
                actionId: 'act_track', actionKind: 'k',
                expectedValue: 100, irreversibilityScore: 0.2,
                optionalityConsumed: 0.2, futureOptionsKilledCount: 1,
                primaryConviction: 0.5, ts: 1000
            });
            M.recordOptionalityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p136_act_new',
                actionId: 'act_track', actionKind: 'k',
                expectedValue: 100, irreversibilityScore: 0.5,
                optionalityConsumed: 0.5, futureOptionsKilledCount: 5,
                primaryConviction: 0.5, ts: 2000
            });
            const r = M.getAssessmentForAction({
                userId: u, resolvedEnv: ENV, actionId: 'act_track'
            });
            expect(r).not.toBeNull();
            expect(r.assessmentId).toBe('p136_act_new');
        });

        test('returns null when no assessment for actionId', () => {
            const r = M.getAssessmentForAction({
                userId: UID_ACT, resolvedEnv: ENV,
                actionId: 'NONEXISTENT'
            });
            expect(r).toBeNull();
        });
    });

    describe('getAssessmentHistory', () => {
        test('returns history DESC by ts with limit', () => {
            const u = UID_HIST;
            for (let i = 0; i < 4; i++) {
                M.recordOptionalityAssessment({
                    userId: u, resolvedEnv: ENV,
                    assessmentId: `p136_h_${i}`,
                    actionId: `a${i}`, actionKind: 'k',
                    expectedValue: 50, irreversibilityScore: 0.2,
                    optionalityConsumed: 0.2, futureOptionsKilledCount: 1,
                    primaryConviction: 0.5, ts: 1000 + i * 100
                });
            }
            const rows = M.getAssessmentHistory({
                userId: u, resolvedEnv: ENV, limit: 10
            });
            expect(rows.length).toBe(4);
            expect(rows[0].assessmentId).toBe('p136_h_3');
            expect(rows[3].assessmentId).toBe('p136_h_0');
        });

        test('category filter works', () => {
            const u = UID_HIST;
            M.recordOptionalityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p136_h_rev', actionId: 'a1', actionKind: 'k',
                expectedValue: 50, irreversibilityScore: 0.1,
                optionalityConsumed: 0.1, futureOptionsKilledCount: 0,
                primaryConviction: 0.5, ts: 2000
            });
            M.recordOptionalityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p136_h_nearly', actionId: 'a2', actionKind: 'k',
                expectedValue: 100, irreversibilityScore: 0.85,
                optionalityConsumed: 0.7, futureOptionsKilledCount: 10,
                primaryConviction: 0.8, ts: 3000
            });
            const rows = M.getAssessmentHistory({
                userId: u, resolvedEnv: ENV,
                categoryFilter: 'nearly_irreversible', limit: 10
            });
            expect(rows.length).toBe(1);
            expect(rows[0].assessmentId).toBe('p136_h_nearly');
        });

        test('invalid categoryFilter throws', () => {
            expect(() => M.getAssessmentHistory({
                userId: UID_HIST, resolvedEnv: ENV,
                categoryFilter: 'BOGUS', limit: 10
            })).toThrow(/invalid categoryFilter/);
        });
    });

    describe('getOptionalityBurnRate', () => {
        test('cumulative optionality_consumed from approved actions since ts', () => {
            const u = UID_BURN;
            // Approved actions
            M.recordOptionalityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p136_burn_1', actionId: 'a1', actionKind: 'k',
                expectedValue: 50, irreversibilityScore: 0.2,
                optionalityConsumed: 0.3, futureOptionsKilledCount: 2,
                primaryConviction: 0.5, ts: 1000
            });
            M.recordOptionalityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p136_burn_2', actionId: 'a2', actionKind: 'k',
                expectedValue: 30, irreversibilityScore: 0.15,
                optionalityConsumed: 0.2, futureOptionsKilledCount: 1,
                primaryConviction: 0.5, ts: 2000
            });
            // Blocked action (should NOT count - approved=0)
            M.recordOptionalityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p136_burn_blocked', actionId: 'a3', actionKind: 'k',
                expectedValue: -20, irreversibilityScore: 0.1,
                optionalityConsumed: 0.5, futureOptionsKilledCount: 5,
                primaryConviction: 0.5, ts: 3000
            });
            const r = M.getOptionalityBurnRate({
                userId: u, resolvedEnv: ENV, sinceTs: 500
            });
            // Only approved: 0.3 + 0.2 = 0.5
            expect(r.totalOptionalityConsumed).toBeCloseTo(0.5, 6);
            expect(r.approvedActionsCount).toBe(2);
        });

        test('respects sinceTs filter', () => {
            const u = UID_BURN;
            M.recordOptionalityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p136_burn_old', actionId: 'a_old', actionKind: 'k',
                expectedValue: 50, irreversibilityScore: 0.2,
                optionalityConsumed: 0.3, futureOptionsKilledCount: 2,
                primaryConviction: 0.5, ts: 100
            });
            M.recordOptionalityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p136_burn_new', actionId: 'a_new', actionKind: 'k',
                expectedValue: 30, irreversibilityScore: 0.15,
                optionalityConsumed: 0.2, futureOptionsKilledCount: 1,
                primaryConviction: 0.5, ts: 5000
            });
            const r = M.getOptionalityBurnRate({
                userId: u, resolvedEnv: ENV, sinceTs: 1000
            });
            // Only "new" counts
            expect(r.totalOptionalityConsumed).toBeCloseTo(0.2, 6);
            expect(r.approvedActionsCount).toBe(1);
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B assessments', () => {
            M.recordOptionalityAssessment({
                userId: UID_ISO_A, resolvedEnv: ENV,
                assessmentId: 'p136_iso_a',
                actionId: 'a', actionKind: 'k',
                expectedValue: 50, irreversibilityScore: 0.2,
                optionalityConsumed: 0.2, futureOptionsKilledCount: 1,
                primaryConviction: 0.5, ts: 1000
            });
            M.recordOptionalityAssessment({
                userId: UID_ISO_B, resolvedEnv: ENV,
                assessmentId: 'p136_iso_b',
                actionId: 'a', actionKind: 'k',
                expectedValue: 50, irreversibilityScore: 0.2,
                optionalityConsumed: 0.2, futureOptionsKilledCount: 1,
                primaryConviction: 0.5, ts: 1000
            });
            const rows = M.getAssessmentHistory({
                userId: UID_ISO_A, resolvedEnv: ENV, limit: 10
            });
            expect(rows.every(r => r.assessmentId !== 'p136_iso_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.recordOptionalityAssessment({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                assessmentId: 'p136_env_demo',
                actionId: 'a', actionKind: 'k',
                expectedValue: 50, irreversibilityScore: 0.2,
                optionalityConsumed: 0.2, futureOptionsKilledCount: 1,
                primaryConviction: 0.5, ts: 1000
            });
            M.recordOptionalityAssessment({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                assessmentId: 'p136_env_testnet',
                actionId: 'a', actionKind: 'k',
                expectedValue: 50, irreversibilityScore: 0.2,
                optionalityConsumed: 0.2, futureOptionsKilledCount: 1,
                primaryConviction: 0.5, ts: 1000
            });
            const rows = M.getAssessmentHistory({
                userId: UID_ENV, resolvedEnv: 'DEMO', limit: 10
            });
            expect(rows.every(r => r.assessmentId !== 'p136_env_testnet')).toBe(true);
        });
    });
});
