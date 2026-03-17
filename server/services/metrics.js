// Zeus Terminal — Metrics Collector
// Tracks runtime metrics: uptime, latency, order counts, errors
// Exposed via GET /api/metrics (read-only)
'use strict';

const _startTime = Date.now();
const _metrics = {
    orders: { placed: 0, filled: 0, failed: 0, blocked: 0 },
    latency: { binanceLast: 0, binanceAvg: 0, _binanceTotal: 0, _binanceCount: 0 },
    errors: { total: 0, last: null },
    reconciliation: { runs: 0, mismatches: 0, lastRun: null },
};

function recordOrder(outcome) {
    if (outcome === 'filled') _metrics.orders.filled++;
    else if (outcome === 'failed') _metrics.orders.failed++;
    else if (outcome === 'blocked') _metrics.orders.blocked++;
    _metrics.orders.placed++;
}

function recordLatency(ms) {
    _metrics.latency.binanceLast = Math.round(ms);
    _metrics.latency._binanceTotal += ms;
    _metrics.latency._binanceCount++;
    _metrics.latency.binanceAvg = Math.round(_metrics.latency._binanceTotal / _metrics.latency._binanceCount);
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

module.exports = { recordOrder, recordLatency, recordError, recordReconciliation, getMetrics };
