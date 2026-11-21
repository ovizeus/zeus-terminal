'use strict';
// [2026-11-21] Market Radar nu mai arata NICIO lichidare: fluxul Binance !forceOrder nu livreaza nimic
// pe aceasta retea (masurat: 0 cadre in 40 s). Agregatorul (Bybit / OKX / Gate) trimite acum si aici.
const radarCache = require('../../server/services/radarCache');
const feed = require('../../server/services/liquidationFeed');

const sent = [];
beforeAll(() => { global.__zeusWsBroadcastAll = (m) => { sent.push(m); return 1; }; });
afterAll(() => { delete global.__zeusWsBroadcastAll; });

const liq = (o = {}) => Object.assign({ exchange: 'bybit', symbol: 'BTCUSDT', side: 'SELL', isLong: true, p: 90000, q: 2, vol: 180000, time: Date.now() }, o);

describe('Market Radar primeste lichidarile din agregator', () => {
    test('o lichidare de long > $100K ajunge ca liqLong rosu, cu valoarea si bursa', () => {
        const n0 = sent.length;
        expect(feed.ingestAggregated(liq())).toBe(true);
        const ev = sent[sent.length - 1].data;
        expect(sent.length).toBe(n0 + 1);
        expect(ev).toMatchObject({ symbol: 'BTCUSDT', category: 'liqLong', color: 'red', notional: 180000, source: 'bybit' });
    });
    test('sub $100K nu urca', () => {
        expect(feed.ingestAggregated(liq({ symbol: 'ETHUSDT', vol: 5000, p: 2500, q: 2 }))).toBe(false);
    });
    test('Binance NU trece pe aici (are calea lui) — nu se numara de doua ori', () => {
        expect(feed.ingestAggregated(liq({ exchange: 'binance', symbol: 'SOLUSDT', vol: 500000 }))).toBe(false);
    });
    test('aceeasi moneda si parte in 30 s = o singura bula', () => {
        expect(feed.ingestAggregated(liq({ symbol: 'XRPUSDT', side: 'BUY', vol: 300000 }))).toBe(true);
        expect(feed.ingestAggregated(liq({ symbol: 'XRPUSDT', side: 'BUY', vol: 400000, exchange: 'okx' }))).toBe(false);
    });
    test('un eveniment stricat nu arunca', () => {
        for (const bad of [null, {}, liq({ side: 'X' }), liq({ p: 0 }), liq({ symbol: 'BTCUSD' })]) expect(() => feed.ingestAggregated(bad)).not.toThrow();
    });
    test('apare in cache-ul radarului (clientii care se reconecteaza o vad)', () => {
        const snap = typeof radarCache.snapshot === 'function' ? radarCache.snapshot() : null;
        if (snap) expect(JSON.stringify(snap)).toContain('liqLong');
    });
});
