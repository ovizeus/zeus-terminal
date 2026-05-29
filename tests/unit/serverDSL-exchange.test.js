'use strict';

// [P4] serverDSL carries the position's exchange in its state so a DSL-driven
// close routes to the right venue and the UI can label the order's exchange.
// Pre-P4 the DSL state had userId/symbol/side but NO exchange.

jest.mock('../../server/services/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../server/services/audit', () => ({ record: jest.fn() }));

const dsl = require('../../server/services/serverDSL');

function pos(overrides) {
    return Object.assign({
        seq: 5001, userId: 1, symbol: 'BTCUSDT', side: 'LONG',
        price: 60000, sl: 59000, tp: 62000,
    }, overrides);
}

describe('[P4] serverDSL exchange tag', () => {
    afterEach(() => { dsl.detach(5001); dsl.detach(5002); });

    test('attach stores position.exchange; getState exposes it', () => {
        dsl.attach(pos({ seq: 5001, exchange: 'bybit' }), dsl.DSL_DEFAULTS);
        const st = dsl.getState(5001);
        expect(st).toBeTruthy();
        expect(st.exchange).toBe('bybit');
    });

    test('missing exchange → null (legacy / demo positions)', () => {
        dsl.attach(pos({ seq: 5002, exchange: undefined }), dsl.DSL_DEFAULTS);
        expect(dsl.getState(5002).exchange).toBeNull();
    });
});
