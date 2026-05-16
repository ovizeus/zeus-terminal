'use strict';

/**
 * OMEGA §133 STEELMAN ADVERSARY ENGINE / STRONGEST OPPOSING WORLDVIEW BUILDER.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 3881-3912.
 *
 * "daca cel mai inteligent adversar al meu ar incerca sa ma contrazica,
 *  ce ar spune?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p133-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R6_shadowMeta/steelmanAdversaryEngine');

const UID = 9133;
const UID_BUILD = 9233;
const UID_HIST = 9333;
const UID_ISO_A = 9433;
const UID_ISO_B = 9533;
const UID_ENV = 9633;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_BUILD, UID_HIST,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_steelman_arguments WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_steelman_constructions WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §133 STEELMAN ADVERSARY ENGINE', () => {

    describe('Migrations 254+255', () => {
        test('254_ml_steelman_arguments migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('254_ml_steelman_arguments')).toBeTruthy();
        });

        test('255_ml_steelman_constructions migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('255_ml_steelman_constructions')).toBeTruthy();
        });

        test('argument_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_steelman_arguments
                (user_id, resolved_env, argument_id, against_thesis_type,
                 argument_text, argument_strength,
                 evidence_requirements_json, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p133_a_dup', 'long_bias',
                'arg text', 0.7, '{}', 1, _now());
            expect(() => stmt.run(UID, ENV, 'p133_a_dup', 'short_bias',
                'arg2', 0.6, '{}', 1, _now())).toThrow();
        });

        test('argument_strength CHECK range enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_steelman_arguments
                (user_id, resolved_env, argument_id, against_thesis_type,
                 argument_text, argument_strength,
                 evidence_requirements_json, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p133_a_bad_str', 'long_bias',
                'arg', 1.5, '{}', 1, _now())).toThrow();
        });

        test('quality_verdict CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_steelman_constructions
                (user_id, resolved_env, construction_id, decision_id,
                 primary_thesis, opposing_thesis_type,
                 selected_arguments_json, composed_steelman,
                 quality_score, quality_verdict, primary_conviction,
                 decision_approved, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p133_c_bad_verdict',
                'd1', 'thesis A', 'long_bias',
                '[]', 'composed', 0.5, 'BOGUS', 0.6, 1, _now())
            ).toThrow();
        });

        test('decision_approved CHECK 0/1 enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_steelman_constructions
                (user_id, resolved_env, construction_id, decision_id,
                 primary_thesis, opposing_thesis_type,
                 selected_arguments_json, composed_steelman,
                 quality_score, quality_verdict, primary_conviction,
                 decision_approved, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p133_c_bad_approved',
                'd1', 'thesis A', 'long_bias',
                '[]', 'composed', 0.5, 'weak', 0.6, 2, _now())
            ).toThrow();
        });
    });

    describe('Constants', () => {
        test('QUALITY_VERDICTS frozen 3 entries', () => {
            expect(M.QUALITY_VERDICTS).toEqual(['weak', 'moderate', 'strong']);
            expect(Object.isFrozen(M.QUALITY_VERDICTS)).toBe(true);
        });

        test('QUALITY_THRESHOLDS ordered', () => {
            expect(M.QUALITY_THRESHOLDS.strong).toBe(0.70);
            expect(M.QUALITY_THRESHOLDS.moderate).toBe(0.40);
            expect(M.QUALITY_THRESHOLDS.moderate)
                .toBeLessThan(M.QUALITY_THRESHOLDS.strong);
        });

        test('MIN_ARGUMENTS_FOR_STEELMAN = 2', () => {
            expect(M.MIN_ARGUMENTS_FOR_STEELMAN).toBe(2);
        });

        test('APPROVAL_GAP map ascending by verdict strength', () => {
            expect(M.APPROVAL_GAP.weak).toBe(0.10);
            expect(M.APPROVAL_GAP.moderate).toBe(0.30);
            expect(M.APPROVAL_GAP.strong).toBe(0.50);
            expect(M.APPROVAL_GAP.weak)
                .toBeLessThan(M.APPROVAL_GAP.moderate);
            expect(M.APPROVAL_GAP.moderate)
                .toBeLessThan(M.APPROVAL_GAP.strong);
        });
    });

    describe('evidenceMatches (pure)', () => {
        test('all requirements present and matching → true', () => {
            const r = M.evidenceMatches({
                requirements: { RSI_high: true, volume_drop: true },
                available: { RSI_high: true, volume_drop: true, extra: false }
            });
            expect(r.matches).toBe(true);
            expect(r.matchFraction).toBe(1.0);
        });

        test('partial match', () => {
            const r = M.evidenceMatches({
                requirements: { a: true, b: true, c: true },
                available: { a: true, b: false }
            });
            // a matches, b doesn't (requires true, has false), c missing
            expect(r.matchFraction).toBeCloseTo(1 / 3, 6);
        });

        test('none match', () => {
            const r = M.evidenceMatches({
                requirements: { a: true, b: true },
                available: { c: true, d: true }
            });
            expect(r.matches).toBe(false);
            expect(r.matchFraction).toBe(0);
        });

        test('empty requirements → trivially matches', () => {
            const r = M.evidenceMatches({
                requirements: {},
                available: { x: true }
            });
            expect(r.matches).toBe(true);
            expect(r.matchFraction).toBe(1.0);
        });
    });

    describe('computeArgumentApplicability (pure)', () => {
        test('full strength + full match → strength', () => {
            const r = M.computeArgumentApplicability({
                argumentStrength: 0.8, evidenceMatchFraction: 1.0
            });
            expect(r.applicabilityScore).toBeCloseTo(0.8, 6);
        });

        test('full strength + half match → strength × 0.5', () => {
            const r = M.computeArgumentApplicability({
                argumentStrength: 0.8, evidenceMatchFraction: 0.5
            });
            expect(r.applicabilityScore).toBeCloseTo(0.4, 6);
        });

        test('no match → 0', () => {
            const r = M.computeArgumentApplicability({
                argumentStrength: 0.9, evidenceMatchFraction: 0
            });
            expect(r.applicabilityScore).toBe(0);
        });
    });

    describe('computeSteelmanQualityScore (pure)', () => {
        test('average of applicable scores', () => {
            const r = M.computeSteelmanQualityScore({
                applicableScores: [0.6, 0.8, 0.4]
            });
            expect(r.qualityScore).toBeCloseTo(0.6, 6);
        });

        test('below MIN_ARGUMENTS_FOR_STEELMAN → 0 (insufficient steelman)', () => {
            const r = M.computeSteelmanQualityScore({
                applicableScores: [0.9]  // single argument
            });
            expect(r.qualityScore).toBe(0);
            expect(r.insufficient).toBe(true);
        });

        test('empty → 0', () => {
            const r = M.computeSteelmanQualityScore({
                applicableScores: []
            });
            expect(r.qualityScore).toBe(0);
            expect(r.insufficient).toBe(true);
        });
    });

    describe('classifyQuality (pure)', () => {
        test('score ≥ 0.70 → strong', () => {
            expect(M.classifyQuality({ qualityScore: 0.85 })
                .qualityVerdict).toBe('strong');
        });

        test('score 0.40..0.70 → moderate', () => {
            expect(M.classifyQuality({ qualityScore: 0.55 })
                .qualityVerdict).toBe('moderate');
        });

        test('score < 0.40 → weak', () => {
            expect(M.classifyQuality({ qualityScore: 0.30 })
                .qualityVerdict).toBe('weak');
        });

        test('exact 0.70 boundary → strong', () => {
            expect(M.classifyQuality({ qualityScore: 0.70 })
                .qualityVerdict).toBe('strong');
        });

        test('exact 0.40 boundary → moderate', () => {
            expect(M.classifyQuality({ qualityScore: 0.40 })
                .qualityVerdict).toBe('moderate');
        });
    });

    describe('shouldApproveDecision (pure)', () => {
        test('primary wins big margin → approved', () => {
            // primary=0.9, quality=0.3 (weak), gap=0.10 → delta=0.6 ≥ 0.10
            const r = M.shouldApproveDecision({
                primaryConviction: 0.9, qualityScore: 0.3,
                qualityVerdict: 'weak'
            });
            expect(r.approved).toBe(true);
        });

        test('strong steelman blocks decision', () => {
            // primary=0.6, quality=0.8 (strong), gap=0.50
            // delta=-0.2 < 0.50 → rejected
            const r = M.shouldApproveDecision({
                primaryConviction: 0.6, qualityScore: 0.8,
                qualityVerdict: 'strong'
            });
            expect(r.approved).toBe(false);
        });

        test('moderate steelman needs sufficient gap', () => {
            // primary=0.7, quality=0.5 (moderate), gap=0.30
            // delta=0.2 < 0.30 → rejected
            const r = M.shouldApproveDecision({
                primaryConviction: 0.7, qualityScore: 0.5,
                qualityVerdict: 'moderate'
            });
            expect(r.approved).toBe(false);
        });

        test('moderate steelman approved with sufficient gap', () => {
            // primary=0.9, quality=0.5 (moderate), gap=0.30
            // delta=0.4 ≥ 0.30 → approved
            const r = M.shouldApproveDecision({
                primaryConviction: 0.9, qualityScore: 0.5,
                qualityVerdict: 'moderate'
            });
            expect(r.approved).toBe(true);
        });

        test('weak steelman → easy approval', () => {
            // primary=0.4, quality=0.2 (weak), gap=0.10
            // delta=0.2 ≥ 0.10 → approved
            const r = M.shouldApproveDecision({
                primaryConviction: 0.4, qualityScore: 0.2,
                qualityVerdict: 'weak'
            });
            expect(r.approved).toBe(true);
        });

        test('invalid verdict throws', () => {
            expect(() => M.shouldApproveDecision({
                primaryConviction: 0.5, qualityScore: 0.5,
                qualityVerdict: 'BOGUS'
            })).toThrow(/invalid qualityVerdict/);
        });
    });

    describe('composeSteelman (pure)', () => {
        test('joins argument texts with separator', () => {
            const r = M.composeSteelman({
                argumentTexts: [
                    'Volume divergence weakens trend.',
                    'Macro DXY breakout against.'
                ]
            });
            expect(r.composed).toContain('Volume divergence');
            expect(r.composed).toContain('Macro DXY');
        });

        test('empty array → empty steelman', () => {
            const r = M.composeSteelman({ argumentTexts: [] });
            expect(r.composed).toBe('');
        });
    });

    describe('registerArgument', () => {
        test('persists argument with evidence requirements', () => {
            const r = M.registerArgument({
                userId: UID, resolvedEnv: ENV,
                argumentId: 'p133_reg_1',
                againstThesisType: 'long_bias',
                argumentText: 'RSI shows overbought, dump risk',
                argumentStrength: 0.75,
                evidenceRequirements: { rsi_high: true, vol_decline: true },
                ts: _now()
            });
            expect(r.registered).toBe(true);
        });

        test('duplicate argumentId throws', () => {
            M.registerArgument({
                userId: UID, resolvedEnv: ENV,
                argumentId: 'p133_reg_dup',
                againstThesisType: 'long_bias',
                argumentText: 'arg',
                argumentStrength: 0.7,
                evidenceRequirements: {},
                ts: _now()
            });
            expect(() => M.registerArgument({
                userId: UID, resolvedEnv: ENV,
                argumentId: 'p133_reg_dup',
                againstThesisType: 'short_bias',
                argumentText: 'arg2',
                argumentStrength: 0.5,
                evidenceRequirements: {},
                ts: _now()
            })).toThrow(/duplicate/);
        });

        test('out-of-range strength throws', () => {
            expect(() => M.registerArgument({
                userId: UID, resolvedEnv: ENV,
                argumentId: 'p133_reg_bad',
                againstThesisType: 'long_bias',
                argumentText: 'arg',
                argumentStrength: 1.5,
                evidenceRequirements: {},
                ts: _now()
            })).toThrow();
        });
    });

    describe('constructSteelman (integration)', () => {
        test('3 args, all evidence-matching, strong + approves', () => {
            const u = UID_BUILD;
            // Register 3 strong arguments against long_bias
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_bld_a1',
                againstThesisType: 'long_bias',
                argumentText: 'RSI 85 overbought',
                argumentStrength: 0.8,
                evidenceRequirements: { rsi_high: true },
                ts: 1000
            });
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_bld_a2',
                againstThesisType: 'long_bias',
                argumentText: 'Volume divergence',
                argumentStrength: 0.75,
                evidenceRequirements: { vol_divergence: true },
                ts: 1001
            });
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_bld_a3',
                againstThesisType: 'long_bias',
                argumentText: 'Macro DXY breakout',
                argumentStrength: 0.7,
                evidenceRequirements: { dxy_breakout: true },
                ts: 1002
            });

            const r = M.constructSteelman({
                userId: u, resolvedEnv: ENV,
                constructionId: 'p133_bld_strong',
                decisionId: 'dec_long_btc',
                primaryThesis: 'BTC long entry valid',
                opposingThesisType: 'long_bias',
                availableEvidence: {
                    rsi_high: true,
                    vol_divergence: true,
                    dxy_breakout: true
                },
                primaryConviction: 0.6,
                ts: 2000
            });
            expect(r.qualityVerdict).toBe('strong');
            expect(r.qualityScore).toBeCloseTo(0.75, 2);  // avg of 0.8/0.75/0.7
            // primary=0.6, quality=0.75, gap=0.50 → delta=-0.15 < 0.50 → rejected
            expect(r.decisionApproved).toBe(false);
        });

        test('weak steelman → easy approval', () => {
            const u = UID_BUILD;
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_bld_weak_a1',
                againstThesisType: 'breakout',
                argumentText: 'Low conviction counter',
                argumentStrength: 0.3,
                evidenceRequirements: { weak_sig: true },
                ts: 1000
            });
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_bld_weak_a2',
                againstThesisType: 'breakout',
                argumentText: 'Even weaker',
                argumentStrength: 0.2,
                evidenceRequirements: { weak_sig2: true },
                ts: 1001
            });
            const r = M.constructSteelman({
                userId: u, resolvedEnv: ENV,
                constructionId: 'p133_bld_weak',
                decisionId: 'dec_breakout_btc',
                primaryThesis: 'BTC breakout valid',
                opposingThesisType: 'breakout',
                availableEvidence: {
                    weak_sig: true, weak_sig2: true
                },
                primaryConviction: 0.5,
                ts: 2000
            });
            expect(r.qualityVerdict).toBe('weak');
            // primary=0.5, quality=0.25, gap=0.10 → delta=0.25 ≥ 0.10 → approved
            expect(r.decisionApproved).toBe(true);
        });

        test('insufficient args (only 1 matches) → weak verdict default', () => {
            const u = UID_BUILD;
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_bld_solo_a1',
                againstThesisType: 'no_trade',
                argumentText: 'Strong but lonely',
                argumentStrength: 0.9,
                evidenceRequirements: { rare_sig: true },
                ts: 1000
            });
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_bld_solo_a2',
                againstThesisType: 'no_trade',
                argumentText: 'Strong but evidence missing',
                argumentStrength: 0.9,
                evidenceRequirements: { another_rare: true },
                ts: 1001
            });
            // Only 1 arg's evidence available
            const r = M.constructSteelman({
                userId: u, resolvedEnv: ENV,
                constructionId: 'p133_bld_solo',
                decisionId: 'dec_no_trade',
                primaryThesis: 'No trade is best',
                opposingThesisType: 'no_trade',
                availableEvidence: { rare_sig: true },  // only first matches
                primaryConviction: 0.5,
                ts: 2000
            });
            // Only 1 applicable score → below MIN_ARGUMENTS → insufficient → quality=0 → weak
            expect(r.qualityVerdict).toBe('weak');
            expect(r.qualityScore).toBe(0);
            // primary=0.5, quality=0, gap=0.10 → delta=0.5 ≥ 0.10 → approved
            expect(r.decisionApproved).toBe(true);
        });

        test('inactive arguments are filtered', () => {
            const u = UID_BUILD;
            // 1 active arg
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_bld_inactive_active',
                againstThesisType: 'inactive_test',
                argumentText: 'Active only',
                argumentStrength: 0.9,
                evidenceRequirements: { s1: true },
                ts: 1000
            });
            // 1 inactive arg (manual insert with active=0)
            db.prepare(`
                INSERT INTO ml_steelman_arguments
                (user_id, resolved_env, argument_id, against_thesis_type,
                 argument_text, argument_strength,
                 evidence_requirements_json, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(u, ENV, 'p133_bld_inactive_disabled',
                'inactive_test', 'Disabled', 0.9, '{"s2":true}', 0, _now());

            const r = M.constructSteelman({
                userId: u, resolvedEnv: ENV,
                constructionId: 'p133_bld_inactive_test',
                decisionId: 'dec_inact',
                primaryThesis: 'thesis',
                opposingThesisType: 'inactive_test',
                availableEvidence: { s1: true, s2: true },
                primaryConviction: 0.7,
                ts: 3000
            });
            // Only 1 applicable (active) → insufficient → weak
            expect(r.qualityVerdict).toBe('weak');
            expect(r.qualityScore).toBe(0);
        });

        test('duplicate constructionId throws', () => {
            const u = UID_BUILD;
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_bld_dup_a1',
                againstThesisType: 'dup_test',
                argumentText: 'a1', argumentStrength: 0.6,
                evidenceRequirements: {}, ts: 1000
            });
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_bld_dup_a2',
                againstThesisType: 'dup_test',
                argumentText: 'a2', argumentStrength: 0.5,
                evidenceRequirements: {}, ts: 1001
            });
            M.constructSteelman({
                userId: u, resolvedEnv: ENV,
                constructionId: 'p133_bld_dup',
                decisionId: 'd1', primaryThesis: 't',
                opposingThesisType: 'dup_test',
                availableEvidence: {}, primaryConviction: 0.5,
                ts: 2000
            });
            expect(() => M.constructSteelman({
                userId: u, resolvedEnv: ENV,
                constructionId: 'p133_bld_dup',
                decisionId: 'd2', primaryThesis: 't',
                opposingThesisType: 'dup_test',
                availableEvidence: {}, primaryConviction: 0.5,
                ts: 3000
            })).toThrow(/duplicate/);
        });
    });

    describe('getConstructionHistory', () => {
        test('returns constructions filtered by decisionId ASC by ts', () => {
            const u = UID_HIST;
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_h_a1',
                againstThesisType: 'long_bias',
                argumentText: 'arg1', argumentStrength: 0.6,
                evidenceRequirements: {}, ts: 100
            });
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_h_a2',
                againstThesisType: 'long_bias',
                argumentText: 'arg2', argumentStrength: 0.5,
                evidenceRequirements: {}, ts: 101
            });

            M.constructSteelman({
                userId: u, resolvedEnv: ENV,
                constructionId: 'p133_h_c1',
                decisionId: 'dec_hist',
                primaryThesis: 't1', opposingThesisType: 'long_bias',
                availableEvidence: {}, primaryConviction: 0.5, ts: 1000
            });
            M.constructSteelman({
                userId: u, resolvedEnv: ENV,
                constructionId: 'p133_h_c2',
                decisionId: 'dec_hist',
                primaryThesis: 't2', opposingThesisType: 'long_bias',
                availableEvidence: {}, primaryConviction: 0.5, ts: 2000
            });
            M.constructSteelman({
                userId: u, resolvedEnv: ENV,
                constructionId: 'p133_h_other',
                decisionId: 'dec_OTHER',
                primaryThesis: 't3', opposingThesisType: 'long_bias',
                availableEvidence: {}, primaryConviction: 0.5, ts: 3000
            });
            const rows = M.getConstructionHistory({
                userId: u, resolvedEnv: ENV, decisionId: 'dec_hist', limit: 10
            });
            expect(rows.length).toBe(2);
            expect(rows[0].constructionId).toBe('p133_h_c1');
            expect(rows[1].constructionId).toBe('p133_h_c2');
        });

        test('without decisionId returns all DESC by ts', () => {
            const u = UID_HIST;
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_h_all_a1',
                againstThesisType: 'tt', argumentText: 'a',
                argumentStrength: 0.5, evidenceRequirements: {}, ts: 100
            });
            M.registerArgument({
                userId: u, resolvedEnv: ENV,
                argumentId: 'p133_h_all_a2',
                againstThesisType: 'tt', argumentText: 'a',
                argumentStrength: 0.5, evidenceRequirements: {}, ts: 101
            });
            M.constructSteelman({
                userId: u, resolvedEnv: ENV,
                constructionId: 'p133_h_all_1',
                decisionId: 'd1', primaryThesis: 't', opposingThesisType: 'tt',
                availableEvidence: {}, primaryConviction: 0.5, ts: 5000
            });
            M.constructSteelman({
                userId: u, resolvedEnv: ENV,
                constructionId: 'p133_h_all_2',
                decisionId: 'd2', primaryThesis: 't', opposingThesisType: 'tt',
                availableEvidence: {}, primaryConviction: 0.5, ts: 6000
            });
            const rows = M.getConstructionHistory({
                userId: u, resolvedEnv: ENV, limit: 10
            });
            expect(rows.length).toBeGreaterThanOrEqual(2);
            expect(rows[0].constructionId).toBe('p133_h_all_2');
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B constructions', () => {
            M.registerArgument({
                userId: UID_ISO_A, resolvedEnv: ENV,
                argumentId: 'p133_iso_a_a1',
                againstThesisType: 'iso_tt',
                argumentText: 'a', argumentStrength: 0.5,
                evidenceRequirements: {}, ts: 100
            });
            M.registerArgument({
                userId: UID_ISO_A, resolvedEnv: ENV,
                argumentId: 'p133_iso_a_a2',
                againstThesisType: 'iso_tt',
                argumentText: 'a', argumentStrength: 0.5,
                evidenceRequirements: {}, ts: 101
            });
            M.registerArgument({
                userId: UID_ISO_B, resolvedEnv: ENV,
                argumentId: 'p133_iso_b_a1',
                againstThesisType: 'iso_tt',
                argumentText: 'a', argumentStrength: 0.5,
                evidenceRequirements: {}, ts: 100
            });
            M.registerArgument({
                userId: UID_ISO_B, resolvedEnv: ENV,
                argumentId: 'p133_iso_b_a2',
                againstThesisType: 'iso_tt',
                argumentText: 'a', argumentStrength: 0.5,
                evidenceRequirements: {}, ts: 101
            });
            M.constructSteelman({
                userId: UID_ISO_A, resolvedEnv: ENV,
                constructionId: 'p133_iso_c_a',
                decisionId: 'd_iso', primaryThesis: 't',
                opposingThesisType: 'iso_tt',
                availableEvidence: {}, primaryConviction: 0.5, ts: 200
            });
            M.constructSteelman({
                userId: UID_ISO_B, resolvedEnv: ENV,
                constructionId: 'p133_iso_c_b',
                decisionId: 'd_iso', primaryThesis: 't',
                opposingThesisType: 'iso_tt',
                availableEvidence: {}, primaryConviction: 0.5, ts: 200
            });
            const rows = M.getConstructionHistory({
                userId: UID_ISO_A, resolvedEnv: ENV, decisionId: 'd_iso', limit: 10
            });
            expect(rows.every(r => r.constructionId !== 'p133_iso_c_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.registerArgument({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                argumentId: 'p133_env_d_a1',
                againstThesisType: 'env_tt',
                argumentText: 'a', argumentStrength: 0.5,
                evidenceRequirements: {}, ts: 100
            });
            M.registerArgument({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                argumentId: 'p133_env_d_a2',
                againstThesisType: 'env_tt',
                argumentText: 'a', argumentStrength: 0.5,
                evidenceRequirements: {}, ts: 101
            });
            M.registerArgument({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                argumentId: 'p133_env_t_a1',
                againstThesisType: 'env_tt',
                argumentText: 'a', argumentStrength: 0.5,
                evidenceRequirements: {}, ts: 100
            });
            M.registerArgument({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                argumentId: 'p133_env_t_a2',
                againstThesisType: 'env_tt',
                argumentText: 'a', argumentStrength: 0.5,
                evidenceRequirements: {}, ts: 101
            });
            M.constructSteelman({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                constructionId: 'p133_env_c_demo',
                decisionId: 'd_env', primaryThesis: 't',
                opposingThesisType: 'env_tt',
                availableEvidence: {}, primaryConviction: 0.5, ts: 200
            });
            M.constructSteelman({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                constructionId: 'p133_env_c_testnet',
                decisionId: 'd_env', primaryThesis: 't',
                opposingThesisType: 'env_tt',
                availableEvidence: {}, primaryConviction: 0.5, ts: 200
            });
            const rows = M.getConstructionHistory({
                userId: UID_ENV, resolvedEnv: 'DEMO', decisionId: 'd_env', limit: 10
            });
            expect(rows.every(r => r.constructionId !== 'p133_env_c_testnet')).toBe(true);
        });
    });
});
