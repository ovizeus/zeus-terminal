'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p227-231-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M227 = require('../../../server/services/ml/_meta/legibilityTax');
const M228 = require('../../../server/services/ml/_meta/enactiveTruthResidue');
const M229 = require('../../../server/services/ml/_meta/epistemicFasting');
const M230 = require('../../../server/services/ml/_meta/proportionEngine');
const M231 = require('../../../server/services/ml/_meta/preconceptualTraceVault');

const UID = 9227;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    for (const t of [
        'ml_legibility_tax_audits', 'ml_enactive_truth_residue',
        'ml_epistemic_fasting_windows', 'ml_proportion_audits',
        'ml_preconceptual_trace_vault'
    ]) {
        db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(UID);
    }
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA cluster §227-§231', () => {
    test('migrations 354-358 applied', () => {
        for (const name of [
            '354_ml_legibility_tax_audits',
            '355_ml_enactive_truth_residue',
            '356_ml_epistemic_fasting_windows',
            '357_ml_proportion_audits',
            '358_ml_preconceptual_trace_vault'
        ]) {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get(name)).toBeTruthy();
        }
    });

    describe('§227 LEGIBILITY TAX', () => {
        test('CLASSIFICATIONS frozen 4', () => {
            expect(M227.CLASSIFICATIONS).toEqual([
                'truth_preserving_explanation', 'explanation_shaped_behavior',
                'audience_conditioned_cognition', 'performative_explainability_drift'
            ]);
        });
        test('outer >> inner → tax > 0', () => {
            const r = M227.computeLegibilityTax({
                innerFidelityScore: 0.40, outerFidelityScore: 0.95
            });
            expect(r.legibilityTaxScore).toBeCloseTo(0.55, 5);
        });
        test('outer <= inner → tax 0', () => {
            const r = M227.computeLegibilityTax({
                innerFidelityScore: 0.90, outerFidelityScore: 0.80
            });
            expect(r.legibilityTaxScore).toBe(0);
        });
        test('tax >= 0.50 → performative drift', () => {
            const r = M227.classifyDrift({ legibilityTaxScore: 0.60 });
            expect(r.classification).toBe('performative_explainability_drift');
        });
        test('tax < 0.15 → truth preserving', () => {
            const r = M227.classifyDrift({ legibilityTaxScore: 0.05 });
            expect(r.classification).toBe('truth_preserving_explanation');
        });
        test('record audit', () => {
            const r = M227.recordAudit({
                userId: UID, resolvedEnv: ENV,
                auditId: 'lt_1',
                innerFidelityScore: 0.30, outerFidelityScore: 0.90,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            // tax = 0.60 → performative drift
            expect(r.classification).toBe('performative_explainability_drift');
        });
    });

    describe('§228 ENACTIVE TRUTH RESIDUE', () => {
        test('TRUTH_CLASSES frozen 4', () => {
            expect(M228.TRUTH_CLASSES).toEqual([
                'observational', 'inferential', 'simulated', 'enactive'
            ]);
        });
        test('enactive truth gets highest weight', () => {
            const r = M228.specialWeight({ truthClass: 'enactive' });
            expect(r.weightMultiplier).toBe(3.0);
        });
        test('observational truth baseline weight', () => {
            const r = M228.specialWeight({ truthClass: 'observational' });
            expect(r.weightMultiplier).toBe(1.0);
        });
        test('invalid truthClass throws', () => {
            expect(() => M228.specialWeight({ truthClass: 'invalid' })).toThrow();
        });
        test('record residue', () => {
            const r = M228.recordResidue({
                userId: UID, resolvedEnv: ENV,
                residueId: 'etr_1', truthClass: 'enactive',
                commitmentThresholdCrossed: 1,
                unobtainableWithoutAction: 1, ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.weightMultiplier).toBe(3.0);
        });
    });

    describe('§229 EPISTEMIC FASTING', () => {
        test('INFO_CLASSES frozen 4', () => {
            expect(M229.INFO_CLASSES).toEqual([
                'beneficial', 'neutral', 'contaminating', 'premature'
            ]);
        });
        test('contaminating → abstain', () => {
            expect(M229.shouldAbstain({ infoClass: 'contaminating' }).abstain).toBe(1);
        });
        test('premature → abstain', () => {
            expect(M229.shouldAbstain({ infoClass: 'premature' }).abstain).toBe(1);
        });
        test('beneficial → no abstain', () => {
            expect(M229.shouldAbstain({ infoClass: 'beneficial' }).abstain).toBe(0);
        });
        test('open window + list active', () => {
            M229.openWindow({
                userId: UID, resolvedEnv: ENV,
                windowId: 'fw_1', sourceLabel: 'twitter_sentiment',
                infoClass: 'contaminating', durationMs: 3600_000,
                purpose: 'avoid_apophenia_during_chop',
                exitCondition: 'regime_clearly_trending', ts: _now()
            });
            const windows = M229.listActiveWindows({ userId: UID, resolvedEnv: ENV });
            expect(windows.length).toBe(1);
        });
        test('close window deactivates', () => {
            M229.openWindow({
                userId: UID, resolvedEnv: ENV,
                windowId: 'fw_2', sourceLabel: 'news',
                infoClass: 'premature', durationMs: 1800_000,
                purpose: 'preserve_clarity',
                exitCondition: 'event_settles', ts: _now()
            });
            M229.closeWindow({ windowId: 'fw_2' });
            const windows = M229.listActiveWindows({ userId: UID, resolvedEnv: ENV });
            expect(windows.find(w => w.windowId === 'fw_2')).toBeUndefined();
        });
    });

    describe('§230 PROPORTION ENGINE', () => {
        test('CLASSIFICATIONS frozen 4', () => {
            expect(M230.CLASSIFICATIONS).toEqual([
                'proportionate', 'minor_over_investigation',
                'theatrical_depth', 'philosophical_inflation_of_trivia'
            ]);
        });
        test('cost matches stake → proportionate score 1', () => {
            const r = M230.computeProportionality({
                stakeScore: 0.80, irreversibilityScore: 0.80,
                cognitiveCostScore: 0.80
            });
            expect(r.proportionalityScore).toBe(1);
        });
        test('cost wildly exceeds stake → inflation classification', () => {
            const r = M230.classifyProportion({
                proportionalityScore: 0.20,
                stakeScore: 0.10, cognitiveCostScore: 0.80
            });
            expect(r.classification).toBe('philosophical_inflation_of_trivia');
        });
        test('proportionate match → proportionate', () => {
            const r = M230.classifyProportion({
                proportionalityScore: 0.95,
                stakeScore: 0.50, cognitiveCostScore: 0.55
            });
            expect(r.classification).toBe('proportionate');
        });
        test('mandate triggers on theatrical/inflation', () => {
            expect(M230.simplificationMandate({
                classification: 'theatrical_depth'
            }).simplificationMandate).toBe(1);
            expect(M230.simplificationMandate({
                classification: 'proportionate'
            }).simplificationMandate).toBe(0);
        });
        test('record audit', () => {
            const r = M230.recordAudit({
                userId: UID, resolvedEnv: ENV,
                auditId: 'pa_1',
                stakeScore: 0.05, irreversibilityScore: 0.10,
                cognitiveCostScore: 0.90, ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.classification).toBe('philosophical_inflation_of_trivia');
            expect(r.simplificationMandate).toBe(1);
        });
    });

    describe('§231 PRECONCEPTUAL TRACE VAULT', () => {
        test('TRACE_TYPES frozen 5', () => {
            expect(M231.TRACE_TYPES.length).toBe(5);
        });
        test('NAMING_STATUSES frozen 3', () => {
            expect(M231.NAMING_STATUSES).toEqual([
                'already_nameable', 'preserved_as_raw', 'resisting_concept'
            ]);
        });
        test('capture trace defaults preserved_as_raw', () => {
            const r = M231.captureTrace({
                userId: UID, resolvedEnv: ENV,
                traceId: 'pt_1', traceType: 'something_was_off',
                rawPayload: { detail: 'orderbook flicker pre-spike' },
                persistenceScore: 0.40, ts: _now()
            });
            expect(r.captured).toBe(true);
            expect(r.namingStatus).toBe('preserved_as_raw');
        });
        test('re-illuminate to already_nameable', () => {
            M231.captureTrace({
                userId: UID, resolvedEnv: ENV,
                traceId: 'pt_2', traceType: 'pre_pattern_discomfort',
                rawPayload: { hint: 'something' },
                persistenceScore: 0.70, ts: _now()
            });
            const r = M231.reIlluminate({
                traceId: 'pt_2', newStatus: 'already_nameable'
            });
            expect(r.reIlluminated).toBe(true);
        });
        test('invalid traceType throws', () => {
            expect(() => M231.captureTrace({
                userId: UID, resolvedEnv: ENV,
                traceId: 'pt_3', traceType: 'invalid',
                rawPayload: {}, persistenceScore: 0.5, ts: _now()
            })).toThrow(/invalid traceType/);
        });
    });
});
