'use strict';

/**
 * OMEGA R4 Execution — smartPostOnly (audit-gap EXEC-N1)
 *
 * EXEC-N1 SMART POST-ONLY PRICE-SHADE.
 * Source: audit 2026-05-05 (project_ml_v3_additional_gaps_audit_2026-05-05.md)
 * Priority: P1 (R4 execution).
 *
 * Post-only orders earn maker rebate (vs taker fee). Trade-off:
 *   - Better fee (rebate ~1bp vs taker fee ~10bp)
 *   - Risk: not filled if market moves away
 *
 * Smart shade: place post-only price slightly off best-of-book:
 *   - PASSIVE   → far from best (low fill rate, max rebate guarantee)
 *   - MODERATE  → middling distance (balance)
 *   - AGGRESSIVE → close to best (high fill rate)
 *
 * Urgency overrides strategy: HIGH urgency + AGGRESSIVE = closest to best.
 *
 * Composability:
 *   - §23 transactionCostAnalyzer → cost savings vs taker
 *   - §28 latency monitor → fill timeout via cancel
 */

const { db } = require('../../database');

const SHADE_STRATEGIES = Object.freeze(['PASSIVE', 'MODERATE', 'AGGRESSIVE']);
const URGENCY_LEVELS = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
const ORDER_OUTCOMES = Object.freeze(['FILLED', 'MISSED', 'PENDING', 'CANCELLED']);

const DEFAULT_SHADE_PARAMS = Object.freeze({
    passive_bps:    8.0,
    moderate_bps:   3.0,
    aggressive_bps: 0.5,
    urgency_high_multiplier: 0.3,  // HIGH urgency = 30% of normal shade
    urgency_low_multiplier:  1.5   // LOW urgency = 150% (further out)
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`smartPostOnly: missing ${key}`);
    }
    return params[key];
}

// ── calculatePriceShade (pure) ─────────────────────────────────────
function calculatePriceShade(params) {
    const side = _required(params, 'side');
    const currentBest = _required(params, 'currentBest');
    const urgency = (params && params.urgency) ? params.urgency : 'MEDIUM';
    const strategy = (params && params.strategy) ? params.strategy : 'MODERATE';
    const shadeParams = (params && params.shadeParams) ? params.shadeParams : DEFAULT_SHADE_PARAMS;

    if (!['BUY', 'SELL'].includes(side)) {
        throw new Error(`smartPostOnly: invalid side "${side}"`);
    }
    if (!SHADE_STRATEGIES.includes(strategy)) {
        throw new Error(`smartPostOnly: invalid strategy "${strategy}"`);
    }
    if (!URGENCY_LEVELS.includes(urgency)) {
        throw new Error(`smartPostOnly: invalid urgency "${urgency}"`);
    }

    let baseShadeBps;
    switch (strategy) {
        case 'PASSIVE':    baseShadeBps = shadeParams.passive_bps; break;
        case 'MODERATE':   baseShadeBps = shadeParams.moderate_bps; break;
        case 'AGGRESSIVE': baseShadeBps = shadeParams.aggressive_bps; break;
        default: baseShadeBps = shadeParams.moderate_bps;
    }

    let urgencyMult = 1.0;
    if (urgency === 'HIGH') urgencyMult = shadeParams.urgency_high_multiplier;
    else if (urgency === 'LOW') urgencyMult = shadeParams.urgency_low_multiplier;

    const shadeBps = baseShadeBps * urgencyMult;
    const shadePct = shadeBps / 10000;

    // BUY: shade DOWN from best ask = better fill price for buyer
    // SELL: shade UP from best bid = better fill price for seller
    let shadedPrice;
    if (side === 'BUY') {
        shadedPrice = currentBest * (1 - shadePct);
    } else {
        shadedPrice = currentBest * (1 + shadePct);
    }

    return {
        shadedPrice,
        shadeBps,
        urgencyMult,
        strategy,
        urgency
    };
}

// ── shouldUsePostOnly (pure) ───────────────────────────────────────
function shouldUsePostOnly(params) {
    const orderUrgency = _required(params, 'orderUrgency');
    const edgeBps = _required(params, 'edgeBps');
    const costSavingsBps = _required(params, 'costSavingsBps');
    const fillRateExpected = _required(params, 'fillRateExpected');

    // HIGH urgency + low fill rate → use taker
    if (orderUrgency === 'HIGH' && fillRateExpected < 0.5) {
        return {
            usePostOnly: false,
            reason: 'high_urgency_with_low_fill_rate'
        };
    }

    // Thin edge + savings matter → post-only
    if (edgeBps < 20 && costSavingsBps >= 5 && fillRateExpected >= 0.5) {
        return {
            usePostOnly: true,
            reason: 'thin_edge_savings_critical'
        };
    }

    // Low urgency + good fill rate → post-only (safe choice)
    if (orderUrgency === 'LOW' && fillRateExpected >= 0.6) {
        return {
            usePostOnly: true,
            reason: 'low_urgency_favorable_fill'
        };
    }

    // Default: balance — use post-only if fill rate >= 0.7 and savings >= edge×10%
    const usePostOnly = fillRateExpected >= 0.7 && costSavingsBps >= edgeBps * 0.1;
    return {
        usePostOnly,
        reason: usePostOnly ? 'default_balanced_threshold_met' : 'default_threshold_not_met'
    };
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertOrder: db.prepare(`
        INSERT INTO ml_post_only_orders
        (user_id, resolved_env, pos_id, exchange, side,
         placed_price, shaded_price, reference_best,
         urgency, strategy, outcome, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateOutcome: db.prepare(`
        UPDATE ml_post_only_orders
        SET outcome = ?, filled_price = ?
        WHERE id = ?
    `),
    selectStats: db.prepare(`
        SELECT outcome, COUNT(*) AS count FROM ml_post_only_orders
        WHERE user_id = ? AND resolved_env = ?
          AND (? IS NULL OR exchange = ?)
          AND (? = 0 OR created_at >= ?)
        GROUP BY outcome
    `)
};

// ── recordPostOnlyOrder ────────────────────────────────────────────
function recordPostOnlyOrder(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');
    const p = _required(params, 'params');
    const posId = (params && params.posId) ? params.posId : null;

    const outcome = p.outcome || 'PENDING';
    if (!ORDER_OUTCOMES.includes(outcome)) {
        throw new Error(`smartPostOnly: invalid outcome "${outcome}"`);
    }

    const result = _stmts.insertOrder.run(
        userId, env, posId, exchange, p.side,
        p.placedPrice, p.shadedPrice, p.referenceBest,
        p.urgency, p.strategy, outcome,
        Date.now()
    );

    return { orderId: result.lastInsertRowid };
}

// ── recordPostOnlyOutcome ──────────────────────────────────────────
function recordPostOnlyOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const orderId = _required(params, 'orderId');
    const outcome = _required(params, 'outcome');
    void userId; void env;

    if (!ORDER_OUTCOMES.includes(outcome.outcome)) {
        throw new Error(`smartPostOnly: invalid outcome "${outcome.outcome}"`);
    }

    _stmts.updateOutcome.run(
        outcome.outcome,
        outcome.filledPrice || null,
        orderId
    );

    return { updated: true };
}

// ── getPostOnlyStats ───────────────────────────────────────────────
function getPostOnlyStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = (params && params.exchange) ? params.exchange : null;
    const since = (params && params.since) ? params.since : 0;

    const rows = _stmts.selectStats.all(
        userId, env, exchange, exchange,
        since > 0 ? 1 : 0, since
    );

    let totalOrders = 0;
    let filledCount = 0;
    let missedCount = 0;
    let pendingCount = 0;
    let cancelledCount = 0;
    for (const row of rows) {
        totalOrders += row.count;
        if (row.outcome === 'FILLED') filledCount = row.count;
        else if (row.outcome === 'MISSED') missedCount = row.count;
        else if (row.outcome === 'PENDING') pendingCount = row.count;
        else if (row.outcome === 'CANCELLED') cancelledCount = row.count;
    }

    const fillRate = totalOrders > 0 ? filledCount / totalOrders : 0;

    return {
        totalOrders,
        filledCount,
        missedCount,
        pendingCount,
        cancelledCount,
        fillRate
    };
}

module.exports = {
    SHADE_STRATEGIES,
    URGENCY_LEVELS,
    ORDER_OUTCOMES,
    DEFAULT_SHADE_PARAMS,
    calculatePriceShade,
    shouldUsePostOnly,
    recordPostOnlyOrder,
    recordPostOnlyOutcome,
    getPostOnlyStats
};
