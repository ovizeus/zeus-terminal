'use strict';

const marketFeed = require('../../server/services/marketFeed');

beforeEach(() => {
    marketFeed._resetRefsForTest();
});

describe('marketFeed — ref counting state', () => {
    test('addRef + hasSymbolRef returns true', () => {
        marketFeed._addRefForTest('XRPUSDT', '1|TESTNET|123');
        expect(marketFeed._hasSymbolRefForTest('XRPUSDT')).toBe(true);
    });

    test('symbol with zero refs returns false', () => {
        expect(marketFeed._hasSymbolRefForTest('XRPUSDT')).toBe(false);
    });

    test('multiple refs on same symbol counted independently', () => {
        marketFeed._addRefForTest('BTCUSDT', '1|TESTNET|111');
        marketFeed._addRefForTest('BTCUSDT', '2|REAL|222');
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(2);
    });

    test('releaseRef removes only matching refKey', () => {
        marketFeed._addRefForTest('BTCUSDT', '1|TESTNET|111');
        marketFeed._addRefForTest('BTCUSDT', '2|REAL|222');
        marketFeed._releaseRefByKeyForTest('1|TESTNET|111');
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1);
        expect(marketFeed._hasSymbolRefForTest('BTCUSDT')).toBe(true);
    });

    test('releaseRef on last ref leaves symbol with zero refs', () => {
        marketFeed._addRefForTest('XRPUSDT', '1|TESTNET|333');
        marketFeed._releaseRefByKeyForTest('1|TESTNET|333');
        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(0);
        expect(marketFeed._hasSymbolRefForTest('XRPUSDT')).toBe(false);
    });

    test('boot|system ref is sticky and never removed by releaseRef', () => {
        marketFeed._addRefForTest('BTCUSDT', 'boot|system');
        marketFeed._addRefForTest('BTCUSDT', '1|TESTNET|111');
        marketFeed._releaseRefByKeyForTest('1|TESTNET|111');
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1);
        expect(marketFeed._hasSymbolRefForTest('BTCUSDT')).toBe(true);
    });

    test('releaseRef with boot|system as refKey is a no-op (sticky guard)', () => {
        marketFeed._addRefForTest('BTCUSDT', 'boot|system');
        marketFeed._releaseRefByKeyForTest('boot|system');
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1);
        expect(marketFeed._hasSymbolRefForTest('BTCUSDT')).toBe(true);
    });
});
