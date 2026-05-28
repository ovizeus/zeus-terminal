'use strict';

// Zeus Terminal — Exchange-Level Circuit Breaker
//
// Sits ABOVE the per-endpoint/per-user circuitBreaker.js to provide a
// process-wide per-exchange CB. Existing CB protects against repeated 4xx/5xx
// for a specific (exchange, endpoint) key — but if Binance has a global
// outage hitting 5 of our users at once, those 5 per-user CBs trip
// independently and we keep hammering Binance with each new symbol/route.
// This global breaker stops the bleeding at the exchange level.
//
// Trip condition: 5 consecutive 5xx responses within a 30s sliding window.
// (Non-5xx responses reset the failure count → "consecutive" by intent.)
// Open duration: 60s. Auto-CLOSE on next canDispatch after window expires.
// Per-exchange isolation: binance trip does NOT block bybit traffic.
//
// 4xx and 429 do NOT contribute — they're client/rate-limit conditions
// handled by the existing per-endpoint backoff layer below us.

const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 30 * 1000;
const OPEN_DURATION_MS = 60 * 1000;

const _state = new Map();  // exchange → { failures: [{ts}], openUntil, state }
let _eventSink = null;

function _getOrInit(exchange) {
    if (!_state.has(exchange)) {
        _state.set(exchange, {
            failures: [],
            openUntil: 0,
            state: 'CLOSED',
        });
    }
    return _state.get(exchange);
}

function _emit(evt) {
    if (typeof _eventSink === 'function') {
        try { _eventSink(evt); } catch (_) { /* sink errors must not break callers */ }
    }
}

function setEventSink(fn) { _eventSink = fn; }

function canDispatch(exchange) {
    const s = _getOrInit(exchange);
    const now = Date.now();
    if (s.state === 'OPEN' && now >= s.openUntil) {
        // Auto-close window expired
        s.state = 'CLOSED';
        s.failures = [];
        _emit({ type: 'CB_CLOSED_AUTO', exchange, ts: now });
    }
    return s.state !== 'OPEN';
}

function recordResponse(exchange, httpStatus) {
    const s = _getOrInit(exchange);
    const now = Date.now();

    // Non-5xx → clear failure counter ("consecutive" semantics)
    if (httpStatus < 500) {
        s.failures = [];
        return;
    }

    // 5xx → prune old, then append
    s.failures = s.failures.filter(f => (now - f.ts) <= FAILURE_WINDOW_MS);
    s.failures.push({ ts: now, status: httpStatus });

    if (s.failures.length >= FAILURE_THRESHOLD && s.state !== 'OPEN') {
        s.state = 'OPEN';
        s.openUntil = now + OPEN_DURATION_MS;
        _emit({ type: 'CB_OPENED', exchange, ts: now, openUntil: s.openUntil, failures: s.failures.length });
        try {
            const audit = require('./audit');
            audit.record('EXCHANGE_CB_OPENED', {
                exchange,
                openDurationMs: OPEN_DURATION_MS,
                failures: s.failures.length,
            }, 'EXCHANGE_CB');
        } catch (_) { /* best-effort */ }
        try {
            const telegram = require('./telegram');
            telegram.sendToAll(
                '⚠️ *EXCHANGE CB OPENED* — `' + exchange + '`\n'
                + 'Paused 60s after ' + s.failures.length + ' consecutive 5xx within 30s.\n'
                + 'Dispatches will resume automatically after window.'
            );
        } catch (_) { /* best-effort */ }
    }
}

function getStatus(exchange) {
    const s = _getOrInit(exchange);
    return {
        state: s.state,
        openUntil: s.openUntil,
        recentFailures: s.failures.length,
    };
}

function _reset() {
    _state.clear();
    _eventSink = null;
}

// Test-only: force openUntil to a specific timestamp (no setter exposed in prod)
function _testSetOpenUntil(exchange, ts) {
    const s = _getOrInit(exchange);
    s.openUntil = ts;
}

// Test-only: shift all recorded failure timestamps by deltaMs (simulate sliding window)
function _testAdvanceFailureWindow(exchange, deltaMs) {
    const s = _getOrInit(exchange);
    s.failures = s.failures.map(f => ({ ts: f.ts + deltaMs, status: f.status }));
}

module.exports = {
    canDispatch,
    recordResponse,
    getStatus,
    setEventSink,
    _reset,
    _testSetOpenUntil,
    _testAdvanceFailureWindow,
};
