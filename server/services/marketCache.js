'use strict';

// ═══════════════════════════════════════════════════════════════════
// Market Cache — Central source of truth for ALL market data.
// Exchange-agnostic. Keys: 'exchange:SYMBOL' (e.g. 'binance:BTCUSDT')
//
// RULES (see docs/SOURCE_OF_TRUTH_MAP.md):
// - Each data type has ONE owner (sole writer)
// - Ownership enforced at write time — wrong caller = rejected + logged
// - Schema validated — malformed payloads rejected
// - Consumers read via get() — NEVER fetch Binance directly
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_TTL = Object.freeze({
    ticker:    60000,   // 60s
    klines:    60000,   // 60s
    oi:        120000,  // 2min
    funding:   300000,  // 5min
    depth:     60000,   // 60s
    sentiment: 300000,  // 5min
    time:      300000,  // 5min
});

// Ownership: type → allowed __src prefix (from SOURCE_OF_TRUTH_MAP)
const OWNERS = Object.freeze({
    ticker:    'marketRadar',
    klines:    'marketFeed',
    oi:        'marketRadar',
    funding:   'marketRadar',
    depth:     'serverLiquidity',
    sentiment: 'serverSentiment',
    time:      'system',
});

// Schema validators — return true if payload is valid for this type
const VALIDATORS = Object.freeze({
    ticker:    (d) => d && typeof d === 'object' && typeof d.price === 'number' && d.price > 0,
    klines:    (d) => Array.isArray(d) && (d.length === 0 || (d[0] && typeof d[0].time === 'number')),
    oi:        (d) => typeof d === 'number' && d >= 0,
    funding:   (d) => d && typeof d === 'object' && typeof d.rate === 'number',
    depth:     (d) => d && typeof d === 'object' && Array.isArray(d.bids) && Array.isArray(d.asks),
    sentiment: (d) => d && typeof d === 'object',
    time:      (d) => typeof d === 'number' && d > 0,
});

const _store = new Map();     // type → Map(key → { data, ts, ttlMs })
const _inflight = new Map();  // dedup key → Promise
let _hits = 0, _misses = 0, _rejected = 0;

function _bucket(type) {
    if (!_store.has(type)) _store.set(type, new Map());
    return _store.get(type);
}

function set(type, key, data, opts) {
    // Ownership check
    const owner = OWNERS[type];
    const caller = (opts && opts.caller) || 'unknown';
    if (owner && owner !== 'system' && !caller.startsWith(owner)) {
        _rejected++;
        if (typeof console !== 'undefined') console.warn(`[CACHE] REJECTED: ${caller} tried to write ${type} (owner: ${owner})`);
        return false;
    }

    // Schema validation
    const validator = VALIDATORS[type];
    if (validator && !validator(data)) {
        _rejected++;
        if (typeof console !== 'undefined') console.warn(`[CACHE] REJECTED: invalid ${type} payload from ${caller}`);
        return false;
    }

    const ttlMs = (opts && opts.ttlMs) || DEFAULT_TTL[type] || 60000;
    _bucket(type).set(key, { data, ts: Date.now(), ttlMs });
    return true;
}

function get(type, key) {
    const bucket = _bucket(type);
    const entry = bucket.get(key);
    if (!entry) { _misses++; return null; }
    if (Date.now() - entry.ts > entry.ttlMs) { _misses++; return null; }
    _hits++;
    return entry.data;
}

function getAll(type) {
    const bucket = _bucket(type);
    const now = Date.now();
    const result = {};
    for (const [key, entry] of bucket) {
        if (now - entry.ts <= entry.ttlMs) result[key] = entry.data;
    }
    return result;
}

async function getOrFetch(type, key, fetchFn, opts) {
    const cached = get(type, key);
    if (cached !== null) return cached;

    const dedupKey = `${type}:${key}`;
    if (_inflight.has(dedupKey)) return _inflight.get(dedupKey);

    const promise = (async () => {
        try {
            const data = await fetchFn();
            set(type, key, data, opts);
            return data;
        } finally {
            _inflight.delete(dedupKey);
        }
    })();
    _inflight.set(dedupKey, promise);
    return promise;
}

function getFreshness(type, key) {
    const bucket = _bucket(type);
    const entry = bucket.get(key);
    if (!entry) return null;
    return { ageMs: Date.now() - entry.ts, ttlMs: entry.ttlMs, stale: Date.now() - entry.ts > entry.ttlMs };
}

function getStats() {
    return { hits: _hits, misses: _misses, rejected: _rejected, types: _store.size, inflight: _inflight.size };
}

function _getEntry(type, key) { return _bucket(type).get(key) || null; }

function _resetForTest() {
    _store.clear(); _inflight.clear(); _hits = 0; _misses = 0; _rejected = 0;
}

module.exports = { set, get, getAll, getOrFetch, getFreshness, getStats, _getEntry, _resetForTest, DEFAULT_TTL, OWNERS, VALIDATORS };
