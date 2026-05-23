'use strict';

// [Wave 9 / Canonical PDF #8] CoinGecko fetcher with 5min TTL DB cache.
// Two endpoints: /global (dominance + total market cap) and /coins/markets
// (top 200 by market cap with rank, volume, 24h change). On API failure,
// returns stale cache row if any so brain doesn't lose context on flap.

const { db } = require('../database');

const TTL_MS = 5 * 60 * 1000;
const MAX_STALE_FOR_BRAIN_MS = 30 * 60 * 1000;
const BASE = 'https://api.coingecko.com/api/v3';
const MARKETS_LIMIT = 200;

let _fetchImpl = (typeof globalThis.fetch === 'function') ? globalThis.fetch.bind(globalThis) : null;

function _setFetchForTest(fn) {
    _fetchImpl = fn;
}

function _resetForTest() {
    try { db.prepare('DELETE FROM ml_fundamentals_cache').run(); } catch (_) {}
    _fetchImpl = (typeof globalThis.fetch === 'function') ? globalThis.fetch.bind(globalThis) : null;
}

function _expireCacheForTest() {
    try {
        db.prepare('UPDATE ml_fundamentals_cache SET fetched_at = 0').run();
    } catch (_) {}
}

function _setCacheAgeForTest(ageMs) {
    try {
        db.prepare('UPDATE ml_fundamentals_cache SET fetched_at = ?').run(Date.now() - ageMs);
    } catch (_) {}
}

function _readCache(key) {
    try {
        const row = db.prepare(
            'SELECT value_json, fetched_at FROM ml_fundamentals_cache WHERE cache_key = ?'
        ).get(key);
        if (!row) return null;
        return { value: JSON.parse(row.value_json), fetched_at: row.fetched_at };
    } catch (_) {
        return null;
    }
}

function _writeCache(key, value) {
    try {
        db.prepare(
            `INSERT INTO ml_fundamentals_cache (cache_key, value_json, fetched_at)
             VALUES (?, ?, ?)
             ON CONFLICT(cache_key) DO UPDATE SET
               value_json = excluded.value_json,
               fetched_at = excluded.fetched_at`
        ).run(key, JSON.stringify(value), Date.now());
    } catch (_) { /* never block on cache write */ }
}

async function _fetchJson(url) {
    if (!_fetchImpl) throw new Error('fetch impl unavailable');
    const res = await _fetchImpl(url);
    if (!res || !res.ok) throw new Error(`fetch failed status=${res && res.status}`);
    return await res.json();
}

async function _refresh() {
    const [global, markets] = await Promise.all([
        _fetchJson(`${BASE}/global`),
        _fetchJson(`${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${MARKETS_LIMIT}&page=1`),
    ]);
    _writeCache('global', global);
    _writeCache('markets_top', markets);
    return { global, markets };
}

async function _loadFresh() {
    const globalCached = _readCache('global');
    const marketsCached = _readCache('markets_top');
    const now = Date.now();
    const fresh = globalCached && marketsCached
        && (now - globalCached.fetched_at) < TTL_MS
        && (now - marketsCached.fetched_at) < TTL_MS;
    if (fresh) {
        return { global: globalCached.value, markets: marketsCached.value, stale: false };
    }
    try {
        const r = await _refresh();
        return { global: r.global, markets: r.markets, stale: false };
    } catch (_) {
        // Refresh failed — fall back to stale if present
        if (globalCached && marketsCached) {
            return { global: globalCached.value, markets: marketsCached.value, stale: true };
        }
        return null;
    }
}

function _baseSymbol(symbol) {
    if (typeof symbol !== 'string') return null;
    const s = symbol.toUpperCase();
    if (s.endsWith('USDT')) return s.slice(0, -4);
    if (s.endsWith('USDC')) return s.slice(0, -4);
    if (s.endsWith('USD')) return s.slice(0, -3);
    return s;
}

// Sync hot-path read for brain. Returns shape only if both 'global' and
// 'markets_top' cache rows exist AND fetched_at is within 30min. Never
// throws, never fetches. Returns null on any failure or staleness.
function getFundamentalsCached(symbol) {
    try {
        const base = _baseSymbol(symbol);
        if (!base) return null;
        const globalCached = _readCache('global');
        const marketsCached = _readCache('markets_top');
        if (!globalCached || !marketsCached) return null;
        const now = Date.now();
        const oldestAge = now - Math.min(globalCached.fetched_at, marketsCached.fetched_at);
        if (oldestAge > MAX_STALE_FOR_BRAIN_MS) return null;
        const baseLower = base.toLowerCase();
        const market = marketsCached.value.find(
            m => m && typeof m.symbol === 'string' && m.symbol.toLowerCase() === baseLower
        );
        if (!market) return null;
        const dominance = (globalCached.value && globalCached.value.data && globalCached.value.data.market_cap_percentage)
            ? Number(globalCached.value.data.market_cap_percentage[baseLower]) || null
            : null;
        return {
            symbol,
            coingecko_id: market.id,
            market_cap_rank: market.market_cap_rank != null ? Number(market.market_cap_rank) : null,
            dominance_pct: dominance,
            vol_24h_usd: market.total_volume != null ? Number(market.total_volume) : null,
            price_change_24h_pct: market.price_change_percentage_24h != null
                ? Number(market.price_change_percentage_24h) : null,
            cache_age_ms: oldestAge,
        };
    } catch (_) {
        return null;
    }
}

async function getFundamentals(symbol) {
    const base = _baseSymbol(symbol);
    if (!base) return null;
    const data = await _loadFresh();
    if (!data) return null;
    const baseLower = base.toLowerCase();
    const market = data.markets.find(m => m && typeof m.symbol === 'string' && m.symbol.toLowerCase() === baseLower);
    if (!market) return null;
    const dominance = (data.global && data.global.data && data.global.data.market_cap_percentage)
        ? Number(data.global.data.market_cap_percentage[baseLower]) || null
        : null;
    const out = {
        symbol,
        coingecko_id: market.id,
        market_cap_rank: market.market_cap_rank != null ? Number(market.market_cap_rank) : null,
        dominance_pct: dominance,
        vol_24h_usd: market.total_volume != null ? Number(market.total_volume) : null,
        price_change_24h_pct: market.price_change_percentage_24h != null
            ? Number(market.price_change_percentage_24h) : null,
        fetched_at: Date.now(),
    };
    if (data.stale) out.stale = true;
    return out;
}

// Background refresher — warms cache periodically so brain hot-path
// (getFundamentalsCached) has data without making HTTP per tick. Default
// 5min interval matches TTL. Safe-stop via stopBackgroundRefresh().
let _refreshTimer = null;
function startBackgroundRefresh(intervalMs) {
    if (_refreshTimer) return;
    const period = intervalMs || TTL_MS;
    // Initial warm shortly after boot (don't block start)
    setTimeout(() => { getFundamentals('BTCUSDT').catch(() => {}); }, 5000);
    _refreshTimer = setInterval(() => {
        getFundamentals('BTCUSDT').catch(() => {});
    }, period);
    if (_refreshTimer.unref) _refreshTimer.unref();
}
function stopBackgroundRefresh() {
    if (_refreshTimer) {
        clearInterval(_refreshTimer);
        _refreshTimer = null;
    }
}

module.exports = {
    getFundamentals,
    getFundamentalsCached,
    startBackgroundRefresh,
    stopBackgroundRefresh,
    _setFetchForTest,
    _resetForTest,
    _expireCacheForTest,
    _setCacheAgeForTest,
};
