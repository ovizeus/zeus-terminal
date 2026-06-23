'use strict';

const WebSocket = require('ws');
const { sendSignedRequest } = require('./binanceSigner');
const logger = require('./logger');
const MF = require('../migrationFlags');

const WS_BASE_PROD = 'wss://fstream.binance.com/ws/';
const WS_BASE_TESTNET = 'wss://stream.binancefuture.com/ws/';

function _wsBase(creds) {
    if (creds && creds.baseUrl && creds.baseUrl.includes('testnet')) return WS_BASE_TESTNET;
    return WS_BASE_PROD;
}
const REFRESH_INTERVAL_MS = 25 * 60 * 1000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

// [T1-1 2026-06-07] Per-user connection map. WAS a module-level singleton
// (`_ws`/`_listenKey`/`_health`) with `if (_ws) return` in connect() — so only
// the FIRST user ever got a stream and all others were silently dropped; health
// reported one user globally. With 8 users (and REAL ahead) that meant 7/8 users
// would miss real-time fills. Each user now owns an isolated connection record.
const _conns = new Map(); // userId -> { ws, listenKey, refreshTimer, reconnectMs, creds, onEvent, disconnected, health }

function _newHealth() {
    return { connected: false, lastEventTs: 0, eventsTotal: 0, reconnectCount: 0, listenKeyCreatedAt: 0 };
}

function _conn(userId) {
    let c = _conns.get(userId);
    if (!c) {
        c = { ws: null, listenKey: null, refreshTimer: null, reconnectMs: RECONNECT_BASE_MS, creds: null, onEvent: null, disconnected: false, health: _newHealth() };
        _conns.set(userId, c);
    }
    return c;
}

async function createListenKey(creds) {
    const res = await sendSignedRequest('POST', '/fapi/v1/listenKey', {}, creds);
    return res.listenKey;
}

async function refreshListenKey(creds) {
    await sendSignedRequest('PUT', '/fapi/v1/listenKey', {}, creds);
}

async function deleteListenKey(creds) {
    await sendSignedRequest('DELETE', '/fapi/v1/listenKey', {}, creds);
}

function parseAccountUpdate(event) {
    if (!event || event.e !== 'ACCOUNT_UPDATE' || !event.a) return null;
    const positions = (event.a.P || []).map(p => ({
        symbol: p.s,
        positionAmt: parseFloat(p.pa) || 0,
        entryPrice: parseFloat(p.ep) || 0,
        unrealizedPnL: parseFloat(p.up) || 0,
        positionSide: p.ps || 'BOTH',
    }));
    const balances = (event.a.B || []).map(b => ({
        asset: b.a,
        walletBalance: parseFloat(b.wb) || 0,
        crossWalletBalance: parseFloat(b.cw) || 0,
    }));
    return { positions, balances, eventTime: event.E, reason: event.a.m };
}

function parseOrderUpdate(event) {
    if (!event || event.e !== 'ORDER_TRADE_UPDATE' || !event.o) return null;
    const o = event.o;
    return {
        symbol: o.s,
        side: o.S,
        orderType: o.o,
        executionType: o.x,
        orderStatus: o.X,
        orderId: o.i,
        // [BUG B 2026-06-05] Triggered algo children carry the clientAlgoId
        // as clientOrderId (sl_<decisionKey>_<i> / tp_...) — needed to
        // recognize our own SL/TP fills and journal HIT_SL/HIT_TP with the
        // REAL exit price + realized PnL instead of EXTERNAL_CLOSE $0.00.
        clientOrderId: o.c,
        price: parseFloat(o.p) || 0,
        avgPrice: parseFloat(o.ap) || 0,
        origQty: parseFloat(o.q) || 0,
        filledQty: parseFloat(o.z) || 0,
        realizedPnL: parseFloat(o.rp) || 0,
        // [FEE-CAPTURE 2026-06-23] Real fill commission (Binance o.n) + asset (o.N).
        // Accumulated per-position by serverAT and surfaced as pos.fee at close for the
        // admin leaderboard (estimate fallback covers fills we miss).
        commission: parseFloat(o.n) || 0,
        commissionAsset: o.N || null,
        // [T-EXTCLOSE 2026-06-08] reduceOnly (o.R) — distinguishes a closing fill
        // (manual/testnet/liquidation close, all reduceOnly) from an entry fill,
        // so EXTERNAL_CLOSE can capture the real realizedPnL instead of $0.00.
        reduceOnly: !!o.R,
        tradeTime: o.T,
        eventTime: event.E,
    };
}

function shouldApplyUpdate(incomingTs, currentTs) {
    return incomingTs >= currentTs;
}

function _healthShape(h) {
    return {
        connected: h.connected,
        lastEventTs: h.lastEventTs,
        eventsTotal: h.eventsTotal,
        reconnectCount: h.reconnectCount,
        listenKeyAgeMs: h.listenKeyCreatedAt ? Date.now() - h.listenKeyCreatedAt : 0,
    };
}

// [T1-1] Per-user when userId given; legacy aggregate when omitted (the
// /api/userdatastream/health endpoint at server.js:157 calls it with no arg).
function getHealthStatus(userId) {
    if (userId != null) {
        const c = _conns.get(userId);
        return c ? _healthShape(c.health) : _healthShape(_newHealth());
    }
    if (_conns.size === 0) return _healthShape(_newHealth());
    const agg = _newHealth();
    let maxLkCreated = 0;
    for (const c of _conns.values()) {
        const h = c.health;
        if (h.connected) agg.connected = true;
        agg.eventsTotal += h.eventsTotal;
        agg.reconnectCount += h.reconnectCount;
        if (h.lastEventTs > agg.lastEventTs) agg.lastEventTs = h.lastEventTs;
        if (h.listenKeyCreatedAt > maxLkCreated) maxLkCreated = h.listenKeyCreatedAt;
    }
    agg.listenKeyCreatedAt = maxLkCreated;
    return Object.assign(_healthShape(agg), { userCount: _conns.size });
}

// [T1-1 REAL-flag fix] `mode` is the resolved EXECUTION env ('demo'|'testnet'|
// 'real'), NOT the engineMode. The boot loop (server.js) now passes
// `creds.mode` (testnet|real) instead of getMode() (which only ever returns
// 'demo'|'live') — so the `real` branch is reachable and
// _USERDATA_STREAM_REAL_ENABLED is no longer dead code. 'live' is kept as a
// conservative alias for testnet (never routes to the REAL flag on ambiguity).
function resolveStreamFlag(mode) {
    if (!MF.USERDATA_STREAM_ENABLED) return false;
    if (mode === 'demo') return true;
    if (mode === 'testnet' || mode === 'live') return MF._USERDATA_STREAM_TESTNET_ENABLED;
    if (mode === 'real') return MF._USERDATA_STREAM_REAL_ENABLED;
    return false;
}

async function connect(userId, creds, onEvent) {
    const existing = _conns.get(userId);
    if (existing && existing.ws) return; // already streaming for THIS user
    // [BUG multi-exchange] The user-data stream is Binance-specific (listenKey +
    // /fapi WS). A non-Binance active exchange (e.g. Bybit) has no listenKey — the
    // createListenKey below would POST /fapi/v1/listenKey to that exchange's host
    // (api-demo.bybit.com) and fail with "non-JSON response (HTTP 200)" on every
    // reconnect. Skip gracefully; Bybit order/position updates are covered by recon
    // polling until a native Bybit private WS exists.
    if (creds && creds.exchange && creds.exchange !== 'binance') {
        logger.info('USERDATA', `skip uid=${userId}: stream is Binance-only, active exchange=${creds.exchange}`);
        return;
    }

    const c = _conn(userId);
    c.creds = creds;
    c.onEvent = onEvent;
    c.disconnected = false;

    try {
        c.listenKey = await createListenKey(creds);
        c.health.listenKeyCreatedAt = Date.now();
        logger.info('USERDATA', `listenKey obtained uid=${userId}`);
    } catch (err) {
        logger.error('USERDATA', `createListenKey failed uid=${userId}: ${err.message}`);
        return;
    }

    const wsUrl = _wsBase(creds) + c.listenKey;
    logger.info('USERDATA', `connecting WS uid=${userId} url=${wsUrl.replace(c.listenKey, '***')}`);
    c.ws = new WebSocket(wsUrl);

    c.ws.on('open', () => {
        c.health.connected = true;
        c.reconnectMs = RECONNECT_BASE_MS;
        logger.info('USERDATA', `WS connected uid=${userId}`);
    });

    c.ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);
            c.health.lastEventTs = Date.now();
            c.health.eventsTotal++;
            if (typeof onEvent === 'function') onEvent(data);
        } catch (_) {}
    });

    c.ws.on('close', () => {
        c.health.connected = false;
        // [T1-1] Manual disconnect must NOT trigger an auto-reconnect.
        if (c.disconnected) return;
        c.health.reconnectCount++;
        logger.warn('USERDATA', `WS disconnected uid=${userId} — reconnect in ${c.reconnectMs}ms`);
        const delay = c.reconnectMs;
        setTimeout(() => {
            if (c.disconnected) return; // disconnected during the backoff window
            c.ws = null;
            connect(userId, c.creds, c.onEvent);
        }, delay);
        c.reconnectMs = Math.min(c.reconnectMs * 2, RECONNECT_MAX_MS);
    });

    c.ws.on('error', (err) => {
        logger.error('USERDATA', `WS error uid=${userId}: ${err.message}`);
    });

    if (c.refreshTimer) clearInterval(c.refreshTimer);
    c.refreshTimer = setInterval(async () => {
        try {
            await refreshListenKey(creds);
        } catch (err) {
            logger.warn('USERDATA', `listenKey refresh failed uid=${userId}: ${err.message} — recreating`);
            try {
                c.listenKey = await createListenKey(creds);
                c.health.listenKeyCreatedAt = Date.now();
            } catch (err2) {
                logger.error('USERDATA', `listenKey recreate failed uid=${userId}: ${err2.message}`);
            }
        }
    }, REFRESH_INTERVAL_MS);
}

// [T1-1] disconnect(userId) tears down ONE user; disconnect() (no arg) tears
// down ALL (graceful shutdown / test reset).
function disconnect(userId) {
    if (userId != null) {
        const c = _conns.get(userId);
        if (!c) return;
        c.disconnected = true;
        if (c.refreshTimer) { clearInterval(c.refreshTimer); c.refreshTimer = null; }
        if (c.ws) { try { c.ws.close(); } catch (_) {} c.ws = null; }
        c.health.connected = false;
        c.listenKey = null;
        _conns.delete(userId);
        return;
    }
    for (const uid of Array.from(_conns.keys())) disconnect(uid);
}

function _resetForTest() {
    disconnect();
    _conns.clear();
}

module.exports = {
    createListenKey,
    refreshListenKey,
    deleteListenKey,
    parseAccountUpdate,
    parseOrderUpdate,
    shouldApplyUpdate,
    getHealthStatus,
    resolveStreamFlag,
    connect,
    disconnect,
    _resetForTest,
};
