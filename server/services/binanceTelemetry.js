'use strict';

// [BIN-TELEM 2026-05-19] Binance Telemetry — instrumentation pure, zero side
// effects pe call path. Capturăm: per-source counter, per-host weight,
// X-MBX-USED-WEIGHT-1M header (ground truth quota IP). Scop diagnosticare
// 429 rate-limit (incident 07:47:54 UTC 2026-05-19).
//
// In-memory ring buffer ultimele RING_WINDOW_MS (1h default). Pruning lazy
// la fiecare recordCall + la getSnapshot. Nu interferează cu request path —
// recordCall e sync, wrapFetch try/catch isolation.

const RING_WINDOW_MS = 60 * 60 * 1000;   // 1h
const ONE_MIN_MS = 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const TOP_ENDPOINTS_N = 10;

const _bootTs = Date.now();
let _now = null;  // override for tests
let _ring = [];   // { ts, host, path, source, weight, status, latencyMs, usedWeight }
let _pollersProvider = null;

function _ts() { return _now == null ? Date.now() : _now; }

function _prune() {
    const cutoff = _ts() - RING_WINDOW_MS;
    while (_ring.length && _ring[0].ts < cutoff) _ring.shift();
}

function recordCall(entry) {
    if (!entry || typeof entry !== 'object') return;
    _ring.push({
        ts: _ts(),
        host: entry.host || 'unknown',
        path: entry.path || '/',
        source: entry.source || 'unknown',
        weight: typeof entry.weight === 'number' ? entry.weight : 0,
        status: typeof entry.status === 'number' ? entry.status : 0,
        latencyMs: typeof entry.latencyMs === 'number' ? entry.latencyMs : 0,
        usedWeight: typeof entry.usedWeight === 'number' ? entry.usedWeight : null,
        networkError: !!entry.networkError,
    });
    _prune();
}

function parseUsedWeight(headers) {
    if (!headers) return null;
    let raw = null;
    if (typeof headers.get === 'function') {
        raw = headers.get('x-mbx-used-weight-1m');
    } else if (typeof headers === 'object') {
        // Case-insensitive lookup over plain object
        for (const k of Object.keys(headers)) {
            if (k.toLowerCase() === 'x-mbx-used-weight-1m') { raw = headers[k]; break; }
        }
    }
    if (raw == null || raw === '') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
}

async function wrapFetch(fetchFn, url, opts) {
    const src = (opts && opts.__src) || 'unknown';
    let host = 'unknown', path = '/';
    try {
        const u = new URL(url);
        host = u.host;
        path = u.pathname;
    } catch (_) { /* leave defaults */ }
    const t0 = Date.now();
    try {
        const res = await fetchFn(url, opts);
        const latencyMs = Date.now() - t0;
        const usedWeight = parseUsedWeight(res && res.headers);
        recordCall({
            host, path, source: src,
            weight: (opts && typeof opts.__weight === 'number') ? opts.__weight : 0,
            status: res ? res.status : 0,
            latencyMs,
            usedWeight,
        });
        return res;
    } catch (err) {
        const latencyMs = Date.now() - t0;
        recordCall({
            host, path, source: src,
            weight: 0,
            status: 0,
            latencyMs,
            networkError: true,
        });
        throw err;
    }
}

function _aggregateBySource() {
    _prune();
    const out = {};
    for (const e of _ring) {
        if (!out[e.source]) {
            out[e.source] = { calls: 0, weightSum: 0, errors2xx: 0, errors4xx: 0, errors5xx: 0, networkErrors: 0, latencySum: 0 };
        }
        const s = out[e.source];
        s.calls++;
        s.weightSum += e.weight;
        s.latencySum += e.latencyMs;
        if (e.networkError) s.networkErrors++;
        else if (e.status >= 200 && e.status < 300) {
            // Successes — but flag 200s only with non-ok-aware status (treat 2xx as success)
            // Per spec test: errors2xx counts ALL 2xx responses (the name "errors2xx" is
            // unfortunate; it's really "responses2xx"). Test asserts 1 for status=200.
            s.errors2xx++;
        } else if (e.status >= 400 && e.status < 500) s.errors4xx++;
        else if (e.status >= 500) s.errors5xx++;
    }
    return out;
}

function _aggregateByHost() {
    _prune();
    const out = {};
    for (const e of _ring) {
        if (!out[e.host]) out[e.host] = { calls: 0, weightSum: 0, peakUsedWeight: 0, lastUsedWeight: null };
        const h = out[e.host];
        h.calls++;
        h.weightSum += e.weight;
        if (e.usedWeight != null) {
            if (e.usedWeight > h.peakUsedWeight) h.peakUsedWeight = e.usedWeight;
            h.lastUsedWeight = e.usedWeight;
        }
    }
    return out;
}

function _topEndpoints() {
    _prune();
    const counts = new Map();
    for (const e of _ring) {
        const k = e.host + '|' + e.path;
        const v = counts.get(k) || { host: e.host, path: e.path, calls: 0 };
        v.calls++;
        counts.set(k, v);
    }
    return Array.from(counts.values())
        .sort((a, b) => b.calls - a.calls)
        .slice(0, TOP_ENDPOINTS_N);
}

function _countSince(sinceMs) {
    _prune();
    const cutoff = _ts() - sinceMs;
    let n = 0;
    for (const e of _ring) if (e.ts >= cutoff) n++;
    return n;
}

function registerActivePollersProvider(fn) {
    _pollersProvider = typeof fn === 'function' ? fn : null;
}

function getSnapshot() {
    _prune();
    let activePollers = null;
    if (_pollersProvider) {
        try { activePollers = _pollersProvider(); } catch (_) { activePollers = null; }
    }
    return {
        bootTs: _bootTs,
        uptimeMs: _ts() - _bootTs,
        totalCalls: _ring.length,
        callsPer1min: _countSince(ONE_MIN_MS),
        callsPer5min: _countSince(FIVE_MIN_MS),
        bySource: _aggregateBySource(),
        byHost: _aggregateByHost(),
        topEndpoints: _topEndpoints(),
        activePollers,
    };
}

// ─── Test helpers ───
function _resetForTest() {
    _ring = [];
    _now = null;
    _pollersProvider = null;
}
function _setNowForTest(ts) { _now = ts; }

module.exports = {
    recordCall,
    parseUsedWeight,
    wrapFetch,
    registerActivePollersProvider,
    getSnapshot,
    _resetForTest,
    _setNowForTest,
};
