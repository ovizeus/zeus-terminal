'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p217-221-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M217 = require('../../../server/services/ml/_meta/unchosenQuestionDetector');
const M218 = require('../../../server/services/ml/_meta/semanticEventHorizon');
const M219 = require('../../../server/services/ml/_meta/onticFrictionMeter');
const M220 = require('../../../server/services/ml/_meta/counterfactualSelfAbsence');
const M221 = require('../../../server/services/ml/_meta/sacredIncompletionCovenant');

const UID = 9217;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    for (const t of [
        'ml_unchosen_question_audits', 'ml_semantic_event_horizon_audits',
        'ml_ontic_friction_audits', 'ml_self_absence_counterfactuals',
        'ml_sacred_incompletion_registry'
    ]) {
        db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(UID);
    }
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA cluster §217-§221', () => {
    test('migrations 349-353 applied', () => {
        for (const name of [
            '349_ml_unchosen_question_audits',
            '350_ml_semantic_event_horizon_audits',
            '351_ml_ontic_friction_audits',
            '352_ml_self_absence_counterfactuals',
            '353_ml_sacred_incompletion_registry'
        ]) {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get(name)).toBeTruthy();
        }
    });

    describe('§217 UNCHOSEN QUESTION DETECTOR', () => {
        test('QUESTION_STATUSES frozen 4', () => {
            expect(M217.QUESTION_STATUSES).toEqual([
                'answered_question', 'avoided_question',
                'suppressed_question', 'missing_higher_order_question'
            ]);
        });
        test('RECOMMENDED_ACTIONS frozen 5', () => {
            expect(M217.RECOMMENDED_ACTIONS).toEqual([
                'proceed', 'wait', 'reframe', 'escalate', 'observe'
            ]);
        });
        test('missing_higher_order + high framing → escalate', () => {
            const r = M217.recommendAction({
                framingStressScore: 0.80,
                questionStatus: 'missing_higher_order_question'
            });
            expect(r.action).toBe('escalate');
        });
        test('avoided + high framing → reframe', () => {
            const r = M217.recommendAction({
                framingStressScore: 0.70,
                questionStatus: 'avoided_question'
            });
            expect(r.action).toBe('reframe');
        });
        test('suppressed + low framing → observe', () => {
            const r = M217.recommendAction({
                framingStressScore: 0.20,
                questionStatus: 'suppressed_question'
            });
            expect(r.action).toBe('observe');
        });
        test('answered + low framing → proceed', () => {
            const r = M217.recommendAction({
                framingStressScore: 0.10,
                questionStatus: 'answered_question'
            });
            expect(r.action).toBe('proceed');
        });
        test('record audit + duplicate throws', () => {
            const r = M217.recordAudit({
                userId: UID, resolvedEnv: ENV,
                auditId: 'uq_1', currentQuestion: 'is BTC bullish?',
                latentQuestions: ['is this regime even classifiable?'],
                framingStressScore: 0.65,
                questionStatus: 'missing_higher_order_question',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.recommendedAction).toBe('escalate');
            expect(() => M217.recordAudit({
                userId: UID, resolvedEnv: ENV,
                auditId: 'uq_1', currentQuestion: 'x',
                latentQuestions: [], framingStressScore: 0.5,
                questionStatus: 'answered_question', ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('§218 SEMANTIC EVENT HORIZON', () => {
        test('REFLECTION_CLASSIFICATIONS frozen 4', () => {
            expect(M218.REFLECTION_CLASSIFICATIONS).toEqual([
                'useful_reflection', 'heavy_reflection',
                'self_referential_orbit', 'epistemic_blackhole_risk'
            ]);
        });
        test('COLLAPSE_DEPTH = 5', () => {
            expect(M218.COLLAPSE_DEPTH).toBe(5);
        });
        test('depth >= 5 → blackhole_risk', () => {
            const r = M218.classifyReflection({
                recursiveDepth: 5, saturationScore: 0.30
            });
            expect(r.classification).toBe('epistemic_blackhole_risk');
        });
        test('saturation >= 0.85 → blackhole_risk', () => {
            const r = M218.classifyReflection({
                recursiveDepth: 2, saturationScore: 0.90
            });
            expect(r.classification).toBe('epistemic_blackhole_risk');
        });
        test('saturation 0.65-0.85 → orbit', () => {
            const r = M218.classifyReflection({
                recursiveDepth: 3, saturationScore: 0.70
            });
            expect(r.classification).toBe('self_referential_orbit');
        });
        test('saturation 0.40-0.65 → heavy', () => {
            const r = M218.classifyReflection({
                recursiveDepth: 2, saturationScore: 0.50
            });
            expect(r.classification).toBe('heavy_reflection');
        });
        test('low saturation + low depth → useful', () => {
            const r = M218.classifyReflection({
                recursiveDepth: 1, saturationScore: 0.20
            });
            expect(r.classification).toBe('useful_reflection');
        });
        test('blackhole → collapse invoked', () => {
            const r = M218.shouldCollapseToWorld({
                classification: 'epistemic_blackhole_risk'
            });
            expect(r.collapseInvoked).toBe(1);
        });
        test('useful reflection → no collapse', () => {
            const r = M218.shouldCollapseToWorld({
                classification: 'useful_reflection'
            });
            expect(r.collapseInvoked).toBe(0);
        });
        test('record audit', () => {
            const r = M218.recordAudit({
                userId: UID, resolvedEnv: ENV,
                auditId: 'seh_1',
                recursiveDepth: 6, saturationScore: 0.92,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.reflectionClassification).toBe('epistemic_blackhole_risk');
            expect(r.collapseToWorldInvoked).toBe(1);
        });
    });

    describe('§219 ONTIC FRICTION METER', () => {
        test('CLASSIFICATIONS frozen 4', () => {
            expect(M219.CLASSIFICATIONS).toEqual([
                'productive_compression', 'acceptable_loss',
                'dangerous_oversmoothing', 'semantic_sanding_of_reality'
            ]);
        });
        test('cumulative loss from per-layer losses', () => {
            // independent compounding: 1 - (1-0.1)*(1-0.1)*(1-0.1) = 0.271
            const r = M219.computeCumulativeLoss({
                perLayerLosses: [0.10, 0.10, 0.10]
            });
            expect(r.cumulativeLossScore).toBeCloseTo(0.271, 5);
        });
        test('classify productive_compression < 0.25', () => {
            const r = M219.classifyLoss({ cumulativeLossScore: 0.10 });
            expect(r.classification).toBe('productive_compression');
        });
        test('classify acceptable 0.25-0.50', () => {
            const r = M219.classifyLoss({ cumulativeLossScore: 0.40 });
            expect(r.classification).toBe('acceptable_loss');
        });
        test('classify dangerous_oversmoothing 0.50-0.75', () => {
            const r = M219.classifyLoss({ cumulativeLossScore: 0.60 });
            expect(r.classification).toBe('dangerous_oversmoothing');
        });
        test('classify sanding >= 0.75', () => {
            const r = M219.classifyLoss({ cumulativeLossScore: 0.85 });
            expect(r.classification).toBe('semantic_sanding_of_reality');
        });
        test('recommend raw replay for dangerous/sanding', () => {
            expect(M219.recommendRawReplay({
                classification: 'dangerous_oversmoothing'
            }).recommendRawReplay).toBe(1);
            expect(M219.recommendRawReplay({
                classification: 'productive_compression'
            }).recommendRawReplay).toBe(0);
        });
        test('record audit', () => {
            const r = M219.recordAudit({
                userId: UID, resolvedEnv: ENV,
                auditId: 'of_1',
                transformationChain: ['raw_tick', 'feature_bin', 'regime_label'],
                perLayerLosses: [0.20, 0.30, 0.40],
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            // 1 - 0.8*0.7*0.6 = 0.664 → dangerous_oversmoothing
            expect(r.cumulativeLossScore).toBeCloseTo(0.664, 3);
            expect(r.classification).toBe('dangerous_oversmoothing');
            expect(r.recommendRawReplay).toBe(1);
        });
    });

    describe('§220 COUNTERFACTUAL SELF-ABSENCE', () => {
        test('CLASSIFICATIONS frozen 4', () => {
            expect(M220.CLASSIFICATIONS).toEqual([
                'truly_external_signal', 'weakly_self_influenced_signal',
                'heavily_self_shaped_signal', 'self_created_task'
            ]);
        });
        test('dep < 0.30 → truly_external', () => {
            const r = M220.classifyDependency({ dependencyScore: 0.10 });
            expect(r.classification).toBe('truly_external_signal');
        });
        test('dep 0.30-0.60 → weakly_self_influenced', () => {
            const r = M220.classifyDependency({ dependencyScore: 0.40 });
            expect(r.classification).toBe('weakly_self_influenced_signal');
        });
        test('dep 0.60-0.85 → heavily_self_shaped', () => {
            const r = M220.classifyDependency({ dependencyScore: 0.70 });
            expect(r.classification).toBe('heavily_self_shaped_signal');
        });
        test('dep >= 0.85 → self_created_task', () => {
            const r = M220.classifyDependency({ dependencyScore: 0.90 });
            expect(r.classification).toBe('self_created_task');
        });
        test('boldness adjustment by class', () => {
            expect(M220.boldnessAdjustment({
                classification: 'truly_external_signal'
            }).boldnessAdjustment).toBe(1.0);
            expect(M220.boldnessAdjustment({
                classification: 'self_created_task'
            }).boldnessAdjustment).toBe(0.20);
        });
        test('record counterfactual', () => {
            const r = M220.recordCounterfactual({
                userId: UID, resolvedEnv: ENV,
                counterfactualId: 'cf_1',
                phenomenonLabel: 'BTC liquidity gap detected',
                dependencyScore: 0.92, ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.classification).toBe('self_created_task');
            expect(r.boldnessAdjustment).toBe(0.20);
        });
    });

    describe('§221 SACRED INCOMPLETION COVENANT', () => {
        test('ZONE_TYPES frozen 4', () => {
            expect(M221.ZONE_TYPES).toEqual([
                'unfinished_concept', 'open_ontology',
                'structurally_open_question', 'exploratory_channel'
            ]);
        });
        test('high pressure → premature flag', () => {
            const r = M221.flagPrematureClosure({
                completionPressureScore: 0.80
            });
            expect(r.prematureClosureFlag).toBe(1);
        });
        test('low pressure → no flag', () => {
            const r = M221.flagPrematureClosure({
                completionPressureScore: 0.20
            });
            expect(r.prematureClosureFlag).toBe(0);
        });
        test('register zone + list active', () => {
            M221.registerZone({
                userId: UID, resolvedEnv: ENV,
                entryId: 'z1', zoneLabel: 'mid-regime ambiguity',
                zoneType: 'open_ontology',
                completionPressureScore: 0.30, ts: _now()
            });
            const zones = M221.listActiveZones({
                userId: UID, resolvedEnv: ENV
            });
            expect(zones.length).toBe(1);
            expect(zones[0].zoneType).toBe('open_ontology');
        });
        test('deactivate zone hides from active list', () => {
            M221.registerZone({
                userId: UID, resolvedEnv: ENV,
                entryId: 'z2', zoneLabel: 'speculative branch',
                zoneType: 'exploratory_channel',
                completionPressureScore: 0.20, ts: _now()
            });
            M221.deactivateZone({ entryId: 'z2' });
            const zones = M221.listActiveZones({
                userId: UID, resolvedEnv: ENV
            });
            expect(zones.find(z => z.entryId === 'z2')).toBeUndefined();
        });
        test('duplicate entryId throws', () => {
            M221.registerZone({
                userId: UID, resolvedEnv: ENV,
                entryId: 'z3', zoneLabel: 'x', zoneType: 'unfinished_concept',
                completionPressureScore: 0.5, ts: _now()
            });
            expect(() => M221.registerZone({
                userId: UID, resolvedEnv: ENV,
                entryId: 'z3', zoneLabel: 'x', zoneType: 'unfinished_concept',
                completionPressureScore: 0.5, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('invalid zoneType throws', () => {
            expect(() => M221.registerZone({
                userId: UID, resolvedEnv: ENV,
                entryId: 'z4', zoneLabel: 'x', zoneType: 'invalid_type',
                completionPressureScore: 0.5, ts: _now()
            })).toThrow(/invalid zoneType/);
        });
    });
});
