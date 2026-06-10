'use strict';
// tests/unit/migrationFlags-defaults.test.js
// [REAL-GATE P0-3 2026-06-09] Pins fail-closed defaults. The flag's own doc
// comment said "(default)" true while the code said false — this test makes
// the doc true and keeps it true.

const MF = require('../../server/migrationFlags');

describe('migrationFlags fail-closed defaults', () => {
    test('exports _DEFAULTS for inspection', () => {
        expect(MF._DEFAULTS).toBeDefined();
    });

    test('ML_LIVE_OPTIN_REQUIRED defaults TRUE (fail-closed)', () => {
        expect(MF._DEFAULTS.ML_LIVE_OPTIN_REQUIRED).toBe(true);
    });

    test('REAL execution flags default FALSE (fail-closed)', () => {
        expect(MF._DEFAULTS._SRV_POS_REAL_ENABLED).toBe(false);
        expect(MF._DEFAULTS._USERDATA_STREAM_REAL_ENABLED).toBe(false);
        expect(MF._DEFAULTS.ML_LIVE_INFLUENCE_ENABLED).toBe(false);
    });
});
