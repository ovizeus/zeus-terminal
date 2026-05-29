'use strict';

// Phase A / Task A3 — gateway must recognize the Binance TESTNET host
// (binancefuture.com) so testnet calls are tracked by the circuit breaker
// (separate from prod) instead of being 'unknown' and untracked — which let the
// hourly key-health probe trip 418 IP-bans on a banned IP unchecked.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-gwtestnet';

let extractExchange, poolForExchange;
beforeAll(() => {
    const gw = require('../../server/services/binanceGateway');
    extractExchange = gw._test.extractExchange;
    poolForExchange = gw._test.poolForExchange;
});

describe('_extractExchange — testnet host recognition', () => {
    test('prod futures host → binance', () => {
        expect(extractExchange('https://fapi.binance.com/fapi/v1/klines')).toBe('binance');
    });

    test('testnet REST host → binance-testnet (tracked, distinct from prod)', () => {
        expect(extractExchange('https://testnet.binancefuture.com/fapi/v2/balance')).toBe('binance-testnet');
    });

    test('testnet stream host → binance-testnet', () => {
        expect(extractExchange('https://stream.binancefuture.com/ws')).toBe('binance-testnet');
    });

    test('bybit / okx unchanged', () => {
        expect(extractExchange('https://api.bybit.com/v5/market/tickers')).toBe('bybit');
        expect(extractExchange('https://ws.okx.com/ws/v5/public')).toBe('okx');
    });

    test('unknown host stays unknown', () => {
        expect(extractExchange('https://example.com/x')).toBe('unknown');
    });

    test('null url defaults to binance (prod), not testnet', () => {
        expect(extractExchange(null)).toBe('binance');
    });
});

describe('_poolForExchange — testnet has no prod-pool (CB tracks, rate-limiter skips)', () => {
    test('binance → binance:futures pool', () => {
        expect(poolForExchange('binance')).toBe('binance:futures');
    });

    test('binance-testnet → null (does not share/contaminate the prod weight pool)', () => {
        expect(poolForExchange('binance-testnet')).toBeNull();
    });

    test('bybit → bybit:v5', () => {
        expect(poolForExchange('bybit')).toBe('bybit:v5');
    });
});
