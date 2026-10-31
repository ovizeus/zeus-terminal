'use strict';
// tests/unit/bookmap-abs.test.js
//
// [BOOKMAP-ABS 2026-10-30] Grila pe PRET ABSOLUT — ce a cerut operatorul cu
// cele doua capturi din Bookmap: „exact asa, cu bule, culori, tot, lichidari".
//
// ⚠️ DE CE SE SCHIMBA CONTRACTUL, si nu e o toana:
//
// Grila de pana acum avea randurile ancorate pe mijlocul FIECAREI coloane
// (relativ). Era corect pentru ce facea: lichiditatea devenea comparabila in
// timp, si asa trebuia cand harta era singura pe ecran.
//
// Dar BULELE si LICHIDARILE au preturi ABSOLUTE. Pe o grila relativa, banda de
// lichiditate sta dreapta la mijloc oricat s-ar misca pretul — exact opusul
// capturilor lui, unde banda urmeaza pretul pe diagonala si bulele calaresc pe
// ea. Deci grila trebuie sa fie absoluta, intinsa pe intervalul de pret al
// ferestrei plus banda carnetului.
//
// Ce se PASTREAZA din versiunea veche, fiindca erau lectii platite scump:
//   • coloanele nu pot fi mai multe decat instantaneele (pieptenele, b334)
//   • tinerea intre instantanee, marginita, ca o pana sa rameane gol (b338)
//   • referinta DE JOS pentru intensitate (b335)
//   • ce iese din banda NU se inghesuie la margine (b332)

const B = require('../../server/services/bookMap');
const T0 = 1793000000000;

const f = (ts, mid, spread = 20) => B.normalize({
    exchange: 'binance', symbol: 'BTCUSDT', ts, mult: 1,
    bids: [[String(mid - spread), '3'], [String(mid - spread * 3), '1']],
    asks: [[String(mid + spread), '3'], [String(mid + spread * 3), '1']],
});

describe('grila absoluta — randurile sunt PRETURI, nu procente', () => {
    test('intervalul acopera tot ce s-a intamplat in fereastra', () => {
        const frames = [f(T0, 79000), f(T0 + 60000, 80000), f(T0 + 120000, 81000)];
        const h = B.heatAbs({ frames, cols: 3, rows: 40, windowMs: 600000, now: T0 + 120000 });
        expect(h.priceLo).toBeLessThan(79000 - 60);
        expect(h.priceHi).toBeGreaterThan(81000 + 60);
    });

    test('BANDA URMEAZA PRETUL: coloane diferite -> randuri diferite', () => {
        // Asta e tot rostul schimbarii. Pe grila relativa, toate coloanele
        // aveau banda in acelasi rand.
        const frames = [f(T0, 79000), f(T0 + 60000, 80000), f(T0 + 120000, 81000)];
        const h = B.heatAbs({ frames, cols: 3, rows: 60, windowMs: 600000, now: T0 + 120000 });
        const randPe = (col) => {
            const c = h.cells.filter((x) => x.col === col);
            expect(c.length).toBeGreaterThan(0);
            return Math.round(c.reduce((s, x) => s + x.row, 0) / c.length);
        };
        expect(randPe(0)).toBeLessThan(randPe(1));
        expect(randPe(1)).toBeLessThan(randPe(2));
    });

    test('un pret se traduce in rand si inapoi, fara deriva', () => {
        const frames = [f(T0, 80000)];
        const h = B.heatAbs({ frames, cols: 2, rows: 50, windowMs: 600000, now: T0 });
        const r = B.priceToRow(80000, h);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(h.rows);
        expect(Math.abs(B.rowToPrice(r, h) - 80000)).toBeLessThanOrEqual(h.rowUsd);
    });

    test('un pret in afara grilei da NULL, nu se agata de margine', () => {
        const frames = [f(T0, 80000)];
        const h = B.heatAbs({ frames, cols: 2, rows: 50, windowMs: 600000, now: T0 });
        expect(B.priceToRow(10, h)).toBeNull();
        expect(B.priceToRow(999999, h)).toBeNull();
        expect(B.priceToRow(NaN, h)).toBeNull();
    });
});

describe('ce s-a pastrat din lectiile platite', () => {
    test('coloanele nu depasesc numarul de instantanee (pieptenele b334)', () => {
        const frames = Array.from({ length: 12 }, (_, i) => f(T0 + i * 5000, 80000));
        const h = B.heatAbs({ frames, cols: 110, rows: 40, windowMs: 600000, now: T0 + 55000 });
        expect(h.cols).toBeLessThanOrEqual(12);
        expect(h.colsAsked).toBe(110);
    });

    test('tinerea intre instantanee umple golurile (b338)', () => {
        const ts = [];
        let t = T0;
        for (let i = 0; i < 10; i++) { ts.push(t); t += 31000; }
        for (let i = 0; i < 10; i++) { ts.push(t); t += 5000; }
        const h = B.heatAbs({ frames: ts.map((x) => f(x, 80000)), cols: 110, rows: 40,
            windowMs: 900000, now: t });
        expect(h.mids.filter((m) => m === null).length).toBe(0);
        expect(h.heldCols).toBeGreaterThan(0);
    });

    test('o PANA reala rameane goala (b338)', () => {
        const ts = [];
        let t = T0;
        for (let i = 0; i < 20; i++) { ts.push(t); t += 5000; }
        t += 6 * 60000;
        for (let i = 0; i < 20; i++) { ts.push(t); t += 5000; }
        const h = B.heatAbs({ frames: ts.map((x) => f(x, 80000)), cols: 40, rows: 40,
            windowMs: 20 * 60000, now: t });
        expect(h.mids.filter((m) => m === null).length).toBeGreaterThan(0);
    });

    test('referinta DE JOS exista, pentru intensitate (b335)', () => {
        const frames = Array.from({ length: 6 }, (_, i) => f(T0 + i * 5000, 80000));
        const h = B.heatAbs({ frames, cols: 6, rows: 40, windowMs: 600000, now: T0 + 25000 });
        expect(h.loUsd).toBeGreaterThan(0);
        expect(h.loUsd).toBeLessThan(h.maxUsd);
    });

    test('valoarea celulei e MEDIA pe coloana, nu suma (b332)', () => {
        const unul = [f(T0, 80000)];
        const opt = Array.from({ length: 8 }, (_, i) => f(T0 + i * 100, 80000));
        const a = B.heatAbs({ frames: unul, cols: 1, rows: 40, windowMs: 600000, now: T0 });
        const b = B.heatAbs({ frames: opt, cols: 1, rows: 40, windowMs: 600000, now: T0 + 700 });
        const sum = (h) => h.cells.reduce((s, c) => s + c.bidUsd + c.askUsd, 0);
        expect(Math.abs(sum(b) - sum(a)) / sum(a)).toBeLessThan(0.05);
    });

    test('grila goala nu arunca', () => {
        const h = B.heatAbs({ frames: [], cols: 10, rows: 10, windowMs: 600000 });
        expect(h.cells).toEqual([]);
        expect(h.mids.every((m) => m === null)).toBe(true);
        expect(h.priceLo).toBeNull();
    });
});

describe('doua mutatii mi-au supravietuit — le acopar aici', () => {
    test('un nivel DINCOLO de grila NU se inghesuie la margine', () => {
        // Prima versiune a testelor nu avea niciun nivel in afara intervalului,
        // deci mutatia care inlocuia excluderea cu agatarea trecea nepedepsita.
        // Agatat, un ordin de la 40.000 ar desena un perete fals pe randul de jos.
        const departe = B.normalize({
            exchange: 'binance', symbol: 'BTCUSDT', ts: T0, mult: 1,
            bids: [['79980', '1'], ['40000', '500']],
            asks: [['80020', '1']],
        });
        const h = B.heatAbs({ frames: [departe], cols: 2, rows: 40, windowMs: 600000, now: T0 });
        const jos = h.cells.filter((c) => c.row === 0);
        for (const c of jos) expect(c.bidUsd).toBeLessThan(1e6);
        expect(h.maxUsd).toBeLessThan(1e6);
    });

    test('LINIA PRETULUI urmeaza pretul, nu sta pe primul cadru', () => {
        // Mutatia `mids[col] = used[0].mid` lasa celulele corecte (ele folosesc
        // pretul absolut) dar ingheta linia pretului — adica tocmai chartul.
        const frames = [f(T0, 79000), f(T0 + 60000, 80000), f(T0 + 120000, 81000)];
        const h = B.heatAbs({ frames, cols: 3, rows: 60, windowMs: 600000, now: T0 + 120000 });
        const m = h.mids.filter((x) => x !== null);
        expect(m.length).toBe(3);
        expect(m[0]).toBeLessThan(m[1]);
        expect(m[1]).toBeLessThan(m[2]);
    });
});
