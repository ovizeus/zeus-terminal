'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p31-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const smd = require('../../../server/services/ml/R2_cognition/smartMoneyDetector');

const TEST_USER = 9031;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_smart_money_observations WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§31 Migration 070_ml_smart_money_observations', () => {
    test('table ml_smart_money_observations exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_smart_money_observations'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_smart_money_observations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'signal_type',
            'sample_count', 'mean_strength', 'regime', 'created_at', 'updated_at'
        ]));
    });

    test('CHECK signal_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_smart_money_observations
             (user_id, resolved_env, signal_type, sample_count, mean_strength, created_at, updated_at)
             VALUES (?, ?, 'BOGUS', 1, 0.5, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });
});

describe('§31 Exported constants', () => {
    test('SIGNAL_TYPES has 10 spec entries', () => {
        expect(smd.SIGNAL_TYPES).toHaveLength(10);
        expect(smd.SIGNAL_TYPES).toEqual(expect.arrayContaining([
            'institutional_divergence', 'venue_divergence',
            'smart_money_signature', 'absorption_post_sweep',
            'hidden_distribution', 'cluster_short_above',
            'cluster_long_below', 'cascade_probability',
            'heatmap_pressure', 'liquidation_magnet'
        ]));
    });

    test('VENUE_KEYS includes major exchanges', () => {
        expect(smd.VENUE_KEYS).toEqual(expect.arrayContaining([
            'binance', 'bybit', 'coinbase'
        ]));
    });

    test('CASCADE_THRESHOLDS finite values', () => {
        expect(smd.CASCADE_THRESHOLDS.cluster_size_pct).toBeGreaterThan(0);
        expect(smd.CASCADE_THRESHOLDS.cascade_prob_alert).toBeGreaterThan(0);
        expect(smd.CASCADE_THRESHOLDS.divergence_pct).toBeGreaterThan(0);
    });
});

describe('§31 detectInstitutionalDivergence (pure)', () => {
    test('no divergence when venues aligned', () => {
        const r = smd.detectInstitutionalDivergence({
            venueData: {
                binance:  { price: 50000, volume: 1000000, buyPct: 0.5 },
                bybit:    { price: 50005, volume: 800000,  buyPct: 0.51 },
                coinbase: { price: 50010, volume: 500000,  buyPct: 0.52 }
            }
        });
        expect(r.divergenceDetected).toBe(false);
        expect(r.severity).toBeLessThan(0.3);
    });

    test('Coinbase premium (institutional) → divergence', () => {
        const r = smd.detectInstitutionalDivergence({
            venueData: {
                binance:  { price: 50000, volume: 1000000, buyPct: 0.50 },
                bybit:    { price: 50010, volume: 800000,  buyPct: 0.50 },
                coinbase: { price: 50300, volume: 500000,  buyPct: 0.80 }  // institutional buy
            }
        });
        expect(r.divergenceDetected).toBe(true);
        expect(r.leadingVenue).toBe('coinbase');
    });

    test('buyPct extreme divergence → divergence signal', () => {
        const r = smd.detectInstitutionalDivergence({
            venueData: {
                binance:  { price: 50000, volume: 1000000, buyPct: 0.50 },
                bybit:    { price: 50000, volume: 800000,  buyPct: 0.51 },
                coinbase: { price: 50000, volume: 500000,  buyPct: 0.85 }
            }
        });
        expect(r.divergenceDetected).toBe(true);
    });

    test('handles missing venue gracefully', () => {
        const r = smd.detectInstitutionalDivergence({
            venueData: {
                binance: { price: 50000, volume: 1000000, buyPct: 0.5 }
            }
        });
        expect(r.divergenceDetected).toBe(false);
        expect(r.severity).toBe(0);
    });
});

describe('§31 detectLiquidationClusters (pure)', () => {
    test('cluster of short liquidations above price', () => {
        const r = smd.detectLiquidationClusters({
            currentPrice: 50000,
            orderBookHeatmap: {
                shortLiqs: {
                    50500: 5000000,
                    50800: 8000000,
                    51000: 4000000
                },
                longLiqs: {
                    49500: 1000000
                }
            }
        });
        expect(r.clustersAbove.length).toBeGreaterThan(0);
        expect(r.totalShortLiqAbove).toBeGreaterThan(r.totalLongLiqBelow);
    });

    test('cluster of long liquidations below price', () => {
        const r = smd.detectLiquidationClusters({
            currentPrice: 50000,
            orderBookHeatmap: {
                shortLiqs: { 51000: 1000000 },
                longLiqs: {
                    49500: 5000000,
                    49000: 8000000
                }
            }
        });
        expect(r.clustersBelow.length).toBeGreaterThan(0);
        expect(r.totalLongLiqBelow).toBeGreaterThan(r.totalShortLiqAbove);
    });

    test('liquidation magnet detected when both clusters significant', () => {
        const r = smd.detectLiquidationClusters({
            currentPrice: 50000,
            orderBookHeatmap: {
                shortLiqs: { 50500: 10000000 },
                longLiqs: { 49500: 10000000 }
            }
        });
        expect(r.magnetLevel).toBeDefined();
    });

    test('empty heatmap returns no clusters', () => {
        const r = smd.detectLiquidationClusters({
            currentPrice: 50000,
            orderBookHeatmap: { shortLiqs: {}, longLiqs: {} }
        });
        expect(r.clustersAbove).toEqual([]);
        expect(r.clustersBelow).toEqual([]);
    });
});

describe('§31 estimateCascadeProbability (pure)', () => {
    test('zero clusters → low probability', () => {
        const r = smd.estimateCascadeProbability({
            liquidationClusters: { clustersAbove: [], clustersBelow: [],
                                   totalShortLiqAbove: 0, totalLongLiqBelow: 0 },
            currentPrice: 50000,
            volatility: 0.01
        });
        expect(r.cascadeProb).toBeLessThan(0.2);
    });

    test('large cluster + high volatility → high probability', () => {
        const r = smd.estimateCascadeProbability({
            liquidationClusters: {
                clustersAbove: [{ level: 50500, size: 50000000 }],
                clustersBelow: [],
                totalShortLiqAbove: 50000000,
                totalLongLiqBelow: 0
            },
            currentPrice: 50000,
            volatility: 0.05
        });
        expect(r.cascadeProb).toBeGreaterThan(0.3);
    });

    test('cascadeProb capped at 1.0', () => {
        const r = smd.estimateCascadeProbability({
            liquidationClusters: {
                clustersAbove: [{ level: 50500, size: 999999999 }],
                clustersBelow: [{ level: 49500, size: 999999999 }],
                totalShortLiqAbove: 999999999,
                totalLongLiqBelow: 999999999
            },
            currentPrice: 50000,
            volatility: 0.20
        });
        expect(r.cascadeProb).toBeLessThanOrEqual(1.0);
    });

    test('returns predicted direction', () => {
        const r = smd.estimateCascadeProbability({
            liquidationClusters: {
                clustersAbove: [{ level: 50500, size: 50000000 }],
                clustersBelow: [],
                totalShortLiqAbove: 50000000,
                totalLongLiqBelow: 0
            },
            currentPrice: 50000,
            volatility: 0.05
        });
        expect(['UP', 'DOWN', 'NEUTRAL']).toContain(r.predictedDirection);
    });
});

describe('§31 detectAbsorption (pure)', () => {
    test('absorption detected post-sweep when price recovers', () => {
        const r = smd.detectAbsorption({
            tradeHistory: [
                { price: 50000, volume: 100 },
                { price: 49800, volume: 5000 },  // sweep
                { price: 50100, volume: 500 }     // recovery
            ],
            sweepEvents: [{ level: 49800, ts: Date.now() - 60000 }]
        });
        expect(r.absorptionDetected).toBe(true);
    });

    test('no absorption when no sweep events', () => {
        const r = smd.detectAbsorption({
            tradeHistory: [],
            sweepEvents: []
        });
        expect(r.absorptionDetected).toBe(false);
    });
});

describe('§31 recordObservation', () => {
    test('records first observation for signal_type', () => {
        smd.recordObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalType: 'institutional_divergence',
            payload: { severity: 0.8 }, regime: 'trend'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_smart_money_observations WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].signal_type).toBe('institutional_divergence');
    });

    test('rolling mean update on multiple observations', () => {
        for (const v of [0.3, 0.5, 0.7]) {
            smd.recordObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalType: 'cascade_probability',
                payload: { strength: v }, regime: 'trend'
            });
        }
        const row = db.prepare(
            `SELECT * FROM ml_smart_money_observations
             WHERE user_id = ? AND signal_type = ? AND regime = ?`
        ).get(TEST_USER, 'cascade_probability', 'trend');
        expect(row.sample_count).toBe(3);
        expect(row.mean_strength).toBeCloseTo(0.5, 1);
    });

    test('throws on invalid signal_type', () => {
        expect(() => smd.recordObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalType: 'bogus_signal',
            payload: { strength: 0.5 }
        })).toThrow(/signal/i);
    });
});

describe('§31 getSignalStrength', () => {
    test('returns null for unobserved signal', () => {
        const r = smd.getSignalStrength({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalType: 'liquidation_magnet'
        });
        expect(r).toBeNull();
    });

    test('returns rolling stats', () => {
        for (const v of [0.4, 0.6, 0.8]) {
            smd.recordObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                signalType: 'cluster_short_above',
                payload: { strength: v }, regime: 'trend'
            });
        }
        const r = smd.getSignalStrength({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalType: 'cluster_short_above', regime: 'trend'
        });
        expect(r.mean).toBeCloseTo(0.6, 1);
        expect(r.count).toBe(3);
    });
});

describe('§31 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9032;
        smd.recordObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalType: 'venue_divergence',
            payload: { strength: 0.3 }
        });
        smd.recordObservation({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            signalType: 'venue_divergence',
            payload: { strength: 0.8 }
        });
        const r1 = smd.getSignalStrength({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signalType: 'venue_divergence'
        });
        const r2 = smd.getSignalStrength({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            signalType: 'venue_divergence'
        });
        expect(r1.mean).toBeCloseTo(0.3);
        expect(r2.mean).toBeCloseTo(0.8);
        db.prepare(`DELETE FROM ml_smart_money_observations WHERE user_id = ?`).run(OTHER_USER);
    });
});
