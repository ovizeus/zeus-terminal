'use strict';

/**
 * r0SubstrateCron.js — Wave 1 Task 5
 *
 * Calls disasterRecoveryOrchestrator.recordHeartbeat() every 60s so
 * the ml_dr_state table has a live heartbeat trail for the primary node.
 *
 * Boot wiring: call schedule() from server.js after server.listen().
 * Pattern mirrors omegaMemoryCleanup.js — no external cron library.
 */

const NODE_ID = 'zeus-primary';
const HEARTBEAT_INTERVAL_MS = 60000; // 60s

let _timer = null;

// [2026-10-09 audit C2] A failed heartbeat used to vanish into an empty catch,
// which is the worst case: the DR state keeps looking maintained while nothing
// is maintaining it. Successes stay silent — one line a minute is noise — and
// failures are reported, throttled so a persistent fault reports periodically
// rather than once every 60 seconds.
const _FAIL_LOG_EVERY = 5;
let _consecutiveFailures = 0;

function _tick() {
    try {
        const dr = require('../services/ml/R0_substrate/disasterRecoveryOrchestrator');
        dr.recordHeartbeat({ nodeId: NODE_ID, role: 'PRIMARY', actor: 'r0SubstrateCron' });
        _consecutiveFailures = 0;
    } catch (err) {
        _consecutiveFailures++;
        if (_consecutiveFailures === 1 || _consecutiveFailures % _FAIL_LOG_EVERY === 0) {
            try {
                require('../services/logger').warn('R0_SUBSTRATE',
                    `DR heartbeat failed (${_consecutiveFailures} in a row): ${err.message}`);
            } catch (_) { /* logging must never crash the cron */ }
        }
    }
}

function schedule() {
    if (_timer) return;
    _timer = setInterval(_tick, HEARTBEAT_INTERVAL_MS);
    setTimeout(_tick, 5000); // first tick after 5s
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { schedule, stop, _tick, NODE_ID, _resetForTest: () => { _consecutiveFailures = 0; } };
