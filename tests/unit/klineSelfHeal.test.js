'use strict';

/**
 * [2026-11-09] A boot during an exchange ban leaves the feed permanently blind.
 *
 * Last night the process restarted while the IP was banned, so every symbol
 * logged "0 initial candles". The live poller only ever fetches the latest two
 * candles, so a symbol that starts empty needs about four hours of real time
 * to reach the 50 bars that make it usable — and any restart in between puts
 * it back to zero. Seven accounts sat without a single new entry because of it.
 *
 * The same shape as the bybit gap fixed earlier the same day: history is
 * fetched once, and nothing ever notices that it failed.
 *
 * This is the decision rule for noticing.
 */
const { needsReseed, pickReseedTargets, RESEED_MIN_BARS } = require('../../server/services/klineSelfHeal');

describe('noticing that a symbol never got its history', () => {
    it('a symbol with no bars needs re-seeding', () => {
        expect(needsReseed([])).toBe(true);
        expect(needsReseed(null)).toBe(true);
        expect(needsReseed(undefined)).toBe(true);
    });

    it('a symbol below the usable line needs re-seeding', () => {
        expect(needsReseed(new Array(RESEED_MIN_BARS - 1).fill({}))).toBe(true);
    });

    it('a symbol with enough history is left alone', () => {
        expect(needsReseed(new Array(RESEED_MIN_BARS).fill({}))).toBe(false);
        expect(needsReseed(new Array(500).fill({}))).toBe(false);
    });

    it('the line is the one readiness actually uses', () => {
        // isDataReadyForSymbol requires >= 50 bars; re-seeding below that is
        // the whole point, and re-seeding above it would be pointless traffic
        expect(RESEED_MIN_BARS).toBe(50);
    });
});

describe('choosing what to re-fetch, without hammering the exchange', () => {
    const full = new Array(200).fill({});
    const empty = [];

    it('picks only the symbol/timeframe pairs that are short', () => {
        const got = pickReseedTargets({
            BTCUSDT: { '5m': full, '1h': empty },
            ETHUSDT: { '5m': full, '1h': full },
        }, 10);
        expect(got).toEqual([{ symbol: 'BTCUSDT', tf: '1h' }]);
    });

    it('returns nothing when everything is healthy — the quiet case', () => {
        expect(pickReseedTargets({ BTCUSDT: { '5m': full } }, 10)).toEqual([]);
    });

    it('caps how many it asks for in one pass', () => {
        const sick = {};
        for (let i = 0; i < 20; i++) sick['SYM' + i] = { '5m': empty, '1h': empty };
        expect(pickReseedTargets(sick, 3)).toHaveLength(3);
    });

    it('survives a malformed store instead of throwing on a live feed', () => {
        expect(pickReseedTargets(null, 5)).toEqual([]);
        expect(pickReseedTargets({ BTCUSDT: null }, 5)).toEqual([]);
        expect(pickReseedTargets({ BTCUSDT: { '5m': 'nonsense' } }, 5))
            .toEqual([{ symbol: 'BTCUSDT', tf: '5m' }]);
    });
});
