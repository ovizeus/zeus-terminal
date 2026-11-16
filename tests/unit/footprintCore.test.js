'use strict';
const F = require('../../server/services/footprintCore');

const T0 = Date.UTC(2026, 10, 16, 10, 0, 0);
const tr = (o) => ({ symbol: 'BTCUSDT', side: 'BUY', price: 64003, qty: 1, ts: T0 + 1000, ...o });

describe('ICHNOS — agregarea pe minut', () => {
    test('nivelul de pret: cutia de jos, fara erori de virgula', () => {
        expect(F.binOf(64003, 5)).toBe(64000);
        expect(F.binOf(64005, 5)).toBe(64005);
        expect(F.binOf(150.37, 0.02)).toBe(150.36);
        expect(F.binOf(3201.15, 0.5)).toBe(3201);
    });
    test('⛔ partea: SELL = bid (vandut agresiv), BUY = ask (cumparat agresiv), in dolari', () => {
        const s = new Map();
        F.addTrade(s, tr({ side: 'BUY', price: 64003, qty: 2 }));
        F.addTrade(s, tr({ side: 'SELL', price: 64004, qty: 1, ts: T0 + 2000 }));
        const c = F.serialize1m(s.get('BTCUSDT').get(T0));
        expect(c.lv).toEqual([[64000, 64004, 128006]]);
    });
    test('OHLC dupa ora tranzactiei, nu dupa ordinea sosirii', () => {
        const s = new Map();
        F.addTrade(s, tr({ price: 64010, ts: T0 + 30000 }));
        F.addTrade(s, tr({ price: 64000, ts: T0 + 1000 }));      // sosita tarziu, dar e prima
        F.addTrade(s, tr({ price: 64050, ts: T0 + 40000 }));
        F.addTrade(s, tr({ price: 63990, ts: T0 + 50000 }));
        const c = F.serialize1m(s.get('BTCUSDT').get(T0));
        expect(c).toMatchObject({ o: 64000, h: 64050, l: 63990, c: 63990 });
    });
    test('gunoiul si monedele fara pas sunt ignorate', () => {
        const s = new Map();
        expect(F.addTrade(s, tr({ symbol: 'XRPUSDT' }))).toBe(false);
        expect(F.addTrade(s, tr({ qty: 0 }))).toBe(false);
        expect(F.addTrade(s, tr({ side: 'X' }))).toBe(false);
        expect(F.addTrade(s, tr({ price: NaN }))).toBe(false);
        expect(s.size).toBe(0);
    });
    test('fiecare minut e candela lui', () => {
        const s = new Map();
        F.addTrade(s, tr({ ts: T0 + 59999 }));
        F.addTrade(s, tr({ ts: T0 + 60000 }));
        expect([...s.get('BTCUSDT').keys()]).toEqual([T0, T0 + 60000]);
    });
});

describe('ICHNOS — unirea pe interval', () => {
    const m = (min, lv, o = 64000, c = 64010) => ({ t: T0 + min * 60000, o, h: Math.max(o, c) + 5, l: Math.min(o, c) - 5, c, lv });
    test('5m: cinci minute devin o candela, nivelurile se unesc pe pasul de 10', () => {
        const r = F.mergeTf([m(0, [[64005, 10, 20], [64000, 5, 0]]), m(1, [[64000, 1, 2]]), m(4, [[64010, 7, 7]], 64010, 64020)], 'BTCUSDT', '5m');
        expect(r.bin).toBe(10);
        expect(r.candles).toHaveLength(1);
        const c = r.candles[0];
        expect(c).toMatchObject({ t: T0, o: 64000, c: 64020 });
        expect(c.lv).toEqual([[64010, 7, 7], [64000, 16, 22]]);
    });
    test('totalurile se pastreaza la unire (nimic pierdut, nimic inventat)', () => {
        const ones = Array.from({ length: 15 }, (_, i) => m(i, [[64000 + (i % 7) * 5, 100 + i, 50 + i]]));
        const sum = (cs) => cs.reduce((a, c) => a + c.lv.reduce((x, l) => x + l[1] + l[2], 0), 0);
        expect(sum(F.mergeTf(ones, 'BTCUSDT', '15m').candles)).toBe(sum(ones));
        expect(sum(F.mergeTf(ones, 'BTCUSDT', '5m').candles)).toBe(sum(ones));
        expect(F.mergeTf(ones, 'BTCUSDT', '5m').candles).toHaveLength(3);
    });
    test('interval sau moneda necunoscuta → nimic', () => {
        expect(F.mergeTf([m(0, [])], 'BTCUSDT', '1d')).toEqual({ bin: null, candles: [] });
        expect(F.mergeTf([m(0, [])], 'XRPUSDT', '5m')).toEqual({ bin: null, candles: [] });
    });
});
