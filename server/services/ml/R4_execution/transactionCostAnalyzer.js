'use strict';

/**
 * OMEGA R4 Execution — transactionCostAnalyzer (canonical §23)
 *
 * §23 SIMULARE COSTURI, TCA SI MARKET IMPACT.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1102-1116.
 *
 * "Brain-ul trebuie sa estimeze costul real, nu costul visat."
 *
 * 12 requirements (lines 1104-1116):
 *   - TCA integrat                                       → recordTcaEstimate
 *   - slippage model dep. book depth                     → estimateTransactionCost
 *   - slippage model dep. order size                     → estimateTransactionCost
 *   - slippage model dep. time-of-day                    → estimateTransactionCost
 *   - fee model per exchange                             → EXCHANGE_FEE_MODELS
 *   - maker/taker/rebates                                → isMaker param
 *   - partial fills in backtest                          → consumer responsibility
 *   - latency in backtest                                → §28 monitorLatency
 *   - iceberg/hidden liquidity assumptions               → bookDepthUsd param
 *   - market impact model                                → estimateMarketImpact
 *   - efectul propriului ordin asupra pretului           → market impact integrated
 *
 * INVARIANT (line 1116):
 *   "trade-ul nu se ia daca edge-ul este mancat de costuri"
 *   → evaluateEdgeVsCost returns viable=false when
 *     expectedEdge <= cost × INVARIANT_MIN_EDGE_RATIO
 */

const { db } = require('../../database');

// Per-exchange fee structure (bps). Approximations for spot/futures.
const EXCHANGE_FEE_MODELS = Object.freeze({
    binance:  { makerBps: 1.0, takerBps: 10.0, name: 'Binance' },
    bybit:    { makerBps: 1.0, takerBps: 6.0,  name: 'Bybit'   },
    coinbase: { makerBps: 4.0, takerBps: 12.0, name: 'Coinbase'}
});

const DEFAULT_SLIPPAGE_PARAMS = Object.freeze({
    base_bps:      1.0,    // 1 bp minimum slippage
    size_factor:   2.0,    // bps per (order_size/depth) ratio percent
    depth_factor:  0.5,    // bps per (1/depth ratio)
    illiquid_mult: 1.5     // illiquid hour multiplier
});

// INVARIANT (line 1116): trade-ul nu se ia daca edge-ul este mancat de costuri.
// Default ratio = 1.5 (edge must be at least 1.5× cost to be viable).
const INVARIANT_MIN_EDGE_RATIO = 1.5;

// Liquid hours (UTC) — london/ny opens + overlap windows
const LIQUID_HOURS_UTC = new Set([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`transactionCostAnalyzer: missing ${key}`);
    }
    return params[key];
}

// ── estimateTransactionCost (pure) ─────────────────────────────────
function estimateTransactionCost(params) {
    const orderSizeUsd = _required(params, 'orderSizeUsd');
    const bookDepthUsd = _required(params, 'bookDepthUsd');
    const hourUtc = (params && typeof params.hourUtc === 'number') ? params.hourUtc : 12;
    const exchange = (params && params.exchange) ? params.exchange : 'binance';
    const isMaker = !!(params && params.isMaker);
    const slippageParams = (params && params.slippageParams)
        ? params.slippageParams : DEFAULT_SLIPPAGE_PARAMS;

    const feeModel = EXCHANGE_FEE_MODELS[exchange];
    if (!feeModel) {
        throw new Error(`transactionCostAnalyzer: unknown exchange "${exchange}"`);
    }

    // Slippage = base + size factor + depth factor + time-of-day mult
    const sizeRatio = bookDepthUsd > 0 ? (orderSizeUsd / bookDepthUsd) * 100 : 100;
    const baseSlippage = slippageParams.base_bps;
    const sizeContrib = sizeRatio * slippageParams.size_factor;
    const depthContrib = bookDepthUsd > 0
        ? Math.max(0, 100 / bookDepthUsd) * slippageParams.depth_factor
        : 50;
    const todMult = LIQUID_HOURS_UTC.has(hourUtc)
        ? 1.0 : slippageParams.illiquid_mult;

    const slippageBps = (baseSlippage + sizeContrib + depthContrib) * todMult;

    // Fees: maker rebate or taker fee
    const feesBps = isMaker ? feeModel.makerBps : feeModel.takerBps;

    // Latency cost approximated as small fixed for now (real latency from §28)
    const latencyCostBps = 0.5;

    const totalCostBps = slippageBps + feesBps + latencyCostBps;

    return {
        slippageBps,
        feesBps,
        latencyCostBps,
        totalCostBps,
        components: {
            base_bps: baseSlippage,
            size_contribution_bps: sizeContrib,
            depth_contribution_bps: depthContrib,
            time_of_day_multiplier: todMult,
            is_maker: isMaker,
            exchange: feeModel.name
        }
    };
}

// ── estimateMarketImpact (pure) ────────────────────────────────────
function estimateMarketImpact(params) {
    const orderSizeUsd = _required(params, 'orderSizeUsd');
    const dailyVolumeUsd = _required(params, 'dailyVolumeUsd');
    const volatility = (params && typeof params.volatility === 'number')
        ? params.volatility : 0.02;

    if (dailyVolumeUsd <= 0) {
        return { impactBps: 999, decayMs: 60000 };
    }

    // Almgren-Chriss-style heuristic:
    //   impact = const × sqrt(order_size / daily_volume) × volatility × 10000
    const ratio = orderSizeUsd / dailyVolumeUsd;
    const impactBps = 5 * Math.sqrt(ratio) * volatility * 10000;

    // Decay scales with order size relative to volume
    const decayMs = Math.max(1000, Math.min(300000, 60000 * Math.sqrt(ratio * 10)));

    return { impactBps, decayMs };
}

// ── evaluateEdgeVsCost — INVARIANT enforced ────────────────────────
function evaluateEdgeVsCost(params) {
    const expectedEdgeBps = _required(params, 'expectedEdgeBps');
    const estimatedCostBps = _required(params, 'estimatedCostBps');
    const riskMultiple = (params && typeof params.riskMultiple === 'number')
        ? params.riskMultiple : INVARIANT_MIN_EDGE_RATIO;

    if (estimatedCostBps < 0) {
        throw new Error(`transactionCostAnalyzer: estimatedCostBps cannot be negative`);
    }

    const edgeAfterCost = expectedEdgeBps - estimatedCostBps;
    const ratio = estimatedCostBps > 0
        ? expectedEdgeBps / estimatedCostBps
        : Infinity;

    // INVARIANT line 1116: viable only if edge >= cost × riskMultiple
    const viable = expectedEdgeBps >= estimatedCostBps * riskMultiple;

    return {
        viable,
        edgeAfterCost,
        ratio,
        expectedEdgeBps,
        estimatedCostBps,
        riskMultiple
    };
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertEstimate: db.prepare(`
        INSERT INTO ml_tca_estimates
        (user_id, resolved_env, pos_id, exchange, order_size_usd,
         estimated_slippage_bps, estimated_fees_bps, estimated_total_cost_bps,
         actual_slippage_bps, actual_fees_bps,
         is_viable, expected_edge_bps, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectByExchange: db.prepare(`
        SELECT * FROM ml_tca_estimates
        WHERE user_id = ? AND resolved_env = ? AND exchange = ?
          AND (? = 0 OR created_at >= ?)
    `)
};

// ── recordTcaEstimate ──────────────────────────────────────────────
function recordTcaEstimate(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');
    const orderSizeUsd = _required(params, 'orderSizeUsd');
    const estimate = _required(params, 'estimate');
    const isViable = !!(params && params.isViable);
    const posId = (params && params.posId) ? params.posId : null;
    const expectedEdgeBps = (params && typeof params.expectedEdgeBps === 'number')
        ? params.expectedEdgeBps : null;
    const actualSlippageBps = (params && typeof params.actualSlippageBps === 'number')
        ? params.actualSlippageBps : null;
    const actualFeesBps = (params && typeof params.actualFeesBps === 'number')
        ? params.actualFeesBps : null;

    _stmts.insertEstimate.run(
        userId, env, posId, exchange, orderSizeUsd,
        estimate.slippageBps, estimate.feesBps, estimate.totalCostBps,
        actualSlippageBps, actualFeesBps,
        isViable ? 1 : 0,
        expectedEdgeBps,
        Date.now()
    );

    return { recorded: true };
}

// ── getTcaStats ────────────────────────────────────────────────────
function getTcaStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');
    const since = (params && params.since) ? params.since : 0;

    const rows = _stmts.selectByExchange.all(
        userId, env, exchange,
        since > 0 ? 1 : 0, since
    );

    if (rows.length === 0) {
        return {
            estimateCount: 0,
            meanEstimatedSlippageBps: null,
            meanActualSlippageBps: null,
            estimationError: null
        };
    }

    let estSlipSum = 0;
    let estCount = 0;
    let actSlipSum = 0;
    let actCount = 0;
    for (const r of rows) {
        estSlipSum += r.estimated_slippage_bps;
        estCount++;
        if (r.actual_slippage_bps !== null) {
            actSlipSum += r.actual_slippage_bps;
            actCount++;
        }
    }

    const meanEst = estCount > 0 ? estSlipSum / estCount : null;
    const meanAct = actCount > 0 ? actSlipSum / actCount : null;
    const error = (meanEst !== null && meanAct !== null)
        ? meanAct - meanEst : null;

    return {
        estimateCount: estCount,
        actualCount: actCount,
        meanEstimatedSlippageBps: meanEst,
        meanActualSlippageBps: meanAct,
        estimationError: error
    };
}

module.exports = {
    EXCHANGE_FEE_MODELS,
    DEFAULT_SLIPPAGE_PARAMS,
    INVARIANT_MIN_EDGE_RATIO,
    LIQUID_HOURS_UTC,
    estimateTransactionCost,
    estimateMarketImpact,
    evaluateEdgeVsCost,
    recordTcaEstimate,
    getTcaStats
};
