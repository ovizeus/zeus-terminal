// A job that dies with its process leaves its temporaries behind.
//
// 2026-10-19: the 16:23 backup was killed mid-snapshot by a pm2 reload and left
// `.zeus-full-1792427032255-3054096.snap.tmp` — 2,2 GB, and an UNENCRYPTED
// partial copy of the whole database — plus a `-journal` beside it. Nothing in
// the code would ever have removed either: `cleanup()` only runs inside the
// process that failed, and a killed process runs nothing.
//
// The owning pid is in the filename so a sweep can tell a corpse from a live
// job. These tests pin that it only ever removes corpses.

const fs = require('fs');
const os = require('os');
const path = require('path');

const adminBackup = require('../../server/services/adminBackup');

let dir;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-bk-sweep-'));
});

afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* */ }
});

const touch = (name, bytes) => fs.writeFileSync(path.join(dir, name), Buffer.alloc(bytes || 8));
const exists = (name) => fs.existsSync(path.join(dir, name));

describe('sweepStaleTemps', () => {
    it('removes the temporaries of a dead job, journal included', () => {
        touch('.zeus-full-1792427032255-3054096.snap.tmp', 64);
        touch('.zeus-full-1792427032255-3054096.snap.tmp-journal', 16);
        touch('.zeus-full-1792427032255-3054096.enc.tmp', 32);

        const removed = adminBackup.sweepStaleTemps(dir, { isAlive: () => false });

        expect(removed).toHaveLength(3);
        expect(exists('.zeus-full-1792427032255-3054096.snap.tmp')).toBe(false);
        expect(exists('.zeus-full-1792427032255-3054096.snap.tmp-journal')).toBe(false);
        expect(exists('.zeus-full-1792427032255-3054096.enc.tmp')).toBe(false);
    });

    it('LEAVES ALONE a temporary whose job is still running', () => {
        touch('.zeus-full-1792427032255-999999.snap.tmp', 64);
        const removed = adminBackup.sweepStaleTemps(dir, { isAlive: () => true });
        expect(removed).toEqual([]);
        expect(exists('.zeus-full-1792427032255-999999.snap.tmp')).toBe(true);
    });

    it('never touches its own pid, whatever the liveness probe says', () => {
        const name = `.zeus-full-1792427032255-${process.pid}.snap.tmp`;
        touch(name, 64);
        // Even with a probe that claims everything is dead.
        expect(adminBackup.sweepStaleTemps(dir, { isAlive: () => false })).toEqual([]);
        expect(exists(name)).toBe(true);
    });

    it('does NOT touch published backups, manifests or anything else in the dir', () => {
        touch('zeus-full-1792427032255.db.gz.enc', 128);
        touch('manifest.json', 64);
        touch('notes.txt', 8);
        touch('.zeus-full-1792427032255-3054096.snap.tmp', 64);

        adminBackup.sweepStaleTemps(dir, { isAlive: () => false });

        expect(exists('zeus-full-1792427032255.db.gz.enc')).toBe(true);
        expect(exists('manifest.json')).toBe(true);
        expect(exists('notes.txt')).toBe(true);
        expect(exists('.zeus-full-1792427032255-3054096.snap.tmp')).toBe(false);
    });

    it('a missing directory sweeps nothing instead of throwing', () => {
        expect(adminBackup.sweepStaleTemps(path.join(dir, 'nope'))).toEqual([]);
    });

    it('createBackup sweeps before it starts, so a corpse cannot fill the disk', async () => {
        touch('.zeus-full-1792427032255-3054096.snap.tmp', 64);
        // No source database: createBackup fails, but the sweep must already
        // have run — reclaiming space is not conditional on the backup working.
        await adminBackup.createBackup({
            srcPath: path.join(dir, 'missing.db'),
            dir,
            passphrase: 'correct horse battery',
        });
        expect(exists('.zeus-full-1792427032255-3054096.snap.tmp')).toBe(false);
    }, 30000);
});
