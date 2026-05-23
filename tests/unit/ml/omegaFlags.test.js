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

    test.each(EXPECTED_FLAGS)('flag %s defaults to false', (flagName) => {
        expect(MF[flagName]).toBe(false);
    });

    test('all 9 OMEGA flags exist in DEFAULTS', () => {
        for (const f of EXPECTED_FLAGS) {
            expect(MF.DEFAULTS).toHaveProperty(f);
            expect(MF.DEFAULTS[f]).toBe(false);
        }
    });
});
