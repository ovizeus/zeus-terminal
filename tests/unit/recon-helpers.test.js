/**
 * Zeus Terminal — Unit Tests: reconHelpers (BUG-T2a + T2b 2026-05-13)
 *
 * Two pure-function helpers extracted din _runReconciliation pentru testability:
 *
 *   1. buildBinanceHeldMap(binancePositions) — keys by (symbol_side) tuple
 *      pentru HEDGE mode awareness (BUG-T2a). Pre-T2a: keyed by symbol only,
 *      collapsed LONG+SHORT same symbol în HEDGE mode.
 *
 *   2. findExitTrade(trades, pos) — strict filter pentru userTrades fallback
 *      (BUG-T2b). Pre-T2b: any trade cu realizedPnl≠0 matched, could pick up
 *      UNRELATED trade. Post-T2b: must be AFTER pos.openTs, opposite side,
 *      qty ≥95% of position size.
 */
'use strict';

const { buildBinanceHeldMap, findExitTrade } = require('../../server/services/reconHelpers');

describe('BUG-T2a: buildBinanceHeldMap (hedge mode aware)', () => {

    test('keys ONE-WAY mode position by symbol_side', () => {
        const bps = [
            { symbol: 'BTCUSDT', positionAmt: '0.5', entryPrice: '50000', markPrice: '51000', unRealizedProfit: '500' },
        ];
        const map = buildBinanceHeldMap(bps);
        expect(map.size).toBe(1);
        expect(map.has('BTCUSDT_LONG')).toBe(true);
        const held = map.get('BTCUSDT_LONG');
        expect(held.side).toBe('LONG');
        expect(held.amt).toBe(0.5);
        expect(held.entryPrice).toBe(50000);
    });

    test('HEDGE mode preserves both LONG + SHORT same symbol', () => {
        const bps = [
            { symbol: 'BTCUSDT', positionAmt: '0.5', entryPrice: '50000', markPrice: '51000', unRealizedProfit: '500' },
            { symbol: 'BTCUSDT', positionAmt: '-0.3', entryPrice: '52000', markPrice: '51000', unRealizedProfit: '300' },
        ];
        const map = buildBinanceHeldMap(bps);
        expect(map.size).toBe(2);
        expect(map.has('BTCUSDT_LONG')).toBe(true);
        expect(map.has('BTCUSDT_SHORT')).toBe(true);
        expect(map.get('BTCUSDT_LONG').amt).toBe(0.5);
        expect(map.get('BTCUSDT_SHORT').amt).toBe(-0.3);
    });

    test('skips zero positionAmt', () => {
        const bps = [
            { symbol: 'BTCUSDT', positionAmt: '0', entryPrice: '50000' },
            { symbol: 'ETHUSDT', positionAmt: '1.0', entryPrice: '3000', markPrice: '3100', unRealizedProfit: '100' },
        ];
        const map = buildBinanceHeldMap(bps);
        expect(map.size).toBe(1);
        expect(map.has('ETHUSDT_LONG')).toBe(true);
        expect(map.has('BTCUSDT_LONG')).toBe(false);
    });

    test('handles malformed input gracefully (empty/null)', () => {
        expect(buildBinanceHeldMap([]).size).toBe(0);
        expect(buildBinanceHeldMap(null).size).toBe(0);
        expect(buildBinanceHeldMap(undefined).size).toBe(0);
    });
});

describe('BUG-T2b: findExitTrade (strict validation)', () => {

    // Helper: mock trade object
    function trade(overrides) {
        return Object.assign({
            symbol: 'BTCUSDT', side: 'SELL', qty: '0.5', price: '50000',
            realizedPnl: '100', time: 2000,
        }, overrides);
    }

    function pos(overrides) {
        return Object.assign({
            symbol: 'BTCUSDT', side: 'LONG', qty: 0.5, openTs: 1000,
        }, overrides);
    }

    test('returns trade matching side opposite + time after + qty match', () => {
        const trades = [trade({ time: 2000 })];
        const result = findExitTrade(trades, pos({ side: 'LONG' }));
        expect(result).toBeTruthy();
        expect(result.price).toBe('50000');
    });

    test('REJECTS trade with time <= pos.openTs (old trade)', () => {
        const trades = [trade({ time: 500 })];  // BEFORE openTs=1000
        const result = findExitTrade(trades, pos({ openTs: 1000 }));
        expect(result).toBeNull();
    });

    test('REJECTS trade with wrong side (LONG must exit SELL)', () => {
        const trades = [trade({ side: 'BUY' })];  // BUY = entry side for LONG, not exit
        const result = findExitTrade(trades, pos({ side: 'LONG' }));
        expect(result).toBeNull();
    });

    test('SHORT position requires BUY exit trade', () => {
        const trades = [trade({ side: 'BUY' })];
        const result = findExitTrade(trades, pos({ side: 'SHORT' }));
        expect(result).toBeTruthy();
    });

    test('REJECTS trade with qty <95% of pos qty', () => {
        const trades = [trade({ qty: '0.4' })];  // 80% of pos.qty=0.5
        const result = findExitTrade(trades, pos());
        expect(result).toBeNull();
    });

    test('ACCEPTS trade with qty ≥95% of pos qty', () => {
        const trades = [trade({ qty: '0.475' })];  // 95% exact
        const result = findExitTrade(trades, pos());
        expect(result).toBeTruthy();
    });

    test('REJECTS trade with realizedPnl=0 (not an exit)', () => {
        const trades = [trade({ realizedPnl: '0' })];
        const result = findExitTrade(trades, pos());
        expect(result).toBeNull();
    });

    test('REJECTS trade for wrong symbol', () => {
        const trades = [trade({ symbol: 'ETHUSDT' })];
        const result = findExitTrade(trades, pos({ symbol: 'BTCUSDT' }));
        expect(result).toBeNull();
    });

    test('handles empty trades array', () => {
        expect(findExitTrade([], pos())).toBeNull();
        expect(findExitTrade(null, pos())).toBeNull();
    });

    test('picks MOST RECENT valid trade (reverse iteration)', () => {
        const trades = [
            trade({ time: 1500, price: '49000' }),  // valid but older
            trade({ time: 2500, price: '51000' }),  // valid and newer
        ];
        const result = findExitTrade(trades, pos());
        expect(result.price).toBe('51000');  // newest wins
    });

    test('handles missing pos.openTs (defaults 0)', () => {
        const trades = [trade({ time: 100 })];
        // pos.openTs missing → treated as 0 → t.time=100 > 0 passes
        const result = findExitTrade(trades, pos({ openTs: undefined }));
        expect(result).toBeTruthy();
    });
});
