'use strict';

/**
 * OMEGA R4 Execution — executionFingerprintObfuscator (Claude-Extra #3)
 *
 * LEGAL execution diversification within SINGLE account. Operator's original
 * "autopoietic chameleon" idea (multi-account ZKP fronting) was illegal
 * (wash trading + concealment of beneficial ownership). This version does
 * NOT use multiple accounts, does NOT wash, does NOT conceal beneficial
 * owner — just diversifies execution patterns from ONE account so that
 * outside observers can't easily fingerprint the algorithm.
 *
 * Strategies:
 * - timing_jitter: random delay ±MAX_JITTER_MS
 * - size_split: split single order into 2-MAX_CHILD_COUNT child orders
 *   with random sum-equal sizes (each ≥ MIN_CHILD_SIZE_RATIO × total)
 * - type_variation: swap order_type to compatible alternative
 *   (limit ↔ gtc; market ↔ ioc; stop only stays stop)
 * - full_obfuscation: all of the above
 * - none: pass-through (for control)
 *
 * LEGALITY: All actions within ONE account. Splitting orders into smaller
 * child orders is standard execution practice. Order type variation is
 * legal. Timing jitter is legal. NO wash trading, NO multi-account
 * coordination, NO market manipulation.
 */

const { db } = require('../../database');

const ORDER_TYPES = Object.freeze([
    'limit', 'market', 'ioc', 'gtc', 'stop', 'stop_limit'
]);

const OBFUSCATION_STRATEGIES = Object.freeze([
    'none', 'timing_jitter', 'size_split',
    'type_variation', 'full_obfuscation'
]);

// Which order types are functionally compatible substitutes.
// Limit/GTC are both passive (rest on book). Market/IOC are both
// liquidity-takers. Stop/stop_limit are conditional triggers — only swap
// within their own narrow family.
const TYPE_COMPATIBILITY = Object.freeze({
    limit: Object.freeze(['limit', 'gtc']),
    gtc: Object.freeze(['gtc', 'limit']),
    market: Object.freeze(['market', 'ioc']),
    ioc: Object.freeze(['ioc', 'market']),
    stop: Object.freeze(['stop']),
    stop_limit: Object.freeze(['stop_limit'])
});

const MAX_JITTER_MS = 100;
const MAX_CHILD_COUNT = 4;
const MIN_CHILD_SIZE_RATIO = 0.10;  // each child ≥ 10% of total

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`executionFingerprintObfuscator: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertOrder: db.prepare(`
        INSERT INTO ml_obfuscated_orders
        (user_id, resolved_env, original_order_id, asset,
         original_size, original_order_type, obfuscation_strategy,
         child_orders_json, jitter_ms, child_count, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listByStrategy: db.prepare(`
        SELECT * FROM ml_obfuscated_orders
        WHERE user_id = ? AND resolved_env = ?
          AND obfuscation_strategy = ?
        ORDER BY ts DESC LIMIT ?
    `),
    listAll: db.prepare(`
        SELECT * FROM ml_obfuscated_orders
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeJitterMs (pure) ─────────────────────────────────────────
function computeJitterMs(params) {
    const max = _required(params, 'maxJitterMs');
    if (max < 0) {
        throw new Error('executionFingerprintObfuscator: maxJitterMs ≥ 0');
    }
    return { jitterMs: Math.floor(Math.random() * (max + 1)) };
}

// ── splitSize (pure) ───────────────────────────────────────────────
// Splits totalSize into childCount children, each ≥ minChildRatio × total.
// Last child takes the remainder. Random within constraints.
function splitSize(params) {
    const total = _required(params, 'totalSize');
    const count = _required(params, 'childCount');
    const minRatio = _required(params, 'minChildRatio');

    if (total <= 0) {
        throw new Error('executionFingerprintObfuscator: totalSize > 0');
    }
    if (count < 1) {
        throw new Error('executionFingerprintObfuscator: childCount ≥ 1');
    }
    if (count === 1) {
        return { childSizes: [total] };
    }
    // Feasibility check: count × min ≤ 1.0 of total
    if (count * minRatio > 1.0) {
        throw new Error(
            `executionFingerprintObfuscator: infeasible split — ${count} children at min ratio ${minRatio} > total`
        );
    }
    const minChild = total * minRatio;
    let remaining = total - minChild * count;
    const sizes = new Array(count).fill(minChild);
    // Distribute remaining randomly
    for (let i = 0; i < count - 1; i++) {
        const max = remaining * 0.99;  // leave a little for last
        const add = Math.random() * max;
        sizes[i] += add;
        remaining -= add;
    }
    sizes[count - 1] += remaining;  // last child takes the rest
    return { childSizes: sizes };
}

// ── selectCompatibleOrderType (pure) ───────────────────────────────
function selectCompatibleOrderType(params) {
    const original = _required(params, 'originalType');
    const allowVariation = _required(params, 'allowVariation');
    if (!ORDER_TYPES.includes(original)) {
        throw new Error(
            `executionFingerprintObfuscator: invalid originalType "${original}"`
        );
    }
    if (!allowVariation) {
        return { selectedType: original };
    }
    const compatible = TYPE_COMPATIBILITY[original];
    const idx = Math.floor(Math.random() * compatible.length);
    return { selectedType: compatible[idx] };
}

// ── obfuscateOrder (integration) ───────────────────────────────────
function obfuscateOrder(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const orderId = _required(params, 'originalOrderId');
    const asset = _required(params, 'asset');
    const size = _required(params, 'originalSize');
    const orderType = _required(params, 'originalOrderType');
    const strategy = _required(params, 'obfuscationStrategy');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (size <= 0) {
        throw new Error('executionFingerprintObfuscator: originalSize > 0');
    }
    if (!ORDER_TYPES.includes(orderType)) {
        throw new Error(
            `executionFingerprintObfuscator: invalid originalOrderType "${orderType}"`
        );
    }
    if (!OBFUSCATION_STRATEGIES.includes(strategy)) {
        throw new Error(
            `executionFingerprintObfuscator: invalid obfuscationStrategy "${strategy}"`
        );
    }

    let childCount = 1;
    let jitterMs = 0;
    let allowTypeVar = false;
    if (strategy === 'timing_jitter' || strategy === 'full_obfuscation') {
        ({ jitterMs } = computeJitterMs({ maxJitterMs: MAX_JITTER_MS }));
    }
    if (strategy === 'size_split' || strategy === 'full_obfuscation') {
        // 2-MAX_CHILD_COUNT inclusive
        childCount = 2 + Math.floor(Math.random() * (MAX_CHILD_COUNT - 1));
        // ensure feasibility (cap at floor(1/minRatio))
        const maxFeasible = Math.floor(1 / MIN_CHILD_SIZE_RATIO);
        if (childCount > maxFeasible) childCount = maxFeasible;
    }
    if (strategy === 'type_variation' || strategy === 'full_obfuscation') {
        allowTypeVar = true;
    }

    const { childSizes } = splitSize({
        totalSize: size, childCount, minChildRatio: MIN_CHILD_SIZE_RATIO
    });
    const childOrders = childSizes.map(s => {
        const { selectedType } = selectCompatibleOrderType({
            originalType: orderType, allowVariation: allowTypeVar
        });
        return { size: s, orderType: selectedType };
    });

    try {
        _stmts.insertOrder.run(
            userId, env, orderId, asset, size, orderType, strategy,
            JSON.stringify(childOrders), jitterMs, childCount, ts
        );
        return {
            recorded: true, originalOrderId: orderId,
            childCount, jitterMs, childOrders
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `executionFingerprintObfuscator: duplicate originalOrderId "${orderId}"`
            );
        }
        throw err;
    }
}

// ── getObfuscationHistory ──────────────────────────────────────────
function getObfuscationHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const strategy = params && params.strategy;
    const limit = (params && params.limit) ? params.limit : 100;
    if (strategy && !OBFUSCATION_STRATEGIES.includes(strategy)) {
        throw new Error(
            `executionFingerprintObfuscator: invalid strategy "${strategy}"`
        );
    }
    const rows = strategy
        ? _stmts.listByStrategy.all(userId, env, strategy, limit)
        : _stmts.listAll.all(userId, env, limit);
    return rows.map(r => ({
        originalOrderId: r.original_order_id,
        asset: r.asset,
        originalSize: r.original_size,
        originalOrderType: r.original_order_type,
        obfuscationStrategy: r.obfuscation_strategy,
        childOrders: JSON.parse(r.child_orders_json),
        jitterMs: r.jitter_ms,
        childCount: r.child_count,
        ts: r.ts
    }));
}

module.exports = {
    ORDER_TYPES,
    OBFUSCATION_STRATEGIES,
    TYPE_COMPATIBILITY,
    MAX_JITTER_MS,
    MAX_CHILD_COUNT,
    MIN_CHILD_SIZE_RATIO,
    computeJitterMs,
    splitSize,
    selectCompatibleOrderType,
    obfuscateOrder,
    getObfuscationHistory
};
