'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p207-211-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M207 = require('../../../server/services/ml/_meta/performativeLabelAwareness');
const M208 = require('../../../server/services/ml/_meta/counterReificationGuard');
const M209 = require('../../../server/services/ml/_meta/gracefulObsolescence');
const M210 = require('../../../server/services/ml/_meta/epistemicReciprocity');
const M211 = require('../../../server/services/ml/_meta/moralLuckNormalizer');

const UID = 9207;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    for (const t of [
        'ml_performative_label_registry', 'ml_counter_reification_audits',
        'ml_graceful_obsolescence_assessments', 'ml_epistemic_reciprocity_audits',
        'ml_moral_luck_adjustments'
    ]) {
        db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(UID);
    }
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA cluster §207-§211', () => {
    test('migrations 344-348 applied', () => {
        for (const name of [
            '344_ml_performative_label_registry',
            '345_ml_counter_reification_audits',
            '346_ml_graceful_obsolescence_assessments',
            '347_ml_epistemic_reciprocity_audits',
            '348_ml_moral_luck_adjustments'
        ]) {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get(name)).toBeTruthy();
        }
    });

    describe('§207 PERFORMATIVE LABEL', () => {
        test('COMMITMENT_STRENGTHS frozen 4', () => {
            expect(M207.COMMITMENT_STRENGTHS).toEqual([
                'tentative', 'working', 'strong', 'operationally_binding'
            ]);
        });
        test('strong label + low sensitivity → premature flag', () => {
            const r = M207.detectPrematureNaming({
                commitmentStrength: 'strong', sensitivityAuditScore: 0.20
            });
            expect(r.prematureNamingFlag).toBe(1);
        });
        test('tentative label always allowed', () => {
            const r = M207.detectPrematureNaming({
                commitmentStrength: 'tentative', sensitivityAuditScore: 0.10
            });
            expect(r.prematureNamingFlag).toBe(0);
        });
        test('record label + duplicate', () => {
            const r = M207.recordLabel({
                userId: UID, resolvedEnv: ENV,
                labelId: 'l1', labelText: 'trend regime',
                commitmentStrength: 'working',
                sensitivityAuditScore: 0.75,
                downstreamConsequences: ['size_increase', 'observer_mode_off'],
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(() => M207.recordLabel({
                userId: UID, resolvedEnv: ENV,
                labelId: 'l1', labelText: 't', commitmentStrength: 'working',
                sensitivityAuditScore: 0.5, downstreamConsequences: [],
                ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('§208 COUNTER-REIFICATION', () => {
        test('high authority + low mechanism → high risk', () => {
            const r = M208.computeReificationRiskScore({
                operationalAuthorityLevel: 0.80, mechanismSupportLevel: 0.10
            });
            expect(r.reificationRiskScore).toBeCloseTo(0.72, 5);
        });
        test('classify mechanism_supported', () => {
            const r = M208.classifyExpression({
                reificationRiskScore: 0.20, mechanismSupportLevel: 0.80
            });
            expect(r.classification).toBe('mechanism_supported_claim');
        });
        test('classify unsupported_reified when high risk', () => {
            const r = M208.classifyExpression({
                reificationRiskScore: 0.75, mechanismSupportLevel: 0.10
            });
            expect(r.classification).toBe('unsupported_reified_construct');
        });
        test('record audit + penalty applied for reified', () => {
            const r = M208.recordReificationAudit({
                userId: UID, resolvedEnv: ENV,
                auditId: 'a1', expressionText: '"piata vrea lichiditate"',
                operationalAuthorityLevel: 0.80,
                mechanismSupportLevel: 0.10,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.classification).toBe('unsupported_reified_construct');
            expect(r.penaltyApplied).toBeGreaterThan(0);
        });
    });

    describe('§209 GRACEFUL OBSOLESCENCE', () => {
        test('AGING_SIGNALS frozen 4', () => {
            expect(M209.AGING_SIGNALS.length).toBe(4);
        });
        test('compute obsolescence high → sunset recommended', () => {
            const { obsolescenceScore } = M209.computeObsolescenceScore({
                excessPatchesScore: 0.85, ontologicalDebtScore: 0.80,
                defensiveConservationScore: 0.75, lowEpistemicIntakeScore: 0.85
            });
            const { sunsetRecommended } = M209.recommendSunset({ obsolescenceScore });
            expect(sunsetRecommended).toBe(1);
        });
        test('low signals → no sunset', () => {
            const { obsolescenceScore } = M209.computeObsolescenceScore({
                excessPatchesScore: 0.10, ontologicalDebtScore: 0.10,
                defensiveConservationScore: 0.10, lowEpistemicIntakeScore: 0.10
            });
            const { sunsetRecommended } = M209.recommendSunset({ obsolescenceScore });
            expect(sunsetRecommended).toBe(0);
        });
        test('record assessment', () => {
            const r = M209.recordAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'go_1', selfVersionLabel: 'v1.7.69',
                excessPatchesScore: 0.50, ontologicalDebtScore: 0.50,
                defensiveConservationScore: 0.50, lowEpistemicIntakeScore: 0.50,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.obsolescenceScore).toBe(0.5);
        });
    });

    describe('§210 EPISTEMIC RECIPROCITY', () => {
        test('high falsification + balanced → high reciprocity', () => {
            const r = M210.computeReciprocityScore({
                confirmationSeekingRatio: 0.30,
                clarificationSeekingRatio: 0.20,
                falsificationSeekingRatio: 0.50
            });
            expect(r.reciprocityScore).toBeGreaterThan(0.40);
        });
        test('confirmation > 0.70 → penalized', () => {
            const r = M210.computeReciprocityScore({
                confirmationSeekingRatio: 0.80,
                clarificationSeekingRatio: 0.10,
                falsificationSeekingRatio: 0.10
            });
            expect(r.reciprocityScore).toBeLessThan(0.10);
        });
        test('record audit', () => {
            const r = M210.recordReciprocityAudit({
                userId: UID, resolvedEnv: ENV,
                auditId: 'er_1', thesisLabel: 'BTC bull-trend confirmed',
                confirmationSeekingRatio: 0.30,
                clarificationSeekingRatio: 0.20,
                falsificationSeekingRatio: 0.50,
                disconfirmatoryObservationsCount: 5,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
        });
    });

    describe('§211 MORAL LUCK', () => {
        test('LUCK_CLASSIFICATIONS frozen 5', () => {
            expect(M211.LUCK_CLASSIFICATIONS).toEqual([
                'skilled_and_lucky', 'skilled_but_unlucky',
                'lucky_salvation', 'deserved_loss',
                'character_outcome_aligned'
            ]);
        });
        test('aligned char+outcome → character_outcome_aligned', () => {
            expect(M211.classifyLuck({
                characterQualityScore: 0.75, outcomeQualityScore: 0.80
            }).classification).toBe('character_outcome_aligned');
        });
        test('low char + high outcome → lucky_salvation', () => {
            expect(M211.classifyLuck({
                characterQualityScore: 0.20, outcomeQualityScore: 0.90
            }).classification).toBe('lucky_salvation');
        });
        test('high char + low outcome → skilled_but_unlucky', () => {
            expect(M211.classifyLuck({
                characterQualityScore: 0.85, outcomeQualityScore: 0.20
            }).classification).toBe('skilled_but_unlucky');
        });
        test('lucky_salvation → strong negative prestige correction', () => {
            expect(M211.computePrestigeCorrection({
                classification: 'lucky_salvation'
            }).prestigeCorrection).toBe(-0.50);
        });
        test('skilled_but_unlucky → positive correction', () => {
            expect(M211.computePrestigeCorrection({
                classification: 'skilled_but_unlucky'
            }).prestigeCorrection).toBe(0.30);
        });
        test('record adjustment', () => {
            const r = M211.recordMoralLuckAdjustment({
                userId: UID, resolvedEnv: ENV,
                adjustmentId: 'ml_1', decisionId: 'd1',
                characterQualityScore: 0.20, outcomeQualityScore: 0.85,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.luckClassification).toBe('lucky_salvation');
            expect(r.prestigeCorrection).toBe(-0.50);
        });
    });
});
