'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p78-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const lp = require('../../../server/services/ml/R5A_learning/labelPurityEngine');

const TEST_USER = 9078;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_label_purity_scores WHERE user_id IN (?, ?)').run(TEST_USER, 9079);
    db.prepare('DELETE FROM ml_contamination_events WHERE user_id IN (?, ?)').run(TEST_USER, 9079);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§78 Migrations 146 + 147', () => {
    test('ml_label_purity_scores UNIQUE trade_id', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_label_purity_scores
             (user_id, resolved_env, trade_id, label_classification,
              purity_score, sample_weight, outcome, last_updated, ts)
             VALUES (?, ?, 'T-UNIQ', 'clean', 1.0, 1.0, 'win', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_label_purity_scores
             (user_id, resolved_env, trade_id, label_classification,
              purity_score, sample_weight, outcome, last_updated, ts)
             VALUES (?, ?, 'T-UNIQ', 'clean', 1.0, 1.0, 'win', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK label_classification restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_label_purity_scores
             (user_id, resolved_env, trade_id, label_classification,
              purity_score, sample_weight, outcome, last_updated, ts)
             VALUES (?, ?, 'T-BAD', 'BOGUS', 1.0, 1.0, 'win', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts)).toThrow();
    });

    test('CHECK contamination_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_contamination_events
             (user_id, resolved_env, trade_id, contamination_type, severity, ts)
             VALUES (?, ?, 'T', 'BOGUS', 'low', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK severity restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_contamination_events
             (user_id, resolved_env, trade_id, contamination_type, severity, ts)
             VALUES (?, ?, 'T', 'stiri_majore', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§78 Constants', () => {
    test('LABEL_CLASSIFICATIONS has 4 entries', () => {
        expect(lp.LABEL_CLASSIFICATIONS).toEqual([
            'clean', 'noisy', 'censored', 'excluded'
        ]);
    });

    test('CONTAMINATION_TYPES has 8 entries per spec', () => {
        expect(lp.CONTAMINATION_TYPES).toHaveLength(8);
        expect(lp.CONTAMINATION_TYPES).toEqual(expect.arrayContaining([
            'stiri_majore', 'exchange_outage', 'venue_anomaly',
            'spread_spike', 'feed_degradation', 'execution_failure',
            'forced_flatten_extern', 'dead_man_event'
        ]));
    });

    test('SEVERITY_LEVELS has 3 entries', () => {
        expect(lp.SEVERITY_LEVELS).toEqual(['low', 'med', 'high']);
    });

    test('purity thresholds ordered', () => {
        expect(lp.PURITY_CLEAN_THRESHOLD).toBeGreaterThan(lp.PURITY_NOISY_THRESHOLD);
        expect(lp.PURITY_NOISY_THRESHOLD).toBeGreaterThan(lp.PURITY_CENSORED_THRESHOLD);
    });

    test('SAMPLE_WEIGHT_BY_CLASS descending', () => {
        expect(lp.SAMPLE_WEIGHT_BY_CLASS.clean).toBeGreaterThan(lp.SAMPLE_WEIGHT_BY_CLASS.noisy);
        expect(lp.SAMPLE_WEIGHT_BY_CLASS.noisy).toBeGreaterThan(lp.SAMPLE_WEIGHT_BY_CLASS.censored);
        expect(lp.SAMPLE_WEIGHT_BY_CLASS.censored).toBeGreaterThan(lp.SAMPLE_WEIGHT_BY_CLASS.excluded);
    });
});

describe('§78 computePurityScore (pure)', () => {
    test('no events → 1.0', () => {
        expect(lp.computePurityScore({ contaminationEvents: [] })).toBe(1.0);
    });

    test('single high-severity → 0.50', () => {
        const r = lp.computePurityScore({
            contaminationEvents: [{ severity: 'high' }]
        });
        expect(r).toBeCloseTo(0.50);
    });

    test('two mid + one low → 0.40', () => {
        const r = lp.computePurityScore({
            contaminationEvents: [
                { severity: 'med' }, { severity: 'med' }, { severity: 'low' }
            ]
        });
        expect(r).toBeCloseTo(0.40);
    });

    test('clamped to [0,1]', () => {
        const r = lp.computePurityScore({
            contaminationEvents: [
                { severity: 'high' }, { severity: 'high' }, { severity: 'high' }
            ]
        });
        expect(r).toBe(0);
    });
});

describe('§78 classifyLabel (pure)', () => {
    test('0.95 → clean', () => {
        expect(lp.classifyLabel(0.95)).toBe('clean');
    });

    test('0.65 → noisy', () => {
        expect(lp.classifyLabel(0.65)).toBe('noisy');
    });

    test('0.30 → censored', () => {
        expect(lp.classifyLabel(0.30)).toBe('censored');
    });

    test('0.10 → excluded', () => {
        expect(lp.classifyLabel(0.10)).toBe('excluded');
    });

    test('throws on out-of-range', () => {
        expect(() => lp.classifyLabel(1.5)).toThrow();
        expect(() => lp.classifyLabel(-0.1)).toThrow();
    });
});

describe('§78 getSampleWeight', () => {
    test('clean = 1.0', () => {
        expect(lp.getSampleWeight({ classification: 'clean' })).toBe(1.0);
    });

    test('excluded = 0', () => {
        expect(lp.getSampleWeight({ classification: 'excluded' })).toBe(0);
    });

    test('throws on invalid', () => {
        expect(() => lp.getSampleWeight({
            classification: 'BOGUS'
        })).toThrow();
    });
});

describe('§78 recordTradeOutcome', () => {
    test('defaults to clean label + weight 1.0', () => {
        lp.recordTradeOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-001', outcome: 'win'
        });
        const r = lp.getLabelPurity({ tradeId: 'T-001' });
        expect(r.classification).toBe('clean');
        expect(r.sampleWeight).toBe(1.0);
    });
});

describe('§78 flagContamination', () => {
    test('downgrades label after contamination', () => {
        lp.recordTradeOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-CONT', outcome: 'win'
        });
        const r = lp.flagContamination({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-CONT',
            contaminationType: 'spread_spike',
            severity: 'high'
        });
        expect(r.purityScore).toBeLessThan(1.0);
        expect(r.newClassification).not.toBe('clean');
    });

    test('multiple events compound', () => {
        lp.recordTradeOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-MULTI', outcome: 'loss'
        });
        lp.flagContamination({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-MULTI',
            contaminationType: 'feed_degradation', severity: 'med'
        });
        const r = lp.flagContamination({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-MULTI',
            contaminationType: 'spread_spike', severity: 'med'
        });
        // 1 - 0.25 - 0.25 = 0.50 → noisy
        expect(r.newClassification).toBe('noisy');
    });

    test('throws on invalid contamination', () => {
        expect(() => lp.flagContamination({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-BAD',
            contaminationType: 'BOGUS', severity: 'high'
        })).toThrow();
    });

    test('throws on invalid severity', () => {
        expect(() => lp.flagContamination({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-BAD2',
            contaminationType: 'spread_spike', severity: 'fatal'
        })).toThrow();
    });
});

describe('§78 getContaminationStats', () => {
    test('aggregates by type + severity', () => {
        lp.recordTradeOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-S1', outcome: 'win'
        });
        lp.flagContamination({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-S1', contaminationType: 'spread_spike', severity: 'low'
        });
        lp.flagContamination({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-S1', contaminationType: 'spread_spike', severity: 'low'
        });
        lp.flagContamination({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-S1', contaminationType: 'venue_anomaly', severity: 'high'
        });
        const stats = lp.getContaminationStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(stats.total).toBe(3);
        expect(stats.byTypeAndSeverity.length).toBeGreaterThan(1);
    });
});

describe('§78 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9079;
        lp.recordTradeOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T-ISO', outcome: 'win'
        });
        const r1 = lp.getLabelPurity({ tradeId: 'T-ISO' });
        expect(r1).toBeTruthy();
        const s1 = lp.getContaminationStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const s2 = lp.getContaminationStats({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(s2.total).toBe(0);
    });
});
