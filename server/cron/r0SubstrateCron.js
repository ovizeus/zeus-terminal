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

function _tick() {
    try {
        const dr = require('../services/ml/R0_substrate/disasterRecoveryOrchestrator');
        dr.recordHeartbeat({ nodeId: NODE_ID, role: 'PRIMARY', actor: 'r0SubstrateCron' });
    } catch (_) { /* never crash cron on DR telemetry */ }
}

function schedule() {
    if (_timer) return;
    _timer = setInterval(_tick, HEARTBEAT_INTERVAL_MS);
    setTimeout(_tick, 5000); // first tick after 5s
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { schedule, stop, _tick, NODE_ID };
