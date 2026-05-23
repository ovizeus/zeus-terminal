'use strict';

/**
 * OMEGA Doctor D-2.2 — Typed Event Bus + Ring Buffer.
 *
 * Hot-path-safe event distribution: emit budget < 0.5ms p99. Modules call
 * emit() synchronously; persistence is async via persistentLogWriter
 * (D-2.3) which subscribes to the bus.
 *
 * Ring buffer holds the last 10K events in memory for forensic replay
 * + Doctor Analyzer queries without DB round-trip.
 *
 * Per OMEGA Failure Ontology: severities map to ml_diagnostic_events.severity.
 */

const EVENT_TYPES = Object.freeze([
    'heartbeat',     // periodic per-module liveness ping
    'alert',         // severity-classified anomaly (P0..P3 / P0-FLOOD)
    'quarantine',    // module clamped or restored
    'shed_state',    // cognitive load shed level changed
    'state_change',  // OMEGA cognitive state transitioned (per ontology)
    'verdict'        // post-hoc operator verdict on prior alert
]);

const SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3', 'P0-FLOOD']);
const RING_BUFFER_SIZE = 10000;

const _subscribers = new Map();  // eventType → Set<handler>
const _ring = [];

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`eventBus.emit: missing required field ${k}`);
    }
    return p[k];
}

function emit(event) {
    const eventType = _required(event, 'eventType');
    const moduleId = _required(event, 'moduleId');
    const ts = _required(event, 'ts');

    if (!EVENT_TYPES.includes(eventType)) {
        throw new Error(`eventBus.emit: unknown eventType '${eventType}'`);
    }
    if (event.severity != null && !SEVERITIES.includes(event.severity)) {
        throw new Error(`eventBus.emit: invalid severity '${event.severity}'`);
    }
    if (eventType === 'alert' && event.severity == null) {
        throw new Error(`eventBus.emit: alert requires severity`);
    }

    // Ring buffer append + bounded eviction (FIFO).
    _ring.push(event);
    if (_ring.length > RING_BUFFER_SIZE) {
        // Drop oldest (slice is O(n) but n is bounded; for hot path
        // we use _ring.shift() which is O(n) too but on small bound it's fine).
        // For higher perf we'd switch to a fixed-size circular index, but at
        // current scale (10K events × ~10K ev/min = ~6s window) this is OK.
        _ring.splice(0, _ring.length - RING_BUFFER_SIZE);
    }

    // Synchronous dispatch to subscribers. Handlers MUST be fast (<0.1ms each).
    const handlers = _subscribers.get(eventType);
    if (handlers) {
        for (const h of handlers) {
            try {
                h(event);
            } catch (err) {
                // Never propagate subscriber errors — emit must remain hot-path-safe.
                // Log to console only; in D-3+ this becomes a P2 self-alert.
                if (typeof console !== 'undefined' && console.error) {
                    console.error('[eventBus] subscriber error:', err.message);
                }
            }
        }
    }
}

function subscribe(eventType, handler) {
    if (!EVENT_TYPES.includes(eventType)) {
        throw new Error(`eventBus.subscribe: unknown eventType '${eventType}'`);
    }
    if (typeof handler !== 'function') {
        throw new Error(`eventBus.subscribe: handler must be function`);
    }
    if (!_subscribers.has(eventType)) _subscribers.set(eventType, new Set());
    _subscribers.get(eventType).add(handler);
}

function unsubscribe(eventType, handler) {
    const set = _subscribers.get(eventType);
    if (set) set.delete(handler);
}

function getRingSnapshot() {
    // Return a copy so callers cannot mutate internal ring state.
    return _ring.slice();
}

function resetForTest() {
    _subscribers.clear();
    _ring.length = 0;
}

module.exports = {
    EVENT_TYPES, SEVERITIES, RING_BUFFER_SIZE,
    emit, subscribe, unsubscribe, getRingSnapshot, resetForTest
};
