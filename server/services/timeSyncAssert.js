'use strict';

/**
 * timeSyncAssert — Detect NTP drift that breaks signed exchange requests.
 *
 * Bybit + Binance both have strict recvWindow (5000ms default). If server
 * clock drifts >500ms vs exchange time, signed requests fail with
 * 'Timestamp outside recvWindow'.
 *
 * Periodic check (5min): fetch /fapi/v1/time, compare to local clock.
 * Drift > THRESHOLD_MS → Telegram CRITICAL alert + audit_log entry.
 * Re-alert cooldown 30min to avoid spam.
 */

const THRESHOLD_MS = 500;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REALERT_COOLDOWN_MS = 30 * 60 * 1000;

function checkDrift(localMs, serverMs) {
    const drift = serverMs - localMs;
    return {
        ok: Math.abs(drift) <= THRESHOLD_MS,
        drift,
        threshold: THRESHOLD_MS
    };
}

let _timer = null;
let _lastCheckTs = 0;
let _lastDrift = 0;
let _alertedAt = 0;

async function _runCheck() {
    _lastCheckTs = Date.now();
    try {
        // Use global fetch (Node 18+) or fall back to node-fetch
        const _fetch = (typeof globalThis.fetch === 'function') ? globalThis.fetch : require('node-fetch');
        const resp = await _fetch('https://fapi.binance.com/fapi/v1/time', { signal: AbortSignal.timeout(5000) });
        const json = await resp.json();
        if (json && typeof json.serverTime === 'number') {
            const drift = json.serverTime - Date.now();
            _lastDrift = drift;
            if (Math.abs(drift) > THRESHOLD_MS) {
                const now = Date.now();
                if (now - _alertedAt > REALERT_COOLDOWN_MS) {
                    _alertedAt = now;
                    try { require('./logger').error('TIME_SYNC', `Drift detected: ${drift}ms (threshold ${THRESHOLD_MS}ms)`); } catch (_) {}
                    try {
                        require('./telegram').alertCritical(null,
                            `🚨 NTP drift: ${drift}ms vs Binance. ` +
                            `Trading may fail signed requests. Check /etc/systemd-timesyncd.`);
                    } catch (_) {}
                    try {
                        require('./database').db.prepare(
                            `INSERT INTO audit_log (user_id, action, details, created_at) VALUES (?, ?, ?, datetime('now'))`
                        ).run(null, 'TIME_SYNC_DRIFT_DETECTED', JSON.stringify({ drift, threshold: THRESHOLD_MS }));
                    } catch (_) {}
                }
            }
        }
    } catch (err) {
        try { require('./logger').warn('TIME_SYNC', `Check failed: ${err.message}`); } catch (_) {}
    }
}

function start() {
    if (_timer) return;
    _runCheck();
    _timer = setInterval(_runCheck, CHECK_INTERVAL_MS);
    if (_timer.unref) _timer.unref();
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

function getStatus() {
    return {
        lastCheckTs: _lastCheckTs,
        lastDrift: _lastDrift,
        threshold: THRESHOLD_MS,
        ok: Math.abs(_lastDrift) <= THRESHOLD_MS
    };
}

module.exports = {
    THRESHOLD_MS,
    CHECK_INTERVAL_MS,
    REALERT_COOLDOWN_MS,
    checkDrift,
    start,
    stop,
    getStatus
};
