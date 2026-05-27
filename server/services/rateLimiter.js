'use strict';

// ═══════════════════════════════════════════════════════════════════
// Rate Limiter — Token bucket per exchange pool.
// Reads REAL weight from Binance/Bybit response headers.
// Pre-flight gate: canFetch() checks before any request.
//
// Pools: 'binance:futures' (2400/min), 'binance:spot' (1200/min),
//        'bybit:v5' (120/10s), etc.
// ═══════════════════════════════════════════════════════════════════

const POOLS = {
    'binance:futures': { capacity: 6000, windowMs: 60000, throttlePct: 80, haltPct: 95 },
    'binance:spot':    { capacity: 1200, windowMs: 60000, throttlePct: 80, haltPct: 95 },
    'bybit:v5':        { capacity: 120,  windowMs: 10000, throttlePct: 80, haltPct: 95 },
};

const _state = new Map(); // poolId → { used, updatedAt, source }

function _getPool(poolId) {
    if (!_state.has(poolId)) {
        _state.set(poolId, { used: 0, updatedAt: Date.now(), source: 'init', windowStart: Date.now() });
    }
    const s = _state.get(poolId);
    const pool = POOLS[poolId];
    if (!pool) return s;

    // Reset window if expired
    if (Date.now() - s.windowStart > pool.windowMs) {
        s.used = 0;
        s.windowStart = Date.now();
        s.source = 'window_reset';
    }
    return s;
}

function parseHeaders(exchange, headers) {
    if (!headers) return null;
    const _get = (k) => {
        if (typeof headers.get === 'function') return headers.get(k);
        if (typeof headers === 'object') return headers[k] || headers[k.toLowerCase()];
        return null;
    };

    if (exchange === 'binance') {
        const used = parseInt(_get('x-mbx-used-weight-1m'), 10);
        const orderCount = parseInt(_get('x-mbx-order-count-1m'), 10);
        if (Number.isFinite(used)) {
            const s = _getPool('binance:futures');
            s.used = used;
            s.updatedAt = Date.now();
            s.source = 'header';
            return { pool: 'binance:futures', used, orderCount: Number.isFinite(orderCount) ? orderCount : null };
        }
    }

    if (exchange === 'bybit') {
        const status = parseInt(_get('x-bapi-limit-status'), 10);
        const limit = parseInt(_get('x-bapi-limit'), 10);
        if (Number.isFinite(status) && Number.isFinite(limit)) {
            const used = limit - status;
            const s = _getPool('bybit:v5');
            s.used = used;
            s.updatedAt = Date.now();
            s.source = 'header';
            return { pool: 'bybit:v5', used, remaining: status, limit };
        }
    }

    return null;
}

function canFetch(poolId, weight) {
    const pool = POOLS[poolId];
    if (!pool) return true; // unknown pool = allow (don't block on config miss)
    const s = _getPool(poolId);
    const usedPct = (s.used / pool.capacity) * 100;
    if (usedPct >= pool.haltPct) return false;
    if (weight && (s.used + weight) > pool.capacity * (pool.haltPct / 100)) return false;
    return true;
}

function reserve(poolId, weight) {
    const pool = POOLS[poolId];
    if (!pool) return true;
    const s = _getPool(poolId);
    const projectedPct = ((s.used + weight) / pool.capacity) * 100;
    if (projectedPct >= pool.haltPct) return false;
    s.used += weight;
    s.updatedAt = Date.now();
    s.source = 'reserve';
    return true;
}

function isThrottled(poolId) {
    const pool = POOLS[poolId];
    if (!pool) return false;
    const s = _getPool(poolId);
    return (s.used / pool.capacity) * 100 >= pool.throttlePct;
}

function isHalted(poolId) {
    const pool = POOLS[poolId];
    if (!pool) return false;
    const s = _getPool(poolId);
    return (s.used / pool.capacity) * 100 >= pool.haltPct;
}

function status(poolId) {
    const pool = POOLS[poolId];
    if (!pool) return null;
    const s = _getPool(poolId);
    const usedPct = +(s.used / pool.capacity * 100).toFixed(1);
    return {
        poolId,
        capacity: pool.capacity,
        used: s.used,
        usedPct,
        throttled: usedPct >= pool.throttlePct,
        halted: usedPct >= pool.haltPct,
        source: s.source,
        updatedAt: s.updatedAt,
        windowMs: pool.windowMs,
    };
}

function statusAll() {
    const result = {};
    for (const poolId of Object.keys(POOLS)) {
        result[poolId] = status(poolId);
    }
    return result;
}

function _resetForTest() {
    if (process.env.NODE_ENV !== 'test') return;
    _state.clear();
}

module.exports = { parseHeaders, canFetch, reserve, isThrottled, isHalted, status, statusAll, _resetForTest, POOLS };
