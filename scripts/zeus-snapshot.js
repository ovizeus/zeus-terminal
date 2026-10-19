#!/usr/bin/env node
'use strict';

// [BACKUP-ZEUS-FIX 2026-10-19] Consistent snapshot of a live SQLite database,
// taken in a CHILD PROCESS on purpose.
//
// Two earlier shapes were both wrong:
//
//   1. `db.backup(dest)` (SQLite online backup API) inside the server. SQLite
//      restarts that copy from page 0 whenever the SOURCE is written, and Zeus
//      writes on every brain tick, so on the real 2,9 GB database it livelocked
//      — 18 minutes, destination stuck at 1 815 756 800 bytes with its mtime
//      still advancing, no resolve and no reject.
//
//   2. `VACUUM INTO` inside the server. Correct and fast (30,3 s, 2,69 GB,
//      quick_check ok) but better-sqlite3 is SYNCHRONOUS, so it would freeze
//      the event loop for those 30 s. That is precisely what took Zeus down on
//      2026-10-07, when a PRAGMA integrity_check ran inline in the doctor tick.
//
// So: VACUUM INTO, but in a child process, on a READ-ONLY connection. The
// 2026-10-18 corruption came from a second process WRITING the database and
// running crons beside the live server — not from a second reader. A read-only
// reader is what WAL is built for.
//
// Usage:  node scripts/zeus-snapshot.js <source.db> <dest.db>
// Exits 0 on success, prints the reason and exits non-zero otherwise.

const fs = require('fs');
const Database = require('better-sqlite3');

const [srcPath, destPath] = process.argv.slice(2);

if (!srcPath || !destPath) {
    process.stderr.write('usage: zeus-snapshot.js <source.db> <dest.db>\n');
    process.exit(2);
}

// VACUUM INTO refuses an existing target, which is the behaviour we want — but
// say so clearly rather than leaking a bare SQLite message.
if (fs.existsSync(destPath)) {
    process.stderr.write(`destination already exists: ${destPath}\n`);
    process.exit(3);
}

let db;
try {
    db = new Database(srcPath, { readonly: true, fileMustExist: true });
    // Bound parameter, not interpolation — SQL that takes a path should never
    // be string-built, however trusted the caller is.
    db.prepare('VACUUM INTO ?').run(destPath);
} catch (e) {
    process.stderr.write(`${(e && e.message) || 'snapshot failed'}\n`);
    try { fs.unlinkSync(destPath); } catch (_) { /* nothing to clean */ }
    process.exit(1);
} finally {
    if (db) { try { db.close(); } catch (_) { /* */ } }
}

process.exit(0);
