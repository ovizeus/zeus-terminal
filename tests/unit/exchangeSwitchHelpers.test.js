'use strict';

// P3 (multi-exchange switch) — summarizeOpenPositions(rows).
// The /switch route no longer blocks on open positions; instead it returns a
// per-exchange count of positions on the previous exchange(s) so the client can
// confirm "BINANCE has N open positions — they stay managed on Binance".

const { summarizeOpenPositions } = require('../../server/routes/exchangeSwitchHelpers');

describe('summarizeOpenPositions(rows)', () => {
    test('empty → []', () => {
        expect(summarizeOpenPositions([])).toEqual([]);
    });

    test('counts per exchange', () => {
        const rows = [
            { exchange: 'binance' }, { exchange: 'binance' }, { exchange: 'bybit' },
        ];
        expect(summarizeOpenPositions(rows)).toEqual([
            { exchange: 'binance', count: 2 },
            { exchange: 'bybit', count: 1 },
        ]);
    });

    test('sorts by count desc, then exchange asc for ties', () => {
        const rows = [
            { exchange: 'bybit' }, { exchange: 'binance' },
        ];
        expect(summarizeOpenPositions(rows)).toEqual([
            { exchange: 'binance', count: 1 },
            { exchange: 'bybit', count: 1 },
        ]);
    });

    test('null/missing exchange falls back to "binance" (legacy pre-stamp rows)', () => {
        const rows = [{ exchange: null }, {}, { exchange: 'binance' }];
        expect(summarizeOpenPositions(rows)).toEqual([
            { exchange: 'binance', count: 3 },
        ]);
    });

    test('tolerates a null/garbage rows array', () => {
        expect(summarizeOpenPositions(null)).toEqual([]);
        expect(summarizeOpenPositions(undefined)).toEqual([]);
    });
});
