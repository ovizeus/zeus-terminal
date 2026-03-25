// Zeus Terminal — Metrics Collector
// Tracks runtime metrics: uptime, latency, order counts, errors
// Exposed via GET /api/metrics (read-only)
'use strict';

const fs = require('fs');
const path = require('path');
const METRICS_FILE = path.join(__dirname, '..', '..', 'data', 'metrics_snapshot.json');

const _startTime = Date.now();
const _metrics = {
    orders: { placed: 0, filled: 0, failed: 0, blocked: 0 },
    latency: { binanceLast: 0, binanceAvg: 0, _recent: [] },
    errors: { total: 0, last: null },
    reconciliation: { runs: 0, mismatches: 0, lastRun: null },
};

// [C6] Restore metrics from previous session on boot
// [B4] Use = (replace) not += (cumulative) to prevent inflation on restart loops
let _metricsRestored = false;
function _restoreMetrics() {
    if (_metricsRestored) return; // guard: never restore twice
    _metricsRestored = true;
    try {
        if (!fs.existsSync(METRICS_FILE)) return;
        const snap = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
        if (snap.orders) {
            _metrics.orders.placed = snap.orders.placed || 0;
            _metrics.orders.filled = snap.orders.filled || 0;
            _metrics.orders.failed = snap.orders.failed || 0;
            _metrics.orders.blocked = snap.orders.blocked || 0;
        }
        if (snap.errors) {
            _metrics.errors.total = snap.errors.total || 0;
            if (snap.errors.last) _metrics.errors.last = snap.errors.last;
        }
        if (snap.reconciliation) {
            _metrics.reconciliation.runs = snap.reconciliation.runs || 0;
            _metrics.reconciliation.mismatches = snap.reconciliation.mismatches || 0;
            if (snap.reconciliation.lastRun) _metrics.reconciliation.lastRun = snap.reconciliation.lastRun;
        }
        console.log('[METRICS] Restored from snapshot:', snap.orders?.placed || 0, 'orders,', snap.errors?.total || 0, 'errors');
    } catch (_) { }
}

// [C6] Save metrics snapshot to disk
function saveSnapshot() {
    try {
        const snap = {
            ts: new Date().toISOString(),
            orders: { ..._metrics.orders },
            errors: { total: _metrics.errors.total, last: _metrics.errors.last },
            reconciliation: { ..._metrics.reconciliation },
        };
        const tmp = METRICS_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(snap, null, 2));
        fs.renameSync(tmp, METRICS_FILE);
    } catch (_) { }
}

_restoreMetrics();

function recordOrder(outcome) {
    if (outcome === 'filled') _metrics.orders.filled++;
    else if (outcome === 'failed') _metrics.orders.failed++;
    else if (outcome === 'blocked') _metrics.orders.blocked++;
    _metrics.orders.placed++;
}

function recordLatency(ms) {
    _metrics.latency.binanceLast = Math.round(ms);
    const r = _metrics.latency._recent;
    r.push(ms);
    if (r.length > 100) r.shift();
    _metrics.latency.binanceAvg = Math.round(r.reduce((a, b) => a + b, 0) / r.length);
}

function recordError(message) {
    _metrics.errors.total++;
    _metrics.errors.last = { ts: new Date().toISOString(), msg: message };
}

function recordReconciliation(ok) {
    _metrics.reconciliation.runs++;
    if (!ok) _metrics.reconciliation.mismatches++;
    _metrics.reconciliation.lastRun = new Date().toISOString();
}

function getMetrics() {
    const mem = process.memoryUsage();
    return {
        uptime: Math.round((Date.now() - _startTime) / 1000),
        uptimeHuman: _formatUptime(Date.now() - _startTime),
        memory: {
            rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB',
        },
        orders: { ..._metrics.orders },
        latency: {
            binanceLast: _metrics.latency.binanceLast + 'ms',
            binanceAvg: _metrics.latency.binanceAvg + 'ms',
        },
        errors: { ..._metrics.errors },
        reconciliation: { ..._metrics.reconciliation },
        nodeVersion: process.version,
        startTime: new Date(_startTime).toISOString(),
    };
}

function _formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h + 'h ' + m + 'm ' + (s % 60) + 's';
}

module.exports = { recordOrder, recordLatency, recordError, recordReconciliation, getMetrics, saveSnapshot };

// [C6] Periodic save every 5 min + save on shutdown
setInterval(saveSnapshot, 5 * 60 * 1000);
process.on('SIGTERM', () => { saveSnapshot(); });
process.on('SIGINT', () => { saveSnapshot(); });
