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

let _ws = null;
let _listenKey = null;
let _refreshTimer = null;
let _reconnectMs = RECONNECT_BASE_MS;
let _health = {
    connected: false,
    lastEventTs: 0,
    eventsTotal: 0,
    reconnectCount: 0,
    listenKeyCreatedAt: 0,
};

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
        price: parseFloat(o.p) || 0,
        avgPrice: parseFloat(o.ap) || 0,
        origQty: parseFloat(o.q) || 0,
        filledQty: parseFloat(o.z) || 0,
        realizedPnL: parseFloat(o.rp) || 0,
        tradeTime: o.T,
        eventTime: event.E,
    };
}

function shouldApplyUpdate(incomingTs, currentTs) {
    return incomingTs >= currentTs;
}

function getHealthStatus() {
    return {
        connected: _health.connected,
        lastEventTs: _health.lastEventTs,
        eventsTotal: _health.eventsTotal,
        reconnectCount: _health.reconnectCount,
        listenKeyAgeMs: _health.listenKeyCreatedAt ? Date.now() - _health.listenKeyCreatedAt : 0,
    };
}

function resolveStreamFlag(mode) {
    if (!MF.USERDATA_STREAM_ENABLED) return false;
    if (mode === 'demo') return true;
    if (mode === 'testnet' || mode === 'live') return MF._USERDATA_STREAM_TESTNET_ENABLED;
    if (mode === 'real') return MF._USERDATA_STREAM_REAL_ENABLED;
    return false;
}

async function connect(userId, creds, onEvent) {
    if (_ws) return;
    try {
        _listenKey = await createListenKey(creds);
        _health.listenKeyCreatedAt = Date.now();
        logger.info('USERDATA', `listenKey obtained uid=${userId}`);
    } catch (err) {
        logger.error('USERDATA', `createListenKey failed uid=${userId}: ${err.message}`);
        return;
    }

    const wsUrl = _wsBase(creds) + _listenKey;
    logger.info('USERDATA', `connecting WS uid=${userId} url=${wsUrl.replace(_listenKey, '***')}`);
    _ws = new WebSocket(wsUrl);

    _ws.on('open', () => {
        _health.connected = true;
        _reconnectMs = RECONNECT_BASE_MS;
        logger.info('USERDATA', `WS connected uid=${userId}`);
    });

    _ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);
            _health.lastEventTs = Date.now();
            _health.eventsTotal++;
            if (typeof onEvent === 'function') onEvent(data);
        } catch (_) {}
    });

    _ws.on('close', () => {
        _health.connected = false;
        _health.reconnectCount++;
        logger.warn('USERDATA', `WS disconnected uid=${userId} — reconnect in ${_reconnectMs}ms`);
        setTimeout(() => {
            _ws = null;
            connect(userId, creds, onEvent);
        }, _reconnectMs);
        _reconnectMs = Math.min(_reconnectMs * 2, RECONNECT_MAX_MS);
    });

    _ws.on('error', (err) => {
        logger.error('USERDATA', `WS error uid=${userId}: ${err.message}`);
    });

    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(async () => {
        try {
            await refreshListenKey(creds);
        } catch (err) {
            logger.warn('USERDATA', `listenKey refresh failed uid=${userId}: ${err.message} — recreating`);
            try {
                _listenKey = await createListenKey(creds);
                _health.listenKeyCreatedAt = Date.now();
            } catch (err2) {
                logger.error('USERDATA', `listenKey recreate failed uid=${userId}: ${err2.message}`);
            }
        }
    }, REFRESH_INTERVAL_MS);
}

function disconnect() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
    _health.connected = false;
    _listenKey = null;
}

function _resetForTest() {
    disconnect();
    _health = { connected: false, lastEventTs: 0, eventsTotal: 0, reconnectCount: 0, listenKeyCreatedAt: 0 };
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
