'use strict';
// [2026-10-09] A test run rewrote the LIVE data/migration_flags.json. The values
// happened to come back identical (save() writes what it loaded), but the file
// changed owner to root, and the app runs as zeus — so the running server could
// no longer persist a flag change at all, silently, until someone looked.
//
// Any suite that loads the real migrationFlags and calls set() on a non-protected
// flag writes the production file. Tests must never touch it.

const path = require('path');
const MF = require('../../server/migrationFlags');

describe('migration flags never persist to the production file under test', () => {
    test('the flags file path is not the live data file', () => {
        const live = path.join(__dirname, '..', '..', 'data', 'migration_flags.json');
        expect(MF.flagsFilePath()).not.toBe(live);
    });

    test('a set() under test does not create or touch the live file', () => {
        const fs = require('fs');
        const live = path.join(__dirname, '..', '..', 'data', 'migration_flags.json');
        const before = fs.existsSync(live) ? fs.statSync(live).mtimeMs : null;

        MF.set('CHART_BACKFILL_ENABLED', MF.CHART_BACKFILL_ENABLED);

        const after = fs.existsSync(live) ? fs.statSync(live).mtimeMs : null;
        expect(after).toBe(before);
    });
});
