'use strict';

/**
 * OMEGA R0 Substrate — ring orchestrator
 *
 * Aggregates the three substrate primitives (timeIntegrity, opsec, dr) under
 * a single ring interface conforming to the standard ring lifecycle:
 * - `init()` — called on server boot, returns health snapshot
 * - `getHealth()` — returns current ring_id + state + last_heartbeat
 * - `shutdown()` — clean shutdown, sets state OFFLINE
 *
 * Other rings consume R0 either via this orchestrator (`require('./R0_substrate').monotonicNow()`)
 * or by direct module require for explicit dependency tracking — both paths
 * are supported. The R7 event bus + ml_ring_health table consume this
 * interface for cross-ring observability.
 */

const timeIntegrity = require('./timeIntegrity');
const opsec = require('./opsec');
const dr = require('./dr');

const RING_ID = 'R0';

let _state = 'OFFLINE';
let _lastHeartbeat = 0;

function init() {
    _state = 'INITIALIZING';
    _lastHeartbeat = Date.now();
    // Substrate has no async setup; transition straight to OK.
    _state = 'OK';
    return getHealth();
}

function getHealth() {
    return {
        ring_id: RING_ID,
        state: _state,
        last_heartbeat: _lastHeartbeat,
        last_updated_at: Date.now()
    };
}

function shutdown() {
    _state = 'OFFLINE';
    _lastHeartbeat = Date.now();
}

module.exports = {
    // Ring lifecycle
    RING_ID,
    init,
    getHealth,
    shutdown,
    // Re-exports from primitives
    monotonicNow: timeIntegrity.monotonicNow,
    detectTimeSkew: timeIntegrity.detectTimeSkew,
    validateTimestamp: timeIntegrity.validateTimestamp,
    MAX_SKEW_MS: timeIntegrity.MAX_SKEW_MS,
    redactSecret: opsec.redactSecret,
    signPayload: opsec.signPayload,
    validateSignature: opsec.validateSignature,
    REDACTION_PLACEHOLDER: opsec.REDACTION_PLACEHOLDER,
    saveSnapshot: dr.saveSnapshot,
    loadSnapshot: dr.loadSnapshot,
    listSnapshots: dr.listSnapshots,
    integrityCheck: dr.integrityCheck,
    deleteSnapshot: dr.deleteSnapshot,
    SNAPSHOTS_DIR: dr.SNAPSHOTS_DIR
};
