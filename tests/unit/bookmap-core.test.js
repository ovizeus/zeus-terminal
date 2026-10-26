'use strict';
// tests/unit/bookmap-core.test.js
//
// [BOOKMAP 2026-10-26] Operatorul: „langa predict poti sa faci bookmap, tot asa
// date reale ce se poate lua din piata, sa fie full, sa se citeasca usor, sa
// arate chartul, pretul, sa avem zoom, totul functional".
//
// ⚠️ TREI LUCRURI MASURATE INAINTE DE ORICE COD, si fiecare schimba designul:
//
// 1. CARTEA CARE EXISTA E LATA DE 253 DE DOLARI. Pe BTC la 80.322, adancimea
//    maxima disponibila (Binance REST limit=1000) acopera -0,155% .. +0,160%.
//    Nu exista pereti la 1% distanta. Deci harta e o BANDA STRANSA, iar zoom
//    inseamna mai adanc in banda si mai mult pe timp — nu mai departe.
//
// 2. OKX DA MARIMEA IN CONTRACTE (ctVal = 0,01 BTC). Fara multiplicator,
//    notionalul iese de 100x. Aceeasi capcana ca Gate la lichidari, si acelasi
//    raspuns: multiplicator necunoscut ⇒ ARUNCA, nu presupune 1.
//
// 3. RAPORTUL max/median PE NIVEL E 427x. Deci intensitatea TREBUIE sa fie
//    logaritmica; liniar, un nivel median langa unul mare ar fi negru, adica
//    ar minti ca nu e nimic acolo.

const B = require('../../server/services/bookMap');

const T0 = 1793000000000;
const book = (mid, levels) => ({
    bids: levels.filter(l => l[0] < mid),
    asks: levels.filter(l => l[0] >= mid),
});

describe('multiplicatorul — aceeasi lectie ca la Gate', () => {
    test('marime in CONTRACTE cu multiplicator cunoscut se converteste', () => {
        const r = B.normalize({
            exchange: 'okx', symbol: 'BTCUSDT', ts: T0,
            bids: [['80000', '100']], asks: [['80010', '50']],
            mult: 0.01,
        });
        // 100 contracte x 0,01 BTC = 1 BTC
        expect(r.bids[0][1]).toBeCloseTo(1, 6);
        expect(r.asks[0][1]).toBeCloseTo(0.5, 6);
    });

    test('multiplicator NECUNOSCUT ⇒ cadrul se ARUNCA, nu se presupune 1', () => {
        for (const mult of [undefined, null, 0, -1, NaN, 'x']) {
            expect(B.normalize({
                exchange: 'okx', symbol: 'BTCUSDT', ts: T0,
                bids: [['80000', '100']], asks: [['80010', '50']], mult,
            })).toBeNull();
        }
    });

    test('multiplicator 1 e EXPLICIT, nu implicit', () => {
        const r = B.normalize({
            exchange: 'binance', symbol: 'BTCUSDT', ts: T0,
            bids: [['80000', '2']], asks: [['80010', '3']], mult: 1,
        });
        expect(r.bids[0][1]).toBeCloseTo(2, 6);
    });

    test('un cadru fara ambele parti NU intra — mijlocul n-ar fi definit', () => {
        expect(B.normalize({ exchange: 'x', symbol: 'B', ts: T0, bids: [], asks: [['1', '1']], mult: 1 })).toBeNull();
        expect(B.normalize({ exchange: 'x', symbol: 'B', ts: T0, bids: [['1', '1']], asks: [], mult: 1 })).toBeNull();
    });

    test('nivelurile stricate se arunca, cadrul supravietuieste', () => {
        const r = B.normalize({
            exchange: 'x', symbol: 'B', ts: T0, mult: 1,
            bids: [['80000', '1'], ['abc', '2'], ['80001', '-5'], ['0', '3']],
            asks: [['80010', '1']],
        });
        expect(r.bids).toHaveLength(1);
    });
});

describe('agregarea pe paliere — relativ la MIJLOC, nu la un pret fix', () => {
    test('mijlocul se calculeaza din varful celor doua parti', () => {
        const r = B.normalize({
            exchange: 'x', symbol: 'B', ts: T0, mult: 1,
            bids: [['79990', '1']], asks: [['80010', '1']],
        });
        expect(r.mid).toBeCloseTo(80000, 6);
    });

    test('palierele sunt in PROCENTE fata de mijloc, ca sa fie comparabile in timp', () => {
        const agg = B.aggregate({
            frames: [B.normalize({
                exchange: 'x', symbol: 'B', ts: T0, mult: 1,
                bids: [['79960', '1']], asks: [['80040', '2']],
            })],
            bandPct: 0.1, rows: 20,
        });
        const bid = agg.cells.find(c => c.bidUsd > 0);
        const ask = agg.cells.find(c => c.askUsd > 0);
        expect(bid.pct).toBeLessThan(0);
        expect(ask.pct).toBeGreaterThan(0);
        expect(Math.abs(bid.pct)).toBeCloseTo(0.05, 2);
    });

    test('ce iese din banda NU se inghesuie la margine — se exclude', () => {
        // Altfel marginea aduna tot ce e departe si arata ca un perete care
        // nu exista. Aceeasi clasa cu axa heatmap-ului de la b327.
        const agg = B.aggregate({
            frames: [B.normalize({
                exchange: 'x', symbol: 'B', ts: T0, mult: 1,
                bids: [['79990', '1'], ['40000', '1000']],
                asks: [['80010', '1']],
            })],
            bandPct: 0.1, rows: 20,
        });
        const total = agg.cells.reduce((s, c) => s + c.bidUsd, 0);
        expect(total).toBeLessThan(200000);   // 1 BTC, nu 1000
        expect(agg.excludedLevels).toBe(1);
    });

    test('notionalul e pret x cantitate, nu cantitatea', () => {
        const agg = B.aggregate({
            frames: [B.normalize({
                exchange: 'x', symbol: 'B', ts: T0, mult: 1,
                bids: [['79990', '2']], asks: [['80010', '1']],
            })],
            bandPct: 0.1, rows: 20,
        });
        const bid = agg.cells.find(c => c.bidUsd > 0);
        expect(bid.bidUsd).toBeCloseTo(159980, 0);
    });
});

describe('PERSISTENTA — un perete care dispare cand pretul se apropie NU e perete', () => {
    // A treia capcana notata in carte inainte de a incepe. Un instantaneu
    // static MINTE: spoofing-ul arata identic cu lichiditate reala.
    //
    // Raspunsul care nu pretinde ca detecteaza intentii: valoarea celulei e
    // media PONDERATA CU TIMPUL, nu maximul. Un perete fulgerat intr-un cadru
    // din 100 contribuie 1%, deci nu mai domina harta.
    const mk = (ts, bidQty) => B.normalize({
        exchange: 'x', symbol: 'B', ts, mult: 1,
        bids: [['79990', String(bidQty)]], asks: [['80010', '1']],
    });

    test('un perete prezent in TOATE cadrele cantareste complet', () => {
        const frames = Array.from({ length: 10 }, (_, i) => mk(T0 + i * 1000, 10));
        const agg = B.aggregate({ frames, bandPct: 0.1, rows: 20 });
        const c = agg.cells.find(x => x.bidUsd > 0);
        expect(c.bidUsd).toBeCloseTo(79990 * 10, 0);
        expect(c.bidFirmness).toBeCloseTo(1, 2);
    });

    test('un perete FULGERAT intr-un cadru din 10 NU domina harta', () => {
        const frames = Array.from({ length: 10 }, (_, i) => mk(T0 + i * 1000, i === 3 ? 100 : 0.0001));
        const agg = B.aggregate({ frames, bandPct: 0.1, rows: 20 });
        const c = agg.cells.find(x => x.bidUsd > 0);
        // media, nu maximul: ~10 BTC echivalent, nu 100
        expect(c.bidUsd).toBeLessThan(79990 * 15);
        expect(c.bidUsd).toBeGreaterThan(79990 * 5);
    });

    test('fermitatea spune in CATE cadre a fost chiar acolo', () => {
        const frames = Array.from({ length: 10 }, (_, i) => mk(T0 + i * 1000, i < 3 ? 10 : 0));
        const agg = B.aggregate({ frames, bandPct: 0.1, rows: 20 });
        const c = agg.cells.find(x => x.bidUsd > 0);
        expect(c.bidFirmness).toBeCloseTo(0.3, 1);
    });

    test('maximul se pastreaza SEPARAT — se vede si varful, dar nu ca medie', () => {
        const frames = Array.from({ length: 10 }, (_, i) => mk(T0 + i * 1000, i === 3 ? 100 : 1));
        const agg = B.aggregate({ frames, bandPct: 0.1, rows: 20 });
        const c = agg.cells.find(x => x.bidUsd > 0);
        expect(c.bidPeakUsd).toBeCloseTo(79990 * 100, 0);
        expect(c.bidPeakUsd).toBeGreaterThan(c.bidUsd * 5);
    });
});

describe('ZOOM — pe banda si pe timp, din datele care EXISTA', () => {
    const frames = (n) => Array.from({ length: n }, (_, i) => B.normalize({
        exchange: 'x', symbol: 'B', ts: T0 + i * 1000, mult: 1,
        bids: [['79990', '1'], ['79950', '2']], asks: [['80010', '1'], ['80060', '3']],
    }));

    test('banda mai stransa arata mai PUTINE niveluri, dar mai fin', () => {
        const larg = B.aggregate({ frames: frames(5), bandPct: 0.2, rows: 40 });
        const strans = B.aggregate({ frames: frames(5), bandPct: 0.02, rows: 40 });
        expect(strans.rowPct).toBeLessThan(larg.rowPct);
        expect(strans.excludedLevels).toBeGreaterThan(larg.excludedLevels);
    });

    test('banda AUTO se LARGESTE cand datele depasesc implicitul', () => {
        // Lectia de la b326/b327: daca desenezi intervalul CERUT in loc de cel
        // care EXISTA, ascunzi exact ce ai.
        //
        // Prima versiune a testului asta trecea si cu banda FIXA, fiindca datele
        // incapeau in implicitul de 0,1%. Acum nivelurile sunt DINCOLO de el,
        // deci numai o banda chiar automata le poate cuprinde.
        const larg = Array.from({ length: 5 }, (_, i) => B.normalize({
            exchange: 'x', symbol: 'B', ts: T0 + i * 1000, mult: 1,
            bids: [['79990', '1'], ['79700', '2']],   // -0,37%, mult peste 0,1%
            asks: [['80010', '1'], ['80300', '3']],
        }));
        const auto = B.aggregate({ frames: larg, bandPct: 'auto', rows: 40 });
        const fix = B.aggregate({ frames: larg, bandPct: B.DEFAULT_BAND_PCT, rows: 40 });
        expect(auto.bandPct).toBeGreaterThan(B.DEFAULT_BAND_PCT);
        expect(auto.excludedLevels).toBe(0);
        expect(fix.excludedLevels).toBeGreaterThan(0);
    });

    test('banda AUTO se STRANGE cand datele sunt mai inguste decat implicitul', () => {
        const ingust = Array.from({ length: 5 }, (_, i) => B.normalize({
            exchange: 'x', symbol: 'B', ts: T0 + i * 1000, mult: 1,
            bids: [['79996', '1']], asks: [['80004', '1']],   // ±0,005%
        }));
        const auto = B.aggregate({ frames: ingust, bandPct: 'auto', rows: 40 });
        expect(auto.bandPct).toBeLessThan(B.DEFAULT_BAND_PCT);
        expect(auto.bandPct).toBeGreaterThan(0);
    });

    test('fereastra de timp taie cadrele vechi', () => {
        const f = frames(60);
        const a = B.aggregate({ frames: f, bandPct: 0.1, rows: 20, windowMs: 10000, now: T0 + 59000 });
        expect(a.frames).toBeLessThanOrEqual(11);
        expect(a.frames).toBeGreaterThan(5);
    });

    test('fara cadre intoarce o harta GOALA, nu arunca', () => {
        const a = B.aggregate({ frames: [], bandPct: 0.1, rows: 20 });
        expect(a.cells).toEqual([]);
        expect(a.frames).toBe(0);
        expect(a.mid).toBeNull();
    });
});

describe('PERETII — cele mai groase niveluri, cu distanţa in dolari', () => {
    test('se intorc sortaţi, cu partea si distanţa', () => {
        const frames = Array.from({ length: 5 }, (_, i) => B.normalize({
            exchange: 'x', symbol: 'B', ts: T0 + i * 1000, mult: 1,
            bids: [['79990', '1'], ['79950', '20']], asks: [['80010', '1']],
        }));
        const a = B.aggregate({ frames, bandPct: 0.1, rows: 40 });
        const w = B.walls(a, 3);
        expect(w.length).toBeGreaterThan(0);
        expect(w[0].side).toBe('BID');
        expect(w[0].distUsd).toBeLessThan(0);
        expect(w[0].usd).toBeGreaterThan(w[1] ? w[1].usd - 1 : 0);
    });

    test('un perete fara fermitate NU intra in lista', () => {
        // Nivelul gros apare o data din 20 de cadre: e spoof, nu perete.
        const frames = Array.from({ length: 20 }, (_, i) => B.normalize({
            exchange: 'x', symbol: 'B', ts: T0 + i * 1000, mult: 1,
            bids: [['79990', '1'], ['79950', i === 5 ? '500' : '0']], asks: [['80010', '1']],
        }));
        const a = B.aggregate({ frames, bandPct: 0.1, rows: 40 });
        const w = B.walls(a, 5);
        const spoof = w.find(x => Math.round(x.price) === 79950);
        expect(spoof).toBeFalsy();
    });

    test('lista goala cand nu exista nimic — nu se inventeaza pereţi', () => {
        expect(B.walls(B.aggregate({ frames: [], bandPct: 0.1, rows: 20 }), 5)).toEqual([]);
    });
});

describe('CHARTUL — timp x pret, cu linia pretului peste (cerut: „sa arate chartul pretul")', () => {
    const f = (ts, mid, bidQty = 1, askQty = 1) => B.normalize({
        exchange: 'x', symbol: 'B', ts, mult: 1,
        bids: [[mid - 10, String(bidQty)], [mid - 30, '2']],
        asks: [[mid + 10, String(askQty)], [mid + 30, '3']],
    });

    test('grila are coloane de TIMP si randuri de PRET', () => {
        const frames = Array.from({ length: 60 }, (_, i) => f(T0 + i * 1000, 80000));
        const h = B.heat({ frames, cols: 20, rows: 24, bandPct: 0.1, windowMs: 60000, now: T0 + 59000 });
        expect(h.cols).toBe(20);
        expect(h.rows).toBe(24);
        expect(h.cells.length).toBeGreaterThan(0);
        for (const c of h.cells) {
            expect(c.col).toBeGreaterThanOrEqual(0);
            expect(c.col).toBeLessThan(20);
            expect(c.row).toBeGreaterThanOrEqual(0);
            expect(c.row).toBeLessThan(24);
        }
    });

    test('LINIA PRETULUI are o valoare pe FIECARE coloana cu date', () => {
        // Lectia de la panourile de flux: orice panou nou emite o valoare pe
        // fiecare bara, altfel se trage in spate.
        const frames = Array.from({ length: 60 }, (_, i) => f(T0 + i * 1000, 80000 + i * 5));
        const h = B.heat({ frames, cols: 12, rows: 24, bandPct: 0.1, windowMs: 60000, now: T0 + 59000 });
        const cuDate = h.mids.filter(m => m !== null);
        expect(cuDate.length).toBe(12);
        // pretul a urcat, deci linia trebuie sa urce
        expect(cuDate[cuDate.length - 1]).toBeGreaterThan(cuDate[0]);
    });

    test('o coloana FARA cadre e NULL, nu zero si nu interpolata', () => {
        // Zero ar desena linia la 0, iar interpolarea ar inventa un pret care
        // n-a existat. NULL se vede ca o intrerupere, adica adevarul.
        //
        // [2026-10-26] Prima versiune declansa cazul cerand mai multe coloane
        // decat cadre — ceea ce nu se mai poate, fiindca grila e acum marginita
        // la numarul de cadre (vezi nota despre pieptene). Dar proprietatea
        // rameane valabila pe cadre GRUPATE NEUNIFORM, care e si cazul real:
        // fluxul se intrerupe o vreme, apoi revine.
        const frames = [
            f(T0, 80000), f(T0 + 500, 80010), f(T0 + 1000, 80020), f(T0 + 1500, 80030),
            f(T0 + 58000, 80090), f(T0 + 58500, 80095), f(T0 + 59000, 80100),
        ];
        const h = B.heat({ frames, cols: 7, rows: 24, bandPct: 0.2, windowMs: 60000, now: T0 + 59000 });
        expect(h.mids.filter(m => m === null).length).toBeGreaterThan(0);
        expect(h.mids.filter(m => m === 0).length).toBe(0);
    });

    test('axa de timp se intinde pe datele care EXISTA, nu pe fereastra CERUTA', () => {
        // Exact bugul de la b327, pe alt panou. Cu 2 minute de date intr-o
        // fereastra de 30, harta ar fi 93% goala cu o dunga la margine.
        const frames = Array.from({ length: 24 }, (_, i) => f(T0 + i * 5000, 80000));
        const h = B.heat({ frames, cols: 30, rows: 24, bandPct: 0.1,
            windowMs: 30 * 60000, now: T0 + 115000 });
        const span = h.tMax - h.tMin;
        expect(span).toBeLessThan(5 * 60000);
        const coloane = new Set(h.cells.map(c => c.col));
        expect(coloane.size).toBeGreaterThan(20);
    });

    test('intensitatea se raporteaza la maximul GRILEI, ca sa fie comparabila', () => {
        const frames = Array.from({ length: 30 }, (_, i) => f(T0 + i * 1000, 80000, i === 10 ? 50 : 1));
        const h = B.heat({ frames, cols: 15, rows: 24, bandPct: 0.1, windowMs: 60000, now: T0 + 29000 });
        expect(h.maxUsd).toBeGreaterThan(0);
        for (const c of h.cells) {
            expect(c.bidUsd).toBeLessThanOrEqual(h.maxUsd + 1e-6);
            expect(c.askUsd).toBeLessThanOrEqual(h.maxUsd + 1e-6);
        }
    });

    test('fara cadre: grila goala, mids numai NULL, fara aruncat', () => {
        const h = B.heat({ frames: [], cols: 10, rows: 10, bandPct: 0.1 });
        expect(h.cells).toEqual([]);
        expect(h.mids).toHaveLength(10);
        expect(h.mids.every(m => m === null)).toBe(true);
        expect(h.tMin).toBeNull();
    });

    test('randurile sunt ancorate pe mijlocul FIECAREI coloane — pretul se misca', () => {
        // Daca randurile ar fi ancorate pe un pret fix, o miscare de 0,1% ar
        // impinge tot carnetul in afara grilei si harta s-ar goli.
        const frames = Array.from({ length: 60 }, (_, i) => f(T0 + i * 1000, 80000 + i * 10));
        const h = B.heat({ frames, cols: 12, rows: 24, bandPct: 0.05, windowMs: 60000, now: T0 + 59000 });
        const perCol = new Map();
        for (const c of h.cells) perCol.set(c.col, (perCol.get(c.col) || 0) + 1);
        // fiecare coloana trebuie sa aiba celule, nu doar primele
        expect(perCol.size).toBe(12);
    });
});

describe('grila: doua mutatii mi-au supravietuit si le acopar aici', () => {
    // Testele pentru banda si pentru medie existau doar pe aggregate(). Pe
    // grila, doua mutatii au trecut nepedepsite:
    //   - scoaterea gardei de banda  -> ce e departe se INGHESUIE la margine
    //   - suma in loc de medie       -> o coloana cu mai multe cadre pare mai grasa
    // Amandoua ar produce o harta care MINTE, nu una care greseste discret.

    test('ce iese din banda NU se inghesuie la marginea grilei', () => {
        const frames = Array.from({ length: 10 }, (_, i) => B.normalize({
            exchange: 'x', symbol: 'B', ts: T0 + i * 1000, mult: 1,
            bids: [['79990', '1'], ['40000', '1000']],   // al doilea e la -50%
            asks: [['80010', '1']],
        }));
        const h = B.heat({ frames, cols: 10, rows: 20, bandPct: 0.1, windowMs: 60000, now: T0 + 9000 });
        // Randul de jos NU trebuie sa poarte cei 40 de milioane
        const jos = h.cells.filter(c => c.row === 0);
        for (const c of jos) expect(c.bidUsd).toBeLessThan(1e6);
        expect(h.maxUsd).toBeLessThan(1e6);
    });

    test('valoarea celulei e MEDIA pe coloana, nu SUMA — altfel coloanele dense par mai grase', () => {
        // Doua coloane cu acelasi carnet, dar una cu 1 cadru si alta cu 8.
        // Cu suma, a doua ar arata de 8 ori mai plina fara sa fie.
        const lvl = (ts) => B.normalize({
            exchange: 'x', symbol: 'B', ts, mult: 1,
            bids: [['79990', '1']], asks: [['80010', '1']],
        });
        const frames = [lvl(T0)];
        for (let i = 0; i < 8; i++) frames.push(lvl(T0 + 50000 + i * 100));
        const h = B.heat({ frames, cols: 2, rows: 20, bandPct: 0.1, windowMs: 120000, now: T0 + 60000 });
        const c0 = h.cells.filter(c => c.col === 0).reduce((s, c) => s + c.bidUsd, 0);
        const c1 = h.cells.filter(c => c.col === 1).reduce((s, c) => s + c.bidUsd, 0);
        expect(c0).toBeGreaterThan(0);
        expect(c1).toBeGreaterThan(0);
        // egale, nu de 8 ori diferite
        expect(Math.abs(c1 - c0) / c0).toBeLessThan(0.05);
    });
});

describe('⛔ COLOANELE nu pot fi mai multe decat CADRELE — altfel harta e un pieptene', () => {
    // [2026-10-26] Verificat aritmetic pe starea reala a serverului, dupa
    // livrare: la ritm lent (nimeni nu s-a uitat inca) se strang ~20 de cadre
    // in fereastra de 10 minute, iar clientul cere 110 coloane.
    //   20 cadre -> 20 coloane cu date, 90 GOALE (82%)
    //   13 cadre -> 13 coloane cu date, 97 GOALE (88%)
    // Adica exact ce vede el la PRIMA deschidere: dungi subtiri cu gauri intre
    // ele. E aceeasi clasa cu bugul de la b327 — daca desenezi grila CERUTA in
    // loc de cea care incape in date, ascunzi exact ce ai.
    const frames = (n, stepMs = 31000) => Array.from({ length: n }, (_, i) => B.normalize({
        exchange: 'x', symbol: 'B', ts: T0 + i * stepMs, mult: 1,
        bids: [['79990', '1']], asks: [['80010', '1']],
    }));

    test('cu 20 de cadre si 110 coloane cerute, grila are 20 de coloane PLINE', () => {
        const h = B.heat({ frames: frames(20), cols: 110, rows: 24, bandPct: 0.1,
            windowMs: 600000, now: T0 + 19 * 31000 });
        expect(h.cols).toBeLessThanOrEqual(20);
        const cuDate = new Set(h.cells.map(c => c.col)).size;
        expect(cuDate).toBe(h.cols);
        expect(h.mids.filter(m => m === null).length).toBe(0);
    });

    test('cu destule cadre, coloanele cerute se respecta', () => {
        const h = B.heat({ frames: frames(200, 3000), cols: 110, rows: 24, bandPct: 0.1,
            windowMs: 600000, now: T0 + 199 * 3000 });
        expect(h.cols).toBe(110);
        expect(h.mids.filter(m => m === null).length).toBe(0);
    });

    test('un singur cadru NU da o grila de o coloana ilizibila — exista un minim', () => {
        const h = B.heat({ frames: frames(1), cols: 110, rows: 24, bandPct: 0.1 });
        expect(h.cols).toBeGreaterThanOrEqual(2);
    });

    test('raporteaza cate coloane a CERUT clientul, ca sa se poata spune pe ecran', () => {
        const h = B.heat({ frames: frames(20), cols: 110, rows: 24, bandPct: 0.1,
            windowMs: 600000, now: T0 + 19 * 31000 });
        expect(h.colsAsked).toBe(110);
        expect(h.cols).toBeLessThan(h.colsAsked);
    });
});

describe('⛔ FERMITATEA nu poate depasi 100% — randarea a aratat 2450%', () => {
    // Gasit randand harta cu date reale: pereţii afisau fermitate 2450%.
    // Cauza: numaram NIVELURILE care au contribuit, nu CADRELE in care randul
    // a avut ceva. Cu 500 de niveluri pe parte, multe cad in acelasi rand de
    // grila, deci numaratoarea depasea numarul de cadre de 24 de ori.
    //
    // Testul vechi trecea fiindca folosea UN nivel pe cadru — adica exact
    // cazul in care bugul nu se vede.
    const multiNivel = (ts) => B.normalize({
        exchange: 'x', symbol: 'B', ts, mult: 1,
        // sase niveluri care cad TOATE in acelasi palier
        bids: [['79990', '1'], ['79990.1', '1'], ['79990.2', '1'],
               ['79990.3', '1'], ['79990.4', '1'], ['79990.5', '1']],
        asks: [['80010', '1']],
    });

    test('cu sase niveluri pe cadru, fermitatea rameane 1, nu 6', () => {
        const frames = Array.from({ length: 10 }, (_, i) => multiNivel(T0 + i * 1000));
        const agg = B.aggregate({ frames, bandPct: 0.1, rows: 20 });
        const c = agg.cells.find(x => x.bidUsd > 0);
        expect(c.bidFirmness).toBeCloseTo(1, 3);
    });

    test('fermitatea e MEREU intre 0 si 1, orice forma au cadrele', () => {
        const frames = Array.from({ length: 10 }, (_, i) => multiNivel(T0 + i * 1000));
        const agg = B.aggregate({ frames, bandPct: 0.1, rows: 20 });
        for (const c of agg.cells) {
            expect(c.bidFirmness).toBeGreaterThanOrEqual(0);
            expect(c.bidFirmness).toBeLessThanOrEqual(1);
            expect(c.askFirmness).toBeGreaterThanOrEqual(0);
            expect(c.askFirmness).toBeLessThanOrEqual(1);
        }
    });

    test('prezent in 3 cadre din 10, cu multe niveluri, da 0,3 nu 1,8', () => {
        const frames = Array.from({ length: 10 }, (_, i) => (i < 3
            ? multiNivel(T0 + i * 1000)
            : B.normalize({ exchange: 'x', symbol: 'B', ts: T0 + i * 1000, mult: 1,
                bids: [['79900', '1']], asks: [['80010', '1']] })));
        const agg = B.aggregate({ frames, bandPct: 0.2, rows: 20 });
        const c = agg.cells.find(x => Math.abs(x.pct + 0.0125) < 0.02 && x.bidUsd > 0)
            || agg.cells.filter(x => x.bidUsd > 0).sort((a, b) => b.bidUsd - a.bidUsd)[0];
        expect(c.bidFirmness).toBeLessThanOrEqual(1);
        expect(c.bidFirmness).toBeCloseTo(0.3, 1);
    });

    test('niciun perete nu raporteaza fermitate peste 100%', () => {
        const frames = Array.from({ length: 10 }, (_, i) => multiNivel(T0 + i * 1000));
        const agg = B.aggregate({ frames, bandPct: 0.1, rows: 20 });
        for (const w of B.walls(agg, 10)) expect(w.firmness).toBeLessThanOrEqual(1);
    });
});

describe('⛔ REFERINTA DE JOS pentru intensitate — raportul pe CELULA e 3x, nu 745x', () => {
    // Masurat pe carte reala: raportul max/median e 745x PE NIVEL, dar o celula
    // de grila aduna ~19 niveluri, deci pe CELULA raportul e 3,0x (26 randuri)
    // sau 6,2x (48 randuri). Cu scara logaritmica potrivita pentru 745x, toate
    // celulele ies intre 0,79 si 1,00 — adica harta uniform aprinsa, randata si
    // vazuta cu ochii.
    //
    // Deci grila trebuie sa spuna si o referinta DE JOS, ca intensitatea sa fie
    // normalizata intre ea si maxim.
    const f = (ts, qty) => B.normalize({
        exchange: 'x', symbol: 'B', ts, mult: 1,
        bids: [['79990', String(qty)], ['79950', '0.2']],
        asks: [['80010', '1'], ['80050', '3']],
    });

    test('grila raporteaza o referinta de jos, pozitiva si sub maxim', () => {
        const h = B.heat({ frames: [f(T0, 5), f(T0 + 1000, 5)], cols: 4, rows: 20, bandPct: 0.1 });
        expect(h.loUsd).toBeGreaterThan(0);
        expect(h.loUsd).toBeLessThan(h.maxUsd);
    });

    test('referinta de jos e un PERCENTIL mic al celulelor, nu minimul absolut', () => {
        // Minimul absolut ar fi o singura celula norocoasa si ar face scara
        // instabila de la o aducere la alta.
        const frames = Array.from({ length: 6 }, (_, i) => f(T0 + i * 1000, 5));
        const h = B.heat({ frames, cols: 6, rows: 40, bandPct: 0.1 });
        const vals = h.cells.map(c => Math.max(c.bidUsd, c.askUsd)).filter(v => v > 0).sort((a, b) => a - b);
        expect(h.loUsd).toBeGreaterThanOrEqual(vals[0]);
        expect(h.loUsd).toBeLessThanOrEqual(vals[Math.floor(vals.length * 0.5)]);
    });

    test('scara intre referinta si maxim DISCRIMINEAZA — median nu sare la 0,88', () => {
        const frames = Array.from({ length: 6 }, (_, i) => f(T0 + i * 1000, 5));
        const h = B.heat({ frames, cols: 6, rows: 40, bandPct: 0.1 });
        const vals = h.cells.map(c => Math.max(c.bidUsd, c.askUsd)).filter(v => v > 0).sort((a, b) => a - b);
        const med = vals[Math.floor(vals.length / 2)];
        const inten = (u) => (u > h.loUsd ? Math.log(u / h.loUsd) / Math.log(h.maxUsd / h.loUsd) : 0);
        expect(inten(med)).toBeLessThan(0.85);
        expect(inten(h.maxUsd)).toBeCloseTo(1, 3);
    });

    test('fara celule, referinta de jos e 0 si nu produce NaN', () => {
        const h = B.heat({ frames: [], cols: 4, rows: 10, bandPct: 0.1 });
        expect(h.loUsd).toBe(0);
    });
});

describe('⛔ PIEPTENELE — vazut in captura LUI, cu goluri negre intre benzi', () => {
    // [2026-10-26] El a trimis o captura: harta avea 9 benzi de culoare cu
    // GOLURI NEGRE intre ele, si linia pretului rupta in bucati.
    //
    // La b334 marginisem coloanele la numarul de cadre — dar asta repara doar
    // jumatate: cadrele NU vin la intervale egale (31 s cand nu se uita nimeni,
    // 5 s cat timp se uita), deci mai multe cad in aceeasi coloana si altele
    // rameane goale. Reprodus: 29 de cadre -> 19 coloane cu date, 10 GOALE (34%).
    //
    // REPARATIA E UN ADEVAR FIZIC, nu o cosmetizare: cartea de ordine NU dispare
    // intre instantanee — doar n-am privit. Deci fiecare instantaneu TINE pana
    // la urmatorul. Dar nu la nesfarsit: o pana reala de flux nu are voie sa fie
    // pictata ca date, deci tinerea se opreste dupa cateva intervale tipice.
    const neegale = () => {
        const ts = [];
        let t = T0;
        for (let i = 0; i < 14; i++) { ts.push(t); t += 31000; }
        for (let i = 0; i < 15; i++) { ts.push(t); t += 5000; }
        return { ts, end: t };
    };
    const mk = (ts) => ts.map(x => B.normalize({ exchange: 'b', symbol: 'B', ts: x, mult: 1,
        bids: [['79990', '1'], ['79950', '2']], asks: [['80010', '1'], ['80050', '3']] }));

    test('cu intervale NEEGALE nu mai rameane nicio coloana goala', () => {
        const { ts, end } = neegale();
        const h = B.heat({ frames: mk(ts), cols: 110, rows: 24, bandPct: 0.1,
            windowMs: 600000, now: end });
        const cuDate = new Set(h.cells.map(c => c.col));
        expect(cuDate.size).toBe(h.cols);
    });

    test('si linia pretului nu mai e rupta', () => {
        const { ts, end } = neegale();
        const h = B.heat({ frames: mk(ts), cols: 110, rows: 24, bandPct: 0.1,
            windowMs: 600000, now: end });
        expect(h.mids.filter(m => m === null).length).toBe(0);
    });

    test('raporteaza cate coloane sunt TINUTE, ca sa se poata spune pe ecran', () => {
        const { ts, end } = neegale();
        const h = B.heat({ frames: mk(ts), cols: 110, rows: 24, bandPct: 0.1,
            windowMs: 600000, now: end });
        expect(h.heldCols).toBeGreaterThan(0);
        expect(h.heldCols).toBeLessThan(h.cols);
    });

    test('o PANA reala de flux NU se picteaza ca date', () => {
        // Cadre dese, apoi o gaura de 5 minute, apoi dese iar. Golul trebuie sa
        // rameana gol: altfel harta ar afirma ca stia ce e in carte cand nu stia.
        const ts = [];
        let t = T0;
        for (let i = 0; i < 20; i++) { ts.push(t); t += 5000; }
        t += 5 * 60000;
        for (let i = 0; i < 20; i++) { ts.push(t); t += 5000; }
        const h = B.heat({ frames: mk(ts), cols: 40, rows: 24, bandPct: 0.1,
            windowMs: 15 * 60000, now: t });
        expect(h.mids.filter(m => m === null).length).toBeGreaterThan(0);
    });

    test('tinerea NU inventeaza coloane inainte de primul instantaneu', () => {
        const { ts, end } = neegale();
        const h = B.heat({ frames: mk(ts), cols: 110, rows: 24, bandPct: 0.1,
            windowMs: 600000, now: end });
        expect(h.mids[0]).not.toBeNull();
        expect(h.tMin).toBe(ts[0]);
    });

    test('celulele tinute sunt MARCATE, nu se dau drept observatii noi', () => {
        const { ts, end } = neegale();
        const h = B.heat({ frames: mk(ts), cols: 110, rows: 24, bandPct: 0.1,
            windowMs: 600000, now: end });
        const tinute = h.cells.filter(c => c.held);
        const masurate = h.cells.filter(c => !c.held);
        expect(tinute.length).toBeGreaterThan(0);
        expect(masurate.length).toBeGreaterThan(0);
    });
});

describe('⛔ DISTANTA se masoara de la pretul de ACUM, nu de la media ferestrei', () => {
    // [2026-10-26] Gasit citindu-i captura ca sa i-o explic. Pretul cazuse 93 de
    // dolari in 10 minute, banda e ±0,165% (±132 dolari), iar scara era ancorata
    // pe media ferestrei (~79.954) in loc de pretul de acum (79.900).
    //
    // Rezultatul pe ecranul lui: un BID la 79.942 etichetat „-12" — dar fata de
    // pretul de acum el e DEASUPRA, ceea ce e imposibil pentru un ordin de
    // cumparare in asteptare. Eticheta se batea cap in cap cu ce vedea.
    //
    // Palierele RAMAN relative (fiecare cadru fata de mijlocul LUI, altfel
    // lichiditatea n-ar fi comparabila in timp) — dar traducerea in preturi
    // absolute trebuie facuta cu „acum", fiindca „acum" e ce vede el sus.
    const scade = () => Array.from({ length: 10 }, (_, i) => B.normalize({
        exchange: 'x', symbol: 'B', ts: T0 + i * 60000, mult: 1,
        bids: [[String(79990 - i * 10 - 40), '5']],
        asks: [[String(79990 - i * 10 + 40), '5']],
    }));

    test('mijlocul raportat e cel din ULTIMUL cadru, nu media', () => {
        const frames = scade();
        const agg = B.aggregate({ frames, bandPct: 0.3, rows: 40,
            windowMs: 900000, now: T0 + 9 * 60000 });
        const ultimul = frames[frames.length - 1].mid;
        const media = frames.reduce((s, f) => s + f.mid, 0) / frames.length;
        expect(agg.mid).toBeCloseTo(ultimul, 6);
        expect(Math.abs(agg.mid - media)).toBeGreaterThan(10);
    });

    test('un BID nu poate iesi DEASUPRA pretului de acum', () => {
        const agg = B.aggregate({ frames: scade(), bandPct: 0.3, rows: 40,
            windowMs: 900000, now: T0 + 9 * 60000 });
        for (const c of agg.cells) {
            if (c.bidUsd > 0) expect(c.price).toBeLessThanOrEqual(agg.mid + 1e-6);
        }
    });

    test('un ASK nu poate iesi DEDESUBTUL pretului de acum', () => {
        const agg = B.aggregate({ frames: scade(), bandPct: 0.3, rows: 40,
            windowMs: 900000, now: T0 + 9 * 60000 });
        for (const c of agg.cells) {
            if (c.askUsd > 0) expect(c.price).toBeGreaterThanOrEqual(agg.mid - 1e-6);
        }
    });

    test('semnul distantei se potriveste cu partea: BID negativ, ASK pozitiv', () => {
        const agg = B.aggregate({ frames: scade(), bandPct: 0.3, rows: 40,
            windowMs: 900000, now: T0 + 9 * 60000 });
        const w = B.walls(agg, 10);
        expect(w.length).toBeGreaterThan(1);
        for (const x of w) {
            if (x.side === 'BID') expect(x.distUsd).toBeLessThanOrEqual(0);
            else expect(x.distUsd).toBeGreaterThanOrEqual(0);
        }
    });

    test('pe o piaţa care NU se misca, nimic nu se schimba', () => {
        const stabil = Array.from({ length: 10 }, (_, i) => B.normalize({
            exchange: 'x', symbol: 'B', ts: T0 + i * 60000, mult: 1,
            bids: [['79950', '5']], asks: [['80050', '5']],
        }));
        const agg = B.aggregate({ frames: stabil, bandPct: 0.3, rows: 40,
            windowMs: 900000, now: T0 + 9 * 60000 });
        expect(agg.mid).toBeCloseTo(80000, 6);
    });
});
