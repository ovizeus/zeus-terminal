'use strict';

// ═══════════════════════════════════════════════════════════════════
// Circuit Breaker — per-exchange, per-endpoint halt on failures.
// States: CLOSED (normal) → OPEN (all blocked) → HALF_OPEN (probe)
//
// HTTP 429 → exponential backoff + jitter
// HTTP 418 → IP BAN — long halt + alert
// HTTP 5xx → negative cache 5s
// Timeout  → soft fail, after 3 → OPEN
// ═══════════════════════════════════════════════════════════════════

const STATES = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const JITTER_MAX_MS = 5000;
const FAILURE_THRESHOLD = 3;        // failures before OPEN
const HALF_OPEN_AFTER_MS = 30000;   // try probe after 30s
const BAN_418_HALT_MS = 600000;     // 10 min halt on 418
const NEGATIVE_CACHE_MS = 5000;     // 5xx → block 5s

const _circuits = new Map(); // 'exchange:endpoint' → { state, failures, lastFailTs, openUntil, backoffMs }

function _key(exchange, endpoint) { return `${exchange}:${endpoint || 'default'}`; }

function _getCircuit(exchange, endpoint) {
    const k = _key(exchange, endpoint);
    if (!_circuits.has(k)) {
        _circuits.set(k, {
            state: STATES.CLOSED,
            failures: 0,
            lastFailTs: 0,
            openUntil: 0,
            backoffMs: BASE_BACKOFF_MS,
            lastStatus: null,
        });
    }
    return _circuits.get(k);
}

function _jitter() { return Math.floor(Math.random() * JITTER_MAX_MS); }

function record(exchange, endpoint, httpStatus) {
    const c = _getCircuit(exchange, endpoint);
    c.lastStatus = httpStatus;

    if (httpStatus >= 200 && httpStatus < 400) {
        // Success → reset
        c.failures = 0;
        c.backoffMs = BASE_BACKOFF_MS;
        if (c.state === STATES.HALF_OPEN) c.state = STATES.CLOSED;
        return { state: c.state, action: 'success_reset' };
    }

    if (httpStatus === 418) {
        // IP BAN — hard halt
        c.state = STATES.OPEN;
        c.openUntil = Date.now() + BAN_418_HALT_MS + _jitter();
        c.failures++;
        c.lastFailTs = Date.now();
        try { console.log(JSON.stringify({ _t: 'CIRCUIT', event: 'ip_ban_418', exchange, endpoint, haltUntil: new Date(c.openUntil).toISOString() })); } catch (_) {}
        return { state: STATES.OPEN, action: 'ip_ban_halt', haltMs: BAN_418_HALT_MS };
    }

    if (httpStatus === 429) {
        // Rate limit — exponential backoff
        c.failures++;
        c.backoffMs = Math.min(c.backoffMs * 2, MAX_BACKOFF_MS);
        c.openUntil = Date.now() + c.backoffMs + _jitter();
        c.state = STATES.OPEN;
        c.lastFailTs = Date.now();
        return { state: STATES.OPEN, action: 'rate_limit_backoff', backoffMs: c.backoffMs };
    }

    if (httpStatus >= 500) {
        // Server error — negative cache
        c.failures++;
        c.openUntil = Date.now() + NEGATIVE_CACHE_MS;
        if (c.failures >= FAILURE_THRESHOLD) c.state = STATES.OPEN;
        c.lastFailTs = Date.now();
        return { state: c.state, action: 'server_error', negCacheMs: NEGATIVE_CACHE_MS };
    }

    if (httpStatus === 0) {
        // Timeout / network error
        c.failures++;
        if (c.failures >= FAILURE_THRESHOLD) {
            c.state = STATES.OPEN;
            c.openUntil = Date.now() + c.backoffMs + _jitter();
            c.backoffMs = Math.min(c.backoffMs * 2, MAX_BACKOFF_MS);
        }
        c.lastFailTs = Date.now();
        return { state: c.state, action: 'timeout', failures: c.failures };
    }

    return { state: c.state, action: 'unknown_status' };
}

function canRequest(exchange, endpoint) {
    const c = _getCircuit(exchange, endpoint);
    const now = Date.now();

    if (c.state === STATES.CLOSED) return true;

    if (c.state === STATES.OPEN) {
        if (now >= c.openUntil) {
            c.state = STATES.HALF_OPEN;
            return true; // allow probe
        }
        return false; // still halted
    }

    if (c.state === STATES.HALF_OPEN) return true; // allow probe

    return true;
}

function getBackoffMs(exchange, endpoint) {
    const c = _getCircuit(exchange, endpoint);
    if (c.state === STATES.OPEN) {
        const remaining = c.openUntil - Date.now();
        return remaining > 0 ? remaining : 0;
    }
    return 0;
}

function status(exchange, endpoint) {
    const c = _getCircuit(exchange, endpoint);
    return {
        key: _key(exchange, endpoint),
        state: c.state,
        failures: c.failures,
        backoffMs: c.backoffMs,
        openUntil: c.openUntil,
        remainingMs: Math.max(0, c.openUntil - Date.now()),
        lastStatus: c.lastStatus,
        lastFailTs: c.lastFailTs,
    };
}

function statusAll() {
    const result = {};
    for (const [key, c] of _circuits) {
        result[key] = {
            state: c.state,
            failures: c.failures,
            remainingMs: Math.max(0, c.openUntil - Date.now()),
            lastStatus: c.lastStatus,
        };
    }
    return result;
}

function _resetForTest() {
    if (process.env.NODE_ENV !== 'test') return;
    _circuits.clear();
}

module.exports = {
    STATES, record, canRequest, getBackoffMs, status, statusAll, _resetForTest,
    FAILURE_THRESHOLD, BAN_418_HALT_MS, NEGATIVE_CACHE_MS,
};
