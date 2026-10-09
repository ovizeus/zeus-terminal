describe('OMEGA Wave 1A — Migration Flags', () => {
    let MF;

    beforeAll(() => {
        delete require.cache[require.resolve('../../../server/migrationFlags')];
        MF = require('../../../server/migrationFlags');
    });

    const EXPECTED_FLAGS = [
        'ML_INGEST_ENABLED',
        'ML_PIPELINE_SHADOW',
        'ML_DEMO_INFLUENCE_ENABLED',
        'ML_TESTNET_INFLUENCE_ENABLED',
        'ML_LIVE_INFLUENCE_ENABLED',
        'ML_LIVE_OPTIN_REQUIRED',
        'ML_BANDIT_AUTO_APPLY_MINOR',
        'ML_HYBRID_POOLING_ENABLED',
        'ML_OVERRIDE_RESOLVER_ENABLED',
    ];

    test.each(EXPECTED_FLAGS)('flag %s exists', (flagName) => {
        expect(MF).toHaveProperty(flagName);
    });

    // [2026-10-09] This block used to assert which flags the OPERATOR had switched
    // on, and only passed because the test process read the live
    // data/migration_flags.json. That is deployment state, not code behaviour: it
    // drifts every time he flips a flag, and it made the suite go red for a
    // perfectly healthy system. Worse, reading that file meant a test run could
    // also WRITE it — which happened, leaving it owned by root so the server
    // could no longer persist flags at all.
    //
    // What the code actually owns is the DECLARED DEFAULT: every ML influence
    // flag ships OFF, and the REAL consent gate ships ON. That is the fail-closed
    // contract worth pinning, and it holds whatever the operator has configured.
    const CONSENT_GATE = 'ML_LIVE_OPTIN_REQUIRED';
    const INFLUENCE_FLAGS = EXPECTED_FLAGS.filter((f) => f !== CONSENT_GATE);

    test.each(INFLUENCE_FLAGS)('flag %s ships OFF by default (fail-closed)', (flagName) => {
        expect(MF.DEFAULTS[flagName]).toBe(false);
    });

    test('the REAL consent gate ships ON by default, so consent can never be skipped', () => {
        expect(MF.DEFAULTS[CONSENT_GATE]).toBe(true);
    });

    test('all 9 OMEGA flags exist in DEFAULTS', () => {
        for (const f of EXPECTED_FLAGS) {
            expect(MF.DEFAULTS).toHaveProperty(f);
            // ML_LIVE_OPTIN_REQUIRED defaults TRUE since 109b8962 (fail-closed
            // consent gate); every other OMEGA flag defaults false.
            const expected = (f === 'ML_LIVE_OPTIN_REQUIRED');
            expect(MF.DEFAULTS[f]).toBe(expected);
        }
    });
});
