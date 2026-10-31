'use strict';
// tests/unit/trade-feed.test.js
//
// [BOOKMAP-BULE 2026-10-30] Operatorul, cu doua capturi din Bookmap: „vreau si
// eu indicatorul ala cu date reale… exact asa, cu bule, culori, tot,
// lichidari, nu sari nimic". Culorile le-a lasat pe ale noastre.
//
// Bulele sunt TRANZACTII EXECUTATE. Si trebuie sa vina din ACEEASI piata ca
// harta de lichiditate (Binance futures), altfel n-ar fi aliniate cu ea —
// doua piete au preturi si volume diferite in aceeasi secunda.
//
// ⚠️ Pe acest VPS fluxul WS de tranzacţii al Binance futures e MUT (verificat:
// 0 mesaje in 20 s, in timp ce Bybit da 161 si OKX 284). REST-ul MERGE, iar
// 1000 de tranzactii acopera 25,1 secunde — deci o cerere la ~20 s nu pierde
// nimic, daca se leaga pe `fromId`.

const TF = require('../../server/services/tradeFeed');

const raw = (over = {}) => Object.assign({
    a: 1000, p: '80000.5', q: '0.25', T: 1793390000000, m: false,
}, over);

describe('normalizarea — ce intra in bule', () => {
    test('o tranzactie valida se traduce intreaga', () => {
        const t = TF.normalizeTrade(raw({ a: 42, p: '79999.9', q: '1.5', T: 1793390001000, m: true }));
        expect(t.id).toBe(42);
        expect(t.price).toBeCloseTo(79999.9, 4);
        expect(t.qty).toBeCloseTo(1.5, 6);
        expect(t.usd).toBeCloseTo(79999.9 * 1.5, 2);
        expect(t.ts).toBe(1793390001000);
    });

    test('`m` INVERSAT: m=true inseamna ca CUMPARATORUL era in carte, deci agresorul a VANDUT', () => {
        // Capcana clasica a API-ului. Daca o incurc, bulele ies colorate exact
        // pe dos si harta minte despre cine a lovit.
        expect(TF.normalizeTrade(raw({ m: true })).sell).toBe(true);
        expect(TF.normalizeTrade(raw({ m: false })).sell).toBe(false);
    });

    test('tranzactiile stricate se arunca, nu se ghicesc', () => {
        for (const bad of [null, {}, raw({ p: '0' }), raw({ p: 'abc' }), raw({ q: '-1' }),
                           raw({ q: '0' }), raw({ T: 0 })]) {
            expect(TF.normalizeTrade(bad)).toBeNull();
        }
    });

    test('un lot intreg se curata fara sa cada pe un rand stricat', () => {
        const out = TF.normalizeTrades([raw({ a: 1 }), null, raw({ a: 2, p: '0' }), raw({ a: 3 })]);
        expect(out.map((t) => t.id)).toEqual([1, 3]);
    });
});

describe('legarea pe fromId — ca sa nu existe gauri si nici dubluri', () => {
    test('intoarce cel mai mare id vazut', () => {
        expect(TF.lastId([{ id: 5 }, { id: 9 }, { id: 7 }])).toBe(9);
        expect(TF.lastId([])).toBeNull();
        expect(TF.lastId(null)).toBeNull();
    });

    test('urmatoarea cerere porneste DUPA ultimul id, nu de la el', () => {
        // De la el ar aduce aceeasi tranzactie a doua oara, si bula ar fi
        // desenata de doua ori — adica volum umflat pe harta.
        expect(TF.nextFromId(9)).toBe(10);
        expect(TF.nextFromId(null)).toBeNull();
        expect(TF.nextFromId(0)).toBe(1);
    });

    test('dublurile se taie chiar daca serverul le retrimite', () => {
        const ring = [];
        TF.pushTrades(ring, TF.normalizeTrades([raw({ a: 1 }), raw({ a: 2 })]), 100, 0);
        TF.pushTrades(ring, TF.normalizeTrades([raw({ a: 2 }), raw({ a: 3 })]), 100, 0);
        expect(ring.map((t) => t.id)).toEqual([1, 2, 3]);
    });
});

describe('inelul — marginit in TIMP si in NUMAR', () => {
    const mk = (n, step = 1000) => TF.normalizeTrades(
        Array.from({ length: n }, (_, i) => raw({ a: i + 1, T: 1793390000000 + i * step })));

    test('ce e mai vechi decat fereastra se arunca', () => {
        const ring = [];
        TF.pushTrades(ring, mk(60), 1000, 30000);  // fereastra 30 s, pas 1 s
        expect(ring.length).toBeLessThanOrEqual(31);
        expect(ring.length).toBeGreaterThan(25);
    });

    test('plafonul de NUMAR taie si cand timpul ar incapea', () => {
        // Altfel o rafala de piata umple memoria telefonului serverului.
        const ring = [];
        TF.pushTrades(ring, mk(5000, 1), 500, 3600000);
        expect(ring.length).toBe(500);
    });

    test('ordinea rameane crescatoare dupa timp, chiar cu lot AMESTECAT', () => {
        // Prima versiune trimitea date deja sortate, deci mutatia care scotea
        // sortarea trecea nepedepsita. La o resincronizare dupa o pana, loturile
        // chiar vin amestecate — iar o harta desenata in ordine gresita pune
        // bulele in coloana gresita de timp.
        const ring = [];
        const amestecat = mk(50).slice().reverse();
        TF.pushTrades(ring, amestecat, 1000, 600000);
        expect(ring.length).toBe(50);
        for (let i = 1; i < ring.length; i++) {
            expect(ring[i].ts).toBeGreaterThanOrEqual(ring[i - 1].ts);
        }
        expect(ring[0].ts).toBeLessThan(ring[ring.length - 1].ts);
    });

    test('taierea pe fereastra foloseste CEL MAI NOU timp, nu ultimul sosit', () => {
        // Cu un lot amestecat, daca taierea s-ar face dupa ultimul element din
        // lista, ar arunca exact tranzactiile proaspete.
        const ring = [];
        TF.pushTrades(ring, mk(60).slice().reverse(), 1000, 30000);
        expect(ring.length).toBeLessThanOrEqual(31);
        expect(ring[ring.length - 1].ts).toBe(1793390000000 + 59 * 1000);
    });

    test('un lot gol nu strica inelul', () => {
        const ring = [];
        TF.pushTrades(ring, mk(10), 100, 600000);
        const before = ring.length;
        TF.pushTrades(ring, [], 100, 600000);
        TF.pushTrades(ring, null, 100, 600000);
        expect(ring.length).toBe(before);
    });
});

describe('cablarea', () => {
    test('modulul se incarca si expune start/stop/trades', () => {
        for (const fn of ['start', 'stop', 'trades', 'noteDemand', 'health']) {
            expect(typeof TF[fn]).toBe('function');
        }
    });

    test('simbol necunoscut da lista goala, nu arunca', () => {
        expect(TF.trades('NUEXISTA')).toEqual([]);
        expect(TF.trades(null)).toEqual([]);
    });

    test('health() merge inainte de start', () => {
        const h = TF.health();
        expect(h.running).toBe(false);
    });
});
