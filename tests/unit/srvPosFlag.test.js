'use strict';

describe('SERVER_AUTHORITATIVE_POSITIONS flag', () => {
    let MF;

    beforeEach(() => {
        jest.resetModules();
        MF = require('../../server/migrationFlags');
    });

    test('flag exists and defaults to false', () => {
        expect(MF.DEFAULTS).toHaveProperty('SERVER_AUTHORITATIVE_POSITIONS', false);
    });

    test('canary sub-flags default to false', () => {
        expect(MF.DEFAULTS).toHaveProperty('_SRV_POS_TESTNET_ENABLED', false);
        expect(MF.DEFAULTS).toHaveProperty('_SRV_POS_REAL_ENABLED', false);
    });

    test('getters work', () => {
        expect(typeof MF.SERVER_AUTHORITATIVE_POSITIONS).toBe('boolean');
        expect(typeof MF._SRV_POS_TESTNET_ENABLED).toBe('boolean');
        expect(typeof MF._SRV_POS_REAL_ENABLED).toBe('boolean');
    });
});
