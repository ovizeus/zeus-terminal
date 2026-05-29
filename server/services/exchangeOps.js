'use strict';

/**
 * exchangeOps — Canonical router for order operations across Binance + Bybit.
 *
 * Public API: placeEntry, closePosition, ensureSymbolReady, getPositions,
 * getBalance, getUserTrades, ping, cancelOrder, invalidateReady, placeStopLoss.
 *
 * Routing: credentialStore.getExchangeCreds(uid).exchange → binanceOps OR bybitOps.
 * Lazy require to avoid eager load of either ops module.
 *
 * Hard SL guard: LIVE mode rejects entry without valid sl.price > 0 — throws
 * canonical ErrInvalidParams. Last line of defense in case brain logic omits SL.
 *
 * Idempotency: decisionKey regex enforced (a-zA-Z0-9_-, 1-36 chars) before any
 * downstream call.
 *
 * ensureSymbolReady cache: 5min TTL per (uid, symbol). Different leverage/
 * marginMode → cache miss. invalidateReady(uid, symbol) hook for 4xx errors.
 */

const credentialStore = require('./credentialStore');
const decisionKey = require('./decisionKey');
const canonicalErrors = require('./canonicalErrors');

const CACHE_TTL_MS = 5 * 60 * 1000;
const _readyCache = new Map(); // `${uid}|${symbol}` → { leverage, marginMode, ts }

function _opsForCreds(creds, uid, label) {
    if (!creds || !creds.exchange) {
        throw new Error(`exchangeOps: no creds for uid=${uid}${label ? ` exchange=${label}` : ''}`);
    }
    if (creds.exchange === 'binance') return { ops: require('./binanceOps'), creds };
    if (creds.exchange === 'bybit')   return { ops: require('./bybitOps'),   creds };
    throw new Error(`exchangeOps: unknown exchange '${creds.exchange}'`);
}

function _resolveOps(uid) {
    return _opsForCreds(credentialStore.getExchangeCreds(uid), uid);
}

// [Multi-exchange switch P2b] Resolve ops + creds for a SPECIFIC exchange when
// managing an already-open position (close/cancel/SL) on its own exchange after a
// switch. Uses getExchangeCredsFor → the override exchange's OWN apiKey/baseUrl
// (NOT the active creds with a swapped label). Fail-closed: throws if no connected
// account exists for that exchange — never silently routes to the active one.
// No override → falls back to the active exchange (unchanged behavior).
function _resolveOpsFor(uid, exchangeOverride) {
    if (!exchangeOverride) return _resolveOps(uid);
    return _opsForCreds(credentialStore.getExchangeCredsFor(uid, exchangeOverride), uid, exchangeOverride);
}

function _validatePlaceEntry(params, creds) {
    // decisionKey gate
    decisionKey.assert(params.decisionKey);

    // Hard SL guard on LIVE
    if (creds.mode === 'live') {
        const sl = params.sl;
        const slPriceNum = sl && sl.price != null ? Number(sl.price) : NaN;
        if (!sl || !Number.isFinite(slPriceNum) || slPriceNum <= 0) {
            throw canonicalErrors.create('ErrInvalidParams', 'SL required on LIVE mode — exchangeOps hard refuse');
        }
    } else if (!params.sl) {
        try { require('./logger').warn('EXCHANGE_OPS', `entry without SL on ${creds.mode} mode (decisionKey=${params.decisionKey})`); } catch (_) {}
    }

    // Basic shape
    if (!params.symbol || typeof params.symbol !== 'string') {
        throw canonicalErrors.create('ErrInvalidParams', `symbol required (got: ${JSON.stringify(params.symbol)})`);
    }
    if (!['LONG', 'SHORT'].includes(params.side)) {
        throw canonicalErrors.create('ErrInvalidParams', `side must be LONG or SHORT (got: ${params.side})`);
    }
    if (!params.qty) {
        throw canonicalErrors.create('ErrInvalidParams', 'qty required');
    }
}

async function placeEntry(uid, params) {
    const { ops, creds } = _resolveOps(uid);
    _validatePlaceEntry(params, creds);
    return ops.placeEntry(uid, params, creds);
}

async function closePosition(uid, params) {
    decisionKey.assert(params.decisionKey);
    const { ops, creds } = _resolveOpsFor(uid, params && params.exchangeOverride);
    return ops.closePosition(uid, params, creds);
}

async function ensureSymbolReady(uid, params) {
    // Fix #9: Cache key includes exchange to prevent cross-exchange cache hits
    // (e.g. a Binance user's BTCUSDT readiness should not satisfy a Bybit user's)
    const { ops, creds } = _resolveOps(uid);
    const key = `${uid}|${params.symbol}|${creds.exchange}`;
    const cached = _readyCache.get(key);
    const now = Date.now();
    const cacheHit = cached
        && (now - cached.ts) < CACHE_TTL_MS
        && cached.leverage === params.leverage
        && cached.marginMode === params.marginMode;
    if (cacheHit) {
        return { ok: true, leverage: params.leverage, marginMode: params.marginMode, cached: true };
    }
    const r = await ops.ensureSymbolReady(uid, params, creds);
    if (r && r.ok) {
        _readyCache.set(key, { leverage: r.leverage, marginMode: r.marginMode, ts: now });
    }
    return r;
}

function invalidateReady(uid, symbol) {
    // Fix #9: Clear all exchange variants of this uid+symbol cache entry
    const prefix = `${uid}|${symbol}|`;
    for (const k of _readyCache.keys()) {
        if (k.startsWith(prefix)) _readyCache.delete(k);
    }
}

async function getPositions(uid, params) {
    // [P2b] Override now resolves the override exchange's OWN creds via
    // getExchangeCredsFor (correct apiKey/baseUrl), replacing the prior
    // {...activeCreds, exchange} label-swap which sent the active exchange's
    // apiKey to the override exchange's ops module.
    const { ops, creds } = _resolveOpsFor(uid, params && params.exchangeOverride);
    return ops.getPositions(uid, params, creds);
}

async function getBalance(uid) {
    const { ops, creds } = _resolveOps(uid);
    return ops.getBalance(uid, creds);
}

async function getUserTrades(uid, params) {
    const { ops, creds } = _resolveOps(uid);
    return ops.getUserTrades(uid, params, creds);
}

async function ping(uid) {
    const { ops, creds } = _resolveOps(uid);
    return ops.ping(uid, creds);
}

async function cancelOrder(uid, params) {
    const { ops, creds } = _resolveOpsFor(uid, params && params.exchangeOverride);
    return ops.cancelOrder(uid, params, creds);
}

// [Task M 2026-05-28] Router for getOpenOrders — used by orderSweeper at boot
// to detect orphan SL/TP orders (exchange knows, Zeus DB doesn't).
async function getOpenOrders(uid, params) {
    const { ops, creds } = _resolveOps(uid);
    if (typeof ops.getOpenOrders !== 'function') {
        // Not implemented for this exchange yet (e.g. Bybit) — return empty
        return [];
    }
    return ops.getOpenOrders(uid, params || {}, creds);
}

async function placeStopLoss(uid, params) {
    const { ops, creds } = _resolveOpsFor(uid, params && params.exchangeOverride);
    return ops.placeStopLoss(uid, params, creds);
}

function _resetForTest() {
    _readyCache.clear();
}

module.exports = {
    placeEntry, closePosition, ensureSymbolReady, invalidateReady,
    getPositions, getBalance, getUserTrades, ping, cancelOrder, placeStopLoss,
    getOpenOrders,
    _resetForTest, CACHE_TTL_MS,
};
