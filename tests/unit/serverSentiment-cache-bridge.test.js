'use strict';

// [SENTFIX] serverSentiment computed sentiment into a private _cache Map but
// never wrote it to the shared marketCache. /api/market/sentiment reads
// mc.get('sentiment', ...) → always null → client LS feed (fetchLS expects
// j.data.ls) + radar display + LS confluence vote all dead. These tests pin the
// bridge: after a poll, marketCache must hold the sentiment entry WITH the raw
// global long/short ratio (`ls`) the client consumes.

let mockFetch = jest.fn();
jest.mock('../../server/services/binanceGateway', () => ({ fetch: (...a) => mockFetch(...a) }));
jest.mock('../../server/services/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

function mockResp(json) { return { ok: true, status: 200, json: async () => json }; }

describe('serverSentiment → marketCache bridge', () => {
    let sent, mc;
    beforeEach(() => {
        jest.resetModules();
        mockFetch = jest.fn();
        sent = require('../../server/services/serverSentiment');
        mc = require('../../server/services/marketCache');
        if (mc._resetForTest) mc._resetForTest();
    });

    test('_pollSymbol writes sentiment (raw ls + compositeScore) to marketCache', async () => {
        mockFetch.mockImplementation((url) => {
            if (url.includes('globalLongShortAccountRatio')) return Promise.resolve(mockResp([{ longShortRatio: '1.50' }]));
            if (url.includes('topLongShortPositionRatio')) return Promise.resolve(mockResp([{ longShortRatio: '1.20' }]));
            if (url.includes('takerlongshortRatio')) return Promise.resolve(mockResp([{ buySellRatio: '1.10' }]));
            return Promise.resolve(mockResp([]));
        });

        await sent._pollSymbol('BTCUSDT');

        const cached = mc.get('sentiment', 'binance:BTCUSDT');
        expect(cached).toBeTruthy();
        // raw global L/S ratio exposed for client fetchLS (j.data.ls)
        expect(cached.ls).toBeCloseTo(1.50);
        expect(typeof cached.compositeScore).toBe('number');
        expect(['bullish', 'bearish', 'neutral']).toContain(cached.crowdPosition);
    });

    test('bridge survives the marketCache sentiment validator and round-trips ls<1 (crowd net short)', async () => {
        mockFetch.mockImplementation((url) => {
            if (url.includes('globalLongShortAccountRatio')) return Promise.resolve(mockResp([{ longShortRatio: '0.80' }]));
            return Promise.resolve(mockResp([]));
        });

        await sent._pollSymbol('ETHUSDT');

        const cached = mc.get('sentiment', 'binance:ETHUSDT');
        expect(cached).toBeTruthy();
        expect(cached.ls).toBeCloseTo(0.80);
    });

    test('no LS feed → entry still written but ls is null (client fetchLS skips, fail-safe)', async () => {
        // global LS returns empty, but taker provides a data point so dataPoints>0
        mockFetch.mockImplementation((url) => {
            if (url.includes('takerlongshortRatio')) return Promise.resolve(mockResp([{ buySellRatio: '1.10' }]));
            return Promise.resolve(mockResp([]));
        });

        await sent._pollSymbol('SOLUSDT');

        const cached = mc.get('sentiment', 'binance:SOLUSDT');
        expect(cached).toBeTruthy();
        expect(cached.ls).toBeNull();
    });
});
