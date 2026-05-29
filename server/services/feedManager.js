'use strict';

/**
 * feedManager — Routes WS feed access per user + manages lifecycle.
 *
 * Refcounted: each (user, exchange) increments refcount. Feed starts on first
 * ref, stops after grace period when last ref released. Multiple users on
 * different exchanges run feeds concurrently.
 *
 * Used by:
 *   - serverBrain._runCycle: getFeedForUser(uid) to read user's active feed
 *   - routes/exchange.js: activateForUser on /api/exchange/save success
 *                         deactivateForUser on /api/exchange/disconnect
 *   - serverBrain _applyPendingSwitches: activate/deactivate during switch
 */

const GRACE_MS = 30_000;

const _refcounts = { binance: 0, bybit: 0 };
const _userExchange = new Map();  // uid → 'binance' | 'bybit'
const _graceTimers = {};

function _getFeed(exchange) {
    if (exchange === 'binance') return require('./marketFeed');
    if (exchange === 'bybit') return require('./bybitFeed');
    throw new Error(`feedManager: unknown exchange ${exchange}`);
}

function _startFeed(exchange) {
    try {
        const feed = _getFeed(exchange);
        if (typeof feed.start === 'function') feed.start();
        try { require('./logger').info('FEED_MANAGER', `feed started: ${exchange}`); } catch (_) {}
    } catch (err) {
        try { require('./logger').error('FEED_MANAGER', `start ${exchange} failed: ${err.message}`); } catch (_) {}
    }
}

function _stopFeed(exchange) {
    try {
        const feed = _getFeed(exchange);
        if (typeof feed.stop === 'function') feed.stop();
        try { require('./logger').info('FEED_MANAGER', `feed stopped: ${exchange}`); } catch (_) {}
    } catch (_) {}
}

function _cancelGrace(exchange) {
    if (_graceTimers[exchange]) {
        clearTimeout(_graceTimers[exchange]);
        delete _graceTimers[exchange];
    }
}

function _scheduleGrace(exchange) {
    _cancelGrace(exchange);
    _graceTimers[exchange] = setTimeout(() => {
        if (_refcounts[exchange] === 0) _stopFeed(exchange);
        delete _graceTimers[exchange];
    }, GRACE_MS);
    if (_graceTimers[exchange].unref) _graceTimers[exchange].unref();
}

function activateForUser(uid, exchange) {
    if (!Object.prototype.hasOwnProperty.call(_refcounts, exchange)) {
        throw new Error(`feedManager: unknown exchange ${exchange}`);
    }
    if (_userExchange.get(uid) === exchange) return; // already active on this exchange

    const prev = _userExchange.get(uid);
    if (prev && prev !== exchange) {
        deactivateForUser(uid, prev);
    }

    const wasZero = _refcounts[exchange] === 0;
    _refcounts[exchange]++;
    _userExchange.set(uid, exchange);
    _cancelGrace(exchange);

    if (wasZero) _startFeed(exchange);
}

function deactivateForUser(uid, exchange) {
    if (_userExchange.get(uid) !== exchange) return;
    _refcounts[exchange]--;
    _userExchange.delete(uid);

    if (_refcounts[exchange] <= 0) {
        _refcounts[exchange] = 0;
        _scheduleGrace(exchange);
    }
}

function getFeedForUser(uid) {
    const exchange = _userExchange.get(uid);
    if (!exchange) return null;
    return _getFeed(exchange);
}

function getUserExchange(uid) {
    return _userExchange.get(uid) || null;
}

function getRefcount(exchange) {
    return _refcounts[exchange] || 0;
}

function getActiveExchanges() {
    return Object.keys(_refcounts).filter(ex => _refcounts[ex] > 0);
}

// [Phase B / Task B1.2] Stop ALL feeds (regardless of refcount) for graceful
// shutdown. Without this, the dying process never closes its feed WS → the close
// fires with _closing=false → reconnect attempts flap during teardown, producing
// the restart-boundary connection storm. Calling each feed.stop() sets _closing=true
// so the close is clean and silent (no reconnect).
function stopAll() {
    for (const ex of Object.keys(_refcounts)) {
        _cancelGrace(ex);
        _stopFeed(ex);
        _refcounts[ex] = 0;
    }
    _userExchange.clear();
}

function _resetForTest() {
    _refcounts.binance = 0;
    _refcounts.bybit = 0;
    _userExchange.clear();
    for (const ex of Object.keys(_graceTimers)) _cancelGrace(ex);
}

module.exports = {
    activateForUser, deactivateForUser,
    getFeedForUser, getUserExchange, getRefcount, getActiveExchanges,
    stopAll,
    _resetForTest, GRACE_MS
};
