'use strict';
// tests/unit/db-backup-permissions.test.js
//
// [SEC 2026-10-25] The live database is 0600. Its daily copies were 0644.
//
// Found while checking a claim a friend of the operator posted on Discord:
// "buy api credits and in 1 week someone will hack your website.. steal the
// api and use credits or access database". The claim is generic, so it was
// checked against this server specifically rather than argued with. Most of
// it did not apply. This did.
//
//     data/zeus.db                      -rw-------   (0600)
//     data/zeus.db.bak.pre-*            -rw-------   (0600, made with cp)
//     data/db_backups/zeus-2026-10-*.db -rw-r--r--   (0644)  ← 7 files, 2.9 GB each
//
// Each of those is a COMPLETE copy: users, password hashes, the encrypted
// exchange keys, journals, the vault. `db.backup(dest)` creates the file with
// the default umask; the hand-made copies inherited 0600 from their source.
//
// NOT exploitable today, and the report says so: data/ is 0750, so another
// user cannot traverse into it — verified by actually trying as `nobody`.
// One layer is holding. The file mode is the layer that is not, and the day
// data/ is relaxed for any reason, seven full database copies become
// world-readable with no further mistake needed.
//
// So the fix is on the class: the backup routine sets the mode itself instead
// of inheriting whatever the umask happens to be.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DB_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'services', 'database.js'), 'utf8');

describe('daily DB backups are created private', () => {

    test('the backup success path sets the mode explicitly', () => {
        const i = DB_SRC.indexOf('function _runDailyBackup');
        expect(i).toBeGreaterThan(-1);
        const block = DB_SRC.slice(i, i + 2500);
        expect(block).toMatch(/chmodSync\([^)]*0o600\)/);
    });

    test('it does not rely on the umask — the mode is a constant, not inherited', () => {
        const i = DB_SRC.indexOf('function _runDailyBackup');
        const block = DB_SRC.slice(i, i + 2500);
        // 0o600 and nothing more permissive anywhere in the routine
        expect(block).not.toMatch(/0o6?4?4|0o755|0o777/);
    });

    test('the chmod sits in the success path, before the file is left alone', () => {
        const i = DB_SRC.indexOf('const _onSuccess');
        expect(i).toBeGreaterThan(-1);
        const block = DB_SRC.slice(i, i + 900);
        expect(block).toMatch(/chmodSync/);
    });

    test('0o600 really means owner-only — the assertion is not folklore', () => {
        // Pin what the constant does, on a real file, so this file documents
        // the intent rather than a number someone has to trust.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-perm-'));
        const f = path.join(tmp, 'probe.db');
        fs.writeFileSync(f, 'x');
        fs.chmodSync(f, 0o600);
        const mode = fs.statSync(f).mode & 0o777;
        expect(mode).toBe(0o600);
        expect(mode & 0o004).toBe(0);   // not world-readable
        expect(mode & 0o040).toBe(0);   // not group-readable
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    test('the file was really read (guard against a vacuous pass)', () => {
        expect(DB_SRC.length).toBeGreaterThan(100000);
    });
});
