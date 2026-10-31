'use strict';
// tests/unit/bookmap-zoom.test.js
//
// [NEREUS ZOOM 2026-10-31] Cererea lui: „poti face zoom sa dau pe acea harta".
//
// Ce se apara aici: grila absoluta accepta o FEREASTRA CERUTA (centru + adancime)
// si o respecta exact, iar ce cade in afara se ARUNCA, nu se agata de margine —
// aceeasi lectie care a costat o coloana falsa de bule pe marginea stanga.

const BM = require('../../server/services/bookMap');
const T0 = 1793000000000;

// Carnet cu niveluri la fiecare 10$, intre 76900 si 77100, mijloc 77000.
function frames(n = 10) {
    return Array.from({ length: n }, (_, i) => {
        const bids = [], asks = [];
        for (let p = 76990; p >= 76900; p -= 10) bids.push([String(p), '1']);
        for (let p = 77010; p <= 77100; p += 10) asks.push([String(p), '1']);
        return BM.normalize({ exchange: 'binance', symbol: 'BTCUSDT', ts: T0 + i * 3000,
            mult: 1, bids, asks });
    });
}

const base = { cols: 10, rows: 40, windowMs: 600000, now: T0 + 30000 };

describe('zoom: fereastra CERUTA de pret', () => {
    test('fara focus, grila se intinde pe tot ce exista (ca pana acum)', () => {
        const h = BM.heatAbs({ frames: frames(), ...base });
        expect(h.priceLo).toBeLessThan(76910);
        expect(h.priceHi).toBeGreaterThan(77090);
        expect(h.focused).toBe(false);
    });

    test('cu focus, marginile sunt EXACT cele cerute — fara margine adaugata', () => {
        // 77000 ±0.05% = 77000 ± 38.5 => [76961.5, 77038.5]
        const h = BM.heatAbs({ frames: frames(), ...base, focusPrice: 77000, focusPct: 0.05 });
        expect(h.priceLo).toBeCloseTo(77000 * (1 - 0.0005), 6);
        expect(h.priceHi).toBeCloseTo(77000 * (1 + 0.0005), 6);
        expect(h.focused).toBe(true);
    });

    test('⛔ nivelurile din AFARA ferestrei se arunca, nu se agata de margine', () => {
        const h = BM.heatAbs({ frames: frames(), ...base, focusPrice: 77000, focusPct: 0.05 });
        // In [76961.5, 77038.5] intra 76970..76990 si 77010..77030 => 6 preturi.
        for (const c of h.cells) {
            expect(c.price).toBeGreaterThanOrEqual(h.priceLo);
            expect(c.price).toBeLessThanOrEqual(h.priceHi);
        }
        // Si chiar s-a aruncat ceva: mai putine rinduri ocupate decat fara focus.
        const larg = BM.heatAbs({ frames: frames(), ...base });
        const rLarg = new Set(larg.cells.map((c) => c.row)).size;
        const rMic = new Set(h.cells.map((c) => c.row)).size;
        expect(rMic).toBeLessThan(rLarg);
    });

    test('zoom-ul face randul mai FIN — asta e tot rostul', () => {
        const larg = BM.heatAbs({ frames: frames(), ...base });
        const mic = BM.heatAbs({ frames: frames(), ...base, focusPrice: 77000, focusPct: 0.05 });
        expect(mic.rowUsd).toBeLessThan(larg.rowUsd / 2);
    });

    test('un focus pe un pret unde nu e nimic da o harta GOALA, nu una inventata', () => {
        const h = BM.heatAbs({ frames: frames(), ...base, focusPrice: 50000, focusPct: 0.05 });
        expect(h.cells.length).toBe(0);
        expect(h.focused).toBe(true);
        expect(h.priceLo).toBeCloseTo(50000 * (1 - 0.0005), 6);
    });

    test('adancimea ceruta se mărgineşte: 0 sau negativ nu e zoom, e impartire la zero', () => {
        for (const bad of [0, -1, NaN, null, undefined, 'x']) {
            const h = BM.heatAbs({ frames: frames(), ...base, focusPrice: 77000, focusPct: bad });
            expect(h.focused).toBe(false);
        }
    });

    test('un focus fara pret valid e ignorat, nu crapa', () => {
        for (const bad of [0, -5, NaN, null, undefined, 'x']) {
            const h = BM.heatAbs({ frames: frames(), ...base, focusPrice: bad, focusPct: 0.05 });
            expect(h.focused).toBe(false);
            expect(h.cells.length).toBeGreaterThan(0);
        }
    });

    test('bandPct raportata urmeaza fereastra CERUTA, nu pe cea din date', () => {
        const h = BM.heatAbs({ frames: frames(), ...base, focusPrice: 77000, focusPct: 0.05 });
        expect(h.bandPct).toBeCloseTo(0.05, 3);
    });

    test('priceToRow si rowToPrice rămân in acord cu grila ingustata', () => {
        const h = BM.heatAbs({ frames: frames(), ...base, focusPrice: 77000, focusPct: 0.05 });
        const r = BM.priceToRow(77000, h);
        expect(r).not.toBeNull();
        // `rowToPrice` da CENTRUL randului, deci acordul se cere cu o jumatate
        // de rand, nu la cent. Prima versiune a testului cerea +-0,5$ pe un rand
        // de 1,9$ — testul se inselase, nu codul.
        expect(Math.abs(BM.rowToPrice(r, h) - 77000)).toBeLessThanOrEqual(h.rowUsd / 2 + 1e-9);
    });
});

// ── CABLAREA RUTEI ──────────────────────────────────────────────────────────
// ⛔ O mutatie a supravietuit si o spun: scosesem `focusPrice, focusPct` din
// apelul rutei si toate cele 110 teste treceau. Testele dovedeau ca harta
// STIE sa faca zoom, nu ca ruta i-o cere — exact clasa care a trimis serviciul
// PREDICT mort in productie (b330). Deci ruta se INVOCA, nu se citeste.
describe('⛔ ruta chiar DUCE focusul pana la harta', () => {
    const SYM = 'BTCUSDT';

    function fakeFrames() {
        const bids = [], asks = [];
        for (let p = 76990; p >= 76900; p -= 10) bids.push([String(p), '1']);
        for (let p = 77010; p <= 77100; p += 10) asks.push([String(p), '1']);
        return Array.from({ length: 6 }, (_, i) => BM.normalize({
            exchange: 'binance', symbol: SYM, ts: Date.now() - (6 - i) * 3000,
            mult: 1, bids, asks,
        }));
    }

    // Handler-ul real, scos din stiva routerului.
    function handler() {
        const router = require('../../server/routes/market');
        const layer = router.stack.find((l) => l.route && l.route.path === '/bookmap');
        expect(layer).toBeTruthy();
        return layer.route.stack[layer.route.stack.length - 1].handle;
    }

    function call(query) {
        const feed = require('../../server/services/bookFeed');
        const origDeep = feed.deepFrames;
        const origTop = feed.topFrames;
        const origDemand = feed.noteDemand;
        feed.deepFrames = () => fakeFrames();
        feed.topFrames = () => [];
        feed.noteDemand = () => {};
        try {
            let body = null;
            const res = { json: (b) => { body = b; return res; }, status: () => res };
            handler()({ query }, res);
            return body;
        } finally {
            feed.deepFrames = origDeep;
            feed.topFrames = origTop;
            feed.noteDemand = origDemand;
        }
    }

    test('fara focus in adresa, harta nu e focalizata', () => {
        const b = call({ symbol: SYM });
        expect(b).toBeTruthy();
        expect(b.heat.focused).toBe(false);
    });

    test('cu focus in adresa, harta ESTE focalizata pe fereastra cerută', () => {
        const b = call({ symbol: SYM, focus: '77000', focusPct: '0.05' });
        expect(b.heat.focused).toBe(true);
        expect(b.heat.priceLo).toBeCloseTo(77000 * (1 - 0.0005), 6);
        expect(b.heat.priceHi).toBeCloseTo(77000 * (1 + 0.0005), 6);
    });

    test('fereastra cerută se vede si in `asked`, ca sa se poată verifica', () => {
        const b = call({ symbol: SYM, focus: '77000', focusPct: '0.05' });
        expect(b.asked.focusPrice).toBe(77000);
        expect(b.asked.focusPct).toBe(0.05);
    });

    test('o adâncime absurdă se mărgineşte, nu se refuză si nu trece intacta', () => {
        const b = call({ symbol: SYM, focus: '77000', focusPct: '99' });
        expect(b.heat.focused).toBe(true);
        expect(b.asked.focusPct).toBeLessThanOrEqual(1);
    });

    test('focus fără adâncime nu e zoom', () => {
        const b = call({ symbol: SYM, focus: '77000' });
        expect(b.heat.focused).toBe(false);
    });
});
