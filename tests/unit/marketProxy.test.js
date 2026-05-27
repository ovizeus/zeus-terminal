'use strict';

const express = require('express');
const request = require('supertest');

let mockGatewayFetch = jest.fn();
jest.mock('../../server/services/binanceGateway', () => ({
    fetch: (...args) => mockGatewayFetch(...args),
}));
jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

let app;
beforeEach(() => {
    jest.resetModules();
    mockGatewayFetch = jest.fn();
    const proxy = require('../../server/routes/marketProxy');
    app = express();
    app.use('/api/market', proxy);
});

describe('marketProxy', () => {
    // ── Klines ──

    test('GET /klines proxies to Binance with correct params', async () => {
        mockGatewayFetch.mockResolvedValueOnce({
            ok: true, status: 200,
            json: async () => [[1700000000000, '75000', '75100', '74900', '75050', '100']],
        });
        const res = await request(app).get('/api/market/klines?symbol=BTCUSDT&interval=5m&limit=100');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(mockGatewayFetch).toHaveBeenCalledWith(
            expect.stringContaining('/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=100'),
            expect.any(Object)
        );
    });

    test('GET /klines returns cached data on second call within TTL', async () => {
        mockGatewayFetch.mockResolvedValue({
            ok: true, status: 200,
            json: async () => [[1, '2', '3', '4', '5', '6']],
        });
        await request(app).get('/api/market/klines?symbol=BTCUSDT&interval=5m&limit=1');
        await request(app).get('/api/market/klines?symbol=BTCUSDT&interval=5m&limit=1');
        expect(mockGatewayFetch).toHaveBeenCalledTimes(1);
    });

    test('GET /klines returns 400 on missing symbol', async () => {
        const res = await request(app).get('/api/market/klines?interval=5m&limit=100');
        expect(res.status).toBe(400);
    });

    // ── Ticker24hr ──

    test('GET /ticker24hr proxies to Binance', async () => {
        mockGatewayFetch.mockResolvedValueOnce({
            ok: true, status: 200,
            json: async () => [{ symbol: 'BTCUSDT', priceChangePercent: '-1.5' }],
        });
        const res = await request(app).get('/api/market/ticker24hr');
        expect(res.status).toBe(200);
        expect(res.body[0].symbol).toBe('BTCUSDT');
    });

    test('GET /ticker24hr caches for 30s', async () => {
        mockGatewayFetch.mockResolvedValue({
            ok: true, status: 200,
            json: async () => [{ symbol: 'BTCUSDT' }],
        });
        await request(app).get('/api/market/ticker24hr');
        await request(app).get('/api/market/ticker24hr');
        expect(mockGatewayFetch).toHaveBeenCalledTimes(1);
    });

    // ── TopLongShort ──

    test('GET /topLongShort proxies with symbol param', async () => {
        mockGatewayFetch.mockResolvedValueOnce({
            ok: true, status: 200,
            json: async () => [{ longShortRatio: '1.5' }],
        });
        const res = await request(app).get('/api/market/topLongShort?symbol=BTCUSDT');
        expect(res.status).toBe(200);
        expect(mockGatewayFetch).toHaveBeenCalledWith(
            expect.stringContaining('topLongShortPositionRatio'),
            expect.any(Object)
        );
    });

    // ── Dedup (pending promise) ──

    test('concurrent identical requests result in single Binance call', async () => {
        mockGatewayFetch.mockImplementation(() => new Promise(resolve => {
            setTimeout(() => resolve({
                ok: true, status: 200,
                json: async () => [[1, '2', '3', '4', '5', '6']],
            }), 50);
        }));
        const [r1, r2] = await Promise.all([
            request(app).get('/api/market/klines?symbol=ETHUSDT&interval=1h&limit=50'),
            request(app).get('/api/market/klines?symbol=ETHUSDT&interval=1h&limit=50'),
        ]);
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(mockGatewayFetch).toHaveBeenCalledTimes(1);
    });

    // ── Error handling ──

    test('returns 502 when Binance returns error', async () => {
        mockGatewayFetch.mockResolvedValueOnce({
            ok: false, status: 503,
            json: async () => ({ code: 'RATE_LIMITED' }),
        });
        const res = await request(app).get('/api/market/klines?symbol=BTCUSDT&interval=5m&limit=1');
        expect(res.status).toBe(502);
    });

    test('returns 502 when gateway throws', async () => {
        mockGatewayFetch.mockRejectedValueOnce(new Error('network fail'));
        const res = await request(app).get('/api/market/klines?symbol=BTCUSDT&interval=5m&limit=1');
        expect(res.status).toBe(502);
    });

    // ── Spot klines (onChainMetrics) ──

    test('GET /spot/klines proxies to api.binance.com', async () => {
        mockGatewayFetch.mockResolvedValueOnce({
            ok: true, status: 200,
            json: async () => [[1, '2', '3', '4', '5', '6']],
        });
        const res = await request(app).get('/api/market/spot/klines?symbol=BTCUSDT&interval=1w&limit=210');
        expect(res.status).toBe(200);
        expect(mockGatewayFetch).toHaveBeenCalledWith(
            expect.stringContaining('api.binance.com'),
            expect.any(Object)
        );
    });
});
