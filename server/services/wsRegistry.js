'use strict';

// ═══════════════════════════════════════════════════════════════════
// WebSocket Registry — 1 stream = 1 WS = N subscribers (multiplexing).
// Prevents duplicate WS connections to same exchange stream.
// Tracks: exchange, stream name, subscriber count, health.
//
// Usage: subscribe('binance', 'btcusdt@trade', handler) → subscriberId
//        unsubscribe(subscriberId)
//        status() → all active streams
// ═══════════════════════════════════════════════════════════════════

let _nextSubId = 1;
const _streams = new Map();     // 'exchange:stream' → { exchange, stream, subscribers: Map(id→handler), createdAt, lastMsgAt, msgCount, reconnectCount }
const _subToStream = new Map(); // subscriberId → 'exchange:stream'

const RECONNECT_JITTER_MAX_MS = 5000;
const DEAD_THRESHOLD_MS = 120000; // 2 min no messages = dead

function _key(exchange, stream) { return `${exchange}:${stream}`; }

function _jitter() { return Math.floor(Math.random() * RECONNECT_JITTER_MAX_MS); }

function subscribe(exchange, stream, handler) {
    if (!exchange || !stream || typeof handler !== 'function') return null;

    const key = _key(exchange, stream);
    if (!_streams.has(key)) {
        _streams.set(key, {
            exchange,
            stream,
            subscribers: new Map(),
            createdAt: Date.now(),
            lastMsgAt: 0,
            msgCount: 0,
            reconnectCount: 0,
        });
    }

    const entry = _streams.get(key);
    const subId = _nextSubId++;
    entry.subscribers.set(subId, handler);
    _subToStream.set(subId, key);

    return subId;
}

function unsubscribe(subscriberId) {
    const key = _subToStream.get(subscriberId);
    if (!key) return false;

    const entry = _streams.get(key);
    if (entry) {
        entry.subscribers.delete(subscriberId);
        // Remove stream entirely if no subscribers left
        if (entry.subscribers.size === 0) _streams.delete(key);
    }
    _subToStream.delete(subscriberId);
    return true;
}

function dispatch(exchange, stream, data) {
    const key = _key(exchange, stream);
    const entry = _streams.get(key);
    if (!entry) return 0;

    entry.lastMsgAt = Date.now();
    entry.msgCount++;

    let dispatched = 0;
    for (const [, handler] of entry.subscribers) {
        try { handler(data); dispatched++; } catch (_) {}
    }
    return dispatched;
}

function recordReconnect(exchange, stream) {
    const key = _key(exchange, stream);
    const entry = _streams.get(key);
    if (entry) entry.reconnectCount++;
}

function getReconnectDelay(exchange, stream) {
    const key = _key(exchange, stream);
    const entry = _streams.get(key);
    const count = entry ? entry.reconnectCount : 0;
    const base = Math.min(1000 * Math.pow(2, count), 30000);
    return base + _jitter();
}

function isStreamActive(exchange, stream) {
    const key = _key(exchange, stream);
    return _streams.has(key);
}

function isStreamDead(exchange, stream) {
    const key = _key(exchange, stream);
    const entry = _streams.get(key);
    if (!entry) return true;
    if (entry.lastMsgAt === 0) return false; // never received = just created
    return (Date.now() - entry.lastMsgAt) > DEAD_THRESHOLD_MS;
}

function subscriberCount(exchange, stream) {
    const key = _key(exchange, stream);
    const entry = _streams.get(key);
    return entry ? entry.subscribers.size : 0;
}

function status() {
    const result = [];
    for (const [key, entry] of _streams) {
        result.push({
            key,
            exchange: entry.exchange,
            stream: entry.stream,
            subscribers: entry.subscribers.size,
            createdAt: entry.createdAt,
            lastMsgAt: entry.lastMsgAt,
            msgCount: entry.msgCount,
            reconnectCount: entry.reconnectCount,
            dead: entry.lastMsgAt > 0 && (Date.now() - entry.lastMsgAt) > DEAD_THRESHOLD_MS,
            ageMs: Date.now() - entry.createdAt,
        });
    }
    return result;
}

function activeStreamCount() { return _streams.size; }

function _resetForTest() {
    if (process.env.NODE_ENV !== 'test') return;
    _streams.clear(); _subToStream.clear(); _nextSubId = 1;
}

module.exports = {
    subscribe, unsubscribe, dispatch, recordReconnect, getReconnectDelay,
    isStreamActive, isStreamDead, subscriberCount, status, activeStreamCount,
    _resetForTest, RECONNECT_JITTER_MAX_MS, DEAD_THRESHOLD_MS,
};
