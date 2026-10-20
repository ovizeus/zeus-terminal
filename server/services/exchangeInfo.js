// Zeus Terminal — Exchange Info Cache
// Fetches and caches stepSize / tickSize per symbol from Binance
// Used to round quantity and stopPrice before placing orders
'use strict';

const config = require('../config');

let _cache = {};        // { BTCUSDT: { stepSize, tickSize, minNotional } }
let _loaded = false;
let _loadPromise = null;

/**
 * Fetch exchangeInfo from Binance and cache filter values.
 * Called once at server startup; refreshes every 6h.
 */
async function loadExchangeInfo() {
    try {
        const url = config.binance.baseUrl + '/fapi/v1/exchangeInfo';
        // [BOOT-STAGGER B 2026-06-05] Was a direct fetch() — the ONLY boot-time
        // Binance call bypassing the gateway (10 weight, invisible to the quota
        // gate/telemetry). Route through binanceGateway like everything else;
        // lane P2 in binanceScheduler (required for order rounding, must
        // survive boot-blind pressure). Failure behaviour unchanged: throw →
        // catch below → keep stale cache + caller's 30/60/120s retries.
        const res = await require('./binanceGateway').fetch(url, {
            signal: AbortSignal.timeout(10000), __weight: 10, __src: 'exchangeInfo:snapshot',
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const fresh = {};
        for (const sym of (data.symbols || [])) {
            const entry = { stepSize: '1', tickSize: '0.01', minNotional: 5 };
            for (const f of (sym.filters || [])) {
                if (f.filterType === 'LOT_SIZE') entry.stepSize = f.stepSize;
                if (f.filterType === 'PRICE_FILTER') entry.tickSize = f.tickSize;
                if (f.filterType === 'MIN_NOTIONAL') entry.minNotional = parseFloat(f.notional || f.minNotional || 5);
            }
            fresh[sym.symbol] = entry;
        }
        _cache = fresh;
        _loaded = true;
        console.log('[EXCHANGE_INFO] Cached filters for', Object.keys(fresh).length, 'symbols');
    } catch (err) {
        console.error('[EXCHANGE_INFO] Failed to load:', err.message);
        // Keep stale cache if available
    }
}

// Auto-refresh every 6 hours
let _refreshInterval = null;
let _bootRetryTimer = null;

// [2026-10-20 b289] Backoff plafonat pentru incarcarea de la boot.
// Varianta veche facea EXACT 4 incercari (0/30s/60s/120s) si, daca toate
// picau, renunta — urmatoarea sansa era abia refresh-ul de 6 ORE. Cache-ul
// de filtre nu e optional: `_alignQtyToLotSize` (serverAT) respinge corect
// orice intrare pentru un simbol fara stepSize, deci cat timp cache-ul e gol
// serverul NU POATE intra in piata, nici autotrade nici inregistrare manuala.
// Pe viu, 2026-10-19 12:40-12:50: 59 de intrari pierdute la uid=1 cu
// incredere 63-71 in regim TREND, toate cu LOT_SIZE_ALIGN_REJECTED, pana
// cand o repornire a reusit sa incarce filtrele la 12:52:29.
// Acum reincercarea nu se opreste pana reuseste, dar e plafonata la 5 min
// ca sa nu devina rafala spre Binance (regula: rafala -> 429 -> ban de IP).
const BOOT_RETRY_DELAYS_MS = [30000, 60000, 120000];
const BOOT_RETRY_MAX_MS = 300000;

function _bootRetryDelay(attempt) {
    return BOOT_RETRY_DELAYS_MS[attempt] !== undefined
        ? BOOT_RETRY_DELAYS_MS[attempt]
        : BOOT_RETRY_MAX_MS;
}

function startAutoRefresh() {
    if (_refreshInterval) return;
    (async function _initialLoad(attempt) {
        _bootRetryTimer = null;
        await loadExchangeInfo();
        if (_loaded) {
            if (attempt > 0) {
                console.log(`[EXCHANGE_INFO] Loaded after ${attempt + 1} attempts — entries unblocked`);
            }
            return;
        }
        const delay = _bootRetryDelay(attempt);
        console.warn(
            `[EXCHANGE_INFO] Retry #${attempt + 1} in ${delay / 1000}s — ` +
            'cache EMPTY, every entry will be rejected (LOT_SIZE_ALIGN_REJECTED) until it loads'
        );
        _bootRetryTimer = setTimeout(() => _initialLoad(attempt + 1), delay);
        if (_bootRetryTimer && typeof _bootRetryTimer.unref === 'function') _bootRetryTimer.unref();
    })(0);
    _refreshInterval = setInterval(loadExchangeInfo, 6 * 60 * 60 * 1000);
}

/**
 * Round a value DOWN to the nearest step (e.g. stepSize or tickSize).
 * Binance rejects orders if qty isn't aligned to LOT_SIZE.
 */
function roundToStep(value, step) {
    const s = parseFloat(step);
    if (!s || s <= 0) return value;
    // Calculate precision from step string (e.g. '0.001' → 3 decimals)
    const decimals = (step.indexOf('.') >= 0) ? step.split('.')[1].replace(/0+$/, '').length : 0;
    const rounded = Math.floor(value / s) * s;
    return parseFloat(rounded.toFixed(decimals));
}

/**
 * Get filters for a symbol. Returns null if symbol not cached.
 */
function getFilters(symbol) {
    return _cache[symbol] || null;
}

// [test-only] Inject filters into cache so unit tests can exercise code
// paths that depend on _getExchangeFilters without hitting Binance.
function _setFiltersForTest(symbol, filters) {
    _cache[symbol] = filters;
}

/**
 * Round order quantity and stopPrice for a given symbol.
 * Returns { quantity, stopPrice } with corrected values.
 * If symbol not in cache, returns values unchanged.
 */
function roundOrderParams(symbol, quantity, stopPrice) {
    const f = _cache[symbol];
    if (!f) return { quantity, stopPrice };
    const result = { quantity: roundToStep(quantity, f.stepSize) };
    if (stopPrice !== undefined && stopPrice !== null) {
        result.stopPrice = roundToStep(stopPrice, f.tickSize);
    } else {
        result.stopPrice = stopPrice;
    }
    return result;
}

// [BUG-TM-8] Export getFilters so callers can prove cache hit before relying on roundOrderParams output (cannot detect cache miss via output equality alone — already-aligned qty looks identical to passthrough).
module.exports = { startAutoRefresh, roundOrderParams, getFilters, _setFiltersForTest };
