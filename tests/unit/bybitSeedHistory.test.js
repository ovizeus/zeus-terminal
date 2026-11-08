'use strict';

/**
 * [2026-11-08] The last thing keeping his wife's account out of the market.
 *
 * A symbol only counts as ready at 50+ bars. The binance feed fetches its
 * history over REST the moment it subscribes; the bybit feed only ever
 * subscribed to the live stream. So a bybit symbol needed FOUR HOURS of live
 * 5m candles to become usable — on a server that restarts far more often than
 * that, which means never.
 *
 * Her account was armed, her feed was connected, and the brain still skipped
 * her every single cycle for want of bars.
 */
const { seedHistory } = require('../../server/services/bybitFeed');

/** Binance-shaped 12-tuples, which is what bybitRest.fetchKlines returns. */
const tuple = (t, c) => [t, '100', '110', '90', String(c), '5', t, '0', 0, '0', '0', '0'];

describe('seeding bybit history over REST', () => {
    it('emits every bar it fetched, for each symbol and timeframe', async () => {
        const emitted = [];
        const res = await seedHistory({
            symbols: ['BTCUSDT', 'ETHUSDT'],
            timeframes: ['5m', '1h'],
            limit: 3,
            fetchKlines: async () => [tuple(1000, 1), tuple(2000, 2), tuple(3000, 3)],
            emit: (ev, data) => emitted.push({ ev, data }),
        });
        expect(res.bars).toBe(12);                 // 2 symbols × 2 tfs × 3 bars
        expect(emitted).toHaveLength(12);
        expect(emitted[0].ev).toBe('kline');
        expect(emitted[0].data).toMatchObject({ symbol: 'BTCUSDT', tf: '5m', rawExchange: 'bybit' });
    });

    it('emits them OLDEST FIRST — bars are appended in order', async () => {
        const emitted = [];
        await seedHistory({
            symbols: ['BTCUSDT'], timeframes: ['5m'], limit: 3,
            // Bybit hands history back newest-first
            fetchKlines: async () => [tuple(3000, 3), tuple(2000, 2), tuple(1000, 1)],
            emit: (ev, data) => emitted.push(data),
        });
        expect(emitted.map((b) => b.ts)).toEqual([1000, 2000, 3000])
    });

    it('marks seeded bars as confirmed — they are closed candles', async () => {
        const emitted = [];
        await seedHistory({
            symbols: ['BTCUSDT'], timeframes: ['5m'], limit: 1,
            fetchKlines: async () => [tuple(1000, 1)],
            emit: (ev, data) => emitted.push(data),
        });
        expect(emitted[0].confirmed).toBe(true);
    });

    it('asks for enough bars to clear the readiness bar of 50', async () => {
        let askedFor = 0;
        await seedHistory({
            symbols: ['BTCUSDT'], timeframes: ['5m'],
            fetchKlines: async (_s, _tf, limit) => { askedFor = limit; return [tuple(1000, 1)]; },
            emit: () => {},
        });
        expect(askedFor).toBeGreaterThanOrEqual(50);
    });

    it('carries real prices through, not placeholders', async () => {
        const emitted = [];
        await seedHistory({
            symbols: ['BTCUSDT'], timeframes: ['5m'], limit: 1,
            fetchKlines: async () => [tuple(1000, 12345.5)],
            emit: (ev, data) => emitted.push(data),
        });
        expect(emitted[0].close).toBe(12345.5);
        expect(emitted[0].open).toBe(100);
    });

    it('skips a symbol whose history cannot be fetched, and keeps going', async () => {
        const emitted = [];
        const res = await seedHistory({
            symbols: ['BTCUSDT', 'ETHUSDT'], timeframes: ['5m'], limit: 1,
            fetchKlines: async (sym) => (sym === 'BTCUSDT' ? null : [tuple(1000, 1)]),
            emit: (ev, data) => emitted.push(data),
        });
        expect(res.bars).toBe(1);
        expect(emitted[0].symbol).toBe('ETHUSDT');
    });

    it('never throws, whatever REST does', async () => {
        await expect(seedHistory({
            symbols: ['BTCUSDT'], timeframes: ['5m'],
            fetchKlines: async () => { throw new Error('network'); },
            emit: () => {},
        })).resolves.toMatchObject({ bars: 0 });

        await expect(seedHistory({})).resolves.toMatchObject({ bars: 0 });
    });

    it('drops malformed rows instead of emitting rubbish into the chart', async () => {
        const emitted = [];
        await seedHistory({
            symbols: ['BTCUSDT'], timeframes: ['5m'], limit: 3,
            fetchKlines: async () => [tuple(1000, 1), ['x'], null, [NaN, 'a', 'b', 'c', 'd', 'e']],
            emit: (ev, data) => emitted.push(data),
        });
        expect(emitted).toHaveLength(1);
        expect(emitted[0].ts).toBe(1000);
    });
});

describe('it waits out the boot gate instead of giving up', () => {
    // The scheduler answers early-boot market-data calls with a synthetic 503
    // (reason=warm_class_b) to protect the Binance weight budget. The first
    // seed attempt lands inside that window and comes back empty, which is how
    // the first version of this shipped: "history seeded: 0 bars".
    it('retries until bars actually arrive', async () => {
        let calls = 0;
        const slept = [];
        const res = await seedHistory({
            symbols: ['BTCUSDT'], timeframes: ['5m'], limit: 1,
            attempts: 4,
            sleep: async (ms) => { slept.push(ms); },
            fetchKlines: async () => {
                calls++;
                return calls < 3 ? null : [[1000, '1', '2', '0.5', '1.5', '10']];
            },
            emit: () => {},
        });
        expect(calls).toBe(3);
        expect(res.bars).toBe(1);
        expect(slept.length).toBe(2);
        expect(slept[1]).toBeGreaterThan(slept[0]);   // backs off
    });

    it('gives up after its attempts rather than retrying forever', async () => {
        let calls = 0;
        const res = await seedHistory({
            symbols: ['BTCUSDT'], timeframes: ['5m'],
            attempts: 3, sleep: async () => {},
            fetchKlines: async () => { calls++; return null; },
            emit: () => {},
        });
        expect(calls).toBe(3);
        expect(res.bars).toBe(0);
    });

    it('does not retry when the first attempt worked', async () => {
        let calls = 0;
        await seedHistory({
            symbols: ['BTCUSDT'], timeframes: ['5m'], attempts: 4, sleep: async () => {},
            fetchKlines: async () => { calls++; return [[1000, '1', '2', '0.5', '1.5', '10']]; },
            emit: () => {},
        });
        expect(calls).toBe(1);
    });
});
