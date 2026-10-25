'use strict';
// tests/unit/liq-panel-api.test.js
//
// [LIQ-PANEL 2026-10-25] Panoul cerut de operator are trei vederi, iar doua
// dintre ele au nevoie de altceva decat scara pe niveluri:
//
//   HEATMAP — timp x pret, intensitatea = dolari lichidati. Aici e diferenta
//             fata de Coinglass: ei deseneaza unde CRED ca vor fi lichidarile
//             (model cu levier presupus), noi desenam unde CHIAR s-a rupt.
//   BANDA DE ONESTITATE — ce burse sunt vii, de cand avem istoric, cate
//             evenimente. Fara ea, o scara goala arata identic cu una stricata,
//             confuzie platita deja azi.
//
// Totul masurat, nimic modelat.

const fs = require('fs');
const os = require('os');
const path = require('path');

let api, db, store;
const DAY = 86400000;

beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-liqpanel-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    api = require('../../server/services/database');
    db = api.db;
    store = require('../../server/services/liqStore');
});
afterEach(() => { try { db.exec('DELETE FROM liq_events;'); } catch (_) {} });

function ev(over = {}) {
    return Object.assign({ exchange: 'gate', symbol: 'BTCUSDT', side: 'SELL',
        p: 80000, q: 0.5, vol: 40000, time: Date.now() }, over);
}

describe('HEATMAP — timp x pret, din evenimente reale', () => {

    test('fara date, grila e goala dar onesta', () => {
        const h = store.heatmap({ symbol: 'BTCUSDT', ref: 80000, days: 90 });
        expect(h.cells).toEqual([]);
        expect(h.events).toBe(0);
        expect(h.maxUsd).toBe(0);
    });

    test('o lichidare produce exact o celula, pe coloana ei de timp', () => {
        store.record(ev({ p: 82000, vol: 1000, time: Date.now() - DAY }));
        const h = store.heatmap({ symbol: 'BTCUSDT', ref: 80000, days: 90, cols: 90 });
        expect(h.cells).toHaveLength(1);
        expect(h.cells[0].pct).toBe(2.5);
        expect(h.cells[0].longUsd).toBeCloseTo(1000, 2);
        expect(h.cells[0].t).toBeGreaterThanOrEqual(0);
        expect(h.cells[0].t).toBeLessThan(90);
    });

    test('doua lichidari in acelasi loc si acelasi interval se ADUNA', () => {
        const t = Date.now() - DAY;
        store.record(ev({ p: 82000, vol: 1000, time: t }));
        store.record(ev({ p: 82000, vol: 500, time: t + 60000 }));
        const h = store.heatmap({ symbol: 'BTCUSDT', ref: 80000, days: 90, cols: 90 });
        expect(h.cells).toHaveLength(1);
        expect(h.cells[0].longUsd).toBeCloseTo(1500, 2);
        expect(h.cells[0].n).toBe(2);
    });

    test('long si short stau SEPARAT in aceeasi celula — nu se amesteca intr-un total', () => {
        const t = Date.now() - DAY;
        store.record(ev({ p: 82000, vol: 1000, side: 'SELL', time: t }));
        store.record(ev({ p: 82000, vol: 400, side: 'BUY', time: t }));
        const c = store.heatmap({ symbol: 'BTCUSDT', ref: 80000, days: 90, cols: 90 }).cells[0];
        expect(c.longUsd).toBeCloseTo(1000, 2);
        expect(c.shortUsd).toBeCloseTo(400, 2);
    });

    test('maxUsd e cel mai INCINS cos — randorul are nevoie de scara', () => {
        const t = Date.now() - DAY;
        store.record(ev({ p: 82000, vol: 1000, time: t }));
        store.record(ev({ p: 78000, vol: 9000, time: t }));
        expect(store.heatmap({ symbol: 'BTCUSDT', ref: 80000, days: 90, cols: 90 }).maxUsd).toBeCloseTo(9000, 2);
    });

    test('coloanele sunt marginite — nu putem cere un milion de coloane', () => {
        store.record(ev({ p: 82000 }));
        for (const c of [0, -5, 99999, NaN, null, 'abc']) {
            const h = store.heatmap({ symbol: 'BTCUSDT', ref: 80000, days: 90, cols: c });
            expect(h.cols).toBeGreaterThan(0);
            expect(h.cols).toBeLessThanOrEqual(240);
        }
    });

    test('un ref absurd nu arunca', () => {
        store.record(ev());
        for (const ref of [0, -1, NaN, null, undefined]) {
            expect(() => store.heatmap({ symbol: 'BTCUSDT', ref, days: 90 })).not.toThrow();
        }
    });
});

describe('BANDA DE ONESTITATE — ce stim si de cand', () => {

    test('raporteaza pe BURSA, ca sa se vada cine lipseste', () => {
        store.record(ev({ exchange: 'gate', vol: 100 }));
        store.record(ev({ exchange: 'gate', vol: 200 }));
        store.record(ev({ exchange: 'okx', vol: 50 }));
        const st = store.stats({ symbol: 'BTCUSDT', days: 90 });
        const byEx = Object.fromEntries(st.exchanges.map(e => [e.exchange, e]));
        expect(byEx.gate.n).toBe(2);
        expect(byEx.gate.usd).toBeCloseTo(300, 2);
        expect(byEx.okx.n).toBe(1);
        expect(byEx.binance).toBeUndefined();   // Binance chiar nu livreaza
    });

    test('spune DE CAND are istoric — altfel „gol" si „stricat" arata la fel', () => {
        const t = Date.now() - 3 * DAY;
        store.record(ev({ time: t }));
        store.record(ev({ time: Date.now() }));
        const st = store.stats({ symbol: 'BTCUSDT', days: 90 });
        expect(st.since).toBe(t);
        expect(st.events).toBe(2);
        expect(st.totalUsd).toBeCloseTo(80000, 2);
    });

    test('fara date spune zero, nu null — randorul nu trebuie sa ghiceasca', () => {
        const st = store.stats({ symbol: 'BTCUSDT', days: 90 });
        expect(st.events).toBe(0);
        expect(st.since).toBe(0);
        expect(st.totalUsd).toBe(0);
        expect(st.exchanges).toEqual([]);
    });

    test('nu amesteca simbolurile', () => {
        store.record(ev({ symbol: 'ETHUSDT' }));
        expect(store.stats({ symbol: 'BTCUSDT', days: 90 }).events).toBe(0);
    });
});
