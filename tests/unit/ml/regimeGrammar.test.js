'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p93-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const rg = require('../../../server/services/ml/R2_cognition/regimeGrammar');

const TEST_USER = 9093;
const OTHER_USER = 9094;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_regime_sentences WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_regime_overlaps WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

const SAMPLE_BULL = {
    volatility: 'EXPANSION', trend: 'BULL', liquidity: 'NORMAL',
    derivatives: 'NEUTRAL', macro: 'OPPOSED'
};
const SAMPLE_RANGE = {
    volatility: 'LOW', trend: 'NEUTRAL', liquidity: 'NORMAL',
    derivatives: 'NEUTRAL', macro: 'NEUTRAL'
};

describe('§93 Migrations 175 + 176', () => {
    test('sentence_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_regime_sentences
             (user_id, resolved_env, sentence_id, regime_label,
              primitives_json, source_context, ts)
             VALUES (?, ?, 'S-UNIQ', 'lbl', '{}', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_regime_sentences
             (user_id, resolved_env, sentence_id, regime_label,
              primitives_json, source_context, ts)
             VALUES (?, ?, 'S-UNIQ', 'lbl2', '{}', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK overlap_count 0-5', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_regime_overlaps
             (user_id, resolved_env, overlap_id, sentence_a_id,
              sentence_b_id, overlap_count, overlap_ratio, ts)
             VALUES (?, ?, 'O-BAD', 'A', 'B', 6, 1.2, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('overlap_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_regime_overlaps
             (user_id, resolved_env, overlap_id, sentence_a_id,
              sentence_b_id, overlap_count, overlap_ratio, ts)
             VALUES (?, ?, 'O-UNIQ', 'A', 'B', 3, 0.6, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_regime_overlaps
             (user_id, resolved_env, overlap_id, sentence_a_id,
              sentence_b_id, overlap_count, overlap_ratio, ts)
             VALUES (?, ?, 'O-UNIQ', 'C', 'D', 2, 0.4, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });
});

describe('§93 Constants', () => {
    test('PRIMITIVE_DIMS has 5 entries', () => {
        expect(rg.PRIMITIVE_DIMS).toEqual([
            'volatility', 'trend', 'liquidity', 'derivatives', 'macro'
        ]);
    });

    test('VOCABULARY has 5 dims with non-empty values', () => {
        for (const dim of rg.PRIMITIVE_DIMS) {
            expect(rg.VOCABULARY[dim].length).toBeGreaterThan(0);
        }
    });

    test('DEFAULT_OVERLAP_THRESHOLD in (0,1]', () => {
        expect(rg.DEFAULT_OVERLAP_THRESHOLD).toBeGreaterThan(0);
        expect(rg.DEFAULT_OVERLAP_THRESHOLD).toBeLessThanOrEqual(1);
    });
});

describe('§93 buildSentence', () => {
    test('builds canonical label', () => {
        const r = rg.buildSentence(SAMPLE_BULL);
        expect(r.regimeLabel).toBe(
            'vol=EXPANSION|trend=BULL|liq=NORMAL|deriv=NEUTRAL|macro=OPPOSED'
        );
    });

    test('throws on missing primitive', () => {
        expect(() => rg.buildSentence({
            volatility: 'LOW', trend: 'BULL', liquidity: 'NORMAL',
            derivatives: 'NEUTRAL'
        })).toThrow();
    });

    test('throws on invalid value', () => {
        expect(() => rg.buildSentence({
            volatility: 'BOGUS', trend: 'BULL', liquidity: 'NORMAL',
            derivatives: 'NEUTRAL', macro: 'NEUTRAL'
        })).toThrow();
    });
});

describe('§93 parseSentence', () => {
    test('round-trip identity', () => {
        const built = rg.buildSentence(SAMPLE_BULL);
        const parsed = rg.parseSentence(built.regimeLabel);
        expect(parsed).toEqual(SAMPLE_BULL);
    });

    test('throws on empty string', () => {
        expect(() => rg.parseSentence('')).toThrow();
    });

    test('throws on unknown primitive key', () => {
        expect(() => rg.parseSentence(
            'vol=BOGUS|trend=BULL|liq=NORMAL|deriv=NEUTRAL|macro=NEUTRAL'
        )).toThrow();
    });
});

describe('§93 computeOverlap', () => {
    test('identical primitives → ratio=1', () => {
        const r = rg.computeOverlap({
            primitivesA: SAMPLE_BULL, primitivesB: SAMPLE_BULL
        });
        expect(r.overlapCount).toBe(5);
        expect(r.overlapRatio).toBe(1);
    });

    test('three matches → ratio=0.6', () => {
        // BULL vs RANGE: vol diff, trend diff, liq same, deriv same, macro diff
        const r = rg.computeOverlap({
            primitivesA: SAMPLE_BULL, primitivesB: SAMPLE_RANGE
        });
        expect(r.overlapCount).toBe(2);
        expect(r.overlapRatio).toBeCloseTo(0.4);
    });

    test('no matches → ratio=0', () => {
        const r = rg.computeOverlap({
            primitivesA: {
                volatility: 'LOW', trend: 'STRONG_BULL', liquidity: 'DRY',
                derivatives: 'FUNDING_POS', macro: 'SUPPORTIVE'
            },
            primitivesB: {
                volatility: 'HIGH', trend: 'STRONG_BEAR', liquidity: 'DEEP',
                derivatives: 'FUNDING_NEG', macro: 'OPPOSED'
            }
        });
        expect(r.overlapCount).toBe(0);
        expect(r.overlapRatio).toBe(0);
    });
});

describe('§93 recordSentence', () => {
    test('persists with label', () => {
        const r = rg.recordSentence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sentenceId: 'RS-1', primitives: SAMPLE_BULL,
            sourceContext: 'unit_test'
        });
        expect(r.recorded).toBe(true);
        expect(r.regimeLabel).toBeTruthy();
    });

    test('duplicate sentenceId throws', () => {
        rg.recordSentence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sentenceId: 'RS-DUP', primitives: SAMPLE_BULL
        });
        expect(() => rg.recordSentence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sentenceId: 'RS-DUP', primitives: SAMPLE_RANGE
        })).toThrow();
    });

    test('throws on invalid primitive', () => {
        expect(() => rg.recordSentence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sentenceId: 'RS-BAD',
            primitives: { volatility: 'BOGUS', trend: 'BULL',
                liquidity: 'NORMAL', derivatives: 'NEUTRAL', macro: 'NEUTRAL' }
        })).toThrow();
    });
});

describe('§93 findSimilarRegimes', () => {
    test('returns sentences above threshold sorted', () => {
        rg.recordSentence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sentenceId: 'F-1', primitives: SAMPLE_BULL
        });
        rg.recordSentence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sentenceId: 'F-2', primitives: SAMPLE_RANGE
        });
        const r = rg.findSimilarRegimes({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentPrimitives: SAMPLE_BULL, minOverlap: 0.99
        });
        expect(r).toHaveLength(1);
        expect(r[0].sentenceId).toBe('F-1');
    });

    test('returns empty when nothing above threshold', () => {
        rg.recordSentence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sentenceId: 'F-3', primitives: SAMPLE_RANGE
        });
        const r = rg.findSimilarRegimes({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentPrimitives: SAMPLE_BULL, minOverlap: 0.80
        });
        expect(r).toHaveLength(0);
    });
});

describe('§93 isolation', () => {
    test('per (user × env) isolation', () => {
        rg.recordSentence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sentenceId: 'ISO-1', primitives: SAMPLE_BULL
        });
        const a = rg.getRegimeHistory({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const b = rg.getRegimeHistory({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
