'use strict';
// tests/unit/migrationFlags-coherence-wiring.test.js
// [REVIEW of 168c0c5a] Proves migrationFlags.set() actually invokes the
// REAL-gate coherence guard (assertAndAlert) on every flip — the wiring is a
// lazy require inside a try/catch, so a typo'd path would fail silently
// without this test.
//
// Safety on the live repo: set() persists data/migration_flags.json and
// snapshots the change to the DB. We (a) pick ML_LIVE_OPTIN_REQUIRED and
// re-set it to its CURRENT value (no mutex partner, no semantic change),
// (b) mock the DB snapshot path so nothing touches the live database, and
// (c) snapshot + byte-identical restore of the flags file because save()
// rewrites it in in-memory key order, which may differ from disk.

const fs = require('fs');
const path = require('path');

jest.mock('../../server/services/realGateCoherence', () => ({
    assertAndAlert: jest.fn(() => ({ coherent: true, problems: [] })),
}));
// Neutralize the R0 config-rollback snapshot — never write to the live DB
// from a unit test.
jest.mock('../../server/services/ml/R0_substrate/configRollback', () => ({
    snapshotConfig: jest.fn(),
}));
jest.mock('../../server/services/database', () => ({
    db: { prepare: () => ({ get: () => ({ v: 0 }) }) },
}));

const FLAGS_FILE = path.join(__dirname, '..', '..', 'data', 'migration_flags.json');
let flagsFileSnapshot = null;

const coherence = require('../../server/services/realGateCoherence');
const MF = require('../../server/migrationFlags');

describe('migrationFlags.set() → realGateCoherence wiring', () => {
    beforeAll(() => {
        if (fs.existsSync(FLAGS_FILE)) {
            flagsFileSnapshot = fs.readFileSync(FLAGS_FILE);
        }
    });

    afterAll(() => {
        // Restore byte-identical — save() rewrites the file even on a no-op set.
        if (flagsFileSnapshot !== null) {
            fs.writeFileSync(FLAGS_FILE, flagsFileSnapshot);
        }
    });

    test('set() calls assertAndAlert with the post-set flags and a set(<key>) label', () => {
        const key = 'ML_LIVE_OPTIN_REQUIRED';
        const current = MF.getAll()[key];
        expect(typeof current).toBe('boolean'); // sanity: flag exists

        MF.set(key, current); // no-op semantically — re-set to current value

        expect(coherence.assertAndAlert).toHaveBeenCalledTimes(1);
        const [flagsArg, labelArg] = coherence.assertAndAlert.mock.calls[0];
        expect(typeof flagsArg).toBe('object');
        expect(flagsArg[key]).toBe(current);
        expect(labelArg).toBe(`set(${key})`);
    });
});
