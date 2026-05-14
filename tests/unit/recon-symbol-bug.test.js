/**
 * Zeus Terminal — Unit Tests: recon symbol normalization (BUG-RECON-SYMBOL 2026-05-14)
 *
 * Discovered 2026-05-14 in PM2 logs: recon block iterating `binanceHeld` map
 * (keyed by `SYMBOL_SIDE` composite, e.g. 'BTCUSDT_LONG') destructured the
 * KEY into a variable named `symbol`, then passed it to Binance API as the
 * `symbol` query param. Binance returns "Invalid symbol" because real symbol
 * is just 'BTCUSDT'.
 *
 * Impact (scope mai larg decât log spam):
 *   - openOrders query → "Invalid symbol" → recon CANNOT detect SAT_ orders
 *   - openAlgoOrders query → same
 *   - MARKET close for orphans → SILENT FAILURE on real orphans (auto-close
 *     never functional)
 *   - cancel order calls → same
 *   - pending orphan re-check `binanceHeld.has(pos.symbol)` uses pure key
 *     but map uses composite → mereu false → poziții valide false-marked
 *
 * Fix: include `symbol` field in map value object. Downstream callers read
 * `bpos.symbol` (pure) instead of the destructured composite key.
 *
 * Coverage:
 *   - Map value contains `symbol` field with pure (uncomposite) value
 *   - HEDGE mode preserves separate symbol field for LONG vs SHORT
 *   - Backward compat: existing fields preserved
 */
'use strict';

const { buildBinanceHeldMap } = require('../../server/services/reconHelpers');

describe('BUG-RECON-SYMBOL: buildBinanceHeldMap value contains pure symbol', () => {
    test('value object exposes `symbol` field with pure exchange symbol', () => {
        const bps = [
            { symbol: 'BTCUSDT', positionAmt: '0.5', entryPrice: '50000', markPrice: '51000', unRealizedProfit: '500' },
        ];
        const map = buildBinanceHeldMap(bps);
        const held = map.get('BTCUSDT_LONG');
        expect(held).toBeDefined();
        expect(held.symbol).toBe('BTCUSDT');
        // Must NOT equal the composite key — that's the whole point
        expect(held.symbol).not.toBe('BTCUSDT_LONG');
    });

    test('HEDGE mode — both entries have correct pure symbol', () => {
        const bps = [
            { symbol: 'BTCUSDT', positionAmt: '0.5', entryPrice: '50000', markPrice: '51000', unRealizedProfit: '500' },
            { symbol: 'BTCUSDT', positionAmt: '-0.3', entryPrice: '52000', markPrice: '51000', unRealizedProfit: '300' },
        ];
        const map = buildBinanceHeldMap(bps);
        expect(map.get('BTCUSDT_LONG').symbol).toBe('BTCUSDT');
        expect(map.get('BTCUSDT_SHORT').symbol).toBe('BTCUSDT');
    });

    test('multiple symbols — each preserves pure symbol independently', () => {
        const bps = [
            { symbol: 'ETHUSDT', positionAmt: '1.0', entryPrice: '3000', markPrice: '3100', unRealizedProfit: '100' },
            { symbol: 'ZECUSDT', positionAmt: '-18.343', entryPrice: '545', markPrice: '546', unRealizedProfit: '-22' },
        ];
        const map = buildBinanceHeldMap(bps);
        expect(map.get('ETHUSDT_LONG').symbol).toBe('ETHUSDT');
        expect(map.get('ZECUSDT_SHORT').symbol).toBe('ZECUSDT');
        // Sanity: pure symbol is downstream-safe (no underscore)
        expect(map.get('ETHUSDT_LONG').symbol).not.toContain('_');
        expect(map.get('ZECUSDT_SHORT').symbol).not.toContain('_');
    });

    test('backward compat: existing fields (amt, side, entryPrice, etc.) preserved', () => {
        const bps = [
            { symbol: 'BTCUSDT', positionAmt: '0.5', entryPrice: '50000', markPrice: '51000', unRealizedProfit: '500' },
        ];
        const held = buildBinanceHeldMap(bps).get('BTCUSDT_LONG');
        expect(held.amt).toBe(0.5);
        expect(held.side).toBe('LONG');
        expect(held.entryPrice).toBe(50000);
        expect(held.markPrice).toBe(51000);
        expect(held.unrealizedProfit).toBe(500);
    });
});
