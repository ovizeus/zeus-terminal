'use strict';

/**
 * OMEGA §197-§201 — exteriority / tragic_choice / mourning / sacred / reverence.
 * Compact cluster tests, smoke-coverage for each module.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p197-201-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M197 = require('../../../server/services/ml/_meta/exterioriyCovenant');
const M198 = require('../../../server/services/ml/_meta/tragicChoiceEngine');
const M199 = require('../../../server/services/ml/_meta/ontologicalMourning');
const M200 = require('../../../server/services/ml/_meta/sacredNonOptimizationZones');
const M201 = require('../../../server/services/ml/_meta/reverenceForResidual');

const UID = 9197;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    db.prepare(`DELETE FROM ml_exteriority_validation_requirements WHERE user_id=?`).run(UID);
    db.prepare(`DELETE FROM ml_tragic_choice_decisions WHERE user_id=?`).run(UID);
    db.prepare(`DELETE FROM ml_ontological_mourning_records WHERE user_id=?`).run(UID);
    db.prepare(`DELETE FROM ml_sacred_non_optimization_registry WHERE user_id=?`).run(UID);
    db.prepare(`DELETE FROM ml_residual_reverence_assessments WHERE user_id=?`).run(UID);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA cluster §197-§201', () => {
    test('migrations 339-343 applied', () => {
        for (const n of [339, 340, 341, 342, 343]) {
            const name = ({
                339: '339_ml_exteriority_validation_requirements',
                340: '340_ml_tragic_choice_decisions',
                341: '341_ml_ontological_mourning_records',
                342: '342_ml_sacred_non_optimization_registry',
                343: '343_ml_residual_reverence_assessments'
            })[n];
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get(name)).toBeTruthy();
        }
    });

    describe('§197 EXTERIORITY COVENANT', () => {
        test('VALIDATION_ZONES frozen 3', () => {
            expect(M197.VALIDATION_ZONES).toEqual([
                'self_knowledge_internal', 'self_knowledge_external_only', 'mixed_validation'
            ]);
            expect(Object.isFrozen(M197.VALIDATION_ZONES)).toBe(true);
        });
        test('external_only → external validator required', () => {
            expect(M197.determineExternalRequirement({
                validationZone: 'self_knowledge_external_only'
            }).externalValidatorRequired).toBe(1);
        });
        test('internal alone → no external', () => {
            expect(M197.determineExternalRequirement({
                validationZone: 'self_knowledge_internal'
            }).externalValidatorRequired).toBe(0);
        });
        test('claims complete autonomy + external zone → penalty 1.0', () => {
            const r = M197.computeSelfSufficiencyPenalty({
                validationZone: 'self_knowledge_external_only',
                claimsCompleteAutonomy: true
            });
            expect(r.penalty).toBe(1.0);
        });
        test('no autonomy claim → 0 penalty', () => {
            const r = M197.computeSelfSufficiencyPenalty({
                validationZone: 'self_knowledge_external_only',
                claimsCompleteAutonomy: false
            });
            expect(r.penalty).toBe(0);
        });
        test('record + duplicate throws', () => {
            const r = M197.recordValidationRequirement({
                userId: UID, resolvedEnv: ENV,
                requirementId: 'er_1', categoryLabel: 'self-consistency proof',
                validationZone: 'self_knowledge_external_only',
                claimsCompleteAutonomy: false, ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.externalValidatorRequired).toBe(1);
            expect(() => M197.recordValidationRequirement({
                userId: UID, resolvedEnv: ENV,
                requirementId: 'er_1', categoryLabel: 'l',
                validationZone: 'mixed_validation', ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('§198 TRAGIC CHOICE', () => {
        test('computeLeastBetrayalScore: preserved > sacrificed → > 0.5', () => {
            const r = M198.computeLeastBetrayalScore({
                preservedValues: [{ name: 'safety', weight: 0.80 }],
                sacrificedValues: [{ name: 'opportunity', weight: 0.30 }]
            });
            expect(r.leastBetrayalScore).toBeGreaterThan(0.6);
        });
        test('record tragic choice', () => {
            const r = M198.recordTragicChoice({
                userId: UID, resolvedEnv: ENV,
                decisionId: 'tc_1', dilemmaLabel: 'capital vs opportunity',
                conflictingValues: ['capital_preservation', 'opportunity_capture'],
                chosenOption: 'preserve_capital',
                sacrificedValues: [{ name: 'unique_window', weight: 0.40 }],
                preservedValues: [{ name: 'capital', weight: 0.70 }],
                dignityOfLossAcknowledged: true,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.dignityOfLossAcknowledged).toBe(1);
        });
        test('duplicate throws', () => {
            M198.recordTragicChoice({
                userId: UID, resolvedEnv: ENV,
                decisionId: 'tc_dup', dilemmaLabel: 'd',
                conflictingValues: ['a'], chosenOption: 'b',
                sacrificedValues: [], preservedValues: [], ts: _now()
            });
            expect(() => M198.recordTragicChoice({
                userId: UID, resolvedEnv: ENV,
                decisionId: 'tc_dup', dilemmaLabel: 'd',
                conflictingValues: ['a'], chosenOption: 'b',
                sacrificedValues: [], preservedValues: [], ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('§199 ONTOLOGICAL MOURNING', () => {
        test('FRAMEWORK_TYPES frozen 5 canonical', () => {
            expect(M199.FRAMEWORK_TYPES).toEqual([
                'concept', 'detector', 'causal_belief',
                'strategy_archetype', 'worldview'
            ]);
        });
        test('REASONS_FOR_DEATH frozen 5 canonical', () => {
            expect(M199.REASONS_FOR_DEATH).toEqual([
                'crowding', 'drift', 'ontological_insufficiency',
                'causal_collapse', 'local_only_truth_universalized'
            ]);
        });
        test('record mourning with epitaph', () => {
            const r = M199.recordMourning({
                userId: UID, resolvedEnv: ENV,
                mourningId: 'm_1',
                frameworkLabel: 'whale-alert sentiment as primary signal',
                frameworkType: 'detector',
                reasonForDeath: 'drift',
                epitaphText: 'served well in retail-heavy 2021-2023, drifted as ETFs reshaped flow',
                preservedLessonText: 'crowd-data signals decay when capital structure changes',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.reasonForDeath).toBe('drift');
        });
        test('invalid framework_type throws', () => {
            expect(() => M199.recordMourning({
                userId: UID, resolvedEnv: ENV,
                mourningId: 'm_bad', frameworkLabel: 'l',
                frameworkType: 'BOGUS', reasonForDeath: 'drift',
                epitaphText: 'e', ts: _now()
            })).toThrow();
        });
    });

    describe('§200 SACRED NON-OPTIMIZATION ZONES', () => {
        test('OPTIMIZATION_TIERS frozen 3', () => {
            expect(M200.OPTIMIZATION_TIERS).toEqual([
                'may_be_optimized', 'conditional_optimization_only',
                'never_purely_instrumental'
            ]);
        });
        test('allowsOptimization correctly maps tiers', () => {
            expect(M200.allowsOptimization({ optimizationTier: 'may_be_optimized' }).allowed).toBe('yes');
            expect(M200.allowsOptimization({ optimizationTier: 'never_purely_instrumental' }).allowed).toBe('no');
            expect(M200.allowsOptimization({ optimizationTier: 'conditional_optimization_only' }).allowed).toBe('requires_review');
        });
        test('register + getActive + deactivate', () => {
            M200.registerProtectedQuantity({
                userId: UID, resolvedEnv: ENV,
                entryId: 'sp_1',
                protectedQuantityLabel: 'reserve_capital_minimum',
                optimizationTier: 'never_purely_instrumental',
                ts: _now()
            });
            const active = M200.getActive({ userId: UID, resolvedEnv: ENV });
            expect(active.length).toBe(1);
            M200.deactivateProtected({
                userId: UID, resolvedEnv: ENV, entryId: 'sp_1'
            });
            const post = M200.getActive({ userId: UID, resolvedEnv: ENV });
            expect(post.length).toBe(0);
        });
    });

    describe('§201 REVERENCE FOR RESIDUAL', () => {
        test('detectEntitlement: high frustration → detected', () => {
            expect(M201.detectEntitlement({ fitFrustrationLevel: 0.70 }).entitlementDetected).toBe(1);
            expect(M201.detectEntitlement({ fitFrustrationLevel: 0.20 }).entitlementDetected).toBe(0);
        });
        test('detectForcingAttempt: high pressure → detected', () => {
            expect(M201.detectForcingAttempt({ modelForcingPressure: 0.70 }).forcingDetected).toBe(1);
            expect(M201.detectForcingAttempt({ modelForcingPressure: 0.20 }).forcingDetected).toBe(0);
        });
        test('recommendPosture: forcing → retreat', () => {
            expect(M201.recommendPosture({
                entitlementDetected: 0, forcingDetected: 1, reverenceScore: 0.5
            }).posture).toBe('retreat');
        });
        test('recommendPosture: entitlement → reduce_pretension', () => {
            expect(M201.recommendPosture({
                entitlementDetected: 1, forcingDetected: 0, reverenceScore: 0.5
            }).posture).toBe('reduce_pretension');
        });
        test('record assessment', () => {
            const r = M201.recordReverenceAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'rr_1',
                residualLabel: 'unexplained mid-day spike pattern',
                reverenceScore: 0.70,
                fitFrustrationLevel: 0.20,
                modelForcingPressure: 0.15,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.recommendedPosture).toBe('continue');
        });
    });
});
