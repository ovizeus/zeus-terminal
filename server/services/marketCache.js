'use strict';

// ═══════════════════════════════════════════════════════════════════
// Market Cache — Central source of truth for ALL market data.
// Exchange-agnostic. Keys: 'exchange:SYMBOL' (e.g. 'binance:BTCUSDT')
//
// RULES (see docs/SOURCE_OF_TRUTH_MAP.md):
// - Each data type has ONE owner (sole writer)
// - Ownership enforced at write time — wrong caller = rejected + logged
// - Schema validated — malformed payloads rejected
// - Monotonic timestamps — older data cannot overwrite newer
// - Immutable reads — get() returns deep clone
// - Cardinality guard — max 2000 keys per type
// - Inflight timeout — stale dedup promises cleaned after 15s
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

const OWNERS = Object.freeze({
    ticker:    'marketRadar',
    klines:    'marketFeed',
    oi:        'marketRadar',
    funding:   'marketRadar',
    depth:     'serverLiquidity',
    sentiment: 'serverSentiment',
    time:      'system',
});

const VALIDATORS = Object.freeze({
    ticker:    (d) => d && typeof d === 'object' && typeof d.price === 'number' && Number.isFinite(d.price) && d.price > 0 && d.price < 1e9,
    klines:    (d) => Array.isArray(d) && (d.length === 0 || (d[0] && typeof d[0].time === 'number' && Number.isFinite(d[0].time))),
    oi:        (d) => typeof d === 'number' && Number.isFinite(d) && d >= 0 && d < 1e15,
    funding:   (d) => d && typeof d === 'object' && typeof d.rate === 'number' && Number.isFinite(d.rate),
    depth:     (d) => d && typeof d === 'object' && Array.isArray(d.bids) && Array.isArray(d.asks),
    sentiment: (d) => d && typeof d === 'object' && !Array.isArray(d),
    time:      (d) => typeof d === 'number' && Number.isFinite(d) && d > 1700000000000 && d < 2000000000000,
});

const MAX_KEYS_PER_TYPE = 2000;
const MAX_INFLIGHT_MS = 15000;

const _store = new Map();
const _inflight = new Map();
let _hits = 0, _misses = 0, _rejected = 0, _monotonic_skips = 0;

function _log(event, detail) {
    try { console.log(JSON.stringify({ _t: 'CACHE', event, ...detail, ts: Date.now() })); } catch (_) {}
}

function _bucket(type) {
    if (!_store.has(type)) _store.set(type, new Map());
    return _store.get(type);
}

function _clone(data) {
    if (data === null || data === undefined) return data;
    if (typeof data !== 'object') return data;
    try { return JSON.parse(JSON.stringify(data)); } catch (_) { return data; }
}

function set(type, key, data, opts) {
    const owner = OWNERS[type];
    const caller = (opts && opts.caller) || 'unknown';

    // Ownership enforcement
    if (owner && owner !== 'system' && !caller.startsWith(owner)) {
        _rejected++;
        _log('reject_owner', { type, key, caller, owner });
        return false;
    }

    // Schema validation (includes NaN/Infinity/absurd guards)
    const validator = VALIDATORS[type];
    if (validator && !validator(data)) {
        _rejected++;
        _log('reject_schema', { type, key, caller });
        return false;
    }

    // Monotonic timestamp — don't overwrite newer with older
    const bucket = _bucket(type);
    const existing = bucket.get(key);
    const incomingTs = (opts && opts.dataTs) || Date.now();
    if (existing && existing.dataTs && incomingTs < existing.dataTs) {
        _monotonic_skips++;
        return false;
    }

    // Cardinality guard — evict oldest if over limit
    if (bucket.size >= MAX_KEYS_PER_TYPE && !bucket.has(key)) {
        let oldestKey = null, oldestTs = Infinity;
        for (const [k, v] of bucket) {
            if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
        }
        if (oldestKey) bucket.delete(oldestKey);
    }

    const ttlMs = (opts && opts.ttlMs) || DEFAULT_TTL[type] || 60000;
    bucket.set(key, { data, ts: Date.now(), dataTs: incomingTs, ttlMs });
    return true;
}

function get(type, key) {
    const bucket = _bucket(type);
    const entry = bucket.get(key);
    if (!entry) { _misses++; return null; }
    if (Date.now() - entry.ts > entry.ttlMs) { _misses++; return null; }
    _hits++;
    return _clone(entry.data);
}

function getAll(type) {
    const bucket = _bucket(type);
    const now = Date.now();
    const result = {};
    for (const [key, entry] of bucket) {
        if (now - entry.ts <= entry.ttlMs) result[key] = _clone(entry.data);
    }
    return result;
}

async function getOrFetch(type, key, fetchFn, opts) {
    const cached = get(type, key);
    if (cached !== null) return cached;

    const dedupKey = `${type}:${key}`;
    if (_inflight.has(dedupKey)) {
        const inf = _inflight.get(dedupKey);
        if (Date.now() - inf.startTs < MAX_INFLIGHT_MS) return inf.promise;
        _inflight.delete(dedupKey);
    }

    const startTs = Date.now();
    const promise = (async () => {
        try {
            const data = await fetchFn();
            set(type, key, data, opts);
            return data;
        } finally {
            _inflight.delete(dedupKey);
        }
    })();
    _inflight.set(dedupKey, { promise, startTs });
    return promise;
}

function getFreshness(type, key) {
    const bucket = _bucket(type);
    const entry = bucket.get(key);
    if (!entry) return null;
    return { ageMs: Date.now() - entry.ts, ttlMs: entry.ttlMs, stale: Date.now() - entry.ts > entry.ttlMs };
}

function health() {
    let totalEntries = 0, staleCount = 0, totalAgeMs = 0;
    const now = Date.now();
    const perType = {};
    for (const [type, bucket] of _store) {
        let typeCount = 0, typeStale = 0;
        for (const [, entry] of bucket) {
            totalEntries++; typeCount++;
            totalAgeMs += (now - entry.ts);
            if (now - entry.ts > entry.ttlMs) { staleCount++; typeStale++; }
        }
        perType[type] = { count: typeCount, stale: typeStale };
    }
    return {
        entries: totalEntries,
        stalePct: totalEntries > 0 ? +(staleCount / totalEntries * 100).toFixed(1) : 0,
        inflightCount: _inflight.size,
        hitRatio: (_hits + _misses) > 0 ? +(_hits / (_hits + _misses) * 100).toFixed(1) : 0,
        rejected: _rejected,
        monotonicSkips: _monotonic_skips,
        avgAgeMs: totalEntries > 0 ? Math.round(totalAgeMs / totalEntries) : 0,
        memEstimateKB: Math.round(JSON.stringify([..._store]).length / 1024),
        perType,
    };
}

function getStats() {
    return { hits: _hits, misses: _misses, rejected: _rejected, monotonicSkips: _monotonic_skips, types: _store.size, inflight: _inflight.size };
}

function _getEntry(type, key) { return _bucket(type).get(key) || null; }

// TTL sweep — call periodically to evict expired entries
function sweep() {
    const now = Date.now();
    let swept = 0;
    for (const [, bucket] of _store) {
        for (const [key, entry] of bucket) {
            if (now - entry.ts > entry.ttlMs * 2) { bucket.delete(key); swept++; }
        }
    }
    // Clean stale inflight
    for (const [key, inf] of _inflight) {
        if (now - inf.startTs > MAX_INFLIGHT_MS) { _inflight.delete(key); }
    }
    return swept;
}

// Test-only — guarded by NODE_ENV
function _resetForTest() {
    if (process.env.NODE_ENV !== 'test' && process.env.ZEUS_DB_PATH !== ':memory:') return;
    _store.clear(); _inflight.clear(); _hits = 0; _misses = 0; _rejected = 0; _monotonic_skips = 0;
}

module.exports = { set, get, getAll, getOrFetch, getFreshness, health, getStats, sweep, _getEntry, _resetForTest, DEFAULT_TTL, OWNERS, VALIDATORS, MAX_KEYS_PER_TYPE };
