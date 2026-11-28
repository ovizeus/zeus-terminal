'use strict';
// [2026-11-28] Pretul de pe server sarea inapoi cate putin. Cu ALT_WS_FEEDS veneau DOUA surse
// amestecate: ticker/price la 3 s si close-ul lumanarii de la fiecare poller de kline (3 TF × 30 s).
// Masurat pe VPS: cele doua difera cu ±10 $ in ambele sensuri, iar `time` din ticker ramane
// in urma pana la 5,7 s. Acum: o singura sursa (ticker), in ordinea timpului de la Binance;
// close-ul de kline ramane doar REZERVA cand tickerul tace.

jest.mock('../../server/services/binanceGateway', () => ({ fetch: jest.fn() }));
const mf = require('../../server/services/marketFeed');

beforeEach(() => mf._resetPriceGateForTest());

describe('o singura sursa de pret', () => {
    test('raspuns de ticker MAI VECHI decat ultimul emis e aruncat (sosit pe dos)', () => {
        expect(mf._acceptTickerPrice('BTCUSDT', 100, 2000, 10000)).toBe(true);
        expect(mf._acceptTickerPrice('BTCUSDT', 99, 1500, 10100)).toBe(false);
        expect(mf._acceptTickerPrice('BTCUSDT', 101, 2500, 10200)).toBe(true);
    });
    test('acelasi timp de la Binance trece (pret neschimbat, prospetimea se pastreaza)', () => {
        expect(mf._acceptTickerPrice('BTCUSDT', 100, 2000, 10000)).toBe(true);
        expect(mf._acceptTickerPrice('BTCUSDT', 100, 2000, 13000)).toBe(true);
    });
    test('fara `time` in raspuns tot trece (nu orbim pretul)', () => {
        expect(mf._acceptTickerPrice('BTCUSDT', 100, undefined, 10000)).toBe(true);
        expect(mf._acceptTickerPrice('BTCUSDT', 100, NaN, 10100)).toBe(true);
    });
    test('close-ul de kline NU e emis ca pret cat timp tickerul e proaspat', () => {
        mf._acceptTickerPrice('BTCUSDT', 100, 2000, 10000);
        expect(mf._klinePriceAllowed('BTCUSDT', 12000)).toBe(false);
    });
    test('close-ul de kline e REZERVA cand tickerul tace (> 2 cicluri)', () => {
        expect(mf._klinePriceAllowed('BTCUSDT', 10000)).toBe(true); // ticker nepornit inca
        mf._acceptTickerPrice('BTCUSDT', 100, 2000, 10000);
        expect(mf._klinePriceAllowed('BTCUSDT', 10000 + 2 * 3000 + 1)).toBe(true);
    });
    test('monedele sunt independente', () => {
        mf._acceptTickerPrice('BTCUSDT', 100, 5000, 10000);
        expect(mf._acceptTickerPrice('ETHUSDT', 3000, 1000, 10000)).toBe(true);
        expect(mf._klinePriceAllowed('ETHUSDT', 10000)).toBe(false);
        expect(mf._klinePriceAllowed('SOLUSDT', 10000)).toBe(true);
    });
});
