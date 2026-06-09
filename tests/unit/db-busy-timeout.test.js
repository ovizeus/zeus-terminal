'use strict';
// [P1 2026-06-09] busy_timeout pragma — without it, any concurrent reader
// (backup script's sqlite3 .backup, probe scripts, manual sqlite3 shells)
// holding the lock makes better-sqlite3 throw SQLITE_BUSY instantly instead
// of waiting. 5000ms matches the offsite-backup online-backup window.

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('database busy_timeout pragma', () => {
    let db;

    beforeAll(() => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-busyto-'));
        process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
        ({ db } = require('../../server/services/database'));
    });

    test('busy_timeout is set to 5000ms so concurrent readers do not cause instant SQLITE_BUSY', () => {
        const v = db.pragma('busy_timeout', { simple: true });
        expect(v).toBe(5000);
    });
});
