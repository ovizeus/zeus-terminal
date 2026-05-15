'use strict';

/**
 * OMEGA R3A Safety — portfolioGovernance (canonical §30)
 *
 * §30 PORTOFOLIU, CORELATII SI CAPITAL GOVERNANCE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1273-1285.
 *
 * 5 grouped primitives for portfolio-level safety:
 *
 *   1. evaluateNewPositionRisk()  — admission check before opening new position.
 *      Caps: total_exposure / per_asset / per_category / concurrent_positions.
 *      Decision: ALLOW / RESTRICT (with adjustedSize) / BLOCK.
 *
 *   2. computeCorrelationMatrix() — category-based heuristic correlation
 *      between current positions. Self = 1.0. Categories share correlation
 *      per CATEGORY_CORRELATIONS table.
 *
 *   3. calculateExposure()         — totals + per-asset + per-category as pct
 *      of balance.
 *
 *   4. assessClusterRisk()         — identifies correlated clusters that
 *      could lose together (cluster_loss risk).
 *
 *   5. estimateRuinProbability()   — simplistic Monte Carlo over scenario
 *      loss; returns ruinProb + expectedDD.
 *
 * Composability: BLOCK / high riskScore → §14 portfolio_risk hierarchy.
 */

const { db } = require('../../database');

const ASSET_CATEGORIES = Object.freeze([
    'BTC', 'ETH', 'LARGE_CAP', 'MID_CAP', 'SMALL_CAP', 'STABLE'
]);

const DEFAULT_LIMITS = Object.freeze({
    max_total_exposure_pct:     50,    // 50% of balance max in positions
    max_per_asset_pct:          15,    // 15% in single asset
    max_per_category_pct:       30,    // 30% in single category
    max_concurrent_positions:    8,
    max_correlated_cluster_pct: 40     // cluster of highly correlated total
});

// Category → category correlation heuristic (symmetric).
// Values: BTC↔ETH 0.85, large caps 0.70, mid 0.55, small 0.45, stables 0.05.
const CATEGORY_CORRELATIONS = Object.freeze({
    BTC:        { BTC: 1.0,  ETH: 0.85, LARGE_CAP: 0.75, MID_CAP: 0.60, SMALL_CAP: 0.45, STABLE: 0.02 },
    ETH:        { BTC: 0.85, ETH: 1.0,  LARGE_CAP: 0.80, MID_CAP: 0.65, SMALL_CAP: 0.50, STABLE: 0.02 },
    LARGE_CAP:  { BTC: 0.75, ETH: 0.80, LARGE_CAP: 0.70, MID_CAP: 0.55, SMALL_CAP: 0.40, STABLE: 0.02 },
    MID_CAP:    { BTC: 0.60, ETH: 0.65, LARGE_CAP: 0.55, MID_CAP: 0.55, SMALL_CAP: 0.45, STABLE: 0.02 },
    SMALL_CAP:  { BTC: 0.45, ETH: 0.50, LARGE_CAP: 0.40, MID_CAP: 0.45, SMALL_CAP: 0.45, STABLE: 0.02 },
    STABLE:     { BTC: 0.02, ETH: 0.02, LARGE_CAP: 0.02, MID_CAP: 0.02, SMALL_CAP: 0.02, STABLE: 0.05 }
});

// Heuristic symbol → category classifier
const _BTC_SYMS = ['BTCUSDT', 'BTCUSD', 'BTC'];
const _ETH_SYMS = ['ETHUSDT', 'ETHUSD', 'ETH'];
const _LARGE_CAP_SYMS = ['BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];
const _STABLE_HINTS = ['USDCUSDT', 'USDC', 'DAI', 'TUSD', 'USDT', 'BUSD'];

function classifyAsset(symbol) {
    if (!symbol) return 'SMALL_CAP';
    const s = symbol.toUpperCase();
    if (_BTC_SYMS.includes(s)) return 'BTC';
    if (_ETH_SYMS.includes(s)) return 'ETH';
    if (_LARGE_CAP_SYMS.includes(s)) return 'LARGE_CAP';
    if (_STABLE_HINTS.some(h => s === h || s.startsWith(h.slice(0, -4)))) return 'STABLE';
    // crude length-based heuristic for remaining: shorter ticker = larger cap
    return s.length <= 7 ? 'MID_CAP' : 'SMALL_CAP';
}

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`portfolioGovernance: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statement ─────────────────────────────────────────────
const _stmts = {
    insertLog: db.prepare(`
        INSERT INTO ml_portfolio_state
        (user_id, resolved_env, check_kind, decision,
         total_exposure_pct, risk_score, details_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── computeCorrelationMatrix ───────────────────────────────────────
function computeCorrelationMatrix(positions) {
    const matrix = {};
    if (!Array.isArray(positions) || positions.length === 0) return matrix;

    for (const a of positions) {
        if (!a || !a.symbol) continue;
        const catA = classifyAsset(a.symbol);
        matrix[a.symbol] = matrix[a.symbol] || {};
        for (const b of positions) {
            if (!b || !b.symbol) continue;
            if (a.symbol === b.symbol) {
                matrix[a.symbol][b.symbol] = 1.0;
                continue;
            }
            const catB = classifyAsset(b.symbol);
            const corr = CATEGORY_CORRELATIONS[catA] && CATEGORY_CORRELATIONS[catA][catB];
            matrix[a.symbol][b.symbol] = corr !== undefined ? corr : 0.3;
        }
    }
    return matrix;
}

// ── calculateExposure ──────────────────────────────────────────────
function calculateExposure(params) {
    const positions = (params && Array.isArray(params.positions)) ? params.positions : [];
    const balance = (params && typeof params.balance === 'number') ? params.balance : 0;

    const perAssetPct = {};
    const perCategoryPct = {};
    let totalUsd = 0;

    for (const p of positions) {
        if (!p || !p.symbol || typeof p.sizeUsd !== 'number') continue;
        const cat = classifyAsset(p.symbol);
        totalUsd += p.sizeUsd;
        perAssetPct[p.symbol] = (perAssetPct[p.symbol] || 0)
            + (balance > 0 ? (p.sizeUsd / balance) * 100 : Infinity);
        perCategoryPct[cat] = (perCategoryPct[cat] || 0)
            + (balance > 0 ? (p.sizeUsd / balance) * 100 : Infinity);
    }

    const totalExposurePct = balance > 0 ? (totalUsd / balance) * 100
        : (totalUsd > 0 ? Infinity : 0);

    return { totalExposurePct, perAssetPct, perCategoryPct };
}

// ── assessClusterRisk ──────────────────────────────────────────────
function assessClusterRisk(params) {
    const positions = (params && Array.isArray(params.positions)) ? params.positions : [];
    if (positions.length === 0) {
        return { maxCluster: 0, clusters: [], riskScore: 0 };
    }

    // Aggregate by symbol first (same-symbol duplicates are perfectly correlated)
    const bySymbol = {};
    for (const p of positions) {
        if (!p || !p.symbol) continue;
        bySymbol[p.symbol] = (bySymbol[p.symbol] || 0) + (p.sizeUsd || 0);
    }
    const aggregatedPositions = Object.keys(bySymbol).map(sym => ({
        symbol: sym, sizeUsd: bySymbol[sym]
    }));

    const matrix = computeCorrelationMatrix(aggregatedPositions);
    const CLUSTER_CORR_THRESHOLD = 0.6;
    const visited = new Set();
    const clusters = [];

    for (const p of aggregatedPositions) {
        if (visited.has(p.symbol)) continue;
        const cluster = [p];
        visited.add(p.symbol);
        for (const q of aggregatedPositions) {
            if (visited.has(q.symbol)) continue;
            const corr = matrix[p.symbol] && matrix[p.symbol][q.symbol];
            if (corr !== undefined && corr >= CLUSTER_CORR_THRESHOLD) {
                cluster.push(q);
                visited.add(q.symbol);
            }
        }
        const clusterSize = cluster.reduce((s, x) => s + (x.sizeUsd || 0), 0);
        clusters.push({
            members: cluster.map(c => c.symbol),
            sizeUsd: clusterSize
        });
    }

    const totalSize = aggregatedPositions.reduce((s, x) => s + (x.sizeUsd || 0), 0);
    const maxClusterSize = clusters.reduce((mx, c) => Math.max(mx, c.sizeUsd), 0);
    const maxCluster = totalSize > 0 ? maxClusterSize / totalSize : 0;
    const riskScore = Math.min(1.0, maxCluster);

    return { maxCluster, clusters, riskScore };
}

// ── estimateRuinProbability ─────────────────────────────────────────
function estimateRuinProbability(params) {
    const balance = (params && typeof params.balance === 'number') ? params.balance : 0;
    const positions = (params && Array.isArray(params.positions)) ? params.positions : [];
    const scenarioLossPct = (params && typeof params.scenarioLossPct === 'number')
        ? params.scenarioLossPct : 0.1;

    if (positions.length === 0 || balance <= 0) {
        return { ruinProb: 0, expectedDD: 0 };
    }

    const totalExposureUsd = positions.reduce((s, p) => s + (p.sizeUsd || 0), 0);
    const expectedLoss = totalExposureUsd * Math.max(0, Math.min(1, scenarioLossPct));
    const expectedDD = Math.max(0, expectedLoss / balance);

    // Ruin = expected loss exceeds 80% balance
    const ruinThreshold = 0.8;
    const ruinProb = Math.max(0, Math.min(1.0, expectedDD / ruinThreshold));

    return { ruinProb, expectedDD };
}

// ── evaluateNewPositionRisk ────────────────────────────────────────
function evaluateNewPositionRisk(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const candidate = _required(params, 'candidate');
    const balance = _required(params, 'balance');
    const currentPositions = (params && Array.isArray(params.currentPositions))
        ? params.currentPositions : [];
    const limits = (params && params.limits) ? params.limits : DEFAULT_LIMITS;
    const allowAdjustment = !!(params && params.allowAdjustment);

    const blockers = [];
    const totalAfter = currentPositions.reduce((s, p) => s + (p.sizeUsd || 0), 0) + candidate.sizeUsd;
    const totalAfterPct = balance > 0 ? (totalAfter / balance) * 100 : Infinity;
    if (totalAfterPct > limits.max_total_exposure_pct) {
        blockers.push('total_exposure_cap');
    }

    // Per-asset check
    let assetAfter = candidate.sizeUsd;
    for (const p of currentPositions) {
        if (p.symbol === candidate.symbol) assetAfter += (p.sizeUsd || 0);
    }
    const assetAfterPct = balance > 0 ? (assetAfter / balance) * 100 : Infinity;
    if (assetAfterPct > limits.max_per_asset_pct) {
        blockers.push('per_asset_cap');
    }

    // Per-category check
    const candidateCat = classifyAsset(candidate.symbol);
    let categoryAfter = candidate.sizeUsd;
    for (const p of currentPositions) {
        if (classifyAsset(p.symbol) === candidateCat) {
            categoryAfter += (p.sizeUsd || 0);
        }
    }
    const categoryAfterPct = balance > 0 ? (categoryAfter / balance) * 100 : Infinity;
    if (categoryAfterPct > limits.max_per_category_pct) {
        blockers.push('per_category_cap');
    }

    // Concurrent positions
    const wouldBeConcurrent = currentPositions.length + 1;
    if (wouldBeConcurrent > limits.max_concurrent_positions) {
        blockers.push('max_concurrent');
    }

    // Cluster risk pre-emptive
    const clusterAssessment = assessClusterRisk({
        positions: [...currentPositions, candidate]
    });

    // Adjusted size for soft RESTRICT (only if requested)
    let adjustedSize = candidate.sizeUsd;
    let decision = 'ALLOW';

    if (blockers.length > 0) {
        if (allowAdjustment && blockers.includes('per_asset_cap')) {
            const maxAllowedAssetUsd = (limits.max_per_asset_pct / 100) * balance;
            const existingSameAsset = currentPositions
                .filter(p => p.symbol === candidate.symbol)
                .reduce((s, p) => s + (p.sizeUsd || 0), 0);
            adjustedSize = Math.max(0, maxAllowedAssetUsd - existingSameAsset);
            decision = 'RESTRICT';
        } else {
            decision = 'BLOCK';
        }
    }

    const riskScore = Math.min(1.0, Math.max(0,
        (totalAfterPct / limits.max_total_exposure_pct) * 0.4 +
        clusterAssessment.riskScore * 0.6
    ));

    const allowed = decision === 'ALLOW' || decision === 'RESTRICT';

    _stmts.insertLog.run(
        userId, env, 'POSITION_RISK', decision,
        totalAfterPct, riskScore,
        JSON.stringify({
            candidate, blockers, adjustedSize,
            assetAfterPct, categoryAfterPct, wouldBeConcurrent,
            clusterRiskScore: clusterAssessment.riskScore
        }),
        Date.now()
    );

    return { allowed, decision, blockers, adjustedSize, riskScore };
}

module.exports = {
    ASSET_CATEGORIES,
    DEFAULT_LIMITS,
    CATEGORY_CORRELATIONS,
    classifyAsset,
    computeCorrelationMatrix,
    calculateExposure,
    assessClusterRisk,
    estimateRuinProbability,
    evaluateNewPositionRisk
};
