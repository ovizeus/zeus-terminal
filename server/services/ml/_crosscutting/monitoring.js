'use strict';

/**
 * OMEGA Cross-cutting — monitoring (canonical §35)
 *
 * §35 MONITORING, LOGGING SI KPI DASHBOARDS.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1358-1384.
 *
 * Mandatory logging (lines 1358-1371): 13 event types covering full decision
 * lifecycle (decision_log, raw_features, detector_score, meta_score,
 * execution_event, fill, pnl, slippage, latency, reconciliation_status,
 * drift_status, veto_reason, explainability_snapshot).
 *
 * Dashboard KPIs (lines 1373-1384): 11 KPI keys for operator visibility.
 *
 * Architecture: cross-cutting foundation. ANY ring (R0-R6 + Operator +
 * Cross-cutting) emits observability via recordEvent / recordKpi. Uniform
 * pipe — closes OBS-4 alert channel concern.
 *
 * Composability:
 *   - all rings emit via recordEvent / recordKpi
 *   - §25 explainability emits explainability_snapshot events
 *   - §17 regime metrics aggregates → recordKpi
 *   - §21 drift detection → recordEvent(drift_status)
 *   - §28 position recon → recordEvent(reconciliation_status)
 *   - §14 veto evaluator → recordEvent(veto_reason)
 */

const { db } = require('../../database');

const EVENT_TYPES = Object.freeze([
    'decision_log',
    'raw_features',
    'detector_score',
    'meta_score',
    'execution_event',
    'fill',
    'pnl',
    'slippage',
    'latency',
    'reconciliation_status',
    'drift_status',
    'veto_reason',
    'explainability_snapshot'
]);

const KPI_KEYS = Object.freeze([
    'kpi_per_regime',
    'pnl_per_regime',
    'hit_rate_per_regime',
    'avg_rr',
    'avg_slippage',
    'avg_latency',
    'fill_quality',
    'confidence_calibration',
    'drift_monitor',
    'false_breakout_monitor',
    'venue_divergence_monitor'
]);

const AGGREGATION_PERIODS = Object.freeze(['minute', 'hour', 'day', 'week']);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`monitoring: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertEvent: db.prepare(`
        INSERT INTO ml_observability_events
        (user_id, resolved_env, event_type, payload_json, regime, pos_id, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    insertKpi: db.prepare(`
        INSERT INTO ml_kpi_snapshots
        (user_id, resolved_env, kpi, value, regime, ts)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    listEvents: db.prepare(`
        SELECT * FROM ml_observability_events
        WHERE user_id = ? AND resolved_env = ?
          AND (? IS NULL OR event_type = ?)
          AND ts >= ?
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `),
    listKpis: db.prepare(`
        SELECT * FROM ml_kpi_snapshots
        WHERE user_id = ? AND resolved_env = ?
          AND (? IS NULL OR regime = ?)
          AND ts >= ?
        ORDER BY ts ASC, id ASC
    `)
};

// ── recordEvent ────────────────────────────────────────────────────
function recordEvent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const eventType = _required(params, 'eventType');
    const payload = _required(params, 'payload');
    const regime = (params && params.regime) ? params.regime : null;
    const posId = (params && params.posId) ? params.posId : null;
    const ts = (params && typeof params.ts === 'number') ? params.ts : Date.now();

    if (!EVENT_TYPES.includes(eventType)) {
        throw new Error(`monitoring: invalid eventType "${eventType}"`);
    }

    _stmts.insertEvent.run(
        userId, env, eventType,
        JSON.stringify(payload),
        regime, posId, ts
    );

    return { recorded: true };
}

// ── recordKpi ──────────────────────────────────────────────────────
function recordKpi(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kpi = _required(params, 'kpi');
    const value = _required(params, 'value');
    const regime = (params && params.regime) ? params.regime : null;
    const ts = (params && typeof params.ts === 'number') ? params.ts : Date.now();

    if (!KPI_KEYS.includes(kpi)) {
        throw new Error(`monitoring: invalid kpi "${kpi}"`);
    }

    _stmts.insertKpi.run(userId, env, kpi, value, regime, ts);
    return { recorded: true };
}

// ── getKpiDashboard ────────────────────────────────────────────────
function getKpiDashboard(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const regime = (params && params.regime) ? params.regime : null;
    const since = (params && params.since) ? params.since : 0;
    const kpisFilter = (params && Array.isArray(params.kpis)) ? params.kpis : null;

    const rows = _stmts.listKpis.all(userId, env, regime, regime, since);

    const aggregated = {};
    for (const row of rows) {
        if (kpisFilter && !kpisFilter.includes(row.kpi)) continue;
        if (!aggregated[row.kpi]) {
            aggregated[row.kpi] = { sum: 0, count: 0, latest: null, latestTs: 0 };
        }
        const stat = aggregated[row.kpi];
        stat.sum += row.value;
        stat.count += 1;
        if (row.ts >= stat.latestTs) {
            stat.latest = row.value;
            stat.latestTs = row.ts;
        }
    }

    const result = {};
    for (const [kpi, s] of Object.entries(aggregated)) {
        result[kpi] = {
            latest: s.latest,
            mean: s.count > 0 ? s.sum / s.count : null,
            count: s.count
        };
    }
    return result;
}

// ── getRecentEvents ────────────────────────────────────────────────
function getRecentEvents(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const eventType = (params && params.eventType) ? params.eventType : null;
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listEvents.all(userId, env, eventType, eventType, since, limit);
    return rows.map(r => ({
        id: r.id,
        eventType: r.event_type,
        payload: JSON.parse(r.payload_json),
        regime: r.regime,
        posId: r.pos_id,
        ts: r.ts
    }));
}

// ── aggregateKpisByRegime ──────────────────────────────────────────
function aggregateKpisByRegime(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;

    const rows = _stmts.listKpis.all(userId, env, null, null, since);

    const buckets = {};
    for (const row of rows) {
        const reg = row.regime || 'unknown';
        if (!buckets[reg]) buckets[reg] = {};
        if (!buckets[reg][row.kpi]) {
            buckets[reg][row.kpi] = { sum: 0, count: 0, latest: null, latestTs: 0 };
        }
        const stat = buckets[reg][row.kpi];
        stat.sum += row.value;
        stat.count += 1;
        if (row.ts >= stat.latestTs) {
            stat.latest = row.value;
            stat.latestTs = row.ts;
        }
    }

    const result = {};
    for (const [reg, kpis] of Object.entries(buckets)) {
        result[reg] = {};
        for (const [kpi, s] of Object.entries(kpis)) {
            result[reg][kpi] = {
                latest: s.latest,
                mean: s.count > 0 ? s.sum / s.count : null,
                count: s.count
            };
        }
    }
    return result;
}

module.exports = {
    EVENT_TYPES,
    KPI_KEYS,
    AGGREGATION_PERIODS,
    recordEvent,
    recordKpi,
    getKpiDashboard,
    getRecentEvents,
    aggregateKpisByRegime
};
