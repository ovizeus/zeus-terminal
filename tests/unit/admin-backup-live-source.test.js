// THE INCIDENT, 2026-10-19: the first real press of the Backup Zeus button
// never finished.
//
// `_snapshot` used the SQLite online backup API (`db.backup(dest)`). SQLite
// restarts that copy from page 0 whenever the SOURCE database is written, and
// Zeus writes on every brain tick — so against the live 2,9 GB database it
// livelocked: 18 minutes, destination stuck at exactly 1 815 756 800 bytes
// while its mtime kept advancing (the restart signature), the promise neither
// resolving nor rejecting, and no ADMIN_BACKUP_DONE row ever written.
//
// ── WHAT THESE TESTS DO AND DO NOT PROVE ────────────────────────────────────
//
// They do NOT reproduce the livelock. I tried, and I am writing it down rather
// than pretending otherwise: a first version of this file hammered a 4000-row
// source and called itself "the livelock regression" — and the mutant with
// `db.backup()` put back PASSED it. Measured again at 82 MB with a writer
// committing throughout: `db.backup()` finished in 0,2 s. The livelock only
// appears at real scale and real write rate, so a unit test that claimed to
// catch it would be decoration.
//
// What proves the fix is the live measurement, in the Book: the same database,
// 18 minutes stuck under `db.backup()` versus 30,3 s and `quick_check: ok`
// under `VACUUM INTO`.
//
// What these tests DO pin, deterministically:
//   * the snapshot runs OUT OF PROCESS, so it cannot freeze the event loop —
//     the 2026-10-07 outage was a PRAGMA integrity_check run inline in the
//     doctor tick, and an in-process VACUUM INTO (better-sqlite3 is
//     synchronous) would be the same mistake for 30 s;
//   * it stays consistent while the source is being written;
//   * it leaves the source untouched;
//   * it refuses an existing destination instead of merging into it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const adminBackup = require('../../server/services/adminBackup');

let tmpRoot;

function makeBusyDb(dir, rows) {
    const p = path.join(dir, 'src.db');
    const db = new Database(p);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, blob TEXT)');
    const ins = db.prepare('INSERT INTO t (blob) VALUES (?)');
    const seed = db.transaction(() => {
        for (let i = 0; i < rows; i++) ins.run('x'.repeat(256));
    });
    seed();
    return { path: p, db, ins };
}

beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-bk-live-'));
});

afterEach(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* */ }
});

describe('_snapshot of a live database', () => {
    it('does NOT block the event loop — it runs out of process', async () => {
        // 60k rows is ~16 MB: far too small to livelock, but long enough that a
        // synchronous in-process VACUUM INTO would measurably stall the loop.
        const src = makeBusyDb(tmpRoot, 60000);
        const dest = path.join(tmpRoot, 'snap.db');

        let ticks = 0;
        const beat = setInterval(() => { ticks++; }, 2);
        try {
            await adminBackup._snapshot(src.path, dest);
        } finally {
            clearInterval(beat);
        }

        // The loop kept turning while the snapshot ran. An in-process
        // better-sqlite3 VACUUM INTO would hold the thread and leave this at 0.
        expect(ticks).toBeGreaterThan(0);
        expect(fs.existsSync(dest)).toBe(true);
        src.db.close();
    }, 60000);

    it('stays consistent while a writer keeps committing to the source', async () => {
        const src = makeBusyDb(tmpRoot, 4000);
        const dest = path.join(tmpRoot, 'snap.db');

        let writes = 0;
        let stop = false;
        const hammer = setInterval(() => {
            if (stop) return;
            try { src.ins.run('y'.repeat(256)); writes++; } catch (_) { /* */ }
        }, 1);

        try {
            await adminBackup._snapshot(src.path, dest);
        } finally {
            stop = true;
            clearInterval(hammer);
        }

        // The writer really did run — otherwise this asserts nothing.
        expect(writes).toBeGreaterThan(0);

        const copy = new Database(dest, { readonly: true, fileMustExist: true });
        try {
            expect(copy.pragma('quick_check', { simple: true })).toBe('ok');
            expect(copy.prepare('SELECT COUNT(*) c FROM t').get().c).toBeGreaterThanOrEqual(4000);
        } finally {
            copy.close();
        }
        src.db.close();
    }, 30000);

    it('refuses an existing destination instead of silently merging into it', async () => {
        const src = makeBusyDb(tmpRoot, 200);
        const dest = path.join(tmpRoot, 'snap.db');
        fs.writeFileSync(dest, 'in the way');
        await expect(adminBackup._snapshot(src.path, dest)).rejects.toThrow(/already exists/);
        // And it did not clobber what was there.
        expect(fs.readFileSync(dest, 'utf8')).toBe('in the way');
        src.db.close();
    });

    it('reports a readable reason when the source is missing, not a bare failure', async () => {
        await expect(adminBackup._snapshot(path.join(tmpRoot, 'nope.db'), path.join(tmpRoot, 'o.db')))
            .rejects.toThrow(/.+/);
    });

    it('leaves the source untouched — the connection is readonly', async () => {
        const src = makeBusyDb(tmpRoot, 500);
        const before = src.db.prepare('SELECT COUNT(*) c FROM t').get().c;
        await adminBackup._snapshot(src.path, path.join(tmpRoot, 'snap.db'));
        expect(src.db.prepare('SELECT COUNT(*) c FROM t').get().c).toBe(before);
        expect(src.db.pragma('quick_check', { simple: true })).toBe('ok');
        src.db.close();
    });
});
