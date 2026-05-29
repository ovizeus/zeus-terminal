'use strict';

/**
 * bybitFeed — Bybit V5 WS market feed (Phase 1A connection lifecycle).
 *
 * Mirror of marketFeed.js (Binance) and liqFeedAggregator.js (Bybit liq) patterns.
 *
 * URL: wss://stream.bybit.com/v5/public/linear (REAL ws always, even for testnet
 * users — per spec Q5 decision, brain reads real prices, testnet differs only
 * at signed REST level).
 *
 * Heartbeat: send {op:'ping'} every 20s, expect {op:'pong'} (Bybit quirk vs
 * Binance ping frame).
 *
 * Reconnect: exponential backoff 1s → 60s max with grace period.
 *
 * Tasks 14-17 add: subscribe batching + per-topic retry + kline/trade/bookTicker
 * /markPrice normalizers. Task 13 is JUST connection lifecycle.
 *
 * Emits canonical events: 'kline', 'trade', 'bookTicker', 'markPrice' (Tasks 14+).
 */

const WebSocket = require('ws');
const EventEmitter = require('events');

const WS_URL = 'wss://stream.bybit.com/v5/public/linear';
const PING_INTERVAL_MS = 20_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

const SYMBOLS = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']);
const TIMEFRAMES_BYBIT = Object.freeze({ '5m': '5', '1h': '60', '4h': '240' });

const _emitter = new EventEmitter();
let _ws = null;
let _connected = false;
let _running = false;
let _closing = false;
let _framesReceived = 0;
let _eventsEmitted = 0;
let _lastMessageTs = 0;
let _pingTimer = null;
let _reconnectTimer = null;
let _reconnectMs = RECONNECT_MIN_MS;

function _clearTimers() {
    if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
}

function _scheduleReconnect() {
    if (_closing) return;
    _clearTimers();
    _reconnectTimer = setTimeout(() => _connect(), _reconnectMs);
    _reconnectMs = Math.min(_reconnectMs * 2, RECONNECT_MAX_MS);
    if (_reconnectTimer.unref) _reconnectTimer.unref();
}

// [Task 14] Topic batches — Bybit V5 max ~10 topics per subscribe message
function _buildTopics() {
    const kline = [];
    for (const sym of SYMBOLS) {
        for (const tf of Object.values(TIMEFRAMES_BYBIT)) {
            kline.push(`kline.${tf}.${sym}`);
        }
    }
    const trade = SYMBOLS.map(s => `publicTrade.${s}`);
    const tickers = SYMBOLS.map(s => `tickers.${s}`);
    const orderbook = SYMBOLS.map(s => `orderbook.1.${s}`);
    return { kline, trade, tickers, orderbook };
}

// [Phase B / Task B1] Bybit V5 allows max ~10 args per subscribe request. The old
// hand-rolled batch1=t.kline put 12 topics (4 symbols × 3 TFs) in ONE message →
// ret_msg=fail → klines never subscribed (half-failing feed). Chunk ALL topics into
// <=10-topic messages so every batch is accepted.
const BYBIT_MAX_TOPICS_PER_MSG = 10;
function _chunkTopics(topics, maxPerBatch) {
    const max = maxPerBatch || BYBIT_MAX_TOPICS_PER_MSG;
    const out = [];
    for (let i = 0; i < topics.length; i += max) out.push(topics.slice(i, i + max));
    return out;
}

let _reqIdCounter = 0;
function _nextReqId() {
    return `bybit-sub-${Date.now()}-${++_reqIdCounter}`;
}

// [Task 17] Per-topic subscribe tracking
// pendingByReqId: Map<reqId, { topics: string[], sentAt: number }>
// subscribedTopics: Set<topic> — topics confirmed subscribed (success ack)
// failedTopics: Map<topic, { retries: number, nextRetryAt: number }>
const _pendingByReqId = new Map();
const _subscribedTopics = new Set();
const _failedTopics = new Map();

function _sendSubscribeBatches() {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    const t = _buildTopics();
    const all = [...t.kline, ...t.trade, ...t.tickers, ...t.orderbook];
    const batches = _chunkTopics(all, BYBIT_MAX_TOPICS_PER_MSG);

    for (const batch of batches) {
        if (batch.length === 0) continue;
        const reqId = _nextReqId();
        try {
            _ws.send(JSON.stringify({
                op: 'subscribe',
                args: batch,
                req_id: reqId,
            }));
            _pendingByReqId.set(reqId, { topics: [...batch], sentAt: Date.now() });
        } catch (err) {
            try { require('./logger').error('BYBIT_FEED', `subscribe send failed: ${err.message}`); } catch (_) {}
        }
    }
}

// [Task 15] Kline normalizer — Bybit V5 → canonical shape
// Bybit interval values: '1','3','5','15','30','60','120','240','360','720','D','M','W'
// We use only 5/60/240 (5m/1h/4h) per Zeus SD_TIMEFRAMES
const _INTERVAL_TO_TF = Object.freeze({ '5': '5m', '60': '1h', '240': '4h' });

function _normalizeKline(msg) {
    if (!msg || !msg.topic || !Array.isArray(msg.data) || msg.data.length === 0) return [];
    if (!msg.topic.startsWith('kline.')) return [];
    // Topic format: kline.{interval}.{symbol}
    const parts = msg.topic.split('.');
    if (parts.length !== 3) return [];
    const symbol = parts[2];
    const out = [];
    for (const k of msg.data) {
        if (!k) continue;
        const interval = String(k.interval != null ? k.interval : parts[1]);
        const tf = _INTERVAL_TO_TF[interval];
        if (!tf) continue;
        const open = parseFloat(k.open);
        const high = parseFloat(k.high);
        const low = parseFloat(k.low);
        const close = parseFloat(k.close);
        const volume = parseFloat(k.volume);
        const ts = Number(k.start);
        if (!Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(ts)) continue;
        out.push({
            symbol, tf,
            open, high, low, close, volume,
            ts,
            confirmed: !!k.confirm,
            rawExchange: 'bybit',
        });
    }
    return out;
}

// [Task 16] Trade normalizer — Bybit publicTrade → canonical
function _normalizeTrade(msg) {
    if (!msg || !Array.isArray(msg.data) || msg.data.length === 0) return [];
    if (typeof msg.topic !== 'string' || !msg.topic.startsWith('publicTrade.')) return [];
    const symbol = msg.topic.split('.')[1];
    if (!symbol) return [];
    const out = [];
    for (const t of msg.data) {
        if (!t) continue;
        if (t.S !== 'Buy' && t.S !== 'Sell') continue;
        const price = parseFloat(t.p);
        const qty = parseFloat(t.v);
        const ts = Number(t.T);
        if (!Number.isFinite(price) || !Number.isFinite(qty) || !Number.isFinite(ts)) continue;
        out.push({
            symbol,
            side: t.S === 'Buy' ? 'BUY' : 'SELL',
            price, qty, ts,
            rawExchange: 'bybit',
        });
    }
    return out;
}

// [Task 16] BookTicker normalizer — orderbook.1 → canonical
function _normalizeBookTicker(msg) {
    if (!msg || !msg.data) return null;
    if (typeof msg.topic !== 'string' || !msg.topic.startsWith('orderbook.1.')) return null;
    const symbol = msg.topic.split('.')[2];
    const d = msg.data;
    if (!Array.isArray(d.b) || !Array.isArray(d.a) || d.b.length === 0 || d.a.length === 0) return null;
    if (!Array.isArray(d.b[0]) || !Array.isArray(d.a[0])) return null;
    const bid = parseFloat(d.b[0][0]);
    const bidQty = parseFloat(d.b[0][1]);
    const ask = parseFloat(d.a[0][0]);
    const askQty = parseFloat(d.a[0][1]);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
    return {
        symbol,
        bid, bidQty: Number.isFinite(bidQty) ? bidQty : 0,
        ask, askQty: Number.isFinite(askQty) ? askQty : 0,
        ts: Number.isFinite(msg.ts) ? Number(msg.ts) : Date.now(),
        rawExchange: 'bybit',
    };
}

// [Task 16] MarkPrice normalizer — tickers → canonical (covers markPrice + funding)
function _normalizeMarkPrice(msg) {
    if (!msg || !msg.data) return null;
    if (typeof msg.topic !== 'string' || !msg.topic.startsWith('tickers.')) return null;
    const symbol = msg.topic.split('.')[1] || msg.data.symbol;
    const d = msg.data;
    const markPrice = parseFloat(d.markPrice);
    if (!Number.isFinite(markPrice)) return null;
    const _parseOpt = (v) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    };
    return {
        symbol: symbol || d.symbol,
        markPrice,
        indexPrice: _parseOpt(d.indexPrice),
        fundingRate: _parseOpt(d.fundingRate),
        nextFundingTime: _parseOpt(d.nextFundingTime),
        ts: Number.isFinite(msg.ts) ? Number(msg.ts) : Date.now(),
        rawExchange: 'bybit',
    };
}

function _connect() {
    if (_closing) return;
    try {
        _ws = new WebSocket(WS_URL);
    } catch (err) {
        try { require('./logger').error('BYBIT_FEED', `ctor failed: ${err.message}`); } catch (_) {}
        _scheduleReconnect();
        return;
    }

    _ws.on('open', () => {
        _connected = true;
        _reconnectMs = RECONNECT_MIN_MS;
        _lastMessageTs = Date.now();
        try { require('./logger').info('BYBIT_FEED', `connected to ${WS_URL}`); } catch (_) {}

        // [Task 14] Subscribe batched: 3 messages × ≤10 topics each
        _sendSubscribeBatches();

        _pingTimer = setInterval(() => {
            try {
                if (_ws && _ws.readyState === WebSocket.OPEN) {
                    _ws.send(JSON.stringify({ op: 'ping' }));
                }
            } catch (_) {}
        }, PING_INTERVAL_MS);
        if (_pingTimer.unref) _pingTimer.unref();
    });

    _ws.on('message', (raw) => {
        _framesReceived++;
        _lastMessageTs = Date.now();
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        _dispatchMessage(msg);
    });

    _ws.on('error', (err) => {
        try { require('./logger').error('BYBIT_FEED', `error: ${err.message}`); } catch (_) {}
    });

    _ws.on('close', (code) => {
        _connected = false;
        _clearTimers();
        if (_closing) return;
        try { require('./logger').warn('BYBIT_FEED', `closed code=${code}, reconnect in ${_reconnectMs}ms`); } catch (_) {}
        _scheduleReconnect();
    });
}

function _handleSubscribeAck(msg) {
    const reqId = msg.req_id;
    if (!reqId) return;
    const pending = _pendingByReqId.get(reqId);
    if (!pending) return; // unknown req_id (e.g., from previous connection)

    _pendingByReqId.delete(reqId);

    if (msg.success === true) {
        // Mark all topics in this batch as subscribed
        for (const topic of pending.topics) {
            _subscribedTopics.add(topic);
            _failedTopics.delete(topic); // clear any prior failure
        }
        try { require('./logger').info('BYBIT_FEED', `subscribe ack OK: ${pending.topics.length} topics`); } catch (_) {}
    } else {
        // Mark all topics in this batch as failed (Bybit doesn't always specify which)
        for (const topic of pending.topics) {
            const current = _failedTopics.get(topic) || { retries: 0, nextRetryAt: 0 };
            current.retries += 1;
            // Backoff: 1s, 5s, 30s, 5min, then 5min cooldown after 5 failures
            const backoffs = [1000, 5000, 30000, 300000];
            const idx = Math.min(current.retries - 1, backoffs.length - 1);
            current.nextRetryAt = Date.now() + backoffs[idx];
            _failedTopics.set(topic, current);
        }
        try { require('./logger').warn('BYBIT_FEED', `subscribe ack FAILED: ${pending.topics.length} topics, ret_msg=${msg.ret_msg || '(empty)'}`); } catch (_) {}
    }
}

function _dispatchMessage(msg) {
    if (!msg) return;
    if (msg.op === 'pong') return;
    if (msg.op === 'subscribe') {
        _handleSubscribeAck(msg);
        return;
    }

    if (typeof msg.topic === 'string') {
        if (msg.topic.startsWith('kline.')) {
            const normalized = _normalizeKline(msg);
            for (const k of normalized) {
                _emitter.emit('kline', k);
                _eventsEmitted++;
            }
            return;
        }
        if (msg.topic.startsWith('publicTrade.')) {
            const trades = _normalizeTrade(msg);
            for (const t of trades) {
                _emitter.emit('trade', t);
                _eventsEmitted++;
            }
            return;
        }
        if (msg.topic.startsWith('orderbook.1.')) {
            const bt = _normalizeBookTicker(msg);
            if (bt) {
                _emitter.emit('bookTicker', bt);
                _eventsEmitted++;
            }
            return;
        }
        if (msg.topic.startsWith('tickers.')) {
            const mp = _normalizeMarkPrice(msg);
            if (mp) {
                _emitter.emit('markPrice', mp);
                _eventsEmitted++;
            }
            return;
        }
    }
}

function start() {
    if (_running) return;
    _running = true;
    _closing = false;
    _connect();
}

function stop() {
    _closing = true;
    _running = false;
    _clearTimers();
    if (_ws) {
        try { _ws.close(); } catch (_) {}
        _ws = null;
    }
    _connected = false;
}

function getConnectionState() {
    return {
        url: WS_URL,
        connected: _connected,
        running: _running,
        framesReceived: _framesReceived,
        eventsEmitted: _eventsEmitted,
        lastMessageTs: _lastMessageTs,
        silentMs: _lastMessageTs ? Date.now() - _lastMessageTs : 0,
        reconnectMs: _reconnectMs,
    };
}

function on(event, handler) { _emitter.on(event, handler); }
function off(event, handler) { _emitter.off(event, handler); }

function _getSubscriptionState() {
    return {
        pendingByReqId: _pendingByReqId,
        subscribedTopics: _subscribedTopics,
        failedTopics: _failedTopics,
    };
}

function _resetForTest() {
    _closing = true;
    _running = false;
    _clearTimers();
    if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
    _connected = false;
    _framesReceived = 0;
    _eventsEmitted = 0;
    _lastMessageTs = 0;
    _reconnectMs = RECONNECT_MIN_MS;
    _closing = false;
    _emitter.removeAllListeners();
    _reqIdCounter = 0;
    _pendingByReqId.clear();
    _subscribedTopics.clear();
    _failedTopics.clear();
}

module.exports = {
    start, stop,
    on, off,
    getConnectionState,
    SYMBOLS, TIMEFRAMES_BYBIT,
    _resetForTest,
    _dispatchMessage,
    _sendSubscribeBatches,
    _buildTopics,
    _chunkTopics,
    BYBIT_MAX_TOPICS_PER_MSG,
    _normalizeKline,
    _normalizeTrade,
    _normalizeBookTicker,
    _normalizeMarkPrice,
    _getSubscriptionState,
};
