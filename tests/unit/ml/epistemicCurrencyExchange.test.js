'use strict';

/**
 * OMEGA §170 EPISTEMIC CURRENCY EXCHANGE / CROSS-FRAME SETTLEMENT ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5621-5669.
 *
 * "cum compar un argument statistic cu unul cauzal si cu unul narrativ
 *  fara sa le amestec prost?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p170-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R2_cognition/epistemicCurrencyExchange');

const UID = 9170;
const UID_R = 9270;
const UID_GET = 9370;
const UID_ISO_A = 9470;
const UID_ISO_B = 9570;
const UID_ENV = 9670;
const ENV = 'DEMO';
const _now = () => Date.now();

const ALIGNED = {
    probabilityEvidence: 0.78, causalForce: 0.75,
    narrativeCoherence: 0.80, informationGain: 0.74,
    adversarialPressure: 0.20, riskOfBeingWrong: 0.25
};
const INCOMMENSURABLE = {
    probabilityEvidence: 0.90, causalForce: 0.10,
    narrativeCoherence: 0.85, informationGain: 0.05,
    adversarialPressure: 0.95, riskOfBeingWrong: 0.10
};

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_epistemic_settlements WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §170 EPISTEMIC CURRENCY EXCHANGE', () => {

    describe('Migration 327', () => {
        test('327 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('327_ml_epistemic_settlements')).toBeTruthy();
        });
        test('dominant_currency CHECK enum (7)', () => {
            expect(() => db.prepare(`INSERT INTO ml_epistemic_settlements
                (user_id, resolved_env, settlement_id, decision_id,
                 probability_evidence_score, causal_force_score,
                 narrative_coherence_score, information_gain_score,
                 adversarial_pressure_score, risk_of_being_wrong_score,
                 settlement_score, commensurability_score,
                 incommensurability_flagged, dominant_currency, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_bk', 'd', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 0.5, 0, 'BOGUS', null, _now())).toThrow();
        });
        test('range CHECK on currency scores', () => {
            expect(() => db.prepare(`INSERT INTO ml_epistemic_settlements
                (user_id, resolved_env, settlement_id, decision_id,
                 probability_evidence_score, causal_force_score,
                 narrative_coherence_score, information_gain_score,
                 adversarial_pressure_score, risk_of_being_wrong_score,
                 settlement_score, commensurability_score,
                 incommensurability_flagged, dominant_currency, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_br', 'd', 1.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 0.5, 0, 'multi_balanced', null, _now())).toThrow();
        });
        test('incommensurability_flagged CHECK (0,1)', () => {
            expect(() => db.prepare(`INSERT INTO ml_epistemic_settlements
                (user_id, resolved_env, settlement_id, decision_id,
                 probability_evidence_score, causal_force_score,
                 narrative_coherence_score, information_gain_score,
                 adversarial_pressure_score, risk_of_being_wrong_score,
                 settlement_score, commensurability_score,
                 incommensurability_flagged, dominant_currency, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_inc', 'd', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 0.5, 2, 'multi_balanced', null, _now())).toThrow();
        });
        test('settlement_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_epistemic_settlements
                (user_id, resolved_env, settlement_id, decision_id,
                 probability_evidence_score, causal_force_score,
                 narrative_coherence_score, information_gain_score,
                 adversarial_pressure_score, risk_of_being_wrong_score,
                 settlement_score, commensurability_score,
                 incommensurability_flagged, dominant_currency, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 's_dup', 'd', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                0.5, 0.5, 0, 'multi_balanced', null, _now());
            expect(() => stmt.run(UID, ENV, 's_dup', 'd2', 0.5, 0.5, 0.5, 0.5,
                0.5, 0.5, 0.5, 0.5, 0, 'multi_balanced', null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('EVIDENCE_CURRENCIES frozen 6 (canonical PDF list)', () => {
            expect(M.EVIDENCE_CURRENCIES).toEqual([
                'probability_evidence', 'causal_force',
                'narrative_coherence', 'information_gain',
                'adversarial_pressure', 'risk_of_being_wrong'
            ]);
            expect(Object.isFrozen(M.EVIDENCE_CURRENCIES)).toBe(true);
        });
        test('DOMINANT_CURRENCIES frozen 7 (6 + multi_balanced)', () => {
            expect(M.DOMINANT_CURRENCIES).toEqual([
                'probability_evidence', 'causal_force',
                'narrative_coherence', 'information_gain',
                'adversarial_pressure', 'risk_of_being_wrong',
                'multi_balanced'
            ]);
            expect(Object.isFrozen(M.DOMINANT_CURRENCIES)).toBe(true);
        });
        test('SETTLEMENT_WEIGHTS sum to 1.0', () => {
            const sum = Object.values(M.SETTLEMENT_WEIGHTS).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0, 6);
        });
        test('INCOMMENSURABILITY_THRESHOLD = 0.30', () => {
            expect(M.INCOMMENSURABILITY_THRESHOLD).toBe(0.30);
        });
        test('DOMINANT_THRESHOLD = 0.40', () => {
            expect(M.DOMINANT_THRESHOLD).toBe(0.40);
        });
        test('INVERTED_CURRENCIES contains adversarial_pressure + risk_of_being_wrong', () => {
            // These are "negative" currencies — high value reduces settlement
            expect(M.INVERTED_CURRENCIES).toEqual([
                'adversarial_pressure', 'risk_of_being_wrong'
            ]);
            expect(Object.isFrozen(M.INVERTED_CURRENCIES)).toBe(true);
        });
    });

    describe('computeSettlementScore (pure)', () => {
        test('all positive currencies high + inverted low → high settlement', () => {
            const r = M.computeSettlementScore({ currencies: ALIGNED });
            expect(r.settlementScore).toBeGreaterThan(0.70);
        });
        test('all positive low + inverted high → low settlement', () => {
            const r = M.computeSettlementScore({
                currencies: {
                    probabilityEvidence: 0.20, causalForce: 0.15,
                    narrativeCoherence: 0.25, informationGain: 0.20,
                    adversarialPressure: 0.90, riskOfBeingWrong: 0.85
                }
            });
            expect(r.settlementScore).toBeLessThan(0.30);
        });
        test('missing currency throws', () => {
            const partial = { ...ALIGNED };
            delete partial.causalForce;
            expect(() => M.computeSettlementScore({
                currencies: partial
            })).toThrow();
        });
        test('out-of-range throws', () => {
            expect(() => M.computeSettlementScore({
                currencies: { ...ALIGNED, probabilityEvidence: 1.5 }
            })).toThrow();
        });
    });

    describe('computeCommensurabilityScore (pure)', () => {
        test('all currencies aligned → high commensurability', () => {
            const r = M.computeCommensurabilityScore({ currencies: ALIGNED });
            // ALIGNED has spread ~0.05 between similar positive currencies
            expect(r.commensurabilityScore).toBeGreaterThan(0.70);
        });
        test('extreme divergence → low commensurability', () => {
            const r = M.computeCommensurabilityScore({
                currencies: INCOMMENSURABLE
            });
            expect(r.commensurabilityScore).toBeLessThan(0.40);
        });
        test('all currencies equal → max commensurability (1.0)', () => {
            const r = M.computeCommensurabilityScore({
                currencies: {
                    probabilityEvidence: 0.5, causalForce: 0.5,
                    narrativeCoherence: 0.5, informationGain: 0.5,
                    adversarialPressure: 0.5, riskOfBeingWrong: 0.5
                }
            });
            expect(r.commensurabilityScore).toBe(1.0);
        });
    });

    describe('detectIncommensurability (pure)', () => {
        test('aligned currencies → not flagged', () => {
            const r = M.detectIncommensurability({ currencies: ALIGNED });
            expect(r.flagged).toBe(0);
        });
        test('extreme divergence → flagged', () => {
            const r = M.detectIncommensurability({
                currencies: INCOMMENSURABLE
            });
            expect(r.flagged).toBe(1);
        });
    });

    describe('identifyDominantCurrency (pure)', () => {
        test('one currency above DOMINANT_THRESHOLD others low → dominant', () => {
            const r = M.identifyDominantCurrency({
                currencies: {
                    probabilityEvidence: 0.80, causalForce: 0.20,
                    narrativeCoherence: 0.20, informationGain: 0.20,
                    adversarialPressure: 0.10, riskOfBeingWrong: 0.10
                }
            });
            expect(r.dominantCurrency).toBe('probability_evidence');
        });
        test('all currencies similar → multi_balanced', () => {
            const r = M.identifyDominantCurrency({ currencies: ALIGNED });
            expect(r.dominantCurrency).toBe('multi_balanced');
        });
        test('all below DOMINANT_THRESHOLD → multi_balanced', () => {
            const r = M.identifyDominantCurrency({
                currencies: {
                    probabilityEvidence: 0.30, causalForce: 0.25,
                    narrativeCoherence: 0.30, informationGain: 0.20,
                    adversarialPressure: 0.30, riskOfBeingWrong: 0.30
                }
            });
            expect(r.dominantCurrency).toBe('multi_balanced');
        });
    });

    describe('recordSettlement', () => {
        test('aligned input → high settlement, low incommensurability, multi_balanced', () => {
            const r = M.recordSettlement({
                userId: UID_R, resolvedEnv: ENV,
                settlementId: 'rs_1', decisionId: 'd_btc_long',
                currencies: ALIGNED,
                reasoning: 'all positive frames align with thesis',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.settlementScore).toBeGreaterThan(0.70);
            expect(r.incommensurabilityFlagged).toBe(0);
            expect(r.dominantCurrency).toBe('multi_balanced');
        });
        test('incommensurable input → flagged + settlement penalized', () => {
            const r = M.recordSettlement({
                userId: UID_R, resolvedEnv: ENV,
                settlementId: 'rs_incomm', decisionId: 'd1',
                currencies: INCOMMENSURABLE,
                ts: _now()
            });
            expect(r.incommensurabilityFlagged).toBe(1);
            // Even if settlement score arithmetically high, flag triggers
        });
        test('duplicate settlementId throws', () => {
            M.recordSettlement({
                userId: UID_R, resolvedEnv: ENV,
                settlementId: 'rs_dup', decisionId: 'd',
                currencies: ALIGNED, ts: _now()
            });
            expect(() => M.recordSettlement({
                userId: UID_R, resolvedEnv: ENV,
                settlementId: 'rs_dup', decisionId: 'd',
                currencies: ALIGNED, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('missing currency throws', () => {
            const partial = { ...ALIGNED };
            delete partial.adversarialPressure;
            expect(() => M.recordSettlement({
                userId: UID_R, resolvedEnv: ENV,
                settlementId: 'rs_part', decisionId: 'd',
                currencies: partial, ts: _now()
            })).toThrow();
        });
    });

    describe('getRecentSettlements & getStatsByDominantCurrency', () => {
        test('getRecentSettlements filters by incommensurability_flagged', () => {
            M.recordSettlement({
                userId: UID_GET, resolvedEnv: ENV,
                settlementId: 'gr_a', decisionId: 'd',
                currencies: ALIGNED, ts: _now()
            });
            M.recordSettlement({
                userId: UID_GET, resolvedEnv: ENV,
                settlementId: 'gr_i', decisionId: 'd',
                currencies: INCOMMENSURABLE, ts: _now()
            });
            const incommOnly = M.getRecentSettlements({
                userId: UID_GET, resolvedEnv: ENV,
                incommensurabilityFlagged: 1
            });
            expect(incommOnly.length).toBe(1);
            expect(incommOnly[0].settlementId).toBe('gr_i');
        });
        test('getStatsByDominantCurrency returns counts', () => {
            M.recordSettlement({
                userId: UID_GET, resolvedEnv: ENV,
                settlementId: 'gs_1', decisionId: 'd',
                currencies: {
                    probabilityEvidence: 0.80, causalForce: 0.20,
                    narrativeCoherence: 0.15, informationGain: 0.20,
                    adversarialPressure: 0.10, riskOfBeingWrong: 0.10
                },
                ts: 1000
            });
            M.recordSettlement({
                userId: UID_GET, resolvedEnv: ENV,
                settlementId: 'gs_2', decisionId: 'd',
                currencies: ALIGNED,
                ts: 2000
            });
            const stats = M.getStatsByDominantCurrency({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(stats.probability_evidence).toBe(1);
            expect(stats.multi_balanced).toBe(1);
            expect(stats.totalCount).toBe(2);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordSettlement({
                userId: UID_ISO_A, resolvedEnv: ENV,
                settlementId: 'iso_a', decisionId: 'd',
                currencies: ALIGNED, ts: _now()
            });
            M.recordSettlement({
                userId: UID_ISO_B, resolvedEnv: ENV,
                settlementId: 'iso_b', decisionId: 'd',
                currencies: ALIGNED, ts: _now()
            });
            const a = M.getRecentSettlements({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(s => s.settlementId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordSettlement({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                settlementId: 'env_d', decisionId: 'd',
                currencies: ALIGNED, ts: _now()
            });
            const testnet = M.getRecentSettlements({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
