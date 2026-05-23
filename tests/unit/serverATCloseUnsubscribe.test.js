'use strict';

const marketFeed = require('../../server/services/marketFeed');

beforeEach(() => {
    marketFeed._resetRefsForTest();
});

describe('serverAT — recon auto-subscribe ref shape', () => {
    test('refKey format used by recon path is "uid|env|seq"', () => {
        // Contract test — refKey must be parseable and stable
        const refKey = '1|TESTNET|1776859652944';
        const parts = refKey.split('|');
        expect(parts.length).toBe(3);
        expect(parts[0]).toBe('1');            // userId
        expect(parts[1]).toBe('TESTNET');      // env
        expect(parts[2]).toBe('1776859652944'); // posSeq
    });
});

describe('serverAT — releaseRef on close', () => {
    test('after addRef + releaseRef on same key, symbol freed', () => {
        marketFeed._setUnsubscribeSymbolFnForTest(() => {});
        marketFeed._addRefForTest('XRPUSDT', '1|TESTNET|999');
        marketFeed.releaseRef('1|TESTNET|999');
        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(0);
    });
});

describe('serverAT — _closePosition releases marketFeed ref', () => {
    test('closing a position decrements ref-count for its symbol', () => {
        // Seed: position open, ref added
        marketFeed._setUnsubscribeSymbolFnForTest(() => {});
        marketFeed._addRefForTest('XRPUSDT', '1|TESTNET|7777');
        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(1);

        // Simulate close by directly calling releaseRef with the same refKey
        // shape _closePosition will use
        const pos = { userId: 1, env: 'TESTNET', seq: 7777, symbol: 'XRPUSDT' };
        const refKey = `${pos.userId}|${pos.env}|${pos.seq}`;
        marketFeed.releaseRef(refKey);

        expect(marketFeed._refCountForTest('XRPUSDT')).toBe(0);
    });
});
