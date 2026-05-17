'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p237-241-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M237 = require('../../../server/services/ml/_meta/articulationLossLaw');
const M238 = require('../../../server/services/ml/_meta/selfTriangulation');
const M239 = require('../../../server/services/ml/_meta/voluntaryPowerRenunciation');
const M240 = require('../../../server/services/ml/_meta/returnPathCovenant');
const M241 = require('../../../server/services/ml/_meta/rightfulUnknown');

const UID = 9237;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    for (const t of [
        'ml_articulation_loss_audits', 'ml_self_triangulation_audits',
        'ml_power_renunciation_audits', 'ml_return_path_covenants',
        'ml_rightful_unknown_registry'
    ]) {
        db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(UID);
    }
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA CAPSTONE cluster §237-§241 (final canonical points)', () => {
    test('migrations 359-363 applied', () => {
        for (const name of [
            '359_ml_articulation_loss_audits',
            '360_ml_self_triangulation_audits',
            '361_ml_power_renunciation_audits',
            '362_ml_return_path_covenants',
            '363_ml_rightful_unknown_registry'
        ]) {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get(name)).toBeTruthy();
        }
    });

    describe('§237 ARTICULATION LOSS LAW', () => {
        test('KNOWLEDGE_CLASSES frozen 4', () => {
            expect(M237.KNOWLEDGE_CLASSES).toEqual([
                'explicit_knowledge', 'tacit_knowledge',
                'fragile_insight', 'articulation_sensitive'
            ]);
        });
        test('fragile_insight + high loss → preserve tacit', () => {
            const r = M237.shouldPreserveTacit({
                knowledgeClass: 'fragile_insight',
                articulationLossScore: 0.80
            });
            expect(r.preserveWithoutFullArticulation).toBe(1);
        });
        test('explicit_knowledge + high loss → no preservation', () => {
            const r = M237.shouldPreserveTacit({
                knowledgeClass: 'explicit_knowledge',
                articulationLossScore: 0.90
            });
            expect(r.preserveWithoutFullArticulation).toBe(0);
        });
        test('articulation_sensitive + low loss → no preservation', () => {
            const r = M237.shouldPreserveTacit({
                knowledgeClass: 'articulation_sensitive',
                articulationLossScore: 0.30
            });
            expect(r.preserveWithoutFullArticulation).toBe(0);
        });
        test('record audit', () => {
            const r = M237.recordAudit({
                userId: UID, resolvedEnv: ENV,
                auditId: 'al_1', knowledgeClass: 'articulation_sensitive',
                articulationLossScore: 0.75, ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.preserveWithoutFullArticulation).toBe(1);
        });
    });

    describe('§238 SELF TRIANGULATION', () => {
        test('CLASSIFICATIONS frozen 4', () => {
            expect(M238.CLASSIFICATIONS).toEqual([
                'converged', 'self_deception_detected',
                'observer_illusion_detected', 'outcome_distortion_detected'
            ]);
        });
        test('all three high → converged', () => {
            const { convergenceScore } = M238.computeConvergence({
                innerSelfReportScore: 0.85,
                outerAuditScore: 0.85, worldEffectScore: 0.85
            });
            const { classification } = M238.detectDivergence({
                innerSelfReportScore: 0.85,
                outerAuditScore: 0.85, worldEffectScore: 0.85,
                convergenceScore
            });
            expect(classification).toBe('converged');
        });
        test('inner high, others low → self_deception', () => {
            const { convergenceScore } = M238.computeConvergence({
                innerSelfReportScore: 0.90,
                outerAuditScore: 0.20, worldEffectScore: 0.30
            });
            const { classification } = M238.detectDivergence({
                innerSelfReportScore: 0.90,
                outerAuditScore: 0.20, worldEffectScore: 0.30,
                convergenceScore
            });
            expect(classification).toBe('self_deception_detected');
        });
        test('outer high, others low → observer_illusion', () => {
            const { convergenceScore } = M238.computeConvergence({
                innerSelfReportScore: 0.20,
                outerAuditScore: 0.95, worldEffectScore: 0.30
            });
            const { classification } = M238.detectDivergence({
                innerSelfReportScore: 0.20,
                outerAuditScore: 0.95, worldEffectScore: 0.30,
                convergenceScore
            });
            expect(classification).toBe('observer_illusion_detected');
        });
        test('world high, others low → outcome_distortion (lucky)', () => {
            const { convergenceScore } = M238.computeConvergence({
                innerSelfReportScore: 0.30,
                outerAuditScore: 0.25, worldEffectScore: 0.95
            });
            const { classification } = M238.detectDivergence({
                innerSelfReportScore: 0.30,
                outerAuditScore: 0.25, worldEffectScore: 0.95,
                convergenceScore
            });
            expect(classification).toBe('outcome_distortion_detected');
        });
        test('record audit', () => {
            const r = M238.recordAudit({
                userId: UID, resolvedEnv: ENV,
                auditId: 'st_1',
                innerSelfReportScore: 0.90,
                outerAuditScore: 0.20, worldEffectScore: 0.30,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.classification).toBe('self_deception_detected');
        });
    });

    describe('§239 VOLUNTARY POWER RENUNCIATION', () => {
        test('AVAILABILITIES frozen 3', () => {
            expect(M239.AVAILABILITIES).toEqual(['cannot', 'should_not', 'could_but_will_not']);
        });
        test('cannot → forced_incapacity', () => {
            const r = M239.classifyRenunciation({
                availability: 'cannot', lucidityScore: 0.90
            });
            expect(r.renunciationType).toBe('forced_incapacity');
        });
        test('could_but_will_not + high lucidity → sovereign_non_use', () => {
            const r = M239.classifyRenunciation({
                availability: 'could_but_will_not', lucidityScore: 0.85
            });
            expect(r.renunciationType).toBe('sovereign_non_use');
        });
        test('could_but_will_not + low lucidity → coward_restraint', () => {
            const r = M239.classifyRenunciation({
                availability: 'could_but_will_not', lucidityScore: 0.20
            });
            expect(r.renunciationType).toBe('coward_restraint');
        });
        test('sovereign_non_use → honor 1.0', () => {
            const r = M239.honorScore({ renunciationType: 'sovereign_non_use' });
            expect(r.renunciationHonorScore).toBe(1.0);
        });
        test('forced_incapacity → honor 0', () => {
            const r = M239.honorScore({ renunciationType: 'forced_incapacity' });
            expect(r.renunciationHonorScore).toBe(0);
        });
        test('record audit', () => {
            const r = M239.recordAudit({
                userId: UID, resolvedEnv: ENV,
                auditId: 'pr_1', powerLabel: 'aggressive_size_doubling',
                availability: 'could_but_will_not', lucidityScore: 0.85,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.renunciationType).toBe('sovereign_non_use');
            expect(r.renunciationHonorScore).toBe(1.0);
        });
    });

    describe('§240 RETURN PATH COVENANT', () => {
        test('CLASSIFICATIONS frozen 4', () => {
            expect(M240.CLASSIFICATIONS).toEqual([
                'fully_reversible', 'partially_reversible',
                'minimum_recoverable', 'non_recoverable'
            ]);
        });
        test('high reversibility → fully_reversible', () => {
            const r = M240.classifyReversibility({ reversibilityScore: 0.90 });
            expect(r.classification).toBe('fully_reversible');
        });
        test('low reversibility → non_recoverable', () => {
            const r = M240.classifyReversibility({ reversibilityScore: 0.10 });
            expect(r.classification).toBe('non_recoverable');
        });
        test('non_recoverable requires governance review', () => {
            const r = M240.governanceReviewRequired({ classification: 'non_recoverable' });
            expect(r.governanceReviewRequired).toBe(1);
        });
        test('fully_reversible bypasses review', () => {
            const r = M240.governanceReviewRequired({ classification: 'fully_reversible' });
            expect(r.governanceReviewRequired).toBe(0);
        });
        test('record covenant', () => {
            const r = M240.recordCovenant({
                userId: UID, resolvedEnv: ENV,
                covenantId: 'rp_1',
                transformationLabel: 'phase2_server_authority_migration',
                safePriorStateRef: 'pre_phase2_baseline_v1.7.69',
                minimumRecoverableArchitecture: 'snapshot_db_t0',
                reversibilityScore: 0.15, ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.classification).toBe('non_recoverable');
            expect(r.governanceReviewRequired).toBe(1);
        });
    });

    describe('§241 RIGHTFUL UNKNOWN (FINAL canonical point)', () => {
        test('CLASSIFICATIONS frozen 4', () => {
            expect(M241.CLASSIFICATIONS).toEqual([
                'problem', 'anomaly', 'unknown', 'rightful_mystery'
            ]);
        });
        test('high legitimacy → rightful_mystery', () => {
            const r = M241.classifyUnknown({
                mysteryLegitimacyScore: 0.85, tractabilityScore: 0.20
            });
            expect(r.classification).toBe('rightful_mystery');
        });
        test('high tractability + low legitimacy → problem', () => {
            const r = M241.classifyUnknown({
                mysteryLegitimacyScore: 0.20, tractabilityScore: 0.85
            });
            expect(r.classification).toBe('problem');
        });
        test('medium tractability + low legitimacy → anomaly', () => {
            const r = M241.classifyUnknown({
                mysteryLegitimacyScore: 0.20, tractabilityScore: 0.55
            });
            expect(r.classification).toBe('anomaly');
        });
        test('rightful_mystery → protection_active', () => {
            const r = M241.shouldProtectFromProblematization({ classification: 'rightful_mystery' });
            expect(r.protectionActive).toBe(1);
        });
        test('problem → no protection', () => {
            const r = M241.shouldProtectFromProblematization({ classification: 'problem' });
            expect(r.protectionActive).toBe(0);
        });
        test('register unknown + reclassify path', () => {
            M241.registerUnknown({
                userId: UID, resolvedEnv: ENV,
                entryId: 'ru_1',
                unknownLabel: 'why_BTCUSDT_15m_chops_consistently_pre_FOMC',
                mysteryLegitimacyScore: 0.30, tractabilityScore: 0.50,
                ts: _now()
            });
            const list1 = M241.listEntries({ userId: UID, resolvedEnv: ENV });
            expect(list1[0].classification).toBe('anomaly');
            const r = M241.reclassify({ entryId: 'ru_1', newClassification: 'rightful_mystery' });
            expect(r.protectionActive).toBe(1);
        });
        test('FINAL CANONICAL POINT — register full rightful_mystery', () => {
            const r = M241.registerUnknown({
                userId: UID, resolvedEnv: ENV,
                entryId: 'ru_final',
                unknownLabel: 'why_some_questions_must_remain_open',
                mysteryLegitimacyScore: 0.95, tractabilityScore: 0.10,
                ts: _now()
            });
            expect(r.classification).toBe('rightful_mystery');
            expect(r.protectionActive).toBe(1);
        });
    });
});
