'use strict';

/**
 * ML Plan v3 Phase 3 — EffectiveStatus resolver (ARCH-2 LRU cache + SPEC-8 hierarchy).
 *
 * Hot-path API: resolve(userId, env, symbol, regime, nowTs) → owned posterior
 * (or L0 default). LRU Map cache, 1000 entries cap, 60s per-entry TTL.
 */

const bp = require('./banditPosteriors');

const LRU_MAX = 1000;
const TTL_MS = 60_000;

const _cache = new Map();
let _hits = 0;
let _misses = 0;

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`effectiveStatus: missing ${k}`);
    return p[k];
}

function _evictIfNeeded() {
    while (_cache.size > LRU_MAX) {
        const oldestKey = _cache.keys().next().value;
        _cache.delete(oldestKey);
    }
}

function resolve(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const nowTs = _required(params, 'nowTs');

    const cellKey = `${userId}:${env}:${symbol}:${regime}`;
    const cached = _cache.get(cellKey);
    if (cached && nowTs < cached.expiresAt) {
        _cache.delete(cellKey);
        _cache.set(cellKey, cached);
        _hits += 1;
        return { ...cached.value, cacheHit: true };
    }

    _misses += 1;
    const resolved = bp.walkHierarchy({ userId, env, symbol, regime });
    const value = {
        level: resolved.level,
        cellKey: resolved.cellKey,
        alpha: resolved.alpha,
        beta: resolved.beta,
        observationCount: resolved.observationCount
    };
    _cache.set(cellKey, { value, expiresAt: nowTs + TTL_MS });
    _evictIfNeeded();
    return { ...value, cacheHit: false };
}

function invalidate(params) {
    const cellKey = _required(params, 'cellKey');
    // [AUDIT-20260619 P3] exact match only. The old `k.includes(cellKey)` branch
    // substring-matched, so invalidating "1:DEMO:BTC:TREND" also evicted
    // "21:DEMO:BTC:TREND" (cross-user). The sole caller passes the full L4 cellKey,
    // and includes() never matched parent levels (they are shorter) — so it only
    // ever caused cross-user over-eviction.
    _cache.delete(cellKey);
    return { invalidated: true };
}

function invalidateAll() {
    _cache.clear();
    return { invalidated: true };
}

function getStats() {
    return { hits: _hits, misses: _misses, entries: _cache.size };
}

function resetCacheForTest() {
    _cache.clear();
    _hits = 0;
    _misses = 0;
}

module.exports = {
    LRU_MAX, TTL_MS,
    resolve, invalidate, invalidateAll, getStats, resetCacheForTest
};
