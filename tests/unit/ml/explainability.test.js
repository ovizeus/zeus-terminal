'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p25-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ex = require('../../../server/services/ml/_crosscutting/explainability');

const TEST_USER = 9025;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_explanations WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_feature_health WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§25 Migration 063 — explanations + feature_health', () => {
    test('table ml_explanations exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_explanations'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_feature_health exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_feature_health'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('ml_explanations has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_explanations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'decision_id', 'pos_id',
            'decision', 'shap_values_json', 'top_positive_json',
            'top_negative_json', 'decisive_factor', 'human_language',
            'model_version', 'created_at'
        ]));
    });

    test('ml_feature_health has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_feature_health)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'feature_name',
            'sample_count', 'mean_importance', 'last_seen_at',
            'disabled', 'disabled_reason', 'disabled_at', 'created_at', 'updated_at'
        ]));
    });

    test('ml_explanations UNIQUE per (user, env, decision_id)', () => {
        db.prepare(
            `INSERT INTO ml_explanations
             (user_id, resolved_env, decision_id, decision, shap_values_json,
              top_positive_json, top_negative_json, decisive_factor, human_language,
              created_at)
             VALUES (?, ?, ?, 'BUY', '{}', '[]', '[]', null, '', ?)`
        ).run(TEST_USER, TEST_ENV, 'dec-1', Date.now());
        expect(() => db.prepare(
            `INSERT INTO ml_explanations
             (user_id, resolved_env, decision_id, decision, shap_values_json,
              top_positive_json, top_negative_json, decisive_factor, human_language,
              created_at)
             VALUES (?, ?, ?, 'BUY', '{}', '[]', '[]', null, '', ?)`
        ).run(TEST_USER, TEST_ENV, 'dec-1', Date.now())).toThrow();
        cleanRows();
    });
});

describe('§25 Exported constants', () => {
    test('TOP_K_FACTORS = 3 per spec', () => {
        expect(ex.TOP_K_FACTORS).toBe(3);
    });

    test('DEGRADATION_THRESHOLD is positive', () => {
        expect(ex.DEGRADATION_THRESHOLD).toBeGreaterThan(0);
    });

    test('MIN_SAMPLES_FOR_DEGRADATION is positive integer', () => {
        expect(ex.MIN_SAMPLES_FOR_DEGRADATION).toBeGreaterThan(0);
        expect(Number.isInteger(ex.MIN_SAMPLES_FOR_DEGRADATION)).toBe(true);
    });
});

describe('§25 formatHumanExplanation (pure)', () => {
    test('returns string with top factors', () => {
        const text = ex.formatHumanExplanation({
            cvd_divergence: 0.4,
            cross_venue_signal: 0.3,
            sweep_reclaim: 0.25,
            high_spread: -0.15
        });
        expect(typeof text).toBe('string');
        expect(text.toLowerCase()).toMatch(/cvd_divergence|cross_venue|sweep_reclaim/);
    });

    test('handles empty shap values', () => {
        const text = ex.formatHumanExplanation({});
        expect(typeof text).toBe('string');
    });

    test('uses contextLabels if provided', () => {
        const text = ex.formatHumanExplanation({
            f1: 0.5, f2: -0.3
        }, {
            f1: 'CVD Divergence',
            f2: 'High Spread'
        });
        expect(text).toMatch(/CVD Divergence/);
    });
});

describe('§25 recordExplanation', () => {
    test('records row with derived top3 positive + top3 negative', () => {
        const r = ex.recordExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-test-1',
            posId: 'pos-1',
            shapValues: {
                cvd_divergence: 0.5,
                cross_venue: 0.3,
                volume: 0.2,
                spread: -0.1,
                latency: -0.05,
                vol_risk: -0.02
            },
            decision: 'BUY',
            modelVersion: 'v1.0'
        });
        expect(r.recorded).toBe(true);

        const explanation = ex.getExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-test-1'
        });
        expect(explanation.topPositive).toHaveLength(3);
        expect(explanation.topPositive[0].feature).toBe('cvd_divergence');
        expect(explanation.topNegative.length).toBeGreaterThan(0);
        expect(explanation.decisiveFactor).toBe('cvd_divergence');
    });

    test('humanLanguage explanation included', () => {
        ex.recordExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-test-2',
            shapValues: { f1: 0.5, f2: 0.3, f3: 0.2 },
            decision: 'BUY'
        });
        const r = ex.getExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-test-2'
        });
        expect(r.humanLanguage.length).toBeGreaterThan(0);
    });

    test('throws on missing shapValues', () => {
        expect(() => ex.recordExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-fail', decision: 'BUY'
        })).toThrow(/shapValues/);
    });

    test('throws on duplicate decisionId', () => {
        ex.recordExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-dup', shapValues: { x: 1 }, decision: 'BUY'
        });
        expect(() => ex.recordExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-dup', shapValues: { y: 2 }, decision: 'SELL'
        })).toThrow();
    });
});

describe('§25 getExplanation', () => {
    test('returns null when decision not recorded', () => {
        const r = ex.getExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-unknown'
        });
        expect(r).toBeNull();
    });

    test('returns full explanation when recorded', () => {
        ex.recordExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-test-3',
            shapValues: { f1: 0.4, f2: 0.3, f3: 0.2, f4: -0.1 },
            decision: 'BUY'
        });
        const r = ex.getExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-test-3'
        });
        expect(r.decisionId).toBe('dec-test-3');
        expect(r.decision).toBe('BUY');
        expect(r.topPositive).toBeDefined();
        expect(r.topNegative).toBeDefined();
        expect(r.humanLanguage).toBeDefined();
        expect(r.shapValues).toBeDefined();
    });
});

describe('§25 trackFeaturePerformance', () => {
    test('records first sample for feature', () => {
        ex.trackFeaturePerformance({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feature: 'cvd_divergence', importance: 0.5, modelVersion: 'v1'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_feature_health WHERE user_id = ? AND feature_name = ?`
        ).all(TEST_USER, 'cvd_divergence');
        expect(rows).toHaveLength(1);
        expect(rows[0].sample_count).toBe(1);
        expect(rows[0].mean_importance).toBeCloseTo(0.5);
    });

    test('updates rolling mean on subsequent samples', () => {
        for (const imp of [0.5, 0.3, 0.4]) {
            ex.trackFeaturePerformance({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                feature: 'volume', importance: imp, modelVersion: 'v1'
            });
        }
        const row = db.prepare(
            `SELECT * FROM ml_feature_health WHERE user_id = ? AND feature_name = ?`
        ).get(TEST_USER, 'volume');
        expect(row.sample_count).toBe(3);
        expect(row.mean_importance).toBeCloseTo(0.4, 1);
    });
});

describe('§25 getDegradedFeatures', () => {
    test('returns empty when no features tracked', () => {
        const r = ex.getDegradedFeatures({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toEqual([]);
    });

    test('returns features below threshold with enough samples', () => {
        // Track high-importance feature
        for (let i = 0; i < ex.MIN_SAMPLES_FOR_DEGRADATION + 5; i++) {
            ex.trackFeaturePerformance({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                feature: 'high_imp_feat', importance: 0.8, modelVersion: 'v1'
            });
        }
        // Track degraded feature
        for (let i = 0; i < ex.MIN_SAMPLES_FOR_DEGRADATION + 5; i++) {
            ex.trackFeaturePerformance({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                feature: 'degraded_feat', importance: 0.01, modelVersion: 'v1'
            });
        }
        const degraded = ex.getDegradedFeatures({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const names = degraded.map(d => d.featureName);
        expect(names).toContain('degraded_feat');
        expect(names).not.toContain('high_imp_feat');
    });

    test('respects custom threshold + minSamples', () => {
        for (let i = 0; i < 3; i++) {
            ex.trackFeaturePerformance({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                feature: 'few_samples', importance: 0.01, modelVersion: 'v1'
            });
        }
        const degraded = ex.getDegradedFeatures({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            minSamples: 5
        });
        expect(degraded.map(d => d.featureName)).not.toContain('few_samples');
    });
});

describe('§25 disableFeatureInModel', () => {
    test('marks feature as disabled', () => {
        ex.trackFeaturePerformance({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            feature: 'to_disable', importance: 0.01, modelVersion: 'v1'
        });
        const r = ex.disableFeatureInModel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureName: 'to_disable',
            reason: 'degraded_performance',
            actor: 'auto_drift_detector'
        });
        expect(r.disabled).toBe(true);
        const row = db.prepare(
            `SELECT * FROM ml_feature_health WHERE feature_name = ?`
        ).get('to_disable');
        expect(row.disabled).toBe(1);
        expect(row.disabled_reason).toBe('degraded_performance');
    });

    test('throws if feature not tracked', () => {
        expect(() => ex.disableFeatureInModel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            featureName: 'never_tracked', reason: 'x', actor: 'test'
        })).toThrow(/not.*tracked|feature/i);
    });
});

describe('§25 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9026;
        ex.recordExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-iso',
            shapValues: { a: 0.5 }, decision: 'BUY'
        });
        ex.recordExplanation({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-iso',
            shapValues: { b: 0.5 }, decision: 'SELL'
        });
        const r1 = ex.getExplanation({
            userId: TEST_USER, resolvedEnv: TEST_ENV, decisionId: 'dec-iso'
        });
        const r2 = ex.getExplanation({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, decisionId: 'dec-iso'
        });
        expect(r1.decision).toBe('BUY');
        expect(r2.decision).toBe('SELL');
        db.prepare(`DELETE FROM ml_explanations WHERE user_id = ?`).run(OTHER_USER);
    });
});
