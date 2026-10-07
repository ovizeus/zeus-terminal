'use strict';

/**
 * mlTelemetryRetention — bounded retention for the high-volume ML telemetry
 * tables.
 *
 * [RETENTION GAP FIX 2026-10-07] The 2026-06-11 audit (b128 F1/F2) closed
 * retention for ml_influence_audit (30d) and brain_parity_log (60d) and noted
 * growth was "now capped". Six bigger writers were missed and kept growing
 * unbounded for ~5 months:
 *
 *     ml_decision_snapshots   2,532,702 rows
 *     ml_decision_light       2,532,702
 *     ml_pit_snapshots        2,531,543
 *     ml_module_heartbeats    2,355,509
 *     ml_thinking_traces      1,670,345
 *     ml_latency_measurements 1,669,857
 *
 * The DB reached 7.9 GB, which turned the doctor's inline `PRAGMA
 * integrity_check` into a multi-minute event-loop freeze → GLOBAL_HALT armed
 * every 5 min → zero trades for 2 months. See dbIntegrityMonitor.js.
 *
 * Deletes are BATCHED under a time budget by design. An unbounded
 * `DELETE FROM … WHERE created_at < ?` over millions of rows is synchronous
 * better-sqlite3 work — i.e. exactly the main-thread freeze we are fixing. None
 * of these tables is indexed on its retention column, so each pass is a scan;
 * bounding the batch keeps every individual statement short.
 *
 * Windows reflect what each table is actually read for:
 *   heartbeats          — only MAX(ts) per module is ever read (liveness)
 *   latency / thinking  — perf + reasoning forensics, short horizon
 *   decisions / pit     — replay & audit by digest; mirrors brain_decisions' 30d
 *   dr_state / runs     — operational telemetry
 *   diagnostic_events   — P0/P1 alerts (analyzer reads last 24h)
 *   voice_log           — user-visible OMEGA chat history, so the most generous
 */

const logger = require('../services/logger');

const POLICY = Object.freeze([
    { table: 'ml_module_heartbeats',    column: 'ts',         days: 7 },
    { table: 'ml_latency_measurements', column: 'created_at', days: 14 },
    { table: 'ml_thinking_traces',      column: 'created_at', days: 14 },
    { table: 'ml_decision_light',       column: 'created_at', days: 30 },
    { table: 'ml_decision_snapshots',   column: 'created_at', days: 30 },
    { table: 'ml_pit_snapshots',        column: 'created_at', days: 30 },
    { table: 'ml_dr_state',             column: 'created_at', days: 30 },
    { table: 'ml_reflection_runs',      column: 'started_at', days: 30 },
    { table: 'ml_diagnostic_events',    column: 'ts',         days: 90 },
    { table: 'ml_voice_log',            column: 'created_at', days: 90 },
]);

const DAY_MS = 86400000;
const BATCH_SIZE = 5000;
const MAX_BATCHES_PER_TABLE = 40;   // ≤200k rows/table/run
const TIME_BUDGET_MS = 20000;       // whole run, so a tick is never long

const TARGET_HOUR_UTC = 4;          // after posClassRetention (03:00)
let _lastRunDate = '';

/**
 * One retention pass. Returns { deleted: {table: n}, errors: [table], budgetExhausted }.
 * Never throws — a bad table must not stop the rest.
 */
function run(opts) {
    const o = opts || {};
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const batchSize = Number.isFinite(o.batchSize) ? o.batchSize : BATCH_SIZE;
    const maxBatches = Number.isFinite(o.maxBatchesPerTable) ? o.maxBatchesPerTable : MAX_BATCHES_PER_TABLE;
    const timeBudgetMs = Number.isFinite(o.timeBudgetMs) ? o.timeBudgetMs : TIME_BUDGET_MS;

    const { db } = require('../services/database');
    const startedAt = Date.now();
    const deleted = {};
    const errors = [];
    let budgetExhausted = false;

    for (const spec of POLICY) {
        if (Date.now() - startedAt >= timeBudgetMs) { budgetExhausted = true; break; }
        const cutoff = now - spec.days * DAY_MS;
        let total = 0;
        try {
            // rowid-keyed batch: bounded work per statement regardless of table size.
            const stmt = db.prepare(
                `DELETE FROM ${spec.table} WHERE rowid IN (
                     SELECT rowid FROM ${spec.table} WHERE ${spec.column} < ? LIMIT ${batchSize}
                 )`
            );
            for (let b = 0; b < maxBatches; b++) {
                if (Date.now() - startedAt >= timeBudgetMs) { budgetExhausted = true; break; }
                const changes = stmt.run(cutoff).changes || 0;
                total += changes;
                if (changes < batchSize) break; // drained
            }
            deleted[spec.table] = total;
        } catch (err) {
            errors.push(spec.table);
            try { logger.warn('CRON', `[mlTelemetryRetention] ${spec.table}: ${err.message}`); } catch (_) {}
        }
    }

    const sum = Object.values(deleted).reduce((a, b) => a + b, 0);
    if (sum > 0) {
        try {
            logger.info('CRON', `[mlTelemetryRetention] pruned ${sum} rows in ${Date.now() - startedAt}ms`
                + (budgetExhausted ? ' (time budget spent — continues next run)' : ''));
        } catch (_) {}
    }
    return { deleted, errors, budgetExhausted, durationMs: Date.now() - startedAt };
}

function schedule() {
    setInterval(() => {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        if (dateStr === _lastRunDate) return;
        if (now.getUTCHours() !== TARGET_HOUR_UTC) return;
        _lastRunDate = dateStr;
        try { run(); } catch (err) {
            try { logger.warn('CRON', `[mlTelemetryRetention] error: ${err.message}`); } catch (_) {}
        }
    }, 60000);
    try { logger.info('CRON', '[mlTelemetryRetention] scheduled daily 04:00 UTC'); } catch (_) {}
}

module.exports = { POLICY, run, schedule, _resetForTest: () => { _lastRunDate = ''; } };
