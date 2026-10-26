'use strict';
// tests/unit/bookmap-contract.test.js
//
// [BOOKMAP 2026-10-26] CONTRACTUL dintre ruta si panou.
//
// Nimic nu dovedea pana acum ca raspunsul rutei conţine exact campurile pe care
// clientul le CITESTE. O nepotrivire nu arunca si nu apare in loguri — da un
// panou rupt in liniste, exact clasa de bug care a costat cel mai mult in
// sesiunea asta (serviciul PREDICT mort, tape-ul cu alt simbol).
//
// Testul citeste SURSA CLIENTULUI, scoate campurile accesate, si verifica ca
// forma produsa de bookMap le are pe toate. Daca cineva redenumeste un camp pe
// server sau citeste unul nou pe client fara sa-l trimita, cade aici.

const fs = require('fs');
const path = require('path');
const BM = require('../../server/services/bookMap');

const T0 = 1793000000000;

const PANEL_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'client', 'src', 'components', 'dock', 'LiqMapPanel.tsx'), 'utf8');
const ROUTE_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'routes', 'market.js'), 'utf8');

function frames(n) {
    return Array.from({ length: n }, (_, i) => BM.normalize({
        exchange: 'binance', symbol: 'BTCUSDT', ts: T0 + i * 5000, mult: 1,
        bids: [['79990', '1'], ['79950', '2']],
        asks: [['80010', '1'], ['80050', '3']],
    }));
}

describe('forma lui heat() acopera tot ce citeste panoul', () => {
    const h = BM.heat({ frames: frames(8), cols: 20, rows: 24, bandPct: 'auto',
        windowMs: 600000, now: T0 + 35000 });

    test('campurile heat.* accesate in panou exista TOATE in raspuns', () => {
        const citite = [...new Set(
            (PANEL_SRC.match(/\bheat\.([a-zA-Z]+)/g) || []).map(x => x.split('.')[1]),
        )];
        expect(citite.length).toBeGreaterThan(5);   // non-vacuitate
        for (const k of citite) {
            expect(Object.prototype.hasOwnProperty.call(h, k)).toBe(true);
        }
    });

    test('si pe forma GOALA, ca panoul sa nu crape pe o harta fara date', () => {
        const gol = BM.heat({ frames: [], cols: 20, rows: 24, bandPct: 0.1 });
        const citite = [...new Set(
            (PANEL_SRC.match(/\bheat\.([a-zA-Z]+)/g) || []).map(x => x.split('.')[1]),
        )];
        for (const k of citite) {
            expect(Object.prototype.hasOwnProperty.call(gol, k)).toBe(true);
        }
    });

    test('loUsd pleaca spre client — fara el harta redevine uniform aprinsa', () => {
        expect(h).toHaveProperty('loUsd');
        expect(PANEL_SRC).toMatch(/loUsd/);
    });

    test('mids are exact atatea intrari cate coloane raporteaza', () => {
        expect(h.mids).toHaveLength(h.cols);
        const gol = BM.heat({ frames: [], cols: 20, rows: 24, bandPct: 0.1 });
        expect(gol.mids).toHaveLength(gol.cols);
    });
});

describe('ruta trimite cheile de prim nivel pe care panoul le citeste', () => {
    test('fiecare data.X citit in panou e pus in raspunsul de SUCCES', () => {
        // Prima versiune cauta cheia in TOT corpul rutei — si trecea chiar cand
        // o redenumeam pe calea de succes, fiindca o gasea in ramura de EROARE
        // (`walls: []`). Deci nu dovedea nimic. Acum cele doua ramuri se
        // verifica SEPARAT.
        const i = ROUTE_SRC.indexOf("'/bookmap'");
        const corp = ROUTE_SRC.slice(i, i + 3200);
        const j = corp.indexOf('} catch');
        expect(j).toBeGreaterThan(-1);
        const succes = corp.slice(0, j);
        for (const k of ['symbol', 'heat', 'ladder', 'walls', 'top', 'source']) {
            expect(succes).toMatch(new RegExp('(^|[^a-zA-Z])' + k + '\\s*[:,]', 'm'));
        }
    });

    test('ramura de EROARE trimite aceleasi chei — altfel panoul citeste undefined', () => {
        const i = ROUTE_SRC.indexOf("'/bookmap'");
        const corp = ROUTE_SRC.slice(i, i + 3200);
        const j = corp.indexOf('catch');
        expect(j).toBeGreaterThan(-1);
        const prins = corp.slice(j, j + 500);
        for (const k of ['symbol', 'heat', 'ladder', 'walls', 'top']) {
            expect(prins).toMatch(new RegExp(k + '\\s*:'));
        }
    });

    test('forma lui walls() are campurile pe care panoul le afiseaza', () => {
        const lad = BM.aggregate({ frames: frames(8), bandPct: 'auto', rows: 40,
            windowMs: 600000, now: T0 + 35000 });
        const w = BM.walls(lad, 3);
        expect(w.length).toBeGreaterThan(0);
        for (const cheie of ['side', 'price', 'usd', 'firmness', 'distUsd']) {
            expect(w[0]).toHaveProperty(cheie);
        }
        // si fiecare e chiar citit in panou
        for (const cheie of ['side', 'price', 'usd', 'firmness', 'distUsd']) {
            expect(PANEL_SRC).toMatch(new RegExp('wl\\.' + cheie));
        }
    });

    test('forma lui aggregate() are ce citeste panoul din ladder', () => {
        const lad = BM.aggregate({ frames: frames(8), bandPct: 'auto', rows: 40,
            windowMs: 600000, now: T0 + 35000 });
        const citite = [...new Set(
            (PANEL_SRC.match(/ladder\?\.([a-zA-Z]+)|ladder\.([a-zA-Z]+)/g) || [])
                .map(x => x.replace(/ladder\??\./, '')),
        )];
        for (const k of citite) {
            expect(Object.prototype.hasOwnProperty.call(lad, k)).toBe(true);
        }
    });
});
