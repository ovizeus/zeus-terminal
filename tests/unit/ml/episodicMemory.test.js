'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p65-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const em = require('../../../server/services/ml/R5A_learning/episodicMemory');

const TEST_USER = 9065;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_episodic_archive WHERE user_id IN (?, ?)').run(TEST_USER, 9066);
    db.prepare('DELETE FROM ml_fingerprint_matches WHERE user_id IN (?, ?)').run(TEST_USER, 9066);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§65 Migrations 115 + 116', () => {
    test('ml_episodic_archive exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_episodic_archive)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'user_id', 'resolved_env', 'archive_id', 'label',
            'start_ts', 'end_ts', 'fingerprint_vector_json',
            'outcome_summary', 'lessons_json', 'created_at'
        ]));
    });

    test('archive_id UNIQUE per user × env', () => {
        const ts = Date.now();
        em.archiveHistoricalPeriod({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            archiveId: 'AUG-2021', label: 'August 2021',
            startTs: 1, endTs: 2,
            fingerprintVector: {}
        });
        expect(() => em.archiveHistoricalPeriod({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            archiveId: 'AUG-2021', label: 'Duplicate',
            startTs: 3, endTs: 4,
            fingerprintVector: {}
        })).toThrow(/duplicate/i);
    });

    test('ml_fingerprint_matches exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_fingerprint_matches)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'query_fingerprint_json', 'archive_id',
            'similarity_score', 'ranked_position', 'ts'
        ]));
    });
});

describe('§65 Constants', () => {
    test('FINGERPRINT_DIMENSIONS has 6 entries', () => {
        expect(em.FINGERPRINT_DIMENSIONS).toEqual([
            'funding_levels', 'oi_trend', 'btc_dominance',
            'macro_index', 'regime_type_enc', 'vol_level'
        ]);
    });

    test('DEFAULT_TOP_K positive', () => {
        expect(em.DEFAULT_TOP_K).toBeGreaterThan(0);
    });

    test('BAYESIAN_PRIOR_USAGE marker', () => {
        expect(em.BAYESIAN_PRIOR_USAGE).toBe('analogy_only');
    });
});

describe('§65 computeFingerprint', () => {
    test('returns all 6 dimensions', () => {
        const f = em.computeFingerprint({
            fundingLevels: 0.01, oiTrend: 0.1,
            btcDominance: 55, macroIndex: 0.2,
            regimeType: 'trend_up', vol: 0.6
        });
        for (const d of em.FINGERPRINT_DIMENSIONS) {
            expect(f).toHaveProperty(d);
        }
    });

    test('btc_dominance normalized around 0', () => {
        const f50 = em.computeFingerprint({ btcDominance: 50 });
        const f100 = em.computeFingerprint({ btcDominance: 100 });
        const f0 = em.computeFingerprint({ btcDominance: 0 });
        expect(f50.btc_dominance).toBe(0);
        expect(f100.btc_dominance).toBe(1);
        expect(f0.btc_dominance).toBe(-1);
    });

    test('regime_type_enc differs per regime', () => {
        const up = em.computeFingerprint({ regimeType: 'trend_up' });
        const down = em.computeFingerprint({ regimeType: 'trend_down' });
        const range = em.computeFingerprint({ regimeType: 'range' });
        expect(up.regime_type_enc).toBeGreaterThan(range.regime_type_enc);
        expect(down.regime_type_enc).toBeLessThan(range.regime_type_enc);
    });
});

describe('§65 archiveHistoricalPeriod', () => {
    test('persists period with all fields', () => {
        const fp = em.computeFingerprint({
            fundingLevels: 0.005, oiTrend: -0.05,
            btcDominance: 60, regimeType: 'trend_up'
        });
        const r = em.archiveHistoricalPeriod({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            archiveId: 'TEST-1',
            label: 'Test period',
            startTs: 1000, endTs: 2000,
            fingerprintVector: fp,
            outcomeSummary: 'bullish breakout',
            lessons: ['watch funding', 'BTC dominance pivot']
        });
        expect(r.archived).toBe(true);
        const rows = db.prepare(
            `SELECT * FROM ml_episodic_archive WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(JSON.parse(rows[0].lessons_json)).toHaveLength(2);
    });
});

describe('§65 findSimilarPeriods', () => {
    beforeEach(() => {
        const fp1 = em.computeFingerprint({
            fundingLevels: 0.01, btcDominance: 55, regimeType: 'trend_up'
        });
        const fp2 = em.computeFingerprint({
            fundingLevels: -0.01, btcDominance: 45, regimeType: 'trend_down'
        });
        em.archiveHistoricalPeriod({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            archiveId: 'P1', label: 'similar regime',
            startTs: 1, endTs: 2,
            fingerprintVector: fp1
        });
        em.archiveHistoricalPeriod({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            archiveId: 'P2', label: 'opposite regime',
            startTs: 3, endTs: 4,
            fingerprintVector: fp2
        });
    });

    test('best match has highest similarity', () => {
        const queryFp = em.computeFingerprint({
            fundingLevels: 0.01, btcDominance: 55, regimeType: 'trend_up'
        });
        const r = em.findSimilarPeriods({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentFingerprint: queryFp,
            minSimilarity: 0
        });
        expect(r.length).toBeGreaterThan(0);
        expect(r[0].archiveId).toBe('P1');
    });

    test('topK respected', () => {
        const queryFp = em.computeFingerprint({});
        const r = em.findSimilarPeriods({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentFingerprint: queryFp,
            topK: 1, minSimilarity: -1
        });
        expect(r.length).toBeLessThanOrEqual(1);
    });

    test('minSimilarity filter excludes low scores', () => {
        const queryFp = em.computeFingerprint({
            fundingLevels: 0.01, btcDominance: 55, regimeType: 'trend_up'
        });
        const r = em.findSimilarPeriods({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentFingerprint: queryFp,
            minSimilarity: 0.99
        });
        // Maybe filter out P2 with opposite regime
        for (const m of r) {
            expect(m.similarity).toBeGreaterThanOrEqual(0.99);
        }
    });

    test('returns empty when no archive', () => {
        cleanRows();
        const r = em.findSimilarPeriods({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentFingerprint: em.computeFingerprint({})
        });
        expect(r).toEqual([]);
    });
});

describe('§65 extractLessons', () => {
    test('aggregates lessons from matched periods', () => {
        em.archiveHistoricalPeriod({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            archiveId: 'L1', label: 'p1',
            startTs: 1, endTs: 2,
            fingerprintVector: em.computeFingerprint({}),
            lessons: ['lesson1', 'lesson2']
        });
        em.archiveHistoricalPeriod({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            archiveId: 'L2', label: 'p2',
            startTs: 3, endTs: 4,
            fingerprintVector: em.computeFingerprint({}),
            lessons: ['lesson3']
        });
        const r = em.extractLessons({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            archiveIds: ['L1', 'L2']
        });
        expect(r.lessons).toHaveLength(3);
        expect(r.periodsCount).toBe(2);
    });

    test('empty archiveIds returns empty', () => {
        const r = em.extractLessons({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            archiveIds: []
        });
        expect(r.lessons).toEqual([]);
    });
});

describe('§65 recordMatchEvent', () => {
    test('persists each match', () => {
        const queryFp = em.computeFingerprint({});
        em.recordMatchEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryFingerprint: queryFp,
            matches: [
                { archiveId: 'X', similarity: 0.9 },
                { archiveId: 'Y', similarity: 0.7 }
            ]
        });
        const rows = db.prepare(
            `SELECT * FROM ml_fingerprint_matches WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(2);
    });
});

describe('§65 getArchiveSummary + getMatchHistory', () => {
    test('summary returns counts', () => {
        em.archiveHistoricalPeriod({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            archiveId: 'S1', label: 's',
            startTs: 1, endTs: 2,
            fingerprintVector: em.computeFingerprint({})
        });
        const s = em.getArchiveSummary({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.count).toBe(1);
    });

    test('match history returns recent', () => {
        em.recordMatchEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryFingerprint: em.computeFingerprint({}),
            matches: [{ archiveId: 'X', similarity: 0.9 }]
        });
        const h = em.getMatchHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(h.length).toBe(1);
    });
});

describe('§65 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9066;
        em.archiveHistoricalPeriod({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            archiveId: 'ISO-1', label: 'iso',
            startTs: 1, endTs: 2,
            fingerprintVector: em.computeFingerprint({})
        });
        const s1 = em.getArchiveSummary({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const s2 = em.getArchiveSummary({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(s1.count).toBe(1);
        expect(s2.count).toBe(0);
    });
});
