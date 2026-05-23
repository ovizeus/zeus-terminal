'use strict';

/**
 * OMEGA §135 EPISTEMIC HUMILITY GOVERNOR / RIGHT-TO-BE-BOLD ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 3954-3996.
 *
 * "nu doar pot intra, dar am dreptul epistemic sa intru tare?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p135-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/epistemicHumilityGovernor');

const UID = 9135;
const UID_DEC = 9235;
const UID_HIST = 9335;
const UID_DIST = 9435;
const UID_ISO_A = 9535;
const UID_ISO_B = 9635;
const UID_ENV = 9735;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_DEC, UID_HIST, UID_DIST,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_humility_assessments WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

// Helper for building input set
function _allHigh() {
    return {
        primaryConfidence: 0.90,
        confidenceOfConfidence: 0.85,
        competenceScore: 0.85,
        unknownsDebt: 0.10,
        falseConsensusPenalty: 0.10,
        representationDebt: 0.10,
        tensionFieldLevel: 0.10
    };
}
function _allLow() {
    return {
        primaryConfidence: 0.20,
        confidenceOfConfidence: 0.20,
        competenceScore: 0.20,
        unknownsDebt: 0.80,
        falseConsensusPenalty: 0.80,
        representationDebt: 0.80,
        tensionFieldLevel: 0.80
    };
}

describe('OMEGA §135 EPISTEMIC HUMILITY GOVERNOR', () => {

    describe('Migration 258', () => {
        test('258_ml_humility_assessments migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('258_ml_humility_assessments')).toBeTruthy();
        });

        test('assessment_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_humility_assessments
                (user_id, resolved_env, assessment_id, decision_id,
                 primary_confidence, confidence_of_confidence,
                 competence_score, unknowns_debt, false_consensus_penalty,
                 representation_debt, tension_field_level,
                 humility_score, boldness_permission, size_multiplier, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p135_a_dup', 'd1',
                0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                0.5, 'moderate', 0.5, _now());
            expect(() => stmt.run(UID, ENV, 'p135_a_dup', 'd2',
                0.6, 0.6, 0.6, 0.4, 0.4, 0.4, 0.4,
                0.6, 'bold', 1.0, _now())).toThrow();
        });

        test('boldness_permission CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_humility_assessments
                (user_id, resolved_env, assessment_id, decision_id,
                 primary_confidence, confidence_of_confidence,
                 competence_score, unknowns_debt, false_consensus_penalty,
                 representation_debt, tension_field_level,
                 humility_score, boldness_permission, size_multiplier, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p135_a_bad_perm', 'd1',
                0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                0.5, 'BOGUS', 0.5, _now())).toThrow();
        });

        test('humility_score CHECK range enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_humility_assessments
                (user_id, resolved_env, assessment_id, decision_id,
                 primary_confidence, confidence_of_confidence,
                 competence_score, unknowns_debt, false_consensus_penalty,
                 representation_debt, tension_field_level,
                 humility_score, boldness_permission, size_multiplier, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p135_a_bad_score', 'd1',
                0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                1.5, 'moderate', 0.5, _now())).toThrow();
        });

        test('input range CHECK enforced (primary_confidence)', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_humility_assessments
                (user_id, resolved_env, assessment_id, decision_id,
                 primary_confidence, confidence_of_confidence,
                 competence_score, unknowns_debt, false_consensus_penalty,
                 representation_debt, tension_field_level,
                 humility_score, boldness_permission, size_multiplier, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p135_a_bad_input', 'd1',
                1.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                0.5, 'moderate', 0.5, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('BOLDNESS_PERMISSIONS frozen 3 entries (ordered low→high)', () => {
            expect(M.BOLDNESS_PERMISSIONS).toEqual([
                'humble_observer', 'moderate', 'bold'
            ]);
            expect(Object.isFrozen(M.BOLDNESS_PERMISSIONS)).toBe(true);
        });

        test('PERMISSION_THRESHOLDS ordered', () => {
            expect(M.PERMISSION_THRESHOLDS.bold).toBe(0.70);
            expect(M.PERMISSION_THRESHOLDS.moderate).toBe(0.40);
            expect(M.PERMISSION_THRESHOLDS.moderate)
                .toBeLessThan(M.PERMISSION_THRESHOLDS.bold);
        });

        test('INPUT_WEIGHTS sum to 1.0', () => {
            const sum = Object.values(M.INPUT_WEIGHTS)
                .reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0, 6);
        });

        test('INPUT_WEIGHTS has all 7 keys', () => {
            expect(Object.keys(M.INPUT_WEIGHTS).sort()).toEqual([
                'competence_score',
                'confidence_of_confidence',
                'false_consensus_penalty',
                'primary_confidence',
                'representation_debt',
                'tension_field_level',
                'unknowns_debt'
            ]);
        });

        test('SIZE_MULTIPLIERS map: bold=1.0 / moderate=0.5 / humble=0.0', () => {
            expect(M.SIZE_MULTIPLIERS.bold).toBe(1.0);
            expect(M.SIZE_MULTIPLIERS.moderate).toBe(0.5);
            expect(M.SIZE_MULTIPLIERS.humble_observer).toBe(0.0);
        });
    });

    describe('validateInputs (pure)', () => {
        test('all in range → no throw', () => {
            expect(() => M.validateInputs(_allHigh())).not.toThrow();
        });

        test('out-of-range primary throws', () => {
            const inp = _allHigh();
            inp.primaryConfidence = 1.5;
            expect(() => M.validateInputs(inp)).toThrow();
        });

        test('negative input throws', () => {
            const inp = _allHigh();
            inp.unknownsDebt = -0.1;
            expect(() => M.validateInputs(inp)).toThrow();
        });

        test('missing input throws', () => {
            const inp = _allHigh();
            delete inp.competenceScore;
            expect(() => M.validateInputs(inp)).toThrow(/missing/);
        });
    });

    describe('computeHumilityScore (pure)', () => {
        test('all-high inputs → high score (bold-eligible)', () => {
            const r = M.computeHumilityScore(_allHigh());
            // Expected: positives at ~0.87-0.90, inversions (1-0.10)=0.90 each
            // Weighted: ~0.85-0.90
            expect(r.humilityScore).toBeGreaterThan(0.70);
        });

        test('all-bad inputs → low score (humble)', () => {
            const r = M.computeHumilityScore(_allLow());
            // Expected: positives ~0.20, inversions (1-0.80)=0.20
            // Weighted: ~0.20
            expect(r.humilityScore).toBeLessThan(0.30);
        });

        test('mixed inputs → middle score', () => {
            const r = M.computeHumilityScore({
                primaryConfidence: 0.7,
                confidenceOfConfidence: 0.5,
                competenceScore: 0.5,
                unknownsDebt: 0.5,
                falseConsensusPenalty: 0.4,
                representationDebt: 0.5,
                tensionFieldLevel: 0.4
            });
            expect(r.humilityScore).toBeGreaterThan(0.40);
            expect(r.humilityScore).toBeLessThan(0.70);
        });

        test('single bad input damages score (high tension)', () => {
            const inp = _allHigh();
            inp.tensionFieldLevel = 0.95;
            const high = M.computeHumilityScore(_allHigh());
            const damaged = M.computeHumilityScore(inp);
            expect(damaged.humilityScore).toBeLessThan(high.humilityScore);
        });

        test('out-of-range throws', () => {
            const inp = _allHigh();
            inp.primaryConfidence = -0.1;
            expect(() => M.computeHumilityScore(inp)).toThrow();
        });

        test('score clamped to [0,1]', () => {
            const r = M.computeHumilityScore(_allHigh());
            expect(r.humilityScore).toBeLessThanOrEqual(1);
            expect(r.humilityScore).toBeGreaterThanOrEqual(0);
        });
    });

    describe('classifyBoldnessPermission (pure)', () => {
        test('score ≥ 0.70 → bold', () => {
            expect(M.classifyBoldnessPermission({ humilityScore: 0.85 })
                .boldnessPermission).toBe('bold');
        });

        test('score 0.40..0.70 → moderate', () => {
            expect(M.classifyBoldnessPermission({ humilityScore: 0.55 })
                .boldnessPermission).toBe('moderate');
        });

        test('score < 0.40 → humble_observer', () => {
            expect(M.classifyBoldnessPermission({ humilityScore: 0.25 })
                .boldnessPermission).toBe('humble_observer');
        });

        test('boundary 0.70 → bold', () => {
            expect(M.classifyBoldnessPermission({ humilityScore: 0.70 })
                .boldnessPermission).toBe('bold');
        });

        test('boundary 0.40 → moderate', () => {
            expect(M.classifyBoldnessPermission({ humilityScore: 0.40 })
                .boldnessPermission).toBe('moderate');
        });

        test('out-of-range throws', () => {
            expect(() => M.classifyBoldnessPermission({
                humilityScore: 1.5
            })).toThrow();
        });
    });

    describe('computeSizeMultiplier (pure)', () => {
        test('bold → 1.0', () => {
            expect(M.computeSizeMultiplier({
                boldnessPermission: 'bold'
            }).sizeMultiplier).toBe(1.0);
        });

        test('moderate → 0.5', () => {
            expect(M.computeSizeMultiplier({
                boldnessPermission: 'moderate'
            }).sizeMultiplier).toBe(0.5);
        });

        test('humble_observer → 0.0', () => {
            expect(M.computeSizeMultiplier({
                boldnessPermission: 'humble_observer'
            }).sizeMultiplier).toBe(0.0);
        });

        test('invalid permission throws', () => {
            expect(() => M.computeSizeMultiplier({
                boldnessPermission: 'BOGUS'
            })).toThrow(/invalid boldnessPermission/);
        });
    });

    describe('recordHumilityAssessment (integration)', () => {
        test('all-high inputs persists bold assessment with size 1.0', () => {
            const r = M.recordHumilityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p135_rec_bold',
                decisionId: 'dec_bold',
                ..._allHigh(),
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.boldnessPermission).toBe('bold');
            expect(r.sizeMultiplier).toBe(1.0);
            expect(r.humilityScore).toBeGreaterThan(0.70);
        });

        test('all-bad inputs persists humble assessment with size 0.0', () => {
            const r = M.recordHumilityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p135_rec_humble',
                decisionId: 'dec_humble',
                ..._allLow(),
                ts: _now()
            });
            expect(r.boldnessPermission).toBe('humble_observer');
            expect(r.sizeMultiplier).toBe(0.0);
        });

        test('mixed inputs → moderate', () => {
            const r = M.recordHumilityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p135_rec_moderate',
                decisionId: 'dec_moderate',
                primaryConfidence: 0.7,
                confidenceOfConfidence: 0.5,
                competenceScore: 0.55,
                unknownsDebt: 0.45,
                falseConsensusPenalty: 0.4,
                representationDebt: 0.5,
                tensionFieldLevel: 0.4,
                ts: _now()
            });
            expect(r.boldnessPermission).toBe('moderate');
            expect(r.sizeMultiplier).toBe(0.5);
        });

        test('duplicate assessmentId throws', () => {
            M.recordHumilityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p135_rec_dup',
                decisionId: 'd1',
                ..._allHigh(),
                ts: _now()
            });
            expect(() => M.recordHumilityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p135_rec_dup',
                decisionId: 'd2',
                ..._allLow(),
                ts: _now()
            })).toThrow(/duplicate/);
        });

        test('out-of-range input throws', () => {
            expect(() => M.recordHumilityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p135_rec_bad',
                decisionId: 'd1',
                primaryConfidence: 1.5,
                confidenceOfConfidence: 0.5,
                competenceScore: 0.5,
                unknownsDebt: 0.5,
                falseConsensusPenalty: 0.5,
                representationDebt: 0.5,
                tensionFieldLevel: 0.5,
                ts: _now()
            })).toThrow();
        });

        test('missing required input throws', () => {
            expect(() => M.recordHumilityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p135_rec_missing',
                decisionId: 'd1',
                primaryConfidence: 0.5,
                // missing confidenceOfConfidence and others
                ts: _now()
            })).toThrow(/missing/);
        });
    });

    describe('getAssessmentForDecision', () => {
        test('returns latest assessment for decision', () => {
            const u = UID_DEC;
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p135_dec_old',
                decisionId: 'dec_lookup',
                ..._allHigh(),
                ts: 1000
            });
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p135_dec_new',
                decisionId: 'dec_lookup',
                ..._allLow(),
                ts: 2000
            });
            const r = M.getAssessmentForDecision({
                userId: u, resolvedEnv: ENV,
                decisionId: 'dec_lookup'
            });
            expect(r).not.toBeNull();
            expect(r.assessmentId).toBe('p135_dec_new');
            expect(r.boldnessPermission).toBe('humble_observer');
        });

        test('returns null when no assessment', () => {
            const r = M.getAssessmentForDecision({
                userId: UID_DEC, resolvedEnv: ENV,
                decisionId: 'dec_NONEXISTENT'
            });
            expect(r).toBeNull();
        });
    });

    describe('getAssessmentHistory', () => {
        test('returns history DESC by ts', () => {
            const u = UID_HIST;
            for (let i = 0; i < 4; i++) {
                M.recordHumilityAssessment({
                    userId: u, resolvedEnv: ENV,
                    assessmentId: `p135_h_${i}`,
                    decisionId: `dec_h${i}`,
                    ..._allHigh(),
                    ts: 1000 + i * 100
                });
            }
            const rows = M.getAssessmentHistory({
                userId: u, resolvedEnv: ENV, limit: 10
            });
            expect(rows.length).toBe(4);
            expect(rows[0].assessmentId).toBe('p135_h_3');
            expect(rows[3].assessmentId).toBe('p135_h_0');
        });

        test('filter by permission works', () => {
            const u = UID_HIST;
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p135_h_f_bold',
                decisionId: 'd1',
                ..._allHigh(), ts: 2000
            });
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p135_h_f_humble',
                decisionId: 'd2',
                ..._allLow(), ts: 3000
            });
            const rows = M.getAssessmentHistory({
                userId: u, resolvedEnv: ENV,
                permissionFilter: 'bold', limit: 10
            });
            expect(rows.length).toBe(1);
            expect(rows[0].assessmentId).toBe('p135_h_f_bold');
        });

        test('invalid permissionFilter throws', () => {
            expect(() => M.getAssessmentHistory({
                userId: UID_HIST, resolvedEnv: ENV,
                permissionFilter: 'BOGUS', limit: 10
            })).toThrow(/invalid permissionFilter/);
        });
    });

    describe('getPermissionDistribution', () => {
        test('counts assessments per permission since ts', () => {
            const u = UID_DIST;
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p135_dist_b1', decisionId: 'd1',
                ..._allHigh(), ts: 1000
            });
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p135_dist_b2', decisionId: 'd2',
                ..._allHigh(), ts: 1001
            });
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p135_dist_h1', decisionId: 'd3',
                ..._allLow(), ts: 1002
            });
            const dist = M.getPermissionDistribution({
                userId: u, resolvedEnv: ENV, sinceTs: 500
            });
            expect(dist.bold).toBe(2);
            expect(dist.humble_observer).toBe(1);
            expect(dist.moderate || 0).toBe(0);
        });

        test('respects sinceTs filter', () => {
            const u = UID_DIST;
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p135_dist_old', decisionId: 'd_old',
                ..._allHigh(), ts: 100
            });
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p135_dist_new', decisionId: 'd_new',
                ..._allLow(), ts: 5000
            });
            const dist = M.getPermissionDistribution({
                userId: u, resolvedEnv: ENV, sinceTs: 1000
            });
            expect(dist.bold || 0).toBe(0);
            expect(dist.humble_observer).toBe(1);
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B assessments', () => {
            M.recordHumilityAssessment({
                userId: UID_ISO_A, resolvedEnv: ENV,
                assessmentId: 'p135_iso_a', decisionId: 'd_iso',
                ..._allHigh(), ts: _now()
            });
            M.recordHumilityAssessment({
                userId: UID_ISO_B, resolvedEnv: ENV,
                assessmentId: 'p135_iso_b', decisionId: 'd_iso',
                ..._allLow(), ts: _now()
            });
            const rows = M.getAssessmentHistory({
                userId: UID_ISO_A, resolvedEnv: ENV, limit: 10
            });
            expect(rows.every(r => r.assessmentId !== 'p135_iso_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.recordHumilityAssessment({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                assessmentId: 'p135_env_demo', decisionId: 'd_env',
                ..._allHigh(), ts: _now()
            });
            M.recordHumilityAssessment({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                assessmentId: 'p135_env_testnet', decisionId: 'd_env',
                ..._allLow(), ts: _now()
            });
            const rows = M.getAssessmentHistory({
                userId: UID_ENV, resolvedEnv: 'DEMO', limit: 10
            });
            expect(rows.every(r => r.assessmentId !== 'p135_env_testnet')).toBe(true);
        });
    });
});
