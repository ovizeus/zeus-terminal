'use strict';

/**
 * OMEGA §187 REALITY CONTACT RATIO / LIVE-WORLD GROUNDING COVENANT.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5989-6039.
 *
 * "cat din aceasta decizie vine din realitatea de acum si cat vine din ce
 *  cred deja despre realitate?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p187-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R3A_safety/realityContactRatio');

const UID = 9187;
const UID_R = 9287;
const UID_GET = 9387;
const UID_ISO_A = 9487;
const UID_ISO_B = 9587;
const UID_ENV = 9687;
const ENV = 'DEMO';
const _now = () => Date.now();

// Decision grounded mostly in direct live data
const LIVE_GROUNDED = {
    directObservedData: 0.55, derivedInferences: 0.25,
    episodicMemories: 0.05, consolidatedConcepts: 0.05,
    structuralPriors: 0.05, historicalOntologies: 0.05
};
// Decision built from old beliefs, little fresh contact
const SCHOLASTIC = {
    directObservedData: 0.05, derivedInferences: 0.05,
    episodicMemories: 0.20, consolidatedConcepts: 0.30,
    structuralPriors: 0.20, historicalOntologies: 0.20
};

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_reality_contact_snapshots WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §187 REALITY CONTACT RATIO', () => {

    describe('Migration 334', () => {
        test('334 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('334_ml_reality_contact_snapshots')).toBeTruthy();
        });
        test('grounding_classification CHECK enum (4)', () => {
            expect(() => db.prepare(`INSERT INTO ml_reality_contact_snapshots
                (user_id, resolved_env, snapshot_id, decision_id,
                 direct_observed_data_weight, derived_inferences_weight,
                 episodic_memories_weight, consolidated_concepts_weight,
                 structural_priors_weight, historical_ontologies_weight,
                 reality_contact_ratio, scholastic_drift_detected,
                 grounding_classification, boldness_adjustment, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_bk', 'd1', 0.5, 0.2, 0.1, 0.1, 0.05, 0.05,
                    0.6, 0, 'BOGUS', 1.0, null, _now())).toThrow();
        });
        test('scholastic_drift_detected CHECK (0,1)', () => {
            expect(() => db.prepare(`INSERT INTO ml_reality_contact_snapshots
                (user_id, resolved_env, snapshot_id, decision_id,
                 direct_observed_data_weight, derived_inferences_weight,
                 episodic_memories_weight, consolidated_concepts_weight,
                 structural_priors_weight, historical_ontologies_weight,
                 reality_contact_ratio, scholastic_drift_detected,
                 grounding_classification, boldness_adjustment, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_sd', 'd1', 0.5, 0.2, 0.1, 0.1, 0.05, 0.05,
                    0.6, 2, 'live', 1.0, null, _now())).toThrow();
        });
        test('range CHECK on weights', () => {
            expect(() => db.prepare(`INSERT INTO ml_reality_contact_snapshots
                (user_id, resolved_env, snapshot_id, decision_id,
                 direct_observed_data_weight, derived_inferences_weight,
                 episodic_memories_weight, consolidated_concepts_weight,
                 structural_priors_weight, historical_ontologies_weight,
                 reality_contact_ratio, scholastic_drift_detected,
                 grounding_classification, boldness_adjustment, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_br', 'd1', 1.5, 0.2, 0.1, 0.1, 0.05, 0.05,
                    0.6, 0, 'live', 1.0, null, _now())).toThrow();
        });
        test('snapshot_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_reality_contact_snapshots
                (user_id, resolved_env, snapshot_id, decision_id,
                 direct_observed_data_weight, derived_inferences_weight,
                 episodic_memories_weight, consolidated_concepts_weight,
                 structural_priors_weight, historical_ontologies_weight,
                 reality_contact_ratio, scholastic_drift_detected,
                 grounding_classification, boldness_adjustment, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 's_dup', 'd1', 0.5, 0.2, 0.1, 0.1, 0.05, 0.05,
                0.6, 0, 'live', 1.0, null, _now());
            expect(() => stmt.run(UID, ENV, 's_dup', 'd2', 0.5, 0.2, 0.1, 0.1,
                0.05, 0.05, 0.6, 0, 'balanced', 0.8, null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('CONTRIBUTION_SOURCES frozen 6 (canonical PDF list)', () => {
            expect(M.CONTRIBUTION_SOURCES).toEqual([
                'directObservedData', 'derivedInferences',
                'episodicMemories', 'consolidatedConcepts',
                'structuralPriors', 'historicalOntologies'
            ]);
            expect(Object.isFrozen(M.CONTRIBUTION_SOURCES)).toBe(true);
        });
        test('LIVE_SOURCES frozen (directObservedData only)', () => {
            expect(M.LIVE_SOURCES).toEqual(['directObservedData']);
            expect(Object.isFrozen(M.LIVE_SOURCES)).toBe(true);
        });
        test('SEMI_LIVE_SOURCES frozen (derivedInferences)', () => {
            expect(M.SEMI_LIVE_SOURCES).toEqual(['derivedInferences']);
            expect(Object.isFrozen(M.SEMI_LIVE_SOURCES)).toBe(true);
        });
        test('GROUNDING_CLASSIFICATIONS frozen 4', () => {
            expect(M.GROUNDING_CLASSIFICATIONS).toEqual([
                'live', 'balanced', 'drift', 'scholastic'
            ]);
            expect(Object.isFrozen(M.GROUNDING_CLASSIFICATIONS)).toBe(true);
        });
        test('CONTACT_THRESHOLDS ordered', () => {
            expect(M.CONTACT_THRESHOLDS.live).toBe(0.65);
            expect(M.CONTACT_THRESHOLDS.balanced).toBe(0.40);
            expect(M.CONTACT_THRESHOLDS.drift).toBe(0.20);
        });
        test('BOLDNESS_ADJUSTMENT_MAP per classification', () => {
            expect(M.BOLDNESS_ADJUSTMENT_MAP.live).toBe(1.0);
            expect(M.BOLDNESS_ADJUSTMENT_MAP.balanced).toBe(0.80);
            expect(M.BOLDNESS_ADJUSTMENT_MAP.drift).toBe(0.50);
            expect(M.BOLDNESS_ADJUSTMENT_MAP.scholastic).toBe(0.20);
        });
        test('SEMI_LIVE_WEIGHT = 0.5', () => {
            expect(M.SEMI_LIVE_WEIGHT).toBe(0.5);
        });
    });

    describe('computeRealityContactRatio (pure)', () => {
        test('all weight on direct → ratio 1.0', () => {
            const r = M.computeRealityContactRatio({
                weights: {
                    directObservedData: 1.0, derivedInferences: 0,
                    episodicMemories: 0, consolidatedConcepts: 0,
                    structuralPriors: 0, historicalOntologies: 0
                }
            });
            expect(r.realityContactRatio).toBe(1.0);
        });
        test('all weight on derived inferences → 0.5 ratio', () => {
            const r = M.computeRealityContactRatio({
                weights: {
                    directObservedData: 0, derivedInferences: 1.0,
                    episodicMemories: 0, consolidatedConcepts: 0,
                    structuralPriors: 0, historicalOntologies: 0
                }
            });
            expect(r.realityContactRatio).toBeCloseTo(0.5, 5);
        });
        test('all weight on historical → ratio 0', () => {
            const r = M.computeRealityContactRatio({
                weights: {
                    directObservedData: 0, derivedInferences: 0,
                    episodicMemories: 0.20, consolidatedConcepts: 0.30,
                    structuralPriors: 0.20, historicalOntologies: 0.30
                }
            });
            expect(r.realityContactRatio).toBe(0);
        });
        test('weights auto-normalized', () => {
            const r = M.computeRealityContactRatio({
                weights: {
                    directObservedData: 0.5, derivedInferences: 0.5,
                    episodicMemories: 0.5, consolidatedConcepts: 0.5,
                    structuralPriors: 0.5, historicalOntologies: 0.5
                }
            });
            // sum=3.0, normalized: each = 1/6
            // ratio = (1/6) + 0.5*(1/6) = 1/6 + 1/12 = 0.25
            expect(r.realityContactRatio).toBeCloseTo(0.25, 5);
        });
        test('missing source throws', () => {
            const partial = { ...LIVE_GROUNDED };
            delete partial.episodicMemories;
            expect(() => M.computeRealityContactRatio({
                weights: partial
            })).toThrow();
        });
    });

    describe('classifyGrounding (pure)', () => {
        test('ratio >= 0.65 → live', () => {
            expect(M.classifyGrounding({ contactRatio: 0.75 }).classification).toBe('live');
        });
        test('0.40 <= ratio < 0.65 → balanced', () => {
            expect(M.classifyGrounding({ contactRatio: 0.50 }).classification).toBe('balanced');
        });
        test('0.20 <= ratio < 0.40 → drift', () => {
            expect(M.classifyGrounding({ contactRatio: 0.30 }).classification).toBe('drift');
        });
        test('ratio < 0.20 → scholastic', () => {
            expect(M.classifyGrounding({ contactRatio: 0.10 }).classification).toBe('scholastic');
        });
        test('boundary 0.65 → live', () => {
            expect(M.classifyGrounding({ contactRatio: 0.65 }).classification).toBe('live');
        });
    });

    describe('detectScholasticDrift (pure)', () => {
        test('scholastic classification → drift detected', () => {
            const r = M.detectScholasticDrift({ classification: 'scholastic' });
            expect(r.scholasticDriftDetected).toBe(1);
        });
        test('drift classification → drift detected', () => {
            const r = M.detectScholasticDrift({ classification: 'drift' });
            expect(r.scholasticDriftDetected).toBe(1);
        });
        test('balanced classification → no drift', () => {
            const r = M.detectScholasticDrift({ classification: 'balanced' });
            expect(r.scholasticDriftDetected).toBe(0);
        });
        test('live classification → no drift', () => {
            const r = M.detectScholasticDrift({ classification: 'live' });
            expect(r.scholasticDriftDetected).toBe(0);
        });
    });

    describe('computeBoldnessAdjustment (pure)', () => {
        test('live → 1.0', () => {
            expect(M.computeBoldnessAdjustment({
                classification: 'live'
            }).adjustment).toBe(1.0);
        });
        test('scholastic → 0.20', () => {
            expect(M.computeBoldnessAdjustment({
                classification: 'scholastic'
            }).adjustment).toBe(0.20);
        });
        test('invalid throws', () => {
            expect(() => M.computeBoldnessAdjustment({
                classification: 'BOGUS'
            })).toThrow();
        });
    });

    describe('recordRealityContactSnapshot', () => {
        test('live-grounded decision', () => {
            const r = M.recordRealityContactSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_live',
                decisionId: 'd_btc_long',
                weights: LIVE_GROUNDED,
                reasoning: 'most weight on current orderflow + price action',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.groundingClassification).toBe('live');
            expect(r.scholasticDriftDetected).toBe(0);
            expect(r.boldnessAdjustment).toBe(1.0);
        });
        test('scholastic decision triggers drift detection', () => {
            const r = M.recordRealityContactSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_scholastic',
                decisionId: 'd_old_thesis',
                weights: SCHOLASTIC,
                ts: _now()
            });
            expect(r.groundingClassification).toBe('scholastic');
            expect(r.scholasticDriftDetected).toBe(1);
            expect(r.boldnessAdjustment).toBe(0.20);
        });
        test('duplicate snapshotId throws', () => {
            M.recordRealityContactSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_dup', decisionId: 'd',
                weights: LIVE_GROUNDED, ts: _now()
            });
            expect(() => M.recordRealityContactSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_dup', decisionId: 'd',
                weights: LIVE_GROUNDED, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('missing source throws', () => {
            const partial = { ...LIVE_GROUNDED };
            delete partial.structuralPriors;
            expect(() => M.recordRealityContactSnapshot({
                userId: UID_R, resolvedEnv: ENV,
                snapshotId: 'rs_part', decisionId: 'd',
                weights: partial, ts: _now()
            })).toThrow();
        });
    });

    describe('getRecentSnapshots & getStatsByClassification', () => {
        test('getRecentSnapshots filters by classification', () => {
            M.recordRealityContactSnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'g_l', decisionId: 'd',
                weights: LIVE_GROUNDED, ts: _now()
            });
            M.recordRealityContactSnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'g_s', decisionId: 'd',
                weights: SCHOLASTIC, ts: _now()
            });
            const scholastics = M.getRecentSnapshots({
                userId: UID_GET, resolvedEnv: ENV,
                groundingClassification: 'scholastic'
            });
            expect(scholastics.length).toBe(1);
        });
        test('getStatsByClassification returns counts', () => {
            M.recordRealityContactSnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gs_1', decisionId: 'd',
                weights: LIVE_GROUNDED, ts: 1000
            });
            M.recordRealityContactSnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gs_2', decisionId: 'd',
                weights: SCHOLASTIC, ts: 2000
            });
            const stats = M.getStatsByClassification({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(stats.live).toBe(1);
            expect(stats.scholastic).toBe(1);
            expect(stats.totalCount).toBe(2);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordRealityContactSnapshot({
                userId: UID_ISO_A, resolvedEnv: ENV,
                snapshotId: 'iso_a', decisionId: 'd',
                weights: LIVE_GROUNDED, ts: _now()
            });
            M.recordRealityContactSnapshot({
                userId: UID_ISO_B, resolvedEnv: ENV,
                snapshotId: 'iso_b', decisionId: 'd',
                weights: LIVE_GROUNDED, ts: _now()
            });
            const a = M.getRecentSnapshots({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(r => r.snapshotId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordRealityContactSnapshot({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                snapshotId: 'env_d', decisionId: 'd',
                weights: LIVE_GROUNDED, ts: _now()
            });
            const testnet = M.getRecentSnapshots({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
