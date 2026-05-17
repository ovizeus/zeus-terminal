'use strict';

/**
 * OMEGA Doctor D-2.3 — Persistent Log Writer.
 *
 * Subscribes to eventBus alert/state_change/quarantine/shed_state/verdict
 * events and batches writes to ml_diagnostic_events. Heartbeats are NOT
 * persisted to this table (too high volume; Doctor Analyzer reads them
 * from ml_module_heartbeats via telemetryCollector instead).
 *
 * Architecture:
 *   - Subscribe inside start()
 *   - Queue events in memory; flush every FLUSH_INTERVAL_MS OR when queue
 *     reaches BATCH_SIZE
 *   - Use INSERT OR IGNORE for idempotent event_id (duplicate drops silently)
 *   - flushNow() exposes synchronous flush for tests and graceful shutdown
 *
 * Hot path impact: subscription handler enqueues only (no DB I/O), <0.05ms.
 */

const { db } = require('../../database');
const eventBus = require('./eventBus');

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 1000;
const PERSISTED_EVENT_TYPES = Object.freeze([
    'alert', 'state_change', 'quarantine', 'shed_state', 'verdict'
]);

let _queue = [];
let _running = false;
let _timer = null;
let _handler = null;

const _insertStmt = db.prepare(`
    INSERT OR IGNORE INTO ml_diagnostic_events
    (event_id, severity, module_id, event_type, payload_json, verdict, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function _generateEventId(event) {
    // Use payload.event_id if caller provided one (allows idempotency
    // across emits with same logical event). Otherwise generate
    // ts-modulId-counter style unique-enough id.
    if (event.payload && event.payload.event_id) return event.payload.event_id;
    return `evt-${event.ts}-${event.moduleId}-${Math.random().toString(36).slice(2, 10)}`;
}

function _onEvent(event) {
    if (!PERSISTED_EVENT_TYPES.includes(event.eventType)) return;
    _queue.push(event);
    if (_queue.length >= BATCH_SIZE) flushNow();
}

function _writeBatch(batch) {
    if (batch.length === 0) return;
    const tx = db.transaction((rows) => {
        for (const e of rows) {
            const eventId = _generateEventId(e);
            const severity = e.severity || 'P3'; // state_change may not include severity
            const verdict = e.payload && e.payload.verdict ? e.payload.verdict : null;
            _insertStmt.run(
                eventId, severity, e.moduleId, e.eventType,
                JSON.stringify(e.payload || {}), verdict, e.ts
            );
        }
    });
    tx(batch);
}

function flushNow() {
    if (_queue.length === 0) return;
    const batch = _queue;
    _queue = [];
    // Write in chunks of BATCH_SIZE to keep transactions bounded.
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        _writeBatch(batch.slice(i, i + BATCH_SIZE));
    }
}

function start() {
    if (_running) return; // idempotent — single subscription
    _running = true;
    _handler = _onEvent;
    for (const t of PERSISTED_EVENT_TYPES) {
        eventBus.subscribe(t, _handler);
    }
    _timer = setInterval(flushNow, FLUSH_INTERVAL_MS);
    if (_timer.unref) _timer.unref(); // don't block process exit
}

function stop() {
    if (!_running) return;
    _running = false;
    if (_handler) {
        for (const t of PERSISTED_EVENT_TYPES) {
            eventBus.unsubscribe(t, _handler);
        }
        _handler = null;
    }
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
}

function getQueueDepth() {
    return _queue.length;
}

function resetForTest() {
    stop();
    _queue = [];
}

module.exports = {
    BATCH_SIZE, FLUSH_INTERVAL_MS, PERSISTED_EVENT_TYPES,
    start, stop, flushNow, getQueueDepth, resetForTest
};
