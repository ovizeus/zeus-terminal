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

describe('marketFeed — subscribeForRef public API', () => {
    test('subscribeForRef adds ref + returns true when symbol newly added', async () => {
        marketFeed._setSubscribeFnForTest(async () => { /* no-op */ });
        try {
            const added = await marketFeed.subscribeForRef('XRPUSDT', '1|TESTNET|999');
            expect(added).toBe(true);
            expect(marketFeed._refCountForTest('XRPUSDT')).toBe(1);
        } finally {
            marketFeed._setSubscribeFnForTest(null);
        }
    });

    test('subscribeForRef returns false on duplicate refKey (idempotent)', async () => {
        marketFeed._setSubscribeFnForTest(async () => {});
        await marketFeed.subscribeForRef('XRPUSDT', '1|TESTNET|999');
        const dup = await marketFeed.subscribeForRef('XRPUSDT', '1|TESTNET|999');
        expect(dup).toBe(false);
        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(1);
        marketFeed._setSubscribeFnForTest(null);
    });

    test('releaseRef on non-sticky last ref calls unsubscribeSymbol', () => {
        let unsubscribedSym = null;
        marketFeed._setUnsubscribeSymbolFnForTest((sym) => { unsubscribedSym = sym; });
        marketFeed._addRefForTest('XRPUSDT', '1|TESTNET|999');
        marketFeed.releaseRef('1|TESTNET|999');
        expect(unsubscribedSym).toBe('XRPUSDT');
        marketFeed._setUnsubscribeSymbolFnForTest(null);
    });

    test('releaseRef does NOT unsubscribe sticky boot symbol', () => {
        let unsubscribedSym = null;
        marketFeed._setUnsubscribeSymbolFnForTest((sym) => { unsubscribedSym = sym; });
        marketFeed._addRefForTest('BTCUSDT', 'boot|system');
        marketFeed._addRefForTest('BTCUSDT', '1|TESTNET|111');
        marketFeed.releaseRef('1|TESTNET|111');
        expect(unsubscribedSym).toBe(null);
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1);
        marketFeed._setUnsubscribeSymbolFnForTest(null);
    });

    test('subscribeForRef rolls back ref if first-ref subscribe throws', async () => {
        const boom = async () => { throw new Error('binance unreachable'); };
        marketFeed._setSubscribeFnForTest(boom);
        const result = await marketFeed.subscribeForRef('XRPUSDT', '1|TESTNET|fail');
        expect(result).toBe(false);
        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(0);
        // Retry with non-throwing fn should now work (refKey not poisoned)
        marketFeed._setSubscribeFnForTest(async () => {});
        const retry = await marketFeed.subscribeForRef('XRPUSDT', '1|TESTNET|fail');
        expect(retry).toBe(true);
        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(1);
        marketFeed._setSubscribeFnForTest(null);
    });
});

describe('marketFeed — boot sticky', () => {
    test('subscribeMultiWithBootRef adds boot|system ref to each symbol', async () => {
        marketFeed._setSubscribeFnForTest(async () => {});
        await marketFeed.subscribeMultiWithBootRef(['BTCUSDT', 'ETHUSDT'], ['5m']);
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1);
        expect(marketFeed._refCountForTest('ETHUSDT')).toBe(1);
        // Release any user ref later — boot still sticky
        marketFeed._addRefForTest('BTCUSDT', '1|TESTNET|111');
        marketFeed.releaseRef('1|TESTNET|111');
        expect(marketFeed._refCountForTest('BTCUSDT')).toBe(1); // boot survives
        marketFeed._setSubscribeFnForTest(null);
    });
});
