'use strict';

// [Wave 9 / Canonical PDF #8] Fundamentals facade. Brain (serverBrain.js)
// reads decision.context.fundamentals from getFundamentals(symbol). Lazy
// require + try/catch isolation — never blocks brain on fundamentals failure.

const coingecko = require('./coingecko');

async function getFundamentals(symbol) {
    try {
        return await coingecko.getFundamentals(symbol);
    } catch (_) {
        return null;
    }
}

// Sync hot-path read for brain. NEVER fetches, NEVER throws.
function getFundamentalsCached(symbol) {
    try {
        return coingecko.getFundamentalsCached(symbol);
    } catch (_) {
        return null;
    }
}

module.exports = {
    getFundamentals,
    getFundamentalsCached,
    startBackgroundRefresh: coingecko.startBackgroundRefresh,
    stopBackgroundRefresh: coingecko.stopBackgroundRefresh,
    _setFetchForTest: coingecko._setFetchForTest,
    _resetForTest: coingecko._resetForTest,
    _expireCacheForTest: coingecko._expireCacheForTest,
    _setCacheAgeForTest: coingecko._setCacheAgeForTest,
};
