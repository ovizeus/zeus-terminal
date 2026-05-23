'use strict';

/**
 * OMEGA Doctor D-2.4 — Telemetry Collector.
 *
 * Hot-path interface for modules to record their own invocations. Each call
 * to recordInvocation() emits a heartbeat event to eventBus AND accumulates
 * per-module stats in memory. Stats are flushed to ml_module_heartbeats
 * every HEARTBEAT_PERSIST_INTERVAL_MS (1s).
 *
 * Why in-memory accumulation + periodic flush:
 *   - hot_path_critical modules may invoke 100s/sec
 *   - Persisting every invocation = DB write contention on hot path
 *   - Accumulate count + max latency per module, write 1 row/sec/module
 *   - = roughly 60 rows/sec across all hot_path modules combined
 *
 * Staleness check: isStale({moduleId}) returns true when last heartbeat
 * older than STALENESS_THRESHOLD_MS (30s) — matches FAILURE_ONTOLOGY
 * "Doctor missed > 30s of heartbeats" trigger for COMPROMISED state.
 *
 * Hot path budget: recordInvocation < 0.5ms p99 (test passes at 2ms slack).
 */

const { db } = require('../../database');
const eventBus = require('./eventBus');

const HEARTBEAT_PERSIST_INTERVAL_MS = 1000;
const STALENESS_THRESHOLD_MS = 30000;

// In-memory accumulator: moduleId → { count, maxLatencyMs, lastTs, anyFail }
const _stats = new Map();
let _running = false;
let _timer = null;

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`telemetryCollector: missing required field ${k}`);
    }
    return p[k];
}

function recordInvocation(params) {
    const moduleId = _required(params, 'moduleId');
    const latencyMs = _required(params, 'latencyMs');
    const ranOk = _required(params, 'ranOk');
    const ts = _required(params, 'ts');

    if (typeof latencyMs !== 'number' || latencyMs < 0) {
        throw new Error('telemetryCollector: latencyMs must be non-negative number');
    }
    if (ranOk !== 0 && ranOk !== 1) {
        throw new Error('telemetryCollector: ranOk must be 0 or 1');
    }

    // Accumulate (memory only — fast path).
    let s = _stats.get(moduleId);
    if (!s) {
        s = { count: 0, maxLatencyMs: 0, lastTs: 0, anyFail: 0 };
        _stats.set(moduleId, s);
    }
    s.count += 1;
    if (latencyMs > s.maxLatencyMs) s.maxLatencyMs = latencyMs;
    if (ts > s.lastTs) s.lastTs = ts;
    if (ranOk === 0) s.anyFail = 1;

    // Emit heartbeat event for any live subscribers (Doctor Analyzer in D-3+).
    eventBus.emit({
        eventType: 'heartbeat',
        moduleId,
        payload: { latency_ms: latencyMs, ran_ok: ranOk },
        ts
    });
}

const _insertStmt = db.prepare(`
    INSERT INTO ml_module_heartbeats
    (module_id, ts, latency_ms, ran_ok, invocation_count)
    VALUES (?, ?, ?, ?, ?)
`);

function flushNow() {
    if (_stats.size === 0) return;
    const tx = db.transaction(() => {
        for (const [moduleId, s] of _stats.entries()) {
            _insertStmt.run(
                moduleId, s.lastTs, s.maxLatencyMs,
                s.anyFail ? 0 : 1, s.count
            );
        }
    });
    tx();
    _stats.clear();
}

function getModuleStats(params) {
    const moduleId = _required(params, 'moduleId');
    const s = _stats.get(moduleId);
    if (!s) return null;
    return {
        moduleId,
        invocationCount: s.count,
        maxLatencyMs: s.maxLatencyMs,
        lastTs: s.lastTs,
        anyFail: s.anyFail
    };
}

const _stalenessStmt = db.prepare(`
    SELECT MAX(ts) AS lastTs FROM ml_module_heartbeats WHERE module_id = ?
`);

function isStale(params) {
    const moduleId = _required(params, 'moduleId');
    const nowTs = _required(params, 'nowTs');
    const row = _stalenessStmt.get(moduleId);
    if (!row || row.lastTs == null) {
        return { stale: true, lastHeartbeatTs: null };
    }
    const stale = (nowTs - row.lastTs) > STALENESS_THRESHOLD_MS;
    return { stale, lastHeartbeatTs: row.lastTs };
}

function start() {
    if (_running) return; // idempotent
    _running = true;
    _timer = setInterval(flushNow, HEARTBEAT_PERSIST_INTERVAL_MS);
    if (_timer.unref) _timer.unref();
}

function stop() {
    if (!_running) return;
    _running = false;
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
}

function resetForTest() {
    stop();
    _stats.clear();
}

module.exports = {
    HEARTBEAT_PERSIST_INTERVAL_MS, STALENESS_THRESHOLD_MS,
    recordInvocation, flushNow, getModuleStats, isStale,
    start, stop, resetForTest
};
