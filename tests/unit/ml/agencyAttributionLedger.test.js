'use strict';

/**
 * OMEGA §167 AGENCY ATTRIBUTION LEDGER / WHO-CAUSED-WHAT ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5457-5516.
 *
 * "ce s-a schimbat, si mai ales cine a produs probabil schimbarea?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p167-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R2_cognition/agencyAttributionLedger');

const UID = 9167;
const UID_R = 9267;
const UID_GET = 9367;
const UID_ISO_A = 9467;
const UID_ISO_B = 9567;
const UID_ENV = 9667;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_agency_attribution_records WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §167 AGENCY ATTRIBUTION LEDGER', () => {

    describe('Migration 323', () => {
        test('323 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('323_ml_agency_attribution_records')).toBeTruthy();
        });
        test('dominant_attribution CHECK enum (6)', () => {
            expect(() => db.prepare(`INSERT INTO ml_agency_attribution_records
                (user_id, resolved_env, record_id, state_change_label,
                 state_change_magnitude, self_caused_probability,
                 market_endogenous_probability, adversary_induced_probability,
                 macro_exogenous_probability, venue_artifact_probability,
                 dominant_attribution, confidence_score, learning_weight, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_bk', 'l', 0.5, 0.2, 0.2, 0.2, 0.2, 0.2,
                    'BOGUS', 0.5, 0.5, null, _now())).toThrow();
        });
        test('all probability columns range CHECK', () => {
            expect(() => db.prepare(`INSERT INTO ml_agency_attribution_records
                (user_id, resolved_env, record_id, state_change_label,
                 state_change_magnitude, self_caused_probability,
                 market_endogenous_probability, adversary_induced_probability,
                 macro_exogenous_probability, venue_artifact_probability,
                 dominant_attribution, confidence_score, learning_weight, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_br', 'l', 0.5, 1.5, 0, 0, 0, 0,
                    'self_caused', 0.5, 0.5, null, _now())).toThrow();
        });
        test('record_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_agency_attribution_records
                (user_id, resolved_env, record_id, state_change_label,
                 state_change_magnitude, self_caused_probability,
                 market_endogenous_probability, adversary_induced_probability,
                 macro_exogenous_probability, venue_artifact_probability,
                 dominant_attribution, confidence_score, learning_weight, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'r_dup', 'l', 0.5, 1, 0, 0, 0, 0,
                'self_caused', 1, 1, null, _now());
            expect(() => stmt.run(UID, ENV, 'r_dup', 'l', 0.5, 0, 1, 0, 0, 0,
                'market_endogenous', 1, 1, null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('AGENCY_CATEGORIES frozen 5 (canonical PDF list)', () => {
            expect(M.AGENCY_CATEGORIES).toEqual([
                'self_caused', 'market_endogenous',
                'adversary_induced', 'macro_exogenous', 'venue_artifact'
            ]);
            expect(Object.isFrozen(M.AGENCY_CATEGORIES)).toBe(true);
        });
        test('DOMINANT_CATEGORIES frozen 6 (5 + ambiguous)', () => {
            expect(M.DOMINANT_CATEGORIES).toEqual([
                'self_caused', 'market_endogenous',
                'adversary_induced', 'macro_exogenous',
                'venue_artifact', 'ambiguous'
            ]);
            expect(Object.isFrozen(M.DOMINANT_CATEGORIES)).toBe(true);
        });
        test('AMBIGUITY_THRESHOLD = 0.40', () => {
            expect(M.AMBIGUITY_THRESHOLD).toBe(0.40);
        });
        test('HIGH_CONFIDENCE_THRESHOLD = 0.70', () => {
            expect(M.HIGH_CONFIDENCE_THRESHOLD).toBe(0.70);
        });
        test('LEARNING_WEIGHT_AMBIGUOUS_PENALTY = 0.50', () => {
            expect(M.LEARNING_WEIGHT_AMBIGUOUS_PENALTY).toBe(0.50);
        });
    });

    describe('normalizeAttribution (pure)', () => {
        test('valid sum-1 input passes through', () => {
            const r = M.normalizeAttribution({
                probabilities: {
                    selfCaused: 0.2, marketEndogenous: 0.2,
                    adversaryInduced: 0.2, macroExogenous: 0.2,
                    venueArtifact: 0.2
                }
            });
            const sum = Object.values(r.normalized).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1, 5);
        });
        test('non-normalized input gets normalized', () => {
            const r = M.normalizeAttribution({
                probabilities: {
                    selfCaused: 0.5, marketEndogenous: 0.5,
                    adversaryInduced: 0.5, macroExogenous: 0.5,
                    venueArtifact: 0.5
                }
            });
            const sum = Object.values(r.normalized).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1, 5);
            expect(r.normalized.selfCaused).toBeCloseTo(0.2, 5);
        });
        test('all zeros throws (cannot normalize)', () => {
            expect(() => M.normalizeAttribution({
                probabilities: {
                    selfCaused: 0, marketEndogenous: 0,
                    adversaryInduced: 0, macroExogenous: 0,
                    venueArtifact: 0
                }
            })).toThrow(/zero|all/i);
        });
        test('missing key throws', () => {
            expect(() => M.normalizeAttribution({
                probabilities: { selfCaused: 0.5, marketEndogenous: 0.5 }
            })).toThrow();
        });
        test('negative value throws', () => {
            expect(() => M.normalizeAttribution({
                probabilities: {
                    selfCaused: -0.1, marketEndogenous: 0.3,
                    adversaryInduced: 0.3, macroExogenous: 0.2,
                    venueArtifact: 0.3
                }
            })).toThrow();
        });
    });

    describe('classifyDominantAttribution (pure)', () => {
        test('clear self-caused (>0.40) → self_caused', () => {
            const r = M.classifyDominantAttribution({
                probabilities: {
                    selfCaused: 0.70, marketEndogenous: 0.10,
                    adversaryInduced: 0.10, macroExogenous: 0.05,
                    venueArtifact: 0.05
                }
            });
            expect(r.dominantAttribution).toBe('self_caused');
            expect(r.confidenceScore).toBeCloseTo(0.70, 5);
        });
        test('all ≤ threshold → ambiguous', () => {
            const r = M.classifyDominantAttribution({
                probabilities: {
                    selfCaused: 0.30, marketEndogenous: 0.25,
                    adversaryInduced: 0.20, macroExogenous: 0.15,
                    venueArtifact: 0.10
                }
            });
            expect(r.dominantAttribution).toBe('ambiguous');
        });
        test('boundary 0.40 → ambiguous (strict >)', () => {
            const r = M.classifyDominantAttribution({
                probabilities: {
                    selfCaused: 0.40, marketEndogenous: 0.30,
                    adversaryInduced: 0.20, macroExogenous: 0.05,
                    venueArtifact: 0.05
                }
            });
            // 0.40 is NOT above threshold (strict >)
            expect(r.dominantAttribution).toBe('ambiguous');
        });
        test('just above 0.40 → dominant', () => {
            const r = M.classifyDominantAttribution({
                probabilities: {
                    selfCaused: 0.41, marketEndogenous: 0.30,
                    adversaryInduced: 0.19, macroExogenous: 0.05,
                    venueArtifact: 0.05
                }
            });
            expect(r.dominantAttribution).toBe('self_caused');
        });
        test('venue_artifact dominant', () => {
            const r = M.classifyDominantAttribution({
                probabilities: {
                    selfCaused: 0.05, marketEndogenous: 0.10,
                    adversaryInduced: 0.10, macroExogenous: 0.05,
                    venueArtifact: 0.70
                }
            });
            expect(r.dominantAttribution).toBe('venue_artifact');
        });
    });

    describe('computeLearningWeight (pure)', () => {
        test('high confidence + clear attribution → full weight', () => {
            const r = M.computeLearningWeight({
                confidenceScore: 0.80,
                dominantAttribution: 'self_caused'
            });
            expect(r.learningWeight).toBeCloseTo(0.80, 5);
        });
        test('ambiguous attribution → halved weight', () => {
            const r = M.computeLearningWeight({
                confidenceScore: 0.60,
                dominantAttribution: 'ambiguous'
            });
            expect(r.learningWeight).toBeCloseTo(0.30, 5);  // 0.60 * 0.50
        });
        test('low confidence + clear attribution → confidence-bounded weight', () => {
            const r = M.computeLearningWeight({
                confidenceScore: 0.30,
                dominantAttribution: 'market_endogenous'
            });
            expect(r.learningWeight).toBeCloseTo(0.30, 5);
        });
        test('ambiguous + low confidence → very low', () => {
            const r = M.computeLearningWeight({
                confidenceScore: 0.20,
                dominantAttribution: 'ambiguous'
            });
            expect(r.learningWeight).toBeCloseTo(0.10, 5);
        });
        test('invalid attribution throws', () => {
            expect(() => M.computeLearningWeight({
                confidenceScore: 0.5,
                dominantAttribution: 'BOGUS'
            })).toThrow();
        });
    });

    describe('recordAttribution', () => {
        test('persists with auto-classification', () => {
            const r = M.recordAttribution({
                userId: UID_R, resolvedEnv: ENV,
                recordId: 'ra_1',
                stateChangeLabel: 'spread widened 12 bps in 200ms',
                stateChangeMagnitude: 0.40,
                probabilities: {
                    selfCaused: 0.10, marketEndogenous: 0.55,
                    adversaryInduced: 0.20, macroExogenous: 0.10,
                    venueArtifact: 0.05
                },
                reasoning: 'thin book + retail flow burst, no own order',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.dominantAttribution).toBe('market_endogenous');
            expect(r.confidenceScore).toBeCloseTo(0.55, 5);
        });
        test('self-caused attribution prevents confusion with market edge', () => {
            // After we send a 0.5 BTC market sell, spread widens — that's
            // OUR impact, not "market edge"
            const r = M.recordAttribution({
                userId: UID_R, resolvedEnv: ENV,
                recordId: 'ra_self',
                stateChangeLabel: 'bid removed 2 levels post-our-order',
                stateChangeMagnitude: 0.30,
                probabilities: {
                    selfCaused: 0.80, marketEndogenous: 0.10,
                    adversaryInduced: 0.05, macroExogenous: 0.02,
                    venueArtifact: 0.03
                },
                ts: _now()
            });
            expect(r.dominantAttribution).toBe('self_caused');
            expect(r.learningWeight).toBeCloseTo(0.80, 5);
        });
        test('ambiguous attribution → reduced learning_weight', () => {
            const r = M.recordAttribution({
                userId: UID_R, resolvedEnv: ENV,
                recordId: 'ra_amb',
                stateChangeLabel: 'unexplained rally during overnight session',
                stateChangeMagnitude: 0.50,
                probabilities: {
                    selfCaused: 0.05, marketEndogenous: 0.30,
                    adversaryInduced: 0.25, macroExogenous: 0.25,
                    venueArtifact: 0.15
                },
                ts: _now()
            });
            expect(r.dominantAttribution).toBe('ambiguous');
            // confidence = max = 0.30; learning = 0.30 * 0.50 = 0.15
            expect(r.learningWeight).toBeCloseTo(0.15, 5);
        });
        test('probabilities auto-normalized if sum != 1.0', () => {
            const r = M.recordAttribution({
                userId: UID_R, resolvedEnv: ENV,
                recordId: 'ra_norm',
                stateChangeLabel: 'sl',
                stateChangeMagnitude: 0.30,
                probabilities: {
                    selfCaused: 0.5, marketEndogenous: 0.5,
                    adversaryInduced: 0.5, macroExogenous: 0.5,
                    venueArtifact: 0.5
                },
                ts: _now()
            });
            expect(r.recorded).toBe(true);
        });
        test('duplicate recordId throws', () => {
            M.recordAttribution({
                userId: UID_R, resolvedEnv: ENV,
                recordId: 'ra_dup',
                stateChangeLabel: 'l',
                stateChangeMagnitude: 0.5,
                probabilities: {
                    selfCaused: 1, marketEndogenous: 0,
                    adversaryInduced: 0, macroExogenous: 0,
                    venueArtifact: 0
                },
                ts: _now()
            });
            expect(() => M.recordAttribution({
                userId: UID_R, resolvedEnv: ENV,
                recordId: 'ra_dup',
                stateChangeLabel: 'l',
                stateChangeMagnitude: 0.5,
                probabilities: {
                    selfCaused: 1, marketEndogenous: 0,
                    adversaryInduced: 0, macroExogenous: 0,
                    venueArtifact: 0
                },
                ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getRecentRecords & getAttributionStats', () => {
        test('getRecentRecords filters by dominant_attribution', () => {
            M.recordAttribution({
                userId: UID_GET, resolvedEnv: ENV,
                recordId: 'gr_self', stateChangeLabel: 'l',
                stateChangeMagnitude: 0.3,
                probabilities: {
                    selfCaused: 0.80, marketEndogenous: 0.05,
                    adversaryInduced: 0.05, macroExogenous: 0.05,
                    venueArtifact: 0.05
                },
                ts: _now()
            });
            M.recordAttribution({
                userId: UID_GET, resolvedEnv: ENV,
                recordId: 'gr_market', stateChangeLabel: 'l',
                stateChangeMagnitude: 0.3,
                probabilities: {
                    selfCaused: 0.05, marketEndogenous: 0.80,
                    adversaryInduced: 0.05, macroExogenous: 0.05,
                    venueArtifact: 0.05
                },
                ts: _now()
            });
            const selfOnly = M.getRecentRecords({
                userId: UID_GET, resolvedEnv: ENV,
                dominantAttribution: 'self_caused'
            });
            expect(selfOnly.length).toBe(1);
        });
        test('getAttributionStats returns counts per category', () => {
            M.recordAttribution({
                userId: UID_GET, resolvedEnv: ENV,
                recordId: 'gs_1', stateChangeLabel: 'l',
                stateChangeMagnitude: 0.3,
                probabilities: {
                    selfCaused: 0.80, marketEndogenous: 0.05,
                    adversaryInduced: 0.05, macroExogenous: 0.05,
                    venueArtifact: 0.05
                },
                ts: 1000
            });
            M.recordAttribution({
                userId: UID_GET, resolvedEnv: ENV,
                recordId: 'gs_2', stateChangeLabel: 'l',
                stateChangeMagnitude: 0.3,
                probabilities: {
                    selfCaused: 0.80, marketEndogenous: 0.05,
                    adversaryInduced: 0.05, macroExogenous: 0.05,
                    venueArtifact: 0.05
                },
                ts: 2000
            });
            const stats = M.getAttributionStats({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(stats.self_caused).toBe(2);
            expect(stats.totalCount).toBe(2);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordAttribution({
                userId: UID_ISO_A, resolvedEnv: ENV,
                recordId: 'iso_a', stateChangeLabel: 'l',
                stateChangeMagnitude: 0.3,
                probabilities: {
                    selfCaused: 1, marketEndogenous: 0,
                    adversaryInduced: 0, macroExogenous: 0,
                    venueArtifact: 0
                },
                ts: _now()
            });
            M.recordAttribution({
                userId: UID_ISO_B, resolvedEnv: ENV,
                recordId: 'iso_b', stateChangeLabel: 'l',
                stateChangeMagnitude: 0.3,
                probabilities: {
                    selfCaused: 1, marketEndogenous: 0,
                    adversaryInduced: 0, macroExogenous: 0,
                    venueArtifact: 0
                },
                ts: _now()
            });
            const a = M.getRecentRecords({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(r => r.recordId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordAttribution({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                recordId: 'env_d', stateChangeLabel: 'l',
                stateChangeMagnitude: 0.3,
                probabilities: {
                    selfCaused: 1, marketEndogenous: 0,
                    adversaryInduced: 0, macroExogenous: 0,
                    venueArtifact: 0
                },
                ts: _now()
            });
            const testnet = M.getRecentRecords({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
