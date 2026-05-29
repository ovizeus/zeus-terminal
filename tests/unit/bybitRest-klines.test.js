'use strict';

// Phase B / Task B3b — Bybit REST kline fallback for the chart.
// When Binance is IP-blocked, fetch klines from Bybit REST (which works from our IP)
// and normalize to Binance array shape so the client chart consumes them unchanged.
// Pure helpers tested here; fetchKlines (network) verified by code-read.
//
// Bybit V5 /v5/market/kline result.list: [startMs, open, high, low, close, volume, turnover]
//   as STRINGS, NEWEST-FIRST.
// Binance klines: [openTime(number), open, high, low, close, volume, ...], OLDEST-FIRST.
// Client reads indices 0..5 (klines.ts:209, marketDataChart.ts:209).

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-bybitrest';

let toBybitInterval, normalizeKlines;
beforeAll(() => {
    const br = require('../../server/services/bybitRest');
    toBybitInterval = br._test.toBybitInterval;
    normalizeKlines = br._test.normalizeKlines;
});

describe('_toBybitInterval — Binance → Bybit interval map', () => {
    test('minute/hour/day intervals map correctly', () => {
        expect(toBybitInterval('1m')).toBe('1');
        expect(toBybitInterval('5m')).toBe('5');
        expect(toBybitInterval('15m')).toBe('15');
        expect(toBybitInterval('1h')).toBe('60');
        expect(toBybitInterval('4h')).toBe('240');
        expect(toBybitInterval('1d')).toBe('D');
    });

    test('unsupported interval → null', () => {
        expect(toBybitInterval('7m')).toBeNull();
        expect(toBybitInterval('')).toBeNull();
        expect(toBybitInterval(undefined)).toBeNull();
    });
});

describe('_normalizeKlines — Bybit list → Binance-shape, oldest-first', () => {
    const bybitNewestFirst = [
        ['1780048800000', '73705.7', '73707.2', '73604.2', '73627.1', '307.1', '22626727.6'],
        ['1780045200000', '73620.9', '73877.5', '73611.3', '73705.7', '1118.4', '82516492.4'],
        ['1780041600000', '73480', '73798.6', '73480', '73620.9', '1842.1', '135756488.0'],
    ];

    test('reverses to oldest-first (Binance order)', () => {
        const out = normalizeKlines(bybitNewestFirst);
        expect(out[0][0]).toBe(1780041600000); // oldest first, numeric openTime
        expect(out[2][0]).toBe(1780048800000); // newest last
    });

    test('indices 0..5 map to openTime/o/h/l/c/v (client-consumed fields)', () => {
        const out = normalizeKlines(bybitNewestFirst);
        const newest = out[2];
        expect(newest[0]).toBe(1780048800000); // openTime numeric
        expect(newest[1]).toBe('73705.7');     // open
        expect(newest[2]).toBe('73707.2');     // high
        expect(newest[3]).toBe('73604.2');     // low
        expect(newest[4]).toBe('73627.1');     // close
        expect(newest[5]).toBe('307.1');       // volume
    });

    test('produces Binance-compatible length (>=6 elements)', () => {
        const out = normalizeKlines(bybitNewestFirst);
        expect(out[0].length).toBeGreaterThanOrEqual(6);
    });

    test('non-array input → empty array (safe)', () => {
        expect(normalizeKlines(null)).toEqual([]);
        expect(normalizeKlines(undefined)).toEqual([]);
        expect(normalizeKlines('x')).toEqual([]);
    });
});
