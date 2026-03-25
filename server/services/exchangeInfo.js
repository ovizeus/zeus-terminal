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
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
function startAutoRefresh() {
    if (_refreshInterval) return;
    // Initial load with retry on failure (30s, 60s, 120s)
    (async function _initialLoad(attempt) {
        await loadExchangeInfo();
        if (!_loaded && attempt < 3) {
            const delay = [30000, 60000, 120000][attempt];
            console.warn(`[EXCHANGE_INFO] Retry #${attempt + 1} in ${delay / 1000}s`);
            setTimeout(() => _initialLoad(attempt + 1), delay);
        }
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

module.exports = { startAutoRefresh, roundOrderParams };
