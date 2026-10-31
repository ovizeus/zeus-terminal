'use strict';
// tests/unit/liq-zoom-span.test.js
//
// [ZOOM LIQ 2026-10-31] Cererea lui: „si fa zoom daa poti pe chart stii ce zic".
//
// Chartul de lichidari e timp (orizontal) x pret (vertical). Timpul se alege
// deja cu butoanele 4H / 24H / 7D / 30D / 90D. Lipsea PRETUL: harta acoperea
// mereu tot ce exista, pana la 35%.
//
// Zoom aici = fereastra de PRET se ingusteaza SI galeata se rafineaza. Fara a
// doua parte, zoom-ul ar arata aceleasi trepte de 0,25%, doar mai putine la
// numar — adica nu ai cistiga nicio informatie, doar bare mai inalte.
//
// ⚠️ CAPCANA PRINSA INAINTE DE COD: `MIN_PCT` e 0,05 si arunca tot ce e mai
// aproape de atat de pret. La un zoom de +-0,1% ar fi ramas aproape nimic —
// un zoom care goleste harta. Deci pragul trebuie sa coboare cu fereastra.

const fs = require('fs');
const os = require('os');
const path = require('path');

let api, db, store;

beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-liqzoom-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    api = require('../../server/services/database');
    db = api.db;
    store = require('../../server/services/liqStore');
});

afterEach(() => { try { db.exec('DELETE FROM liq_events;'); } catch (_) {} });

const REF = 80000;

// Lichidari la distante cunoscute de REF, de la 0,02% la 5%.
function seed() {
    const now = Date.now();
    const pcts = [0.02, 0.06, 0.1, 0.2, 0.3, 0.45, 0.6, 1.2, 2.5, 5,
        -0.03, -0.08, -0.15, -0.28, -0.4, -0.55, -0.9, -1.8, -3.1, -4.4];
    pcts.forEach((pc, i) => {
        store.record({
            exchange: 'bybit', symbol: 'BTCUSDT', side: pc < 0 ? 'SELL' : 'BUY',
            isLong: pc < 0, p: REF * (1 + pc / 100), q: 1, vol: 10000 + i,
            time: now - i * 60000,
        });
    });
    return now;
}

describe('zoom pe chartul de lichidari: fereastra de PRET', () => {
    test('fara fereastra, harta acopera tot ce exista (ca pana acum)', () => {
        seed();
        const m = store.map({ symbol: 'BTCUSDT', ref: REF, days: 1 });
        expect(m.coverage.upPct).toBeGreaterThan(4);
        expect(m.coverage.downPct).toBeLessThan(-4);
        expect(m.spanPct).toBeNull();
    });

    test('cu fereastra de +-0,5%, nimic de dincolo nu intra', () => {
        seed();
        const m = store.map({ symbol: 'BTCUSDT', ref: REF, days: 1, spanPct: 0.5 });
        expect(m.spanPct).toBeCloseTo(0.5, 9);
        for (const b of m.buckets) expect(Math.abs(b.pct)).toBeLessThanOrEqual(0.5);
        expect(m.coverage.upPct).toBeLessThanOrEqual(0.5);
        expect(m.coverage.downPct).toBeGreaterThanOrEqual(-0.5);
    });

    test('⛔ galeata se RAFINEAZA — altfel zoom-ul nu aduce informatie', () => {
        seed();
        const larg = store.map({ symbol: 'BTCUSDT', ref: REF, days: 1 });
        const mic = store.map({ symbol: 'BTCUSDT', ref: REF, days: 1, spanPct: 0.5 });
        // In +-0,5% exista 12 lichidari la distante distincte. Cu treapta veche
        // de 0,25% s-ar strange in cel mult 5 galeti; cu treapta rafinata, mai multe.
        const inLarg = larg.buckets.filter((b) => Math.abs(b.pct) <= 0.5).length;
        expect(mic.buckets.length).toBeGreaterThan(inLarg);
        expect(mic.bucket).toBeGreaterThan(larg.bucket);
    });

    test('⛔ un zoom strans NU goleste harta (pragul MIN_PCT coboara cu fereastra)', () => {
        seed();
        const m = store.map({ symbol: 'BTCUSDT', ref: REF, days: 1, spanPct: 0.1 });
        // La +-0,1% exista 0,02 / 0,06 / 0,1 / -0,03 / -0,08 = 5 lichidari.
        expect(m.events).toBeGreaterThanOrEqual(4);
    });

    test('fereastra absurda se margineste, nu se refuza', () => {
        seed();
        for (const v of [999, 1e9]) {
            const m = store.map({ symbol: 'BTCUSDT', ref: REF, days: 1, spanPct: v });
            expect(m.spanPct).toBeLessThanOrEqual(35);
        }
    });

    test('o fereastra invalida e ignorata, nu crapa si nu goleste', () => {
        seed();
        for (const bad of [0, -1, NaN, null, undefined, 'x']) {
            const m = store.map({ symbol: 'BTCUSDT', ref: REF, days: 1, spanPct: bad });
            expect(m.spanPct).toBeNull();
            expect(m.events).toBeGreaterThan(10);
        }
    });

    test('heatmap() se ingusteaza la fel — altfel cele doua vederi se contrazic', () => {
        seed();
        const h = store.heatmap({ symbol: 'BTCUSDT', ref: REF, days: 1, cols: 20, spanPct: 0.5 });
        expect(h.spanPct).toBeCloseTo(0.5, 9);
        for (const c of h.cells) expect(Math.abs(c.pct)).toBeLessThanOrEqual(0.5);
    });

    test('heatmap() rafineaza galeata la fel ca map()', () => {
        seed();
        const larg = store.heatmap({ symbol: 'BTCUSDT', ref: REF, days: 1, cols: 20 });
        const mic = store.heatmap({ symbol: 'BTCUSDT', ref: REF, days: 1, cols: 20, spanPct: 0.5 });
        expect(mic.bucket).toBeGreaterThan(larg.bucket);
        const pLarg = new Set(larg.cells.filter((c) => Math.abs(c.pct) <= 0.5).map((c) => c.pct)).size;
        const pMic = new Set(mic.cells.map((c) => c.pct)).size;
        expect(pMic).toBeGreaterThan(pLarg);
    });

    test('o fereastra pe un gol da harta GOALA, nu una inventata', () => {
        seed();
        const m = store.map({ symbol: 'BTCUSDT', ref: REF * 1.5, days: 1, spanPct: 0.1 });
        expect(m.buckets).toHaveLength(0);
        expect(m.spanPct).toBeCloseTo(0.1, 9);
    });

    test('galeata raportata e cea FOLOSITA: cheile cad pe treapta ei', () => {
        seed();
        const m = store.map({ symbol: 'BTCUSDT', ref: REF, days: 1, spanPct: 0.5 });
        for (const b of m.buckets) {
            expect(Math.abs(b.pct * m.bucket - Math.round(b.pct * m.bucket))).toBeLessThan(1e-9);
        }
    });
});

// ── CABLAREA RUTEI ──────────────────────────────────────────────────────────
// La b348 o mutatie a supravietuit exact aici: scosesem fereastra din apelul
// rutei si toate testele treceau, fiindca dovedeau ca depozitul STIE sa taie,
// nu ca ruta i-o cere. Deci ruta se INVOCA.
describe('⛔ ruta chiar DUCE fereastra de pret la ambele vederi', () => {
    function call(query) {
        const router = require('../../server/routes/market');
        const layer = router.stack.find((l) => l.route && l.route.path === '/liq-panel');
        expect(layer).toBeTruthy();
        const handle = layer.route.stack[layer.route.stack.length - 1].handle;
        let body = null;
        const res = { json: (b) => { body = b; return res; }, status: () => res };
        handle({ query }, res);
        return body;
    }

    test('fara span in adresa, nicio vedere nu e ingustata', () => {
        seed();
        const b = call({ symbol: 'BTCUSDT', ref: String(REF), days: '1' });
        expect(b.map.spanPct).toBeNull();
        expect(b.heat.spanPct).toBeNull();
    });

    test('cu span in adresa, AMBELE vederi se ingusteaza la fel', () => {
        seed();
        const b = call({ symbol: 'BTCUSDT', ref: String(REF), days: '1', span: '0.5' });
        expect(b.map.spanPct).toBeCloseTo(0.5, 9);
        expect(b.heat.spanPct).toBeCloseTo(0.5, 9);
        expect(b.map.bucket).toBe(b.heat.bucket);
        for (const x of b.map.buckets) expect(Math.abs(x.pct)).toBeLessThanOrEqual(0.5);
        for (const c of b.heat.cells) expect(Math.abs(c.pct)).toBeLessThanOrEqual(0.5);
    });

    test('fereastra pleaca si in raspuns, ca sa se poată verifica', () => {
        seed();
        const b = call({ symbol: 'BTCUSDT', ref: String(REF), days: '1', span: '0.5' });
        expect(b.spanPct).toBe(0.5);
    });

    test('un span invalid nu ingusteaza si nu crapa', () => {
        seed();
        for (const bad of ['0', '-1', 'x', '']) {
            const b = call({ symbol: 'BTCUSDT', ref: String(REF), days: '1', span: bad });
            expect(b.map.spanPct).toBeNull();
            expect(b.map.events).toBeGreaterThan(10);
        }
    });
});
