'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p96-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const smg = require('../../../server/services/ml/R5A_learning/syntheticMarketGenerator');

const TEST_USER = 9096;
const OTHER_USER = 9097;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_data_fingerprints WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_synthetic_scenarios WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

const SAMPLE_FP = {
    marginalDistributions: { TREND: 0.4, RANGE: 0.4, PANIC: 0.2 },
    transitionMatrix: {
        TREND:  { TREND: 0.7, RANGE: 0.2, PANIC: 0.1 },
        RANGE:  { RANGE: 0.6, TREND: 0.3, PANIC: 0.1 },
        PANIC:  { PANIC: 0.5, RANGE: 0.4, TREND: 0.1 }
    },
    sampleCount: 1000
};

describe('§96 Migrations 181 + 182', () => {
    test('fingerprint_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_data_fingerprints
             (user_id, resolved_env, fingerprint_id,
              marginal_distributions_json, transition_matrix_json,
              sample_count, ts)
             VALUES (?, ?, 'FP-UNIQ', '{}', '{}', 100, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_data_fingerprints
             (user_id, resolved_env, fingerprint_id,
              marginal_distributions_json, transition_matrix_json,
              sample_count, ts)
             VALUES (?, ?, 'FP-UNIQ', '{}', '{}', 200, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK scenario_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_synthetic_scenarios
             (user_id, resolved_env, scenario_id, regime_sequence_json,
              scenario_type, source_fingerprint_id, plausibility_score,
              is_synthetic, flagged_for_review, flag_reason, ts)
             VALUES (?, ?, 'SC-BAD', '[]', 'BOGUS', NULL, 0.5, 1, 0, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK is_synthetic must be 1', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_synthetic_scenarios
             (user_id, resolved_env, scenario_id, regime_sequence_json,
              scenario_type, source_fingerprint_id, plausibility_score,
              is_synthetic, flagged_for_review, flag_reason, ts)
             VALUES (?, ?, 'SC-NOTSYN', '[]', 'custom', NULL, 0.5, 0, 0, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§96 Constants', () => {
    test('SCENARIO_TYPES has 5 entries', () => {
        expect(smg.SCENARIO_TYPES).toEqual([
            'trend_to_panic', 'range_to_squeeze',
            'macro_shock', 'venue_fragmentation', 'custom'
        ]);
    });

    test('length bounds ordered', () => {
        expect(smg.MIN_SCENARIO_LENGTH).toBeLessThan(smg.MAX_SCENARIO_LENGTH);
    });
});

describe('§96 registerRealDataFingerprint', () => {
    test('persists', () => {
        const r = smg.registerRealDataFingerprint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            fingerprintId: 'FP-1', ...SAMPLE_FP
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        smg.registerRealDataFingerprint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            fingerprintId: 'FP-DUP', ...SAMPLE_FP
        });
        expect(() => smg.registerRealDataFingerprint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            fingerprintId: 'FP-DUP', ...SAMPLE_FP
        })).toThrow();
    });
});

describe('§96 generateScenario', () => {
    beforeEach(() => {
        smg.registerRealDataFingerprint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            fingerprintId: 'FP-GEN', ...SAMPLE_FP
        });
    });

    test('generates sequence with correct length + startState', () => {
        const r = smg.generateScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'GS-1', startState: 'TREND',
            length: 10, fingerprintId: 'FP-GEN',
            scenarioType: 'custom',
            rng: () => 0.05
        });
        expect(r.regimeSequence).toHaveLength(10);
        expect(r.regimeSequence[0]).toBe('TREND');
    });

    test('throws on invalid length', () => {
        expect(() => smg.generateScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'GS-BAD', startState: 'TREND',
            length: 1, fingerprintId: 'FP-GEN',
            scenarioType: 'custom'
        })).toThrow();
    });

    test('throws on invalid scenarioType', () => {
        expect(() => smg.generateScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'GS-BAD2', startState: 'TREND',
            length: 10, fingerprintId: 'FP-GEN',
            scenarioType: 'BOGUS'
        })).toThrow();
    });

    test('throws on unknown startState', () => {
        expect(() => smg.generateScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'GS-BAD3', startState: 'UNKNOWN',
            length: 10, fingerprintId: 'FP-GEN',
            scenarioType: 'custom'
        })).toThrow();
    });

    test('throws on missing fingerprint', () => {
        expect(() => smg.generateScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'GS-BAD4', startState: 'TREND',
            length: 10, fingerprintId: 'FP-MISSING',
            scenarioType: 'custom'
        })).toThrow();
    });
});

describe('§96 validateScenarioPlausibility (pure)', () => {
    test('plausible when frequencies match reference', () => {
        const seq = ['TREND','TREND','RANGE','RANGE','PANIC',
                     'TREND','RANGE','TREND','PANIC','TREND'];
        const r = smg.validateScenarioPlausibility({
            scenarioSequence: seq,
            referenceMarginal: { TREND: 0.5, RANGE: 0.3, PANIC: 0.2 }
        });
        expect(r.plausible).toBe(true);
    });

    test('implausible when distribution far from reference', () => {
        const seq = Array(20).fill('PANIC');
        const r = smg.validateScenarioPlausibility({
            scenarioSequence: seq,
            referenceMarginal: { TREND: 0.5, RANGE: 0.45, PANIC: 0.05 },
            klThreshold: 0.5
        });
        expect(r.plausible).toBe(false);
        expect(r.kl).toBeGreaterThan(0.5);
    });

    test('empty sequence → not plausible', () => {
        const r = smg.validateScenarioPlausibility({
            scenarioSequence: [],
            referenceMarginal: { TREND: 1.0 }
        });
        expect(r.plausible).toBe(false);
    });
});

describe('§96 recordScenario', () => {
    test('persists with is_synthetic=true', () => {
        const r = smg.recordScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'RS-1',
            regimeSequence: ['TREND','PANIC','PANIC'],
            scenarioType: 'trend_to_panic',
            plausibilityScore: 0.3
        });
        expect(r.recorded).toBe(true);
        expect(r.isSynthetic).toBe(true);
    });

    test('duplicate throws', () => {
        smg.recordScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'RS-DUP',
            regimeSequence: ['TREND'], scenarioType: 'custom'
        });
        expect(() => smg.recordScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'RS-DUP',
            regimeSequence: ['RANGE'], scenarioType: 'custom'
        })).toThrow();
    });

    test('invalid scenarioType throws', () => {
        expect(() => smg.recordScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'RS-BAD',
            regimeSequence: ['TREND'], scenarioType: 'BOGUS'
        })).toThrow();
    });
});

describe('§96 flagScenarioForReview', () => {
    test('marks flagged with reason', () => {
        smg.recordScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'FL-1',
            regimeSequence: ['TREND'], scenarioType: 'custom'
        });
        const r = smg.flagScenarioForReview({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'FL-1', reason: 'plausibility_low'
        });
        expect(r.flagged).toBe(true);

        const h = smg.getScenarioHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(h[0].flaggedForReview).toBe(true);
        expect(h[0].flagReason).toBe('plausibility_low');
    });

    test('unknown scenario throws', () => {
        expect(() => smg.flagScenarioForReview({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'NOEXIST', reason: 'r'
        })).toThrow();
    });
});

describe('§96 isolation', () => {
    test('per (user × env) isolation', () => {
        smg.recordScenario({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            scenarioId: 'ISO-1',
            regimeSequence: ['TREND'], scenarioType: 'custom'
        });
        const a = smg.getScenarioHistory({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const b = smg.getScenarioHistory({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
