/**
 * R-1 Test Harness — mockExchanges.js tests
 *
 * Verifies the mock exchange factory provides deterministic, configurable
 * stand-ins for Binance/Bybit/OKX during integration tests of R4 execution.
 */

const { createMockExchange } = require('../../../server/services/ml/R-1_testHarness/mockExchanges');

describe('R-1 Test Harness — mockExchanges', () => {
    test('module exports createMockExchange', () => {
        expect(typeof createMockExchange).toBe('function');
    });

    test('returns object with required exchange interface', () => {
        const ex = createMockExchange({ type: 'binance' });
        expect(typeof ex.getOrderBook).toBe('function');
        expect(typeof ex.placeOrder).toBe('function');
        expect(typeof ex.cancelOrder).toBe('function');
        expect(typeof ex.getPosition).toBe('function');
        expect(ex.type).toBe('binance');
    });

    test('supports binance, bybit, okx exchange types', () => {
        const bn = createMockExchange({ type: 'binance' });
        const by = createMockExchange({ type: 'bybit' });
        const ok = createMockExchange({ type: 'okx' });
        expect(bn.type).toBe('binance');
        expect(by.type).toBe('bybit');
        expect(ok.type).toBe('okx');
    });

    test('throws on invalid exchange type', () => {
        expect(() => createMockExchange({ type: 'kraken' })).toThrow(/invalid exchange type/i);
    });

    test('placeOrder returns deterministic id given same seed', async () => {
        const ex1 = createMockExchange({ type: 'binance', seed: 42 });
        const ex2 = createMockExchange({ type: 'binance', seed: 42 });
        const r1 = await ex1.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', qty: 0.01, type: 'MARKET' });
        const r2 = await ex2.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', qty: 0.01, type: 'MARKET' });
        expect(r1.orderId).toBe(r2.orderId);
    });

    test('different seeds produce different order ids', async () => {
        const ex1 = createMockExchange({ type: 'binance', seed: 1 });
        const ex2 = createMockExchange({ type: 'binance', seed: 2 });
        const r1 = await ex1.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', qty: 0.01, type: 'MARKET' });
        const r2 = await ex2.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', qty: 0.01, type: 'MARKET' });
        expect(r1.orderId).not.toBe(r2.orderId);
    });

    test('errorRate causes placeOrder to throw at given rate', async () => {
        const ex = createMockExchange({ type: 'binance', seed: 7, errorRate: 1.0 });
        await expect(ex.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', qty: 0.01, type: 'MARKET' }))
            .rejects.toThrow(/mock exchange error/i);
    });

    test('errorRate=0 never throws', async () => {
        const ex = createMockExchange({ type: 'binance', seed: 1, errorRate: 0 });
        for (let i = 0; i < 10; i++) {
            await expect(ex.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', qty: 0.01, type: 'MARKET' })).resolves.toBeDefined();
        }
    });

    test('getOrderBook returns shape with bids/asks/timestamp', async () => {
        const ex = createMockExchange({ type: 'binance', seed: 1 });
        const ob = await ex.getOrderBook('BTCUSDT');
        expect(Array.isArray(ob.bids)).toBe(true);
        expect(Array.isArray(ob.asks)).toBe(true);
        expect(typeof ob.timestamp).toBe('number');
    });
});
