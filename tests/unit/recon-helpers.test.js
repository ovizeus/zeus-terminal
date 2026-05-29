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

const { buildBinanceHeldMap, findExitTrade, buildHeldMap, groupPositionsByExchange } = require('../../server/services/reconHelpers');

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

    // [P2c.1] Normalized exchangeOps.getUserTrades uses `ts` (Number), not `time`.
    // findExitTrade must read both so it works for Binance AND Bybit normalized trades.
    test('[P2c.1] accepts normalized trade with `ts` instead of `time`', () => {
        const trades = [{ symbol: 'BTCUSDT', side: 'SELL', qty: '0.5', price: '50000', realizedPnl: '100', ts: 2000 }];
        const result = findExitTrade(trades, pos({ side: 'LONG', openTs: 1000 }));
        expect(result).toBeTruthy();
        expect(result.price).toBe('50000');
    });

    test('[P2c.1] rejects normalized trade with ts <= openTs', () => {
        const trades = [{ symbol: 'BTCUSDT', side: 'SELL', qty: '0.5', price: '50000', realizedPnl: '100', ts: 500 }];
        const result = findExitTrade(trades, pos({ side: 'LONG', openTs: 1000 }));
        expect(result).toBeNull();
    });
});

// [P2c.1] Generic held-map from exchangeOps.getPositions NORMALIZED output
// ({symbol, side:LONG/SHORT, qty, entryPrice, markPrice, ...}) — replaces the
// Binance-raw buildBinanceHeldMap in cross-exchange recon. Keyed symbol_side.
describe('[P2c.1] buildHeldMap (normalized, cross-exchange)', () => {
    test('keys normalized positions by symbol_side', () => {
        const positions = [
            { symbol: 'BTCUSDT', side: 'LONG', qty: '0.5', entryPrice: '50000', markPrice: '51000' },
            { symbol: 'ETHUSDT', side: 'SHORT', qty: '2', entryPrice: '3000', markPrice: '2900' },
        ];
        const map = buildHeldMap(positions);
        expect(map.size).toBe(2);
        expect(map.has('BTCUSDT_LONG')).toBe(true);
        expect(map.has('ETHUSDT_SHORT')).toBe(true);
        const btc = map.get('BTCUSDT_LONG');
        expect(btc.side).toBe('LONG');
        expect(btc.symbol).toBe('BTCUSDT');
        expect(btc.markPrice).toBe(51000);
        expect(btc.qty).toBe(0.5);
    });

    test('emits orphan-branch-compatible fields (amt, entryPrice, unrealizedProfit)', () => {
        const positions = [
            { symbol: 'BTCUSDT', side: 'LONG', qty: '0.5', entryPrice: '50000', markPrice: '51000', unrealizedPnl: '500' },
        ];
        const held = buildHeldMap(positions).get('BTCUSDT_LONG');
        expect(held.amt).toBe(0.5);                 // = qty (sign-agnostic; orphan uses Math.abs)
        expect(held.entryPrice).toBe(50000);
        expect(held.unrealizedProfit).toBe(500);    // mapped from normalized unrealizedPnl
    });

    test('HEDGE mode preserves LONG + SHORT same symbol', () => {
        const positions = [
            { symbol: 'BTCUSDT', side: 'LONG', qty: '0.5', markPrice: '51000' },
            { symbol: 'BTCUSDT', side: 'SHORT', qty: '0.3', markPrice: '51000' },
        ];
        const map = buildHeldMap(positions);
        expect(map.size).toBe(2);
        expect(map.get('BTCUSDT_LONG').qty).toBe(0.5);
        expect(map.get('BTCUSDT_SHORT').qty).toBe(0.3);
    });

    test('skips zero/invalid qty', () => {
        const positions = [
            { symbol: 'BTCUSDT', side: 'LONG', qty: '0' },
            { symbol: 'ETHUSDT', side: 'LONG', qty: '1', markPrice: '3100' },
        ];
        const map = buildHeldMap(positions);
        expect(map.size).toBe(1);
        expect(map.has('ETHUSDT_LONG')).toBe(true);
    });

    test('handles empty/null gracefully', () => {
        expect(buildHeldMap([]).size).toBe(0);
        expect(buildHeldMap(null).size).toBe(0);
        expect(buildHeldMap(undefined).size).toBe(0);
    });
});

// [P2c.1] Group live positions by their own exchange so recon can fetch each
// exchange's held positions with the right creds (getExchangeCredsFor via
// exchangeOps exchangeOverride). Null/missing exchange → 'binance' (legacy rows).
describe('[P2c.1] groupPositionsByExchange', () => {
    test('groups by pos.exchange', () => {
        const positions = [
            { seq: 1, exchange: 'binance' },
            { seq: 2, exchange: 'bybit' },
            { seq: 3, exchange: 'binance' },
        ];
        const groups = groupPositionsByExchange(positions);
        expect(groups.get('binance').map(p => p.seq)).toEqual([1, 3]);
        expect(groups.get('bybit').map(p => p.seq)).toEqual([2]);
    });

    test('null/missing exchange falls back to binance', () => {
        const positions = [{ seq: 1, exchange: null }, { seq: 2 }];
        const groups = groupPositionsByExchange(positions);
        expect(groups.get('binance').map(p => p.seq)).toEqual([1, 2]);
        expect(groups.has('bybit')).toBe(false);
    });

    test('empty/null input → empty map', () => {
        expect(groupPositionsByExchange([]).size).toBe(0);
        expect(groupPositionsByExchange(null).size).toBe(0);
    });
});
