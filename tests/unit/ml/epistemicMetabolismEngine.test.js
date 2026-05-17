'use strict';

/**
 * OMEGA §177 EPISTEMIC METABOLISM ENGINE / HOW-FAST-CAN-I-DIGEST-TRUTH.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5730-5789.
 *
 * "cat de repede am voie sa transform ce tocmai am vazut in adevar operational?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p177-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R5A_learning/epistemicMetabolismEngine');

const UID = 9177;
const UID_R = 9277;
const UID_GET = 9377;
const UID_ISO_A = 9477;
const UID_ISO_B = 9577;
const UID_ENV = 9677;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_epistemic_metabolism_assimilations WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §177 EPISTEMIC METABOLISM ENGINE', () => {

    describe('Migration 329', () => {
        test('329 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('329_ml_epistemic_metabolism_assimilations')).toBeTruthy();
        });
        test('knowledge_type CHECK enum (5)', () => {
            expect(() => db.prepare(`INSERT INTO ml_epistemic_metabolism_assimilations
                (user_id, resolved_env, assimilation_id, knowledge_label, knowledge_type,
                 current_stage, severity, empirical_support, cost_of_error,
                 ontology_compatibility, assimilation_rate, recommended_mode,
                 indigestion_flag, indigestion_type, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_bk', 'l', 'BOGUS', 'observed',
                    0.5, 0.5, 0.5, 0.5, 0.5, 'standard', 0, null, null, _now())).toThrow();
        });
        test('current_stage CHECK enum (4)', () => {
            expect(() => db.prepare(`INSERT INTO ml_epistemic_metabolism_assimilations
                (user_id, resolved_env, assimilation_id, knowledge_label, knowledge_type,
                 current_stage, severity, empirical_support, cost_of_error,
                 ontology_compatibility, assimilation_rate, recommended_mode,
                 indigestion_flag, indigestion_type, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_st', 'l', 'new_pattern', 'BOGUS',
                    0.5, 0.5, 0.5, 0.5, 0.5, 'standard', 0, null, null, _now())).toThrow();
        });
        test('recommended_mode CHECK enum (3)', () => {
            expect(() => db.prepare(`INSERT INTO ml_epistemic_metabolism_assimilations
                (user_id, resolved_env, assimilation_id, knowledge_label, knowledge_type,
                 current_stage, severity, empirical_support, cost_of_error,
                 ontology_compatibility, assimilation_rate, recommended_mode,
                 indigestion_flag, indigestion_type, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_md', 'l', 'new_pattern', 'observed',
                    0.5, 0.5, 0.5, 0.5, 0.5, 'BOGUS', 0, null, null, _now())).toThrow();
        });
        test('indigestion_type CHECK enum (3 or NULL)', () => {
            expect(() => db.prepare(`INSERT INTO ml_epistemic_metabolism_assimilations
                (user_id, resolved_env, assimilation_id, knowledge_label, knowledge_type,
                 current_stage, severity, empirical_support, cost_of_error,
                 ontology_compatibility, assimilation_rate, recommended_mode,
                 indigestion_flag, indigestion_type, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_id', 'l', 'new_pattern', 'observed',
                    0.5, 0.5, 0.5, 0.5, 0.5, 'standard', 1, 'BOGUS', null, _now())).toThrow();
        });
        test('assimilation_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_epistemic_metabolism_assimilations
                (user_id, resolved_env, assimilation_id, knowledge_label, knowledge_type,
                 current_stage, severity, empirical_support, cost_of_error,
                 ontology_compatibility, assimilation_rate, recommended_mode,
                 indigestion_flag, indigestion_type, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'a_dup', 'l', 'new_pattern', 'observed',
                0.5, 0.5, 0.5, 0.5, 0.5, 'standard', 0, null, null, _now());
            expect(() => stmt.run(UID, ENV, 'a_dup', 'l2', 'new_rule', 'metabolized',
                0.5, 0.5, 0.5, 0.5, 0.5, 'standard', 0, null, null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('KNOWLEDGE_TYPES frozen 5 (canonical PDF list)', () => {
            expect(M.KNOWLEDGE_TYPES).toEqual([
                'new_pattern', 'new_rule', 'new_concept',
                'new_causal_relation', 'ontological_change'
            ]);
            expect(Object.isFrozen(M.KNOWLEDGE_TYPES)).toBe(true);
        });
        test('DIGESTION_STAGES frozen 4 (canonical PDF list)', () => {
            expect(M.DIGESTION_STAGES).toEqual([
                'observed', 'metabolized', 'stabilized', 'constitutionalized'
            ]);
            expect(Object.isFrozen(M.DIGESTION_STAGES)).toBe(true);
        });
        test('INDIGESTION_TYPES frozen 3 (canonical PDF list)', () => {
            expect(M.INDIGESTION_TYPES).toEqual([
                'premature_integration', 'overloaded_revision',
                'unstable_concept_absorption'
            ]);
            expect(Object.isFrozen(M.INDIGESTION_TYPES)).toBe(true);
        });
        test('METABOLISM_MODES frozen 3', () => {
            expect(M.METABOLISM_MODES).toEqual([
                'slow_cook', 'standard', 'fast_assimilation'
            ]);
            expect(Object.isFrozen(M.METABOLISM_MODES)).toBe(true);
        });
        test('RATE_THRESHOLDS ordered', () => {
            expect(M.RATE_THRESHOLDS.fast).toBe(0.70);
            expect(M.RATE_THRESHOLDS.slow).toBe(0.30);
        });
    });

    describe('computeAssimilationRate (pure)', () => {
        test('high empirical + low cost + high compat → fast rate', () => {
            const r = M.computeAssimilationRate({
                severity: 0.50,
                empiricalSupport: 0.90,
                costOfError: 0.15,
                ontologyCompatibility: 0.85
            });
            expect(r.assimilationRate).toBeGreaterThan(0.70);
        });
        test('low empirical + high cost + low compat → slow rate', () => {
            const r = M.computeAssimilationRate({
                severity: 0.50,
                empiricalSupport: 0.20,
                costOfError: 0.85,
                ontologyCompatibility: 0.15
            });
            expect(r.assimilationRate).toBeLessThan(0.30);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeAssimilationRate({
                severity: 1.5,
                empiricalSupport: 0.5,
                costOfError: 0.5,
                ontologyCompatibility: 0.5
            })).toThrow();
        });
        test('missing field throws', () => {
            expect(() => M.computeAssimilationRate({
                severity: 0.5, empiricalSupport: 0.5
            })).toThrow();
        });
    });

    describe('classifyMode (pure)', () => {
        test('rate >= 0.70 → fast_assimilation', () => {
            const r = M.classifyMode({ assimilationRate: 0.80 });
            expect(r.mode).toBe('fast_assimilation');
        });
        test('rate < 0.30 → slow_cook', () => {
            const r = M.classifyMode({ assimilationRate: 0.20 });
            expect(r.mode).toBe('slow_cook');
        });
        test('middle band → standard', () => {
            const r = M.classifyMode({ assimilationRate: 0.50 });
            expect(r.mode).toBe('standard');
        });
        test('boundary 0.70 → fast_assimilation', () => {
            const r = M.classifyMode({ assimilationRate: 0.70 });
            expect(r.mode).toBe('fast_assimilation');
        });
        test('boundary 0.30 → standard', () => {
            const r = M.classifyMode({ assimilationRate: 0.30 });
            expect(r.mode).toBe('standard');
        });
    });

    describe('detectIndigestion (pure)', () => {
        test('observed → constitutionalized in 1 step → premature_integration', () => {
            const r = M.detectIndigestion({
                currentStage: 'observed',
                requestedStage: 'constitutionalized',
                supportingObservationsCount: 2,
                ontologyCompatibility: 0.50
            });
            expect(r.indigestionFlag).toBe(1);
            expect(r.indigestionType).toBe('premature_integration');
        });
        test('many concurrent revisions → overloaded_revision', () => {
            const r = M.detectIndigestion({
                currentStage: 'observed',
                requestedStage: 'metabolized',
                supportingObservationsCount: 5,
                ontologyCompatibility: 0.70,
                concurrentRevisionsCount: 6  // many at once
            });
            expect(r.indigestionFlag).toBe(1);
            expect(r.indigestionType).toBe('overloaded_revision');
        });
        test('low compat absorption → unstable_concept_absorption', () => {
            const r = M.detectIndigestion({
                currentStage: 'metabolized',
                requestedStage: 'stabilized',
                supportingObservationsCount: 10,
                ontologyCompatibility: 0.15
            });
            expect(r.indigestionFlag).toBe(1);
            expect(r.indigestionType).toBe('unstable_concept_absorption');
        });
        test('healthy stage progression → no indigestion', () => {
            const r = M.detectIndigestion({
                currentStage: 'metabolized',
                requestedStage: 'stabilized',
                supportingObservationsCount: 20,
                ontologyCompatibility: 0.80
            });
            expect(r.indigestionFlag).toBe(0);
            expect(r.indigestionType).toBeNull();
        });
        test('invalid stage throws', () => {
            expect(() => M.detectIndigestion({
                currentStage: 'BOGUS',
                requestedStage: 'metabolized',
                supportingObservationsCount: 5,
                ontologyCompatibility: 0.5
            })).toThrow();
        });
    });

    describe('recommendNextStage (pure)', () => {
        test('high rate from observed → metabolized', () => {
            const r = M.recommendNextStage({
                currentStage: 'observed',
                assimilationRate: 0.80
            });
            expect(r.nextStage).toBe('metabolized');
        });
        test('low rate stays at observed', () => {
            const r = M.recommendNextStage({
                currentStage: 'observed',
                assimilationRate: 0.20
            });
            expect(r.nextStage).toBe('observed');
        });
        test('constitutionalized is terminal', () => {
            const r = M.recommendNextStage({
                currentStage: 'constitutionalized',
                assimilationRate: 1.0
            });
            expect(r.nextStage).toBe('constitutionalized');
        });
    });

    describe('recordAssimilation', () => {
        test('persists with auto-pipeline', () => {
            const r = M.recordAssimilation({
                userId: UID_R, resolvedEnv: ENV,
                assimilationId: 'ra_1',
                knowledgeLabel: 'new pattern: orderflow imbalance after sweep',
                knowledgeType: 'new_pattern',
                currentStage: 'observed',
                severity: 0.50,
                empiricalSupport: 0.85,
                costOfError: 0.20,
                ontologyCompatibility: 0.80,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.assimilationRate).toBeGreaterThan(0.60);
            expect(['standard', 'fast_assimilation']).toContain(r.recommendedMode);
        });
        test('high cost + low empirical → slow_cook', () => {
            const r = M.recordAssimilation({
                userId: UID_R, resolvedEnv: ENV,
                assimilationId: 'ra_slow',
                knowledgeLabel: 'ontological revision proposed',
                knowledgeType: 'ontological_change',
                currentStage: 'observed',
                severity: 0.85,
                empiricalSupport: 0.20,
                costOfError: 0.90,
                ontologyCompatibility: 0.15,
                ts: _now()
            });
            expect(r.recommendedMode).toBe('slow_cook');
        });
        test('duplicate assimilationId throws', () => {
            M.recordAssimilation({
                userId: UID_R, resolvedEnv: ENV,
                assimilationId: 'ra_dup', knowledgeLabel: 'l',
                knowledgeType: 'new_pattern', currentStage: 'observed',
                severity: 0.5, empiricalSupport: 0.5, costOfError: 0.5,
                ontologyCompatibility: 0.5, ts: _now()
            });
            expect(() => M.recordAssimilation({
                userId: UID_R, resolvedEnv: ENV,
                assimilationId: 'ra_dup', knowledgeLabel: 'l',
                knowledgeType: 'new_pattern', currentStage: 'observed',
                severity: 0.5, empiricalSupport: 0.5, costOfError: 0.5,
                ontologyCompatibility: 0.5, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('invalid knowledge_type throws', () => {
            expect(() => M.recordAssimilation({
                userId: UID_R, resolvedEnv: ENV,
                assimilationId: 'ra_bad', knowledgeLabel: 'l',
                knowledgeType: 'BOGUS', currentStage: 'observed',
                severity: 0.5, empiricalSupport: 0.5, costOfError: 0.5,
                ontologyCompatibility: 0.5, ts: _now()
            })).toThrow();
        });
    });

    describe('getRecentAssimilations & getStageStats & getIndigestionStats', () => {
        test('getRecentAssimilations filters by current_stage', () => {
            M.recordAssimilation({
                userId: UID_GET, resolvedEnv: ENV,
                assimilationId: 'gs_obs', knowledgeLabel: 'l',
                knowledgeType: 'new_pattern', currentStage: 'observed',
                severity: 0.5, empiricalSupport: 0.5, costOfError: 0.5,
                ontologyCompatibility: 0.5, ts: _now()
            });
            M.recordAssimilation({
                userId: UID_GET, resolvedEnv: ENV,
                assimilationId: 'gs_met', knowledgeLabel: 'l',
                knowledgeType: 'new_pattern', currentStage: 'metabolized',
                severity: 0.5, empiricalSupport: 0.5, costOfError: 0.5,
                ontologyCompatibility: 0.5, ts: _now()
            });
            const obsOnly = M.getRecentAssimilations({
                userId: UID_GET, resolvedEnv: ENV,
                currentStage: 'observed'
            });
            expect(obsOnly.length).toBe(1);
        });
        test('getStageStats returns counts per stage', () => {
            M.recordAssimilation({
                userId: UID_GET, resolvedEnv: ENV,
                assimilationId: 'st_1', knowledgeLabel: 'l',
                knowledgeType: 'new_pattern', currentStage: 'observed',
                severity: 0.5, empiricalSupport: 0.5, costOfError: 0.5,
                ontologyCompatibility: 0.5, ts: _now()
            });
            M.recordAssimilation({
                userId: UID_GET, resolvedEnv: ENV,
                assimilationId: 'st_2', knowledgeLabel: 'l',
                knowledgeType: 'new_pattern', currentStage: 'observed',
                severity: 0.5, empiricalSupport: 0.5, costOfError: 0.5,
                ontologyCompatibility: 0.5, ts: _now()
            });
            const stats = M.getStageStats({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(stats.observed).toBe(2);
            expect(stats.totalCount).toBe(2);
        });
        test('getIndigestionStats returns counts per indigestion_type', () => {
            // Force indigestion via direct insert (bypassing module to test query)
            M.recordAssimilation({
                userId: UID_GET, resolvedEnv: ENV,
                assimilationId: 'in_1', knowledgeLabel: 'l',
                knowledgeType: 'new_pattern', currentStage: 'observed',
                requestedStage: 'constitutionalized',
                supportingObservationsCount: 2,
                severity: 0.5, empiricalSupport: 0.5, costOfError: 0.5,
                ontologyCompatibility: 0.5, ts: _now()
            });
            const stats = M.getIndigestionStats({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(stats.totalCount).toBeGreaterThanOrEqual(1);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordAssimilation({
                userId: UID_ISO_A, resolvedEnv: ENV,
                assimilationId: 'iso_a', knowledgeLabel: 'l',
                knowledgeType: 'new_pattern', currentStage: 'observed',
                severity: 0.5, empiricalSupport: 0.5, costOfError: 0.5,
                ontologyCompatibility: 0.5, ts: _now()
            });
            M.recordAssimilation({
                userId: UID_ISO_B, resolvedEnv: ENV,
                assimilationId: 'iso_b', knowledgeLabel: 'l',
                knowledgeType: 'new_pattern', currentStage: 'observed',
                severity: 0.5, empiricalSupport: 0.5, costOfError: 0.5,
                ontologyCompatibility: 0.5, ts: _now()
            });
            const a = M.getRecentAssimilations({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(r => r.assimilationId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordAssimilation({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                assimilationId: 'env_d', knowledgeLabel: 'l',
                knowledgeType: 'new_pattern', currentStage: 'observed',
                severity: 0.5, empiricalSupport: 0.5, costOfError: 0.5,
                ontologyCompatibility: 0.5, ts: _now()
            });
            const testnet = M.getRecentAssimilations({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
