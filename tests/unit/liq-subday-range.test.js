'use strict';
// tests/unit/liq-subday-range.test.js
//
// [RANGE 2026-10-31] Cererea lui: „poti face pe timeframe de 24h, 7 zile ca la
// coinglass si 4 ore?".
//
// Harta de lichidari avea doar 7D / 30D / 90D. Coinglass porneste de la ore.
// `days` curge deja ca numar ZECIMAL pana in SQL (`d * DAY_MS`), deci sub-zi
// ar trebui sa mearga — dar „ar trebui" nu e o dovada. Aici se dovedeste, pe
// TOATE cele patru functii care primesc `days`, fiindca o singura functie care
// rotunjeste la zi ar da un panou in care trei cifre spun 4h si a patra 24h,
// fara ca nimic sa pice.

const fs = require('fs');
const os = require('os');
const path = require('path');

let api, db, store;
const HOUR = 3600000;

beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-liqrange-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    api = require('../../server/services/database');
    db = api.db;
    store = require('../../server/services/liqStore');
});

afterEach(() => { try { db.exec('DELETE FROM liq_events;'); } catch (_) {} });

const H4 = 4 / 24;      // patru ore, exprimate in zile
const H24 = 1;

// Doua evenimente: unul acum 2h (INTRA in 4h), unul acum 10h (NU intra).
function seed() {
    const now = Date.now();
    store.record({ exchange: 'bybit', symbol: 'BTCUSDT', side: 'SELL', isLong: true,
        p: 80400, q: 1, vol: 80400, time: now - 2 * HOUR });
    store.record({ exchange: 'okx', symbol: 'BTCUSDT', side: 'BUY', isLong: false,
        p: 79600, q: 1, vol: 79600, time: now - 10 * HOUR });
    return now;
}

describe('fereastra sub-zi: 4 ore chiar inseamna 4 ore', () => {
    test('map() taie la 4h — evenimentul de acum 10h nu intra', () => {
        seed();
        const m4 = store.map({ symbol: 'BTCUSDT', ref: 80000, days: H4 });
        const m24 = store.map({ symbol: 'BTCUSDT', ref: 80000, days: H24 });
        expect(m4.events).toBe(1);
        expect(m24.events).toBe(2);
    });

    test('⛔ map() nu rotunjeste fereastra la o zi intreaga', () => {
        seed();
        const m4 = store.map({ symbol: 'BTCUSDT', ref: 80000, days: H4 });
        expect(m4.days).toBeCloseTo(H4, 6);
        expect(m4.days).toBeLessThan(1);
    });

    test('stats() taie la fel ca map() — altfel panoul se contrazice singur', () => {
        seed();
        const s4 = store.stats({ symbol: 'BTCUSDT', days: H4 });
        const s24 = store.stats({ symbol: 'BTCUSDT', days: H24 });
        expect(s4.events).toBe(1);
        expect(s24.events).toBe(2);
        expect(s4.days).toBeCloseTo(H4, 6);
    });

    test('heatmap() taie la fel', () => {
        seed();
        const h4 = store.heatmap({ symbol: 'BTCUSDT', ref: 80000, days: H4, cols: 20 });
        const h24 = store.heatmap({ symbol: 'BTCUSDT', ref: 80000, days: H24, cols: 20 });
        expect(h4.events).toBe(1);
        expect(h24.events).toBe(2);
        expect(h4.days).toBeCloseTo(H4, 6);
    });

    test('symbols() taie la fel', () => {
        seed();
        const t4 = store.symbols({ days: H4, limit: 12 });
        const t24 = store.symbols({ days: H24, limit: 12 });
        expect(t4[0].n).toBe(1);
        expect(t24[0].n).toBe(2);
    });

    test('fereastra de 4h pe ceva fara evenimente da gol, nu cade pe implicit', () => {
        seed();
        const m = store.map({ symbol: 'ETHUSDT', ref: 2500, days: H4 });
        expect(m.events).toBe(0);
        expect(m.days).toBeCloseTo(H4, 6);
    });

    test('zero si negativ NU sunt ferestre — cad pe implicit, nu pe fereastra goala', () => {
        seed();
        for (const bad of [0, -1, NaN, null, undefined, 'x']) {
            const m = store.map({ symbol: 'BTCUSDT', ref: 80000, days: bad });
            expect(m.days).toBe(store.DEFAULT_DAYS);
            expect(m.events).toBe(2);
        }
    });
});
