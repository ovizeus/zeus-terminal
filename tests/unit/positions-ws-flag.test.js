'use strict';

// Task F — Regression guard: POSITIONS_WS flag must remain true.
// With autonomous brain (SERVER_AT_TESTNET=true), the client UI relies on
// server-broadcast positions.changed frames to render entries opened by the
// brain without a browser-side refresh poll. Flipping POSITIONS_WS off would
// hide autonomous positions from the UI until next polling cycle.
//
// This test reads the persisted flag value to guard against accidental revert
// of data/migration_flags.json.

const fs = require('fs');
const path = require('path');

describe('POSITIONS_WS flag — regression guard', () => {
    test('persisted flag is true in data/migration_flags.json', () => {
        const flagsPath = path.resolve(__dirname, '../../data/migration_flags.json');
        const flags = JSON.parse(fs.readFileSync(flagsPath, 'utf8'));
        expect(flags.POSITIONS_WS).toBe(true);
    });

    // [2026-10-09] This used to load migrationFlags and assert POSITIONS_WS was
    // true there. Flags are isolated under test now — a test run was rewriting
    // the production file and left it owned by root — so the module reports
    // declared defaults, not the operator's configuration, and this said nothing.
    // The guard that matters is the one above, which reads the file itself. What
    // is worth asserting here is that the file it reads is the file production
    // loads, so that guard actually governs the running server.
    test('production loads the very file the guard above checks', () => {
        jest.resetModules();
        const MF = require('../../server/migrationFlags');
        expect(MF.flagsFilePath()).not.toBe(path.resolve(__dirname, '../../data/migration_flags.json'));

        const src = fs.readFileSync(path.resolve(__dirname, '../../server/migrationFlags.js'), 'utf8');
        expect(src).toMatch(/path\.join\(__dirname, '\.\.', 'data', 'migration_flags\.json'\)/);
    });

    test('serverAT module loads with POSITIONS_WS=true (no boot-time mutex violation)', () => {
        jest.resetModules();
        const serverAT = require('../../server/services/serverAT');
        // Module must export at least one expected method — broadcast path is
        // gated internally by MF.POSITIONS_WS; if flag/serverAT contradict at
        // load, require() would throw before reaching here.
        expect(typeof serverAT.setGlobalHalt).toBe('function');
    });

    test('client subscriber wiring present (App.tsx imports positionsRealtime)', () => {
        const appPath = path.resolve(__dirname, '../../client/src/App.tsx');
        const src = fs.readFileSync(appPath, 'utf8');
        expect(src).toMatch(/startPositionsRealtime/);
        expect(src).toMatch(/from ['"]\.\/services\/positionsRealtime['"]/);
    });
});
