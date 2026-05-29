'use strict';

// ═══════════════════════════════════════════════════════════════════
// Binance Gateway — SINGLE entry point for ALL Binance REST calls.
// Integrates: rateLimiter pre-flight + circuitBreaker per-endpoint +
//             binanceTelemetry (existing) + header parsing on response.
//
// EVERY module that needs Binance data calls gateway.fetch() — NEVER
// raw fetch() to fapi.binance.com.
//
// See docs/SOURCE_OF_TRUTH_MAP.md for allowed callers.
// ═══════════════════════════════════════════════════════════════════

const rateLimiter = require('./rateLimiter');
const circuitBreaker = require('./circuitBreaker');

let _telem = null;
function _getTelem() {
    if (_telem) return _telem;
    try { _telem = require('./binanceTelemetry'); } catch (_) {}
    return _telem;
}

function _extractEndpoint(url) {
    try {
        const u = new URL(url);
        const path = u.pathname;
        // Extract meaningful endpoint: /fapi/v1/klines → klines
        const parts = path.split('/').filter(Boolean);
        return parts[parts.length - 1] || 'unknown';
    } catch (_) { return 'unknown'; }
}

function _extractExchange(url) {
    if (!url) return 'binance';
    // [Phase A / Task A3] Testnet host (binancefuture.com) must be checked BEFORE
    // binance.com and tracked as a DISTINCT exchange so its circuit breaker is
    // independent of prod — otherwise testnet key-health probes were 'unknown'
    // and untracked, tripping 418 IP-bans unchecked on a banned IP.
    if (url.includes('binancefuture.com')) return 'binance-testnet';
    if (url.includes('binance.com')) return 'binance';
    if (url.includes('bybit.com')) return 'bybit';
    if (url.includes('okx.com')) return 'okx';
    return 'unknown';
}

function _poolForExchange(exchange) {
    if (exchange === 'binance') return 'binance:futures';
    if (exchange === 'bybit') return 'bybit:v5';
    return null;
}

async function gatewayFetch(url, opts) {
    const exchange = _extractExchange(url);
    const endpoint = _extractEndpoint(url);
    const pool = _poolForExchange(exchange);
    const weight = (opts && opts.__weight) || 1;

    // Pre-flight: circuit breaker
    if (!circuitBreaker.canRequest(exchange, endpoint)) {
        const backoff = circuitBreaker.getBackoffMs(exchange, endpoint);
        return {
            status: 503, ok: false, _stale: true, _reason: 'circuit_open', _backoffMs: backoff,
            headers: { get: () => null },
            json: async () => ({ code: 'CIRCUIT_OPEN', exchange, endpoint, backoffMs: backoff }),
        };
    }

    // Pre-flight: rate limiter
    if (pool && !rateLimiter.canFetch(pool, weight)) {
        return {
            status: 503, ok: false, _stale: true, _reason: 'rate_limit',
            headers: { get: () => null },
            json: async () => ({ code: 'RATE_LIMITED', pool, weight }),
        };
    }

    // Reserve weight
    if (pool) rateLimiter.reserve(pool, weight);

    // Execute via existing telemetry wrapper (preserves scheduler/A.1 gate)
    const telem = _getTelem();
    let res;
    try {
        if (telem) {
            res = await telem.wrapFetch(fetch, url, opts);
        } else {
            res = await fetch(url, opts);
        }
    } catch (err) {
        circuitBreaker.record(exchange, endpoint, 0); // timeout/network error
        throw err;
    }

    // Post-flight: parse real weight from headers
    if (res && res.headers) {
        rateLimiter.parseHeaders(exchange, res.headers);
    }

    // Post-flight: record result in circuit breaker
    const status = res ? res.status : 0;
    circuitBreaker.record(exchange, endpoint, status);

    return res;
}

function getStatus() {
    return {
        rateLimiter: rateLimiter.statusAll(),
        circuitBreaker: circuitBreaker.statusAll(),
    };
}

module.exports = {
    fetch: gatewayFetch,
    getStatus,
    // [Phase A / Task A3] Pure-logic exports for unit testing (no runtime use).
    _test: { extractExchange: _extractExchange, poolForExchange: _poolForExchange },
};
