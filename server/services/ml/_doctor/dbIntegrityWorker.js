'use strict';

/**
 * dbIntegrityWorker — runs the (expensive) SQLite integrity scan OFF the main
 * thread. See dbIntegrityMonitor.js for why this must never run inline.
 *
 * Opens the DB READ-ONLY, runs `PRAGMA quick_check(1)` and posts the rows back.
 * quick_check does the same page/b-tree validation as integrity_check but skips
 * the index-vs-table cross-check, which is the most expensive part and the least
 * useful here (a rebuilt index is recoverable; a torn page is not).
 */

const { parentPort, workerData } = require('worker_threads');

(function run() {
    const startedAt = Date.now();
    try {
        const Database = require('better-sqlite3');
        const db = new Database(workerData.dbPath, { readonly: true, fileMustExist: true });
        try {
            const rows = db.prepare('PRAGMA quick_check(1)').all();
            parentPort.postMessage({ ok: true, rows, durationMs: Date.now() - startedAt });
        } finally {
            try { db.close(); } catch (_) { /* best-effort */ }
        }
    } catch (err) {
        parentPort.postMessage({ ok: false, error: err && err.message, durationMs: Date.now() - startedAt });
    }
})();
