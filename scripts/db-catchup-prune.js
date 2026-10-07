#!/usr/bin/env node
/**
 * db-catchup-prune.js — one-time catch-up for the retention gap fixed on
 * 2026-10-07 (see server/cron/mlTelemetryRetention.js).
 *
 * The daily cron only trims deltas; ~12M historical rows predate it. This runs
 * the SAME policy repeatedly until each table is drained, printing progress.
 *
 * SAFE TO RUN WITH THE APP UP: every statement is a bounded rowid batch, so it
 * never holds a long write lock. It does NOT vacuum — the file only shrinks
 * after `VACUUM`, which needs the app stopped.
 *
 *   node scripts/db-catchup-prune.js [--dry-run]
 */
const retention = require('../server/cron/mlTelemetryRetention');

const dryRun = process.argv.includes('--dry-run');
const { db } = require('../server/services/database');

const DAY_MS = 86400000;
console.log('\n══════ CATCH-UP PRUNE ' + (dryRun ? '(DRY RUN)' : '') + ' ══════');

const before = {};
for (const spec of retention.POLICY) {
    try {
        const cutoff = Date.now() - spec.days * DAY_MS;
        const total = db.prepare(`SELECT COUNT(*) c FROM ${spec.table}`).get().c;
        const old = db.prepare(`SELECT COUNT(*) c FROM ${spec.table} WHERE ${spec.column} < ?`).get(cutoff).c;
        before[spec.table] = { total, old };
        console.log(`  ${spec.table.padEnd(26)} total=${String(total).padStart(9)}  older_than_${spec.days}d=${String(old).padStart(9)}`);
    } catch (err) {
        console.log(`  ${spec.table.padEnd(26)} SKIP (${err.message})`);
    }
}

if (dryRun) { console.log('\nDry run — nothing deleted.\n'); process.exit(0); }

console.log('\n── draining ──');
let pass = 0;
let grandTotal = 0;
for (;;) {
    pass++;
    const res = retention.run({ batchSize: 5000, maxBatchesPerTable: 200, timeBudgetMs: 60000 });
    const sum = Object.values(res.deleted).reduce((a, b) => a + b, 0);
    grandTotal += sum;
    console.log(`  pass ${String(pass).padStart(3)}: deleted ${String(sum).padStart(8)} (running total ${grandTotal})`);
    if (sum === 0) break;
    if (pass > 500) { console.log('  safety stop at 500 passes'); break; }
}

console.log('\n── after ──');
for (const spec of retention.POLICY) {
    try {
        const total = db.prepare(`SELECT COUNT(*) c FROM ${spec.table}`).get().c;
        const was = before[spec.table] ? before[spec.table].total : '?';
        console.log(`  ${spec.table.padEnd(26)} ${String(was).padStart(9)} → ${String(total).padStart(9)}`);
    } catch (_) {}
}
console.log(`\nTotal deleted: ${grandTotal}`);
console.log('NOTE: file size shrinks only after VACUUM (needs the app stopped).\n');
