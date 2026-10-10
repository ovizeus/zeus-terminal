'use strict';
/**
 * dbOpen — open the SQLite database, surviving a corrupt write-ahead log.
 *
 * [2026-10-10] Zeus spent three and a half hours in a restart loop overnight,
 * 1082 attempts, serving 502 to everyone, with no alert. The database itself
 * was intact — a full PRAGMA integrity_check on it returned ok — but its WAL
 * was corrupt, and the first schema read happens at require time, so the
 * process died before anything could react. Recovery was: move the -wal and
 * -shm aside, start again.
 *
 * SQLite cannot read an unreadable WAL either, so the transactions inside it
 * are already unreachable; quarantining the file loses nothing that could have
 * been recovered, and it is RENAMED, never deleted, so the evidence survives.
 * Corruption in the main database is deliberately NOT swallowed — starting a
 * server on a broken database would be worse than staying down.
 */

const fs = require('fs');

function _isCorruption(err) {
    if (!err) return false;
    if (err.code === 'SQLITE_CORRUPT' || err.code === 'SQLITE_NOTADB') return true;
    return /malformed|not a database|disk image is malformed/i.test(err.message || '');
}

// Touching sqlite_master is what actually fails on a corrupt schema — a bare
// open() succeeds and only the first read throws.
function _probe(handle) {
    handle.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get();
}

function openWithWalRecovery(dbPath, deps) {
    const d = deps || {};
    const open = d.open || ((p) => new (require('better-sqlite3'))(p));
    const exists = d.exists || ((p) => fs.existsSync(p));
    const rename = d.rename || ((a, b) => fs.renameSync(a, b));
    const log = d.log || ((m) => { try { console.warn(m); } catch (_) { /* */ } });

    let handle = open(dbPath);
    try {
        _probe(handle);
        return handle;
    } catch (err) {
        if (!_isCorruption(err)) throw err;
        log(`[DB] corrupt database on open (${err.message}) — quarantining the write-ahead log and retrying`);
        try { handle.close(); } catch (_) { /* already unusable */ }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        for (const suffix of ['-wal', '-shm']) {
            const p = dbPath + suffix;
            if (!exists(p)) continue;
            try { rename(p, `${p}.corrupt-${stamp}`); } catch (e) {
                log(`[DB] could not move ${p} aside: ${e && e.message}`);
            }
        }

        handle = open(dbPath);
        try {
            _probe(handle);
        } catch (err2) {
            // Not the WAL. The database itself is damaged — say so and stop.
            log('[DB] FATAL: the database itself is corrupt, not just its WAL — restore from backup');
            throw err2;
        }
        log('[DB] recovered: the write-ahead log was the corrupt part, database opened cleanly');
        return handle;
    }
}

module.exports = { openWithWalRecovery, _isCorruption };
