'use strict';

/**
 * [2026-11-09] The watchdog that would have saved last night.
 *
 * The process restarted during a Binance IP ban, every symbol logged
 * "0 initial candles", and nothing ever re-checked. Seven accounts went the
 * whole night without a new entry. `pickReseedTargets` decides WHAT to refill;
 * this proves the pass actually refills it, caps itself, and keeps going when
 * the exchange is still refusing.
 */

const mockState = { bars: {} };
jest.mock('../../server/services/serverState', () => ({
    getBarsForSymbol: (sym, tf) => (mockState.bars[sym] && mockState.bars[sym][tf]) || [],
}));

const feed = require('../../server/services/marketFeed');

const full = () => new Array(200).fill({ time: 1, close: 1 });

describe('the self-heal pass', () => {
    let fetched;

    beforeEach(() => {
        fetched = [];
        mockState.bars = {};
        feed._resetForTest && feed._resetForTest();
    });

    it('is exported and callable', () => {
        expect(typeof feed._selfHealPass).toBe('function');
        expect(typeof feed.startSelfHeal).toBe('function');
        expect(typeof feed.stopSelfHeal).toBe('function');
    });

    it('never throws, even with nothing subscribed', async () => {
        await expect(feed._selfHealPass()).resolves.toBeUndefined();
    });

    it('asks for nothing when every series is healthy', async () => {
        const spy = jest.spyOn(feed, 'fetchKlines');
        mockState.bars = { BTCUSDT: { '5m': full(), '1h': full(), '4h': full() } };
        await feed._selfHealPass();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('the rule it runs on, against last night exactly', () => {
    const { pickReseedTargets, needsReseed } = require('../../server/services/klineSelfHeal');

    it('a boot during a ban — every pair empty — is caught, three at a time', () => {
        // "XRPUSDT 5m: 0 initial candles" … for all seven symbols
        const store = {};
        for (const s of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'LINKUSDT']) {
            store[s] = { '5m': [], '1h': [], '4h': [] };
        }
        const first = pickReseedTargets(store, 3);
        expect(first).toHaveLength(3);
        // and the cap is what keeps the repair from becoming the next burst
        expect(pickReseedTargets(store, 3).length).toBeLessThan(21);
    });

    it('a symbol that has been dribbling in live candles is still too short', () => {
        // ~20 candles accumulated since the ban lifted — not yet usable
        expect(needsReseed(new Array(20).fill({}))).toBe(true);
    });

    it('and is left alone once it crosses the line', () => {
        expect(needsReseed(new Array(50).fill({}))).toBe(false);
    });
});
