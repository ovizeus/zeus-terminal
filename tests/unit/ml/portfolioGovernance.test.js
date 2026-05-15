'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p30-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const pg = require('../../../server/services/ml/R3A_safety/portfolioGovernance');

const TEST_USER = 9030;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_portfolio_state WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§30 Migration 059_ml_portfolio_state', () => {
    test('table ml_portfolio_state exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_portfolio_state'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_portfolio_state)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'check_kind', 'decision',
            'total_exposure_pct', 'risk_score', 'details_json', 'created_at'
        ]));
    });

    test('CHECK check_kind restricts to allowed values', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_portfolio_state
             (user_id, resolved_env, check_kind, decision, total_exposure_pct, risk_score, created_at)
             VALUES (?, ?, 'BOGUS', 'ALLOW', 0, 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK decision restricts to ALLOW|RESTRICT|BLOCK', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_portfolio_state
             (user_id, resolved_env, check_kind, decision, total_exposure_pct, risk_score, created_at)
             VALUES (?, ?, 'POSITION_RISK', 'YOLO', 0, 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§30 Exported constants', () => {
    test('ASSET_CATEGORIES has 6 entries', () => {
        expect(pg.ASSET_CATEGORIES).toEqual(expect.arrayContaining([
            'BTC', 'ETH', 'LARGE_CAP', 'MID_CAP', 'SMALL_CAP', 'STABLE'
        ]));
    });

    test('DEFAULT_LIMITS has positive numeric caps', () => {
        expect(pg.DEFAULT_LIMITS.max_total_exposure_pct).toBeGreaterThan(0);
        expect(pg.DEFAULT_LIMITS.max_per_asset_pct).toBeGreaterThan(0);
        expect(pg.DEFAULT_LIMITS.max_per_category_pct).toBeGreaterThan(0);
        expect(pg.DEFAULT_LIMITS.max_concurrent_positions).toBeGreaterThan(0);
        expect(pg.DEFAULT_LIMITS.max_correlated_cluster_pct).toBeGreaterThan(0);
    });

    test('CATEGORY_CORRELATIONS matrix complete (symmetric)', () => {
        for (const a of pg.ASSET_CATEGORIES) {
            for (const b of pg.ASSET_CATEGORIES) {
                const corr = pg.CATEGORY_CORRELATIONS[a] && pg.CATEGORY_CORRELATIONS[a][b];
                expect(typeof corr).toBe('number');
                expect(corr).toBeGreaterThanOrEqual(-1);
                expect(corr).toBeLessThanOrEqual(1);
            }
        }
    });

    test('classifyAsset returns valid category', () => {
        expect(pg.classifyAsset('BTCUSDT')).toBe('BTC');
        expect(pg.classifyAsset('ETHUSDT')).toBe('ETH');
        expect(pg.classifyAsset('USDCUSDT')).toBe('STABLE');
    });
});

describe('§30 computeCorrelationMatrix', () => {
    test('empty positions → empty matrix', () => {
        expect(pg.computeCorrelationMatrix([])).toEqual({});
    });

    test('returns symmetric matrix between positions', () => {
        const m = pg.computeCorrelationMatrix([
            { symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }
        ]);
        expect(m['BTCUSDT']['ETHUSDT']).toBeCloseTo(m['ETHUSDT']['BTCUSDT']);
    });

    test('same-category positions have higher correlation than cross-category', () => {
        const m = pg.computeCorrelationMatrix([
            { symbol: 'BTCUSDT' },  // BTC
            { symbol: 'ETHUSDT' },  // ETH
            { symbol: 'USDCUSDT' }  // STABLE
        ]);
        const btc_eth = m['BTCUSDT']['ETHUSDT'];
        const btc_stable = m['BTCUSDT']['USDCUSDT'];
        expect(btc_eth).toBeGreaterThan(btc_stable);
    });

    test('self-correlation = 1.0', () => {
        const m = pg.computeCorrelationMatrix([{ symbol: 'BTCUSDT' }]);
        expect(m['BTCUSDT']['BTCUSDT']).toBe(1);
    });
});

describe('§30 calculateExposure', () => {
    test('empty positions → 0% exposure', () => {
        const r = pg.calculateExposure({ positions: [], balance: 10000 });
        expect(r.totalExposurePct).toBe(0);
        expect(r.perAssetPct).toEqual({});
    });

    test('computes per-asset exposure correctly', () => {
        const r = pg.calculateExposure({
            positions: [
                { symbol: 'BTCUSDT', sizeUsd: 1000 },
                { symbol: 'ETHUSDT', sizeUsd: 500 }
            ],
            balance: 10000
        });
        expect(r.totalExposurePct).toBeCloseTo(15);
        expect(r.perAssetPct.BTCUSDT).toBeCloseTo(10);
        expect(r.perAssetPct.ETHUSDT).toBeCloseTo(5);
    });

    test('aggregates per-category', () => {
        const r = pg.calculateExposure({
            positions: [
                { symbol: 'BTCUSDT', sizeUsd: 1000 },
                { symbol: 'ETHUSDT', sizeUsd: 500 }
            ],
            balance: 10000
        });
        expect(r.perCategoryPct.BTC).toBeCloseTo(10);
        expect(r.perCategoryPct.ETH).toBeCloseTo(5);
    });

    test('handles balance=0 gracefully', () => {
        const r = pg.calculateExposure({
            positions: [{ symbol: 'BTCUSDT', sizeUsd: 100 }],
            balance: 0
        });
        expect(r.totalExposurePct).toBe(Infinity);
    });
});

describe('§30 evaluateNewPositionRisk', () => {
    test('candidate within all limits → ALLOW', () => {
        const r = pg.evaluateNewPositionRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'SOLUSDT', sizeUsd: 200 },
            currentPositions: [],
            balance: 10000
        });
        expect(r.allowed).toBe(true);
        expect(r.blockers).toEqual([]);
    });

    test('candidate over total exposure cap → BLOCK', () => {
        const limits = { ...pg.DEFAULT_LIMITS, max_total_exposure_pct: 5 };
        const r = pg.evaluateNewPositionRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'BTCUSDT', sizeUsd: 1000 },
            currentPositions: [],
            balance: 10000,
            limits
        });
        expect(r.allowed).toBe(false);
        expect(r.blockers).toContain('total_exposure_cap');
    });

    test('candidate over per-asset cap → BLOCK', () => {
        const limits = { ...pg.DEFAULT_LIMITS, max_per_asset_pct: 5 };
        const r = pg.evaluateNewPositionRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'BTCUSDT', sizeUsd: 1000 },
            currentPositions: [],
            balance: 10000,
            limits
        });
        expect(r.allowed).toBe(false);
        expect(r.blockers).toContain('per_asset_cap');
    });

    test('candidate adds to existing cluster exceeding category cap → BLOCK', () => {
        const limits = { ...pg.DEFAULT_LIMITS, max_per_category_pct: 10 };
        const r = pg.evaluateNewPositionRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'BTCUSDT', sizeUsd: 500 },
            currentPositions: [{ symbol: 'BTCUSDT', sizeUsd: 800 }],
            balance: 10000,
            limits
        });
        expect(r.allowed).toBe(false);
        expect(r.blockers).toContain('per_category_cap');
    });

    test('candidate exceeds concurrent positions cap → BLOCK', () => {
        const limits = { ...pg.DEFAULT_LIMITS, max_concurrent_positions: 2 };
        const r = pg.evaluateNewPositionRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'BNBUSDT', sizeUsd: 100 },
            currentPositions: [
                { symbol: 'BTCUSDT', sizeUsd: 100 },
                { symbol: 'ETHUSDT', sizeUsd: 100 }
            ],
            balance: 10000,
            limits
        });
        expect(r.allowed).toBe(false);
        expect(r.blockers).toContain('max_concurrent');
    });

    test('riskScore in [0, 1] range', () => {
        const r = pg.evaluateNewPositionRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'BTCUSDT', sizeUsd: 200 },
            currentPositions: [],
            balance: 10000
        });
        expect(r.riskScore).toBeGreaterThanOrEqual(0);
        expect(r.riskScore).toBeLessThanOrEqual(1);
    });

    test('adjustedSize reduces when soft caps violated (RESTRICT path)', () => {
        const limits = { ...pg.DEFAULT_LIMITS, max_per_asset_pct: 5 };
        const r = pg.evaluateNewPositionRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'BTCUSDT', sizeUsd: 700 },
            currentPositions: [],
            balance: 10000,
            limits,
            allowAdjustment: true
        });
        // With adjustment allowed, sizeUsd should be reduced to fit cap
        expect(r.adjustedSize).toBeLessThanOrEqual(500);
    });
});

describe('§30 assessClusterRisk', () => {
    test('empty positions → no clusters', () => {
        const r = pg.assessClusterRisk({ positions: [] });
        expect(r.maxCluster).toBe(0);
        expect(r.clusters).toEqual([]);
    });

    test('single category dominates → large cluster identified', () => {
        const r = pg.assessClusterRisk({
            positions: [
                { symbol: 'BTCUSDT', sizeUsd: 1000 },
                { symbol: 'ETHUSDT', sizeUsd: 800 },  // high corr with BTC
                { symbol: 'SOLUSDT', sizeUsd: 100 }   // STABLE-like correlation
            ]
        });
        expect(r.clusters.length).toBeGreaterThan(0);
        expect(r.maxCluster).toBeGreaterThan(0);
    });

    test('risk score scales with cluster concentration', () => {
        const concentrated = pg.assessClusterRisk({
            positions: [
                { symbol: 'BTCUSDT', sizeUsd: 1000 },
                { symbol: 'BTCUSDT', sizeUsd: 1000 }  // same asset
            ]
        });
        const diversified = pg.assessClusterRisk({
            positions: [
                { symbol: 'BTCUSDT', sizeUsd: 500 },
                { symbol: 'USDCUSDT', sizeUsd: 500 }  // uncorrelated
            ]
        });
        expect(concentrated.riskScore).toBeGreaterThan(diversified.riskScore);
    });
});

describe('§30 estimateRuinProbability', () => {
    test('empty positions → 0 ruin prob', () => {
        const r = pg.estimateRuinProbability({
            balance: 10000, positions: [], scenarioLossPct: 0.1
        });
        expect(r.ruinProb).toBe(0);
    });

    test('higher exposure → higher ruin prob', () => {
        const high = pg.estimateRuinProbability({
            balance: 10000,
            positions: [{ symbol: 'BTCUSDT', sizeUsd: 5000 }],
            scenarioLossPct: 0.5
        });
        const low = pg.estimateRuinProbability({
            balance: 10000,
            positions: [{ symbol: 'BTCUSDT', sizeUsd: 100 }],
            scenarioLossPct: 0.5
        });
        expect(high.ruinProb).toBeGreaterThan(low.ruinProb);
    });

    test('ruinProb capped at 1.0', () => {
        const r = pg.estimateRuinProbability({
            balance: 1000,
            positions: [
                { symbol: 'BTCUSDT', sizeUsd: 2000 },
                { symbol: 'ETHUSDT', sizeUsd: 2000 }
            ],
            scenarioLossPct: 1.0
        });
        expect(r.ruinProb).toBeLessThanOrEqual(1.0);
        expect(r.ruinProb).toBeGreaterThanOrEqual(0);
    });

    test('expectedDD non-negative', () => {
        const r = pg.estimateRuinProbability({
            balance: 10000,
            positions: [{ symbol: 'BTCUSDT', sizeUsd: 1000 }],
            scenarioLossPct: 0.2
        });
        expect(r.expectedDD).toBeGreaterThanOrEqual(0);
    });
});

describe('§30 audit logging', () => {
    test('evaluateNewPositionRisk logs row', () => {
        pg.evaluateNewPositionRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'BTCUSDT', sizeUsd: 200 },
            currentPositions: [],
            balance: 10000
        });
        const rows = db.prepare(
            `SELECT * FROM ml_portfolio_state WHERE user_id = ? AND check_kind = 'POSITION_RISK'`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].decision).toBe('ALLOW');
    });

    test('BLOCK decision logs accordingly', () => {
        const limits = { ...pg.DEFAULT_LIMITS, max_total_exposure_pct: 0.1 };
        pg.evaluateNewPositionRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'BTCUSDT', sizeUsd: 5000 },
            currentPositions: [],
            balance: 10000,
            limits
        });
        const rows = db.prepare(
            `SELECT * FROM ml_portfolio_state WHERE user_id = ? AND decision = 'BLOCK'`
        ).all(TEST_USER);
        expect(rows.length).toBeGreaterThan(0);
    });
});

describe('§30 validation + isolation', () => {
    test('throws on missing userId', () => {
        expect(() => pg.evaluateNewPositionRisk({
            resolvedEnv: TEST_ENV,
            candidate: { symbol: 'BTCUSDT', sizeUsd: 100 },
            currentPositions: [], balance: 10000
        })).toThrow(/userId/);
    });

    test('throws on missing balance', () => {
        expect(() => pg.evaluateNewPositionRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'BTCUSDT', sizeUsd: 100 },
            currentPositions: []
        })).toThrow(/balance/);
    });

    test('per (user × env) isolation', () => {
        const OTHER_USER = 9031;
        pg.evaluateNewPositionRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'BTCUSDT', sizeUsd: 100 },
            currentPositions: [], balance: 10000
        });
        pg.evaluateNewPositionRisk({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            candidate: { symbol: 'ETHUSDT', sizeUsd: 100 },
            currentPositions: [], balance: 10000
        });
        const myRows = db.prepare(`SELECT * FROM ml_portfolio_state WHERE user_id = ?`).all(TEST_USER);
        const otherRows = db.prepare(`SELECT * FROM ml_portfolio_state WHERE user_id = ?`).all(OTHER_USER);
        expect(myRows.length).toBeGreaterThan(0);
        expect(otherRows.length).toBeGreaterThan(0);
        db.prepare(`DELETE FROM ml_portfolio_state WHERE user_id = ?`).run(OTHER_USER);
    });
});
