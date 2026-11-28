'use strict';
// [2026-11-28] Cartea de ordine pe VPS: fstream trimite 0 cadre catre Hetzner, deci `market.depth`
// din proxy nu vine niciodata si panoul OB / alertele de balene / zidurile erau goale. Ruta noua
// citeste cartea prin REST (limit 20, greutate 2), cu cache scurt impartit de toti clientii.

const express = require('express');
const request = require('supertest');

let mockGatewayFetch = jest.fn();
jest.mock('../../server/services/binanceGateway', () => ({ fetch: (...a) => mockGatewayFetch(...a) }));
jest.mock('../../server/services/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const BOOK = { lastUpdateId: 1, bids: [['100.5', '2'], ['100.4', '1']], asks: [['100.6', '3'], ['100.7', '4']] };
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

let app, proxy;
beforeEach(() => {
    jest.resetModules();
    mockGatewayFetch = jest.fn();
    proxy = require('../../server/routes/marketProxy');
    app = express();
    app.use('/api/market', proxy);
});

describe('GET /api/market/orderbook', () => {
    test('citeste 20 de niveluri de pe Binance si le da in forma clientului {p,q}', async () => {
        mockGatewayFetch.mockResolvedValueOnce(ok(BOOK));
        const res = await request(app).get('/api/market/orderbook?symbol=BTCUSDT');
        expect(res.status).toBe(200);
        expect(res.body.bids).toEqual([{ p: 100.5, q: 2 }, { p: 100.4, q: 1 }]);
        expect(res.body.asks).toEqual([{ p: 100.6, q: 3 }, { p: 100.7, q: 4 }]);
        expect(res.body.ts).toBeGreaterThan(0);
        const [url, opts] = mockGatewayFetch.mock.calls[0];
        expect(url).toBe('https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=20');
        expect(opts.__weight).toBe(2);
    });
    test('cache: multi clienti in aceeasi fereastra = O SINGURA cerere la Binance', async () => {
        mockGatewayFetch.mockResolvedValue(ok(BOOK));
        await Promise.all([1, 2, 3, 4, 5].map(() => request(app).get('/api/market/orderbook?symbol=BTCUSDT')));
        await request(app).get('/api/market/orderbook?symbol=btcusdt');
        expect(mockGatewayFetch).toHaveBeenCalledTimes(1);
    });
    test('simbol invalid → 400, fara cerere', async () => {
        for (const s of ['', 'BTC/USDT', 'A', 'x'.repeat(30), 'BTC&limit=1000']) {
            const res = await request(app).get('/api/market/orderbook?symbol=' + encodeURIComponent(s));
            expect(res.status).toBe(400);
        }
        expect(mockGatewayFetch).not.toHaveBeenCalled();
    });
    test('Binance refuza (rata / circuit) → 503, NU o carte veche', async () => {
        mockGatewayFetch.mockResolvedValueOnce({ ok: false, status: 503, _reason: 'rate_limit', json: async () => ({}) });
        const res = await request(app).get('/api/market/orderbook?symbol=BTCUSDT');
        expect(res.status).toBe(503);
    });
    test('raspuns stricat → 503', async () => {
        mockGatewayFetch.mockResolvedValueOnce(ok({ code: -1121, msg: 'Invalid symbol.' }));
        const res = await request(app).get('/api/market/orderbook?symbol=NOPEUSDT');
        expect(res.status).toBe(503);
    });
    test('plafon de simboluri distincte: nimeni nu poate arde greutatea cerand sute de monede', async () => {
        mockGatewayFetch.mockResolvedValue(ok(BOOK));
        const codes = [];
        for (let i = 0; i < proxy.ORDERBOOK_MAX_SYMBOLS + 3; i++) {
            codes.push((await request(app).get(`/api/market/orderbook?symbol=COIN${i}USDT`)).status);
        }
        expect(codes.filter((c) => c === 200)).toHaveLength(proxy.ORDERBOOK_MAX_SYMBOLS);
        expect(codes.slice(-3)).toEqual([503, 503, 503]);
        expect(mockGatewayFetch).toHaveBeenCalledTimes(proxy.ORDERBOOK_MAX_SYMBOLS);
        // o moneda deja in fereastra merge in continuare
        expect((await request(app).get('/api/market/orderbook?symbol=COIN0USDT')).status).toBe(200);
    });
});
