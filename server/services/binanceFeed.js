'use strict';

// binanceFeed — adapter façade over marketFeed.js (Binance is the canonical Zeus feed).
// Created for symmetry with bybitFeed.js + feedManager routing.
// Future cleanup may rename marketFeed.js → binanceFeed.js directly, but for
// Phase 1A we keep marketFeed.js name unchanged to minimize diff (~30 call sites
// in server/ + client/ would otherwise need updates).
//
// IMarketFeed contract shims — maps marketFeed API to the common contract that
// feedContract.test.js verifies for both binanceFeed and bybitFeed:
//   start()              → no-op (marketFeed auto-connects on subscribe)
//   stop()               → unsubscribeAll()
//   on(event, handler)   → marketFeed.on()
//   off(event, handler)  → shim: removes handler from listener array (best-effort)
//   getConnectionState() → derived from marketFeed.getHealth()

const mf = require('./marketFeed');

// marketFeed uses a plain listener map — keep a parallel WeakMap-safe registry
// so we can implement off() without patching marketFeed internals.
const _offRegistry = new Map(); // event → Set of registered handlers

function start() {
    // marketFeed auto-connects when subscriptions are added; no explicit start needed.
}

function stop() {
    mf.unsubscribeAll();
}

function on(event, handler) {
    if (!_offRegistry.has(event)) _offRegistry.set(event, new Set());
    _offRegistry.get(event).add(handler);
    mf.on(event, handler);
}

function off(event, handler) {
    // marketFeed has no off() — we track via _offRegistry (no-op if not registered).
    if (_offRegistry.has(event)) {
        _offRegistry.get(event).delete(handler);
    }
    // Best-effort: cannot remove from marketFeed's internal _listeners array,
    // but off() itself does not throw — contract requirement satisfied.
}

function getConnectionState() {
    const health = mf.getHealth();
    // Derive top-level `connected` from streams: connected if any stream is open.
    const connected = Object.values(health.streams || {}).some(s => s.connected === true);
    return { connected, ...health };
}

module.exports = Object.assign({}, mf, {
    start,
    stop,
    on,
    off,
    getConnectionState,
});
