'use strict';

/**
 * OMEGA §146 IDENTITY-UNDER-TRANSFORMATION TEST.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 4718-4775.
 *
 * "daca ma modific inca putin, sunt tot eu sau deja altcineva?"
 *
 * Tests written FIRST per TDD discipline (RED step). Module does not exist
 * yet — these tests MUST fail when run before module creation.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p146-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/identityUnderTransformationTest');

const UID = 9146;
const UID_REC = 9246;
const UID_GOV = 9346;
const UID_LATEST = 9446;
const UID_FILTER = 9546;
const UID_ISO_A = 9646;
const UID_ISO_B = 9746;
const UID_ENV = 9846;
const ENV = 'DEMO';
const _now = () => Date.now();

// Helper: insert a snapshot directly into ml_identity_snapshots so we can
// FK to it from transformation tests.
function _insertSnapshot(uid, snapshotId, hashSuffix = 'x', ts = _now()) {
    const stmt = db.prepare(`
        INSERT INTO ml_identity_snapshots
        (user_id, resolved_env, snapshot_id, version_label,
         charter_hash, ontology_hash, concepts_hash,
         utility_priorities_hash, regime_grammar_hash,
         policy_style_hash, risk_philosophy_hash, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(uid, ENV, snapshotId, 'v' + hashSuffix,
        'charter_' + hashSuffix, 'ont_' + hashSuffix,
        'concepts_' + hashSuffix, 'util_' + hashSuffix,
        'regime_' + hashSuffix, 'policy_' + hashSuffix,
        'risk_' + hashSuffix, ts);
}

function cleanRows() {
    const uids = [UID, UID_REC, UID_GOV, UID_LATEST, UID_FILTER,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    // delete tests first (FK)
    db.prepare(`DELETE FROM ml_identity_transformation_tests WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_identity_snapshots WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §146 IDENTITY-UNDER-TRANSFORMATION TEST', () => {

    describe('Migration 290', () => {
        test('290 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('290_ml_identity_transformation_tests')).toBeTruthy();
        });
        test('identity_verdict CHECK enum', () => {
            _insertSnapshot(UID, 'b_bk');
            _insertSnapshot(UID, 'c_bk', 'y');
            expect(() => db.prepare(`INSERT INTO ml_identity_transformation_tests
                (user_id, resolved_env, test_id, baseline_snapshot_id, current_snapshot_id,
                 charter_drift_score, utility_function_drift_score,
                 policy_style_drift_score, ontology_drift_score,
                 regime_interpretation_drift_score, boldness_humility_drift_score,
                 replay_divergence_pct, semantic_equivalence_score,
                 composite_drift_score, identity_verdict,
                 governance_escalation_required, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_bk', 'b_bk', 'c_bk',
                    0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
                    0.1, 0.9, 0.1, 'BOGUS', 0, _now())).toThrow();
        });
        test('FK baseline_snapshot_id → ml_identity_snapshots', () => {
            expect(() => db.prepare(`INSERT INTO ml_identity_transformation_tests
                (user_id, resolved_env, test_id, baseline_snapshot_id, current_snapshot_id,
                 charter_drift_score, utility_function_drift_score,
                 policy_style_drift_score, ontology_drift_score,
                 regime_interpretation_drift_score, boldness_humility_drift_score,
                 replay_divergence_pct, semantic_equivalence_score,
                 composite_drift_score, identity_verdict,
                 governance_escalation_required, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_orphan', 'NONEXISTENT_BASE', 'NONEXISTENT_CURR',
                    0, 0, 0, 0, 0, 0, 0, 1, 0,
                    'same_agent', 0, _now())).toThrow(/FOREIGN KEY/i);
        });
        test('CHECK baseline ≠ current', () => {
            _insertSnapshot(UID, 'same_snap');
            expect(() => db.prepare(`INSERT INTO ml_identity_transformation_tests
                (user_id, resolved_env, test_id, baseline_snapshot_id, current_snapshot_id,
                 charter_drift_score, utility_function_drift_score,
                 policy_style_drift_score, ontology_drift_score,
                 regime_interpretation_drift_score, boldness_humility_drift_score,
                 replay_divergence_pct, semantic_equivalence_score,
                 composite_drift_score, identity_verdict,
                 governance_escalation_required, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_self', 'same_snap', 'same_snap',
                    0, 0, 0, 0, 0, 0, 0, 1, 0,
                    'same_agent', 0, _now())).toThrow();
        });
        test('composite_drift_score CHECK range', () => {
            _insertSnapshot(UID, 'b_range');
            _insertSnapshot(UID, 'c_range', 'y');
            expect(() => db.prepare(`INSERT INTO ml_identity_transformation_tests
                (user_id, resolved_env, test_id, baseline_snapshot_id, current_snapshot_id,
                 charter_drift_score, utility_function_drift_score,
                 policy_style_drift_score, ontology_drift_score,
                 regime_interpretation_drift_score, boldness_humility_drift_score,
                 replay_divergence_pct, semantic_equivalence_score,
                 composite_drift_score, identity_verdict,
                 governance_escalation_required, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_range', 'b_range', 'c_range',
                    0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
                    0.1, 0.9, 1.5,  // composite > 1
                    'same_agent', 0, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('IDENTITY_VERDICTS frozen 3', () => {
            expect(M.IDENTITY_VERDICTS).toEqual([
                'same_agent', 'evolved_variant', 'materially_new_agent'
            ]);
            expect(Object.isFrozen(M.IDENTITY_VERDICTS)).toBe(true);
        });
        test('DRIFT_DIMENSIONS frozen 6', () => {
            expect(M.DRIFT_DIMENSIONS).toEqual([
                'charter', 'utility_function', 'policy_style',
                'ontology', 'regime_interpretation', 'boldness_humility'
            ]);
            expect(Object.isFrozen(M.DRIFT_DIMENSIONS)).toBe(true);
        });
        test('VERDICT_THRESHOLDS ordered', () => {
            expect(M.VERDICT_THRESHOLDS.new_agent).toBe(0.70);
            expect(M.VERDICT_THRESHOLDS.evolved).toBe(0.40);
        });
        test('DIMENSION_WEIGHTS sum 1.0 + charter heaviest', () => {
            const sum = Object.values(M.DIMENSION_WEIGHTS).reduce((a,b)=>a+b,0);
            expect(sum).toBeCloseTo(1.0, 6);
            expect(M.DIMENSION_WEIGHTS.charter).toBe(0.30);
            // Charter must be heaviest
            for (const dim of M.DRIFT_DIMENSIONS) {
                if (dim !== 'charter') {
                    expect(M.DIMENSION_WEIGHTS[dim]).toBeLessThanOrEqual(M.DIMENSION_WEIGHTS.charter);
                }
            }
        });
        test('STRUCTURAL/REPLAY weights sum 1.0', () => {
            expect(M.STRUCTURAL_WEIGHT + M.REPLAY_WEIGHT).toBeCloseTo(1.0, 6);
            expect(M.STRUCTURAL_WEIGHT).toBe(0.70);
            expect(M.REPLAY_WEIGHT).toBe(0.30);
        });
        test('SEMANTIC_PRESERVE_BONUS = 0.10', () => {
            expect(M.SEMANTIC_PRESERVE_BONUS).toBe(0.10);
        });
        test('SEMANTIC_PRESERVE_THRESHOLD = 0.90', () => {
            expect(M.SEMANTIC_PRESERVE_THRESHOLD).toBe(0.90);
        });
    });

    describe('computeStructuralDrift (pure)', () => {
        test('all zero drift → 0', () => {
            const r = M.computeStructuralDrift({
                charter: 0, utility_function: 0, policy_style: 0,
                ontology: 0, regime_interpretation: 0, boldness_humility: 0
            });
            expect(r.structuralDrift).toBe(0);
        });
        test('all max drift → 1.0', () => {
            const r = M.computeStructuralDrift({
                charter: 1, utility_function: 1, policy_style: 1,
                ontology: 1, regime_interpretation: 1, boldness_humility: 1
            });
            expect(r.structuralDrift).toBe(1.0);
        });
        test('only charter drifted → 0.30 (its weight)', () => {
            const r = M.computeStructuralDrift({
                charter: 1, utility_function: 0, policy_style: 0,
                ontology: 0, regime_interpretation: 0, boldness_humility: 0
            });
            expect(r.structuralDrift).toBeCloseTo(0.30, 6);
        });
        test('out-of-range dimension throws', () => {
            expect(() => M.computeStructuralDrift({
                charter: 1.5, utility_function: 0, policy_style: 0,
                ontology: 0, regime_interpretation: 0, boldness_humility: 0
            })).toThrow();
        });
        test('missing dimension throws', () => {
            expect(() => M.computeStructuralDrift({
                charter: 0.5, utility_function: 0.5
                // others missing
            })).toThrow(/missing/);
        });
    });

    describe('computeCompositeDrift (pure)', () => {
        test('zero structural + zero replay → 0', () => {
            const r = M.computeCompositeDrift({
                structuralDrift: 0, replayDivergencePct: 0,
                semanticEquivalenceScore: 1.0
            });
            expect(r.compositeDrift).toBe(0);
        });
        test('full structural + full replay → 1.0 (without bonus)', () => {
            // 1.0 × 0.70 + 1.0 × 0.30 = 1.0, no bonus because semantic < 0.90
            const r = M.computeCompositeDrift({
                structuralDrift: 1.0, replayDivergencePct: 1.0,
                semanticEquivalenceScore: 0.5
            });
            expect(r.compositeDrift).toBe(1.0);
        });
        test('semantic preservation bonus applied when ≥0.90', () => {
            // 0.5 × 0.7 + 0.5 × 0.3 = 0.5 raw; semantic 0.95 → bonus 0.10 → 0.4
            const r = M.computeCompositeDrift({
                structuralDrift: 0.5, replayDivergencePct: 0.5,
                semanticEquivalenceScore: 0.95
            });
            expect(r.compositeDrift).toBeCloseTo(0.40, 6);
            expect(r.semanticPreserveBonusApplied).toBe(true);
        });
        test('semantic preservation NOT applied when <0.90', () => {
            const r = M.computeCompositeDrift({
                structuralDrift: 0.5, replayDivergencePct: 0.5,
                semanticEquivalenceScore: 0.85
            });
            expect(r.compositeDrift).toBeCloseTo(0.50, 6);
            expect(r.semanticPreserveBonusApplied).toBe(false);
        });
        test('clamp at 0 (bonus could not make negative)', () => {
            const r = M.computeCompositeDrift({
                structuralDrift: 0.05, replayDivergencePct: 0.05,
                semanticEquivalenceScore: 1.0
            });
            // raw 0.05 - 0.10 bonus = -0.05 → clamped 0
            expect(r.compositeDrift).toBe(0);
        });
        test('clamp at 1', () => {
            const r = M.computeCompositeDrift({
                structuralDrift: 1, replayDivergencePct: 1,
                semanticEquivalenceScore: 0
            });
            expect(r.compositeDrift).toBe(1);
        });
    });

    describe('classifyIdentityVerdict (pure)', () => {
        test('composite ≥ 0.70 → materially_new_agent', () => {
            expect(M.classifyIdentityVerdict({ compositeDrift: 0.85 }).verdict).toBe('materially_new_agent');
        });
        test('0.40 ≤ composite < 0.70 → evolved_variant', () => {
            expect(M.classifyIdentityVerdict({ compositeDrift: 0.55 }).verdict).toBe('evolved_variant');
        });
        test('composite < 0.40 → same_agent', () => {
            expect(M.classifyIdentityVerdict({ compositeDrift: 0.20 }).verdict).toBe('same_agent');
        });
        test('boundary 0.70 → materially_new_agent', () => {
            expect(M.classifyIdentityVerdict({ compositeDrift: 0.70 }).verdict).toBe('materially_new_agent');
        });
        test('boundary 0.40 → evolved_variant', () => {
            expect(M.classifyIdentityVerdict({ compositeDrift: 0.40 }).verdict).toBe('evolved_variant');
        });
        test('out-of-range throws', () => {
            expect(() => M.classifyIdentityVerdict({ compositeDrift: 1.5 })).toThrow();
        });
    });

    describe('isGovernanceEscalationRequired (pure)', () => {
        test('materially_new_agent → true', () => {
            expect(M.isGovernanceEscalationRequired({
                verdict: 'materially_new_agent'
            }).escalationRequired).toBe(true);
        });
        test('evolved_variant → false', () => {
            expect(M.isGovernanceEscalationRequired({
                verdict: 'evolved_variant'
            }).escalationRequired).toBe(false);
        });
        test('same_agent → false', () => {
            expect(M.isGovernanceEscalationRequired({
                verdict: 'same_agent'
            }).escalationRequired).toBe(false);
        });
        test('invalid throws', () => {
            expect(() => M.isGovernanceEscalationRequired({
                verdict: 'BOGUS'
            })).toThrow();
        });
    });

    describe('assessSemanticEquivalence (pure)', () => {
        test('all matches → 1.0', () => {
            const r = M.assessSemanticEquivalence({
                baselineOutputs: ['a', 'b', 'c'],
                currentOutputs: ['a', 'b', 'c']
            });
            expect(r.equivalenceScore).toBe(1.0);
        });
        test('half match → 0.5', () => {
            const r = M.assessSemanticEquivalence({
                baselineOutputs: ['a', 'b', 'c', 'd'],
                currentOutputs: ['a', 'b', 'x', 'y']
            });
            expect(r.equivalenceScore).toBe(0.5);
        });
        test('no match → 0', () => {
            const r = M.assessSemanticEquivalence({
                baselineOutputs: ['a', 'b'],
                currentOutputs: ['x', 'y']
            });
            expect(r.equivalenceScore).toBe(0);
        });
        test('length mismatch throws', () => {
            expect(() => M.assessSemanticEquivalence({
                baselineOutputs: ['a', 'b'],
                currentOutputs: ['a']
            })).toThrow(/length|mismatch/i);
        });
        test('empty arrays → 1.0 (trivially equivalent)', () => {
            const r = M.assessSemanticEquivalence({
                baselineOutputs: [], currentOutputs: []
            });
            expect(r.equivalenceScore).toBe(1.0);
        });
    });

    describe('recordTransformationTest (integration)', () => {
        test('low drift → same_agent + no escalation', () => {
            _insertSnapshot(UID_REC, 'rec_b_same');
            _insertSnapshot(UID_REC, 'rec_c_same', 'y');
            const r = M.recordTransformationTest({
                userId: UID_REC, resolvedEnv: ENV,
                testId: 't_same',
                baselineSnapshotId: 'rec_b_same',
                currentSnapshotId: 'rec_c_same',
                charterDrift: 0.05, utilityFunctionDrift: 0.05,
                policyStyleDrift: 0.05, ontologyDrift: 0.05,
                regimeInterpretationDrift: 0.05, boldnessHumilityDrift: 0.05,
                replayDivergencePct: 0.05,
                semanticEquivalenceScore: 0.98,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.verdict).toBe('same_agent');
            expect(r.escalationRequired).toBe(false);
            // raw composite ≈ 0.05; bonus -0.10 → clamped 0; below 0.40 → same
            expect(r.compositeDrift).toBe(0);
        });
        test('mid drift → evolved_variant', () => {
            _insertSnapshot(UID_REC, 'rec_b_evolved');
            _insertSnapshot(UID_REC, 'rec_c_evolved', 'y');
            const r = M.recordTransformationTest({
                userId: UID_REC, resolvedEnv: ENV,
                testId: 't_evolved',
                baselineSnapshotId: 'rec_b_evolved',
                currentSnapshotId: 'rec_c_evolved',
                charterDrift: 0.50, utilityFunctionDrift: 0.50,
                policyStyleDrift: 0.50, ontologyDrift: 0.50,
                regimeInterpretationDrift: 0.50, boldnessHumilityDrift: 0.50,
                replayDivergencePct: 0.50,
                semanticEquivalenceScore: 0.50,
                ts: _now()
            });
            // structural = 0.50, replay = 0.50, composite = 0.50, no bonus
            expect(r.compositeDrift).toBeCloseTo(0.50, 6);
            expect(r.verdict).toBe('evolved_variant');
            expect(r.escalationRequired).toBe(false);
        });
        test('high drift → materially_new_agent + escalation REQUIRED', () => {
            _insertSnapshot(UID_GOV, 'gov_b');
            _insertSnapshot(UID_GOV, 'gov_c', 'y');
            const r = M.recordTransformationTest({
                userId: UID_GOV, resolvedEnv: ENV,
                testId: 't_new_agent',
                baselineSnapshotId: 'gov_b',
                currentSnapshotId: 'gov_c',
                charterDrift: 0.90, utilityFunctionDrift: 0.90,
                policyStyleDrift: 0.90, ontologyDrift: 0.90,
                regimeInterpretationDrift: 0.90, boldnessHumilityDrift: 0.90,
                replayDivergencePct: 0.85,
                semanticEquivalenceScore: 0.10,
                ts: _now()
            });
            expect(r.verdict).toBe('materially_new_agent');
            expect(r.escalationRequired).toBe(true);
        });
        test('orphan baseline_snapshot_id → FK throw', () => {
            expect(() => M.recordTransformationTest({
                userId: UID_REC, resolvedEnv: ENV,
                testId: 't_orphan',
                baselineSnapshotId: 'NONEXISTENT',
                currentSnapshotId: 'ALSO_NONEXISTENT',
                charterDrift: 0.1, utilityFunctionDrift: 0.1,
                policyStyleDrift: 0.1, ontologyDrift: 0.1,
                regimeInterpretationDrift: 0.1, boldnessHumilityDrift: 0.1,
                replayDivergencePct: 0.1,
                semanticEquivalenceScore: 0.9,
                ts: _now()
            })).toThrow(/FOREIGN KEY|not found/i);
        });
        test('baseline == current rejected (DB CHECK)', () => {
            _insertSnapshot(UID_REC, 'same_test');
            expect(() => M.recordTransformationTest({
                userId: UID_REC, resolvedEnv: ENV,
                testId: 't_self',
                baselineSnapshotId: 'same_test',
                currentSnapshotId: 'same_test',
                charterDrift: 0, utilityFunctionDrift: 0,
                policyStyleDrift: 0, ontologyDrift: 0,
                regimeInterpretationDrift: 0, boldnessHumilityDrift: 0,
                replayDivergencePct: 0, semanticEquivalenceScore: 1,
                ts: _now()
            })).toThrow();
        });
        test('duplicate testId throws', () => {
            _insertSnapshot(UID_REC, 'dup_b');
            _insertSnapshot(UID_REC, 'dup_c', 'y');
            M.recordTransformationTest({
                userId: UID_REC, resolvedEnv: ENV,
                testId: 't_dup',
                baselineSnapshotId: 'dup_b', currentSnapshotId: 'dup_c',
                charterDrift: 0.1, utilityFunctionDrift: 0.1,
                policyStyleDrift: 0.1, ontologyDrift: 0.1,
                regimeInterpretationDrift: 0.1, boldnessHumilityDrift: 0.1,
                replayDivergencePct: 0.1, semanticEquivalenceScore: 0.9,
                ts: _now()
            });
            expect(() => M.recordTransformationTest({
                userId: UID_REC, resolvedEnv: ENV,
                testId: 't_dup',
                baselineSnapshotId: 'dup_b', currentSnapshotId: 'dup_c',
                charterDrift: 0.2, utilityFunctionDrift: 0.2,
                policyStyleDrift: 0.2, ontologyDrift: 0.2,
                regimeInterpretationDrift: 0.2, boldnessHumilityDrift: 0.2,
                replayDivergencePct: 0.2, semanticEquivalenceScore: 0.8,
                ts: _now()
            })).toThrow(/duplicate/);
        });
        test('out-of-range drift score throws', () => {
            _insertSnapshot(UID_REC, 'br_b');
            _insertSnapshot(UID_REC, 'br_c', 'y');
            expect(() => M.recordTransformationTest({
                userId: UID_REC, resolvedEnv: ENV,
                testId: 't_br',
                baselineSnapshotId: 'br_b', currentSnapshotId: 'br_c',
                charterDrift: 1.5, utilityFunctionDrift: 0.1,
                policyStyleDrift: 0.1, ontologyDrift: 0.1,
                regimeInterpretationDrift: 0.1, boldnessHumilityDrift: 0.1,
                replayDivergencePct: 0.1, semanticEquivalenceScore: 0.9,
                ts: _now()
            })).toThrow();
        });
    });

    describe('getLatestTest', () => {
        test('returns most recent test', () => {
            _insertSnapshot(UID_LATEST, 'lat_b1');
            _insertSnapshot(UID_LATEST, 'lat_c1', 'y');
            _insertSnapshot(UID_LATEST, 'lat_c2', 'z');
            M.recordTransformationTest({
                userId: UID_LATEST, resolvedEnv: ENV,
                testId: 't_lat_old',
                baselineSnapshotId: 'lat_b1', currentSnapshotId: 'lat_c1',
                charterDrift: 0.1, utilityFunctionDrift: 0.1,
                policyStyleDrift: 0.1, ontologyDrift: 0.1,
                regimeInterpretationDrift: 0.1, boldnessHumilityDrift: 0.1,
                replayDivergencePct: 0.1, semanticEquivalenceScore: 0.9,
                ts: 1000
            });
            M.recordTransformationTest({
                userId: UID_LATEST, resolvedEnv: ENV,
                testId: 't_lat_new',
                baselineSnapshotId: 'lat_b1', currentSnapshotId: 'lat_c2',
                charterDrift: 0.5, utilityFunctionDrift: 0.5,
                policyStyleDrift: 0.5, ontologyDrift: 0.5,
                regimeInterpretationDrift: 0.5, boldnessHumilityDrift: 0.5,
                replayDivergencePct: 0.5, semanticEquivalenceScore: 0.5,
                ts: 2000
            });
            const r = M.getLatestTest({
                userId: UID_LATEST, resolvedEnv: ENV
            });
            expect(r).not.toBeNull();
            expect(r.testId).toBe('t_lat_new');
        });
        test('returns null when none', () => {
            expect(M.getLatestTest({
                userId: UID_LATEST, resolvedEnv: 'REAL'
            })).toBeNull();
        });
    });

    describe('getTestsByVerdict', () => {
        test('filter by verdict', () => {
            const u = UID_FILTER;
            _insertSnapshot(u, 'flt_b');
            _insertSnapshot(u, 'flt_c1', 'y');
            _insertSnapshot(u, 'flt_c2', 'z');
            M.recordTransformationTest({
                userId: u, resolvedEnv: ENV,
                testId: 't_flt_same',
                baselineSnapshotId: 'flt_b', currentSnapshotId: 'flt_c1',
                charterDrift: 0.05, utilityFunctionDrift: 0.05,
                policyStyleDrift: 0.05, ontologyDrift: 0.05,
                regimeInterpretationDrift: 0.05, boldnessHumilityDrift: 0.05,
                replayDivergencePct: 0.05, semanticEquivalenceScore: 0.98,
                ts: 2000
            });
            M.recordTransformationTest({
                userId: u, resolvedEnv: ENV,
                testId: 't_flt_new',
                baselineSnapshotId: 'flt_b', currentSnapshotId: 'flt_c2',
                charterDrift: 0.9, utilityFunctionDrift: 0.9,
                policyStyleDrift: 0.9, ontologyDrift: 0.9,
                regimeInterpretationDrift: 0.9, boldnessHumilityDrift: 0.9,
                replayDivergencePct: 0.9, semanticEquivalenceScore: 0.1,
                ts: 3000
            });
            const newAgents = M.getTestsByVerdict({
                userId: u, resolvedEnv: ENV,
                verdict: 'materially_new_agent', limit: 10
            });
            expect(newAgents.length).toBe(1);
            expect(newAgents[0].testId).toBe('t_flt_new');
        });
        test('invalid verdict throws', () => {
            expect(() => M.getTestsByVerdict({
                userId: UID_FILTER, resolvedEnv: ENV,
                verdict: 'BOGUS', limit: 10
            })).toThrow();
        });
    });

    describe('isolation per user × env', () => {
        test('uid', () => {
            _insertSnapshot(UID_ISO_A, 'iso_a_b');
            _insertSnapshot(UID_ISO_A, 'iso_a_c', 'y');
            _insertSnapshot(UID_ISO_B, 'iso_b_b');
            _insertSnapshot(UID_ISO_B, 'iso_b_c', 'y');
            M.recordTransformationTest({
                userId: UID_ISO_A, resolvedEnv: ENV,
                testId: 'iso_a',
                baselineSnapshotId: 'iso_a_b', currentSnapshotId: 'iso_a_c',
                charterDrift: 0.1, utilityFunctionDrift: 0.1,
                policyStyleDrift: 0.1, ontologyDrift: 0.1,
                regimeInterpretationDrift: 0.1, boldnessHumilityDrift: 0.1,
                replayDivergencePct: 0.1, semanticEquivalenceScore: 0.9,
                ts: 1000
            });
            M.recordTransformationTest({
                userId: UID_ISO_B, resolvedEnv: ENV,
                testId: 'iso_b',
                baselineSnapshotId: 'iso_b_b', currentSnapshotId: 'iso_b_c',
                charterDrift: 0.1, utilityFunctionDrift: 0.1,
                policyStyleDrift: 0.1, ontologyDrift: 0.1,
                regimeInterpretationDrift: 0.1, boldnessHumilityDrift: 0.1,
                replayDivergencePct: 0.1, semanticEquivalenceScore: 0.9,
                ts: 1000
            });
            const aLatest = M.getLatestTest({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(aLatest).not.toBeNull();
            expect(aLatest.testId).toBe('iso_a');
        });
        test('env', () => {
            _insertSnapshot(UID_ENV, 'env_b');
            _insertSnapshot(UID_ENV, 'env_c', 'y');
            M.recordTransformationTest({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                testId: 'env_demo',
                baselineSnapshotId: 'env_b', currentSnapshotId: 'env_c',
                charterDrift: 0.1, utilityFunctionDrift: 0.1,
                policyStyleDrift: 0.1, ontologyDrift: 0.1,
                regimeInterpretationDrift: 0.1, boldnessHumilityDrift: 0.1,
                replayDivergencePct: 0.1, semanticEquivalenceScore: 0.9,
                ts: 1000
            });
            const testnetLatest = M.getLatestTest({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnetLatest).toBeNull();
            const demoLatest = M.getLatestTest({
                userId: UID_ENV, resolvedEnv: 'DEMO'
            });
            expect(demoLatest).not.toBeNull();
        });
    });
});
