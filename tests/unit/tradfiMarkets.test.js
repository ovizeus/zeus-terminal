'use strict';
// [2026-11-21] MARKETS — piete traditionale prin Gate (services/tradfiMarkets.js).
const tm = require('../../server/services/tradfiMarkets');

const ET = (iso) => Date.parse(iso);   // ISO cu offset explicit

describe('orarul burselor (OPEN / CLOSED)', () => {
    test('NYSE: marti 10:00 New York = deschis; 16:30 = inchis; sambata = inchis', () => {
        expect(tm.isOpen('us', ET('2026-11-17T10:00:00-05:00'))).toBe(true);
        expect(tm.isOpen('us', ET('2026-11-17T16:30:00-05:00'))).toBe(false);
        expect(tm.isOpen('us', ET('2026-11-21T12:00:00-05:00'))).toBe(false);
    });
    test('marfuri: duminica 18:30 ET deschis, vineri 17:30 ET inchis, pauza zilnica 17–18', () => {
        expect(tm.isOpen('cmdty', ET('2026-11-22T18:30:00-05:00'))).toBe(true);
        expect(tm.isOpen('cmdty', ET('2026-11-20T17:30:00-05:00'))).toBe(false);
        expect(tm.isOpen('cmdty', ET('2026-11-18T17:30:00-05:00'))).toBe(false);
        expect(tm.isOpen('cmdty', ET('2026-11-18T03:00:00-05:00'))).toBe(true);
    });
    test('DAX dupa ora Berlinului', () => {
        expect(tm.isOpen('de', ET('2026-11-17T10:00:00+01:00'))).toBe(true);
        expect(tm.isOpen('de', ET('2026-11-17T18:00:00+01:00'))).toBe(false);
    });
});

describe('corelatia cu BTC (randamente zilnice)', () => {
    const days = (f) => Array.from({ length: 40 }, (_, i) => ({ t: 1e9 + i * 86400, c: f(i) }));
    const btc = days((i) => 50000 * Math.exp(0.02 * Math.sin(i * 1.7) + 0.001 * i));
    test('acelasi drum = 1; drum oglindit = -1', () => {
        expect(tm.corrDaily(btc, btc)).toBeCloseTo(1, 6);
        const inv = btc.map((k) => ({ t: k.t, c: 1e9 / k.c }));
        expect(tm.corrDaily(inv, btc)).toBeCloseTo(-1, 6);
    });
    test('sub 15 zile comune = null („—"), nu o cifra inventata', () => {
        expect(tm.corrDaily(btc.slice(0, 10), btc)).toBeNull();
    });
    test('doar zilele COMUNE conteaza (alinierea pe timp)', () => {
        const shifted = btc.map((k) => ({ t: k.t + 3600, c: k.c }));
        expect(tm.corrDaily(shifted, btc)).toBeNull();
    });
});

describe('instantaneul trimis aplicatiei', () => {
    beforeEach(() => tm._resetForTest());
    const fake = (map) => async (url) => ({ ok: true, json: async () => map(url) });
    test('pretul = index_price (activul real); 24h din bursa; doar catalogul', async () => {
        await tm.refreshTickers(fake(() => [
            { contract: 'XAU_USDT', last: '3540', index_price: '3538.4', change_percentage: '-0.54', high_24h: '3601', low_24h: '3510', volume_24h_quote: '2e8' },
            { contract: 'DOGE_USDT', last: '0.1', index_price: '0.1', change_percentage: '1' },
        ]));
        const s = tm.snapshot();
        expect(s.items.map((i) => i.sym)).toEqual(['XAU']);
        expect(s.items[0]).toMatchObject({ name: 'Gold', group: 'metals', price: 3538.4, chg24: -0.54 });
        expect(s.items[0].corrBtc).toBeNull();     // fara lumanari inca
    });
    test('o eroare la Gate nu sterge ultimele preturi, doar le marcheaza', async () => {
        await tm.refreshTickers(fake(() => [{ contract: 'NVDA_USDT', last: '129', index_price: '128.9', change_percentage: '-10' }]));
        await tm.refreshTickers(async () => ({ ok: false, status: 502 }));
        const s = tm.snapshot();
        expect(s.items[0].price).toBe(128.9);
        expect(s.error).toBe('http_502');
    });
    test('catalogul are ~100 de active, fara simboluri duble', () => {
        const syms = tm.CATALOG.map((c) => c.sym);
        expect(syms.length).toBeGreaterThanOrEqual(100);
        expect(new Set(syms).size).toBe(syms.length);
    });
});

describe('[2026-11-22] piete noi: volatilitate, ETF-uri, aur tokenizat, actiuni urmarite', () => {
    const tm = require('../../server/services/tradfiMarkets');
    test('sunt in catalog, in grupul potrivit', () => {
        const by = Object.fromEntries(tm.CATALOG.map((c) => [c.sym, c]));
        expect(by.VOLX.group).toBe('indices');
        expect(by.SPY.group).toBe('indices');
        expect(by.XAUT.group).toBe('crypto');
        expect(by.SNDK.group).toBe('stocks');
        expect(tm.CATALOG.length).toBe(135);
    });
    test('aurul tokenizat si volatilitatea crypto sunt „deschise" mereu, si sambata', () => {
        const sat = Date.parse('2026-11-21T12:00:00Z');
        expect(tm.isOpen('24h', sat)).toBe(true);
        expect(tm.isOpen('us', sat)).toBe(false);
    });
});
