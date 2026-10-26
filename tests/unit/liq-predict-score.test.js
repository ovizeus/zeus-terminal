'use strict';
// ══════════════════════════════════════════════════════════════════
// PREDICŢIA pe lichidări — nucleul de calcul, funcţii pure
// ══════════════════════════════════════════════════════════════════
//
// [LIQ-PREDICT 2026-10-26] Operatorul: „să socotească din lichidările reale
// unde e atracţia, magnetul… pe BTC şi ETH… dar date reale, nu fake".
//
// PRIMUL TEST DIN FIŞIER APĂRĂ SEMNUL, şi nu din pedanterie: pe 23 octombrie
// am livrat un filtru cu semnul întors şi a trebuit retras tot (R-V-13). Aici
// un semn întors ar da un panou care arată încrezător exact direcţia greşită.
//
// Mecanica, verificată în datele reale ale operatorului (2026-10-26):
//   23:00 → 137 M$ LONG lichidat, preţul 80 755 → 79 808  (a CĂZUT)
//   04:00 →  40 M$ SHORT lichidat, preţul 79 273 → 80 095  (a URCAT)
// Deci: long lichidat = vânzare forţată = preţul coboară.
// Combustibilul ARS nu mai e acolo; magnetul arată spre partea care a RĂMAS.

const P = require('../../server/services/liqPredict');

const T0 = 1793000000000;
const ev = (side, usd, minutesAgo, price = 80000) =>
    ({ side, usd, price, ts: T0 - minutesAgo * 60000 });

// Linie de baza NEUTRA: piata in care longurile si shorturile ard egal.
// Testele de mecanica o folosesc ca sa masoare exact semnul, nu înclinarea
// structurala a pietei.
const BASE0 = { imbalance: 0, n: 500, hours: 24 };

describe('direcţia magnetului — partea ARSĂ nu e ţinta', () => {
    test('longurile arse (SELL) ⇒ combustibilul rămas e SUS ⇒ magnet UP', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0, baseline: BASE0,
            events: [ev('SELL', 200e6, 30), ev('SELL', 50e6, 60)],
        });
        expect(r.side).toBe('UP');
    });

    test('shorturile arse (BUY) ⇒ combustibilul rămas e JOS ⇒ magnet DOWN', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0, baseline: BASE0,
            events: [ev('BUY', 200e6, 30), ev('BUY', 50e6, 60)],
        });
        expect(r.side).toBe('DOWN');
    });

    test('NU e invers: un singur eveniment SELL nu poate da DOWN', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0, baseline: BASE0,
            events: [ev('SELL', 300e6, 10)],
        });
        expect(r.side).not.toBe('DOWN');
    });
});

describe('descreşterea în timp — o lichidare de ieri nu cântăreşte ca una de acum', () => {
    test('acelaşi dolar, mai vechi, cântăreşte mai puţin', () => {
        const proaspat = P.decayedUsd([ev('SELL', 100e6, 1)], T0);
        const vechi = P.decayedUsd([ev('SELL', 100e6, 600)], T0);
        expect(proaspat.long).toBeGreaterThan(vechi.long * 5);
    });

    test('la un timp de înjumătăţire greutatea e ~jumătate', () => {
        const w = P.weight(P.HALF_LIFE_MS, P.HALF_LIFE_MS);
        expect(w).toBeGreaterThan(0.45);
        expect(w).toBeLessThan(0.55);
    });

    test('un eveniment din viitor nu capătă greutate peste 1', () => {
        expect(P.weight(-5 * 3600000, P.HALF_LIFE_MS)).toBeLessThanOrEqual(1);
    });
});

describe('NO EDGE — cea mai importantă funcţie e să TACĂ', () => {
    test('fără evenimente nu există semnal', () => {
        const r = P.score({ symbol: 'BTCUSDT', price: 80000, now: T0, baseline: BASE0, events: [] });
        expect(r.side).toBe('NONE');
        expect(r.reason).toMatch(/data/i);
    });

    test('prea puţini dolari ⇒ NONE, nu un semnal slab', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0, baseline: BASE0,
            events: [ev('SELL', 1000, 5)],
        });
        expect(r.side).toBe('NONE');
    });

    test('părţile echilibrate ⇒ NONE: nu există magnet', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0, baseline: BASE0,
            events: [ev('SELL', 100e6, 30), ev('BUY', 100e6, 30)],
        });
        expect(r.side).toBe('NONE');
    });

    test('mulţimea aglomerată ÎMPOTRIVA magnetului anulează semnalul', () => {
        // Longurile arse ⇒ magnet UP. Dar dacă 69% din conturi sunt long,
        // combustibilul de JOS se reface — exact cazul BTC de azi, pe care
        // l-am citit operatorului ca „nu e un semnal curat".
        const curat = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0, baseline: BASE0,
            events: [ev('SELL', 200e6, 30)],
        });
        const contrazis = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0, baseline: BASE0,
            events: [ev('SELL', 200e6, 30)],
            crowd: { longAccount: 0.69 },
        });
        expect(curat.side).toBe('UP');
        expect(contrazis.strength).toBeLessThan(curat.strength);
    });
});

describe('ţinta — din paliere reale, NU o cifră rotundă', () => {
    test('magnet UP ⇒ ţinta e palierul de DEASUPRA unde mor shorturile', () => {
        const r = P.target({
            price: 80000, side: 'UP',
            events: [ev('BUY', 40e6, 30, 80520), ev('BUY', 2e6, 30, 81500), ev('SELL', 90e6, 30, 79750)],
        });
        expect(r.price).toBeGreaterThan(80000);
        expect(Math.abs(r.price - 80500)).toBeLessThan(260);
    });

    test('magnet DOWN ⇒ ţinta e palierul de DEDESUBT unde mor longurile', () => {
        const r = P.target({
            price: 80000, side: 'DOWN',
            events: [ev('SELL', 120e6, 30, 79760), ev('BUY', 40e6, 30, 80520)],
        });
        expect(r.price).toBeLessThan(80000);
        expect(Math.abs(r.price - 79750)).toBeLessThan(260);
    });

    test('un palier prea mic în dolari NU e ţintă — altfel o lichidare singură devine magnet', () => {
        // O mutaţie a scos pragul şi toate testele au trecut: nimic nu-l apăra.
        const r = P.target({
            price: 80000, side: 'UP',
            events: [ev('BUY', 4000, 30, 80520)],
        });
        expect(r).toBeNull();
    });

    test('peste prag, acelaşi palier DEVINE ţintă — pragul nu respinge tot', () => {
        const r = P.target({
            price: 80000, side: 'UP',
            events: [ev('BUY', 40e6, 30, 80520)],
        });
        expect(r).not.toBeNull();
    });

    test('fără palier în direcţia magnetului ⇒ ţintă NULĂ, nu inventată', () => {
        const r = P.target({
            price: 80000, side: 'UP',
            events: [ev('SELL', 120e6, 30, 79000)],
        });
        expect(r).toBeNull();
    });
});

describe('procentul NU se afirmă — se măsoară', () => {
    test('fără cazuri rezolvate nu există rată, ci starea de calibrare', () => {
        const h = P.hitRate({ resolved: 0, hits: 0 });
        expect(h.calibrating).toBe(true);
        expect(h.pct).toBeNull();
    });

    test('sub pragul de cazuri rămâne în calibrare chiar dacă toate au nimerit', () => {
        const h = P.hitRate({ resolved: 5, hits: 5 });
        expect(h.calibrating).toBe(true);
        expect(h.pct).toBeNull();
        expect(h.need).toBe(P.MIN_SAMPLES);
    });

    test('peste prag apare rata OBSERVATĂ, nu una presupusă', () => {
        const h = P.hitRate({ resolved: 40, hits: 28 });
        expect(h.calibrating).toBe(false);
        expect(h.pct).toBe(70);
    });
});

describe('evaluarea unui semnal trecut — pe bare REALE, nu pe amintiri', () => {
    const bars = (...hl) => hl.map(([h, l, c], i) => ({ time: (T0 / 1000) + i * 300, high: h, low: l, close: c }));

    test('UP cu ţintă atinsă ⇒ HIT, şi regula spune pe ce s-a decis', () => {
        const r = P.evaluate({ side: 'UP', priceAt: 80000, targetPrice: 80500,
            bars: bars([80200, 79900, 80100], [80600, 80150, 80550]) });
        expect(r.outcome).toBe('HIT');
        expect(r.rule).toBe('TARGET');
    });

    test('UP care a urcat DAR nu până la ţintă ⇒ MISS, nu „aproape"', () => {
        const r = P.evaluate({ side: 'UP', priceAt: 80000, targetPrice: 80500,
            bars: bars([80200, 79900, 80100], [80400, 80150, 80350]) });
        expect(r.outcome).toBe('MISS');
        expect(r.extremePct).toBeGreaterThan(0);
    });

    test('DOWN cu ţinta atinsă în jos ⇒ HIT', () => {
        const r = P.evaluate({ side: 'DOWN', priceAt: 80000, targetPrice: 79500,
            bars: bars([80100, 79800, 79900], [79950, 79450, 79600]) });
        expect(r.outcome).toBe('HIT');
    });

    test('fără ţintă cartografiată se judecă DIRECŢIA, şi se spune', () => {
        const r = P.evaluate({ side: 'UP', priceAt: 80000, targetPrice: null,
            bars: bars([80200, 79900, 80300]) });
        expect(r.rule).toBe('DIRECTION');
        expect(r.outcome).toBe('HIT');
    });

    test('fără bare NU se inventează un rezultat — rămâne nerezolvat', () => {
        expect(P.evaluate({ side: 'UP', priceAt: 80000, targetPrice: 80500, bars: [] })).toBeNull();
    });

    test('extrema se ia pe partea semnalului, nu pe amândouă', () => {
        // Un UP care a căzut adânc şi a revenit: extrema RELEVANTĂ e maximul.
        const r = P.evaluate({ side: 'UP', priceAt: 80000, targetPrice: null,
            bars: bars([80100, 78000, 79000], [80300, 79500, 80250]) });
        expect(r.extremePct).toBeCloseTo(0.375, 2);
    });
});

describe('LINIA DE BAZA — „longurile ard mai mult" e starea NORMALA, nu o informaţie', () => {
    // [2026-10-26] Masurat pe 13h de date reale: cu masurarea fata de ZERO,
    // semnalul a dat 19 UP / 0 DOWN pe BTC si 22 UP / 0 DOWN pe ETH. Un semnal
    // care nu poate spune niciodata DOWN nu e un semnal.
    //
    // Cauza e structurala: multimea e 69-77% long, deci 71,4% din dolarii arsi
    // pe BTC sunt longuri PRIN NATURA. Doar ABATEREA de la propria linie de
    // baza spune ceva. Fata de linia de baza, aceleasi date dau 10 UP / 4 DOWN
    // / 9 NO EDGE pe BTC — adica un instrument care discrimineaza.

    const base = (imb) => ({ imbalance: imb, n: 500, hours: 24 });

    test('o piaţa care arde 71% longuri PRIN NATURA: 71% nu e semnal', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0,
            baseline: base(0.428),   // 71,4% long, masurat pe BTC
            events: [ev('SELL', 71.4e6, 20), ev('BUY', 28.6e6, 20)],
        });
        expect(r.side).toBe('NONE');
        expect(r.reason).toMatch(/baseline|normal/i);
    });

    test('ACEEASI ardere, intr-o piaţa echilibrata, ESTE semnal', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0,
            baseline: base(0),
            events: [ev('SELL', 71.4e6, 20), ev('BUY', 28.6e6, 20)],
        });
        expect(r.side).toBe('UP');
    });

    test('mai PUTINE longuri arse decat normal ⇒ DOWN, direcţia care lipsea', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0,
            baseline: base(0.428),
            events: [ev('SELL', 40e6, 20), ev('BUY', 60e6, 20)],
        });
        expect(r.side).toBe('DOWN');
    });

    test('FARA linie de baza stabilita NU se afirma nimic — cedeaza INCHIS', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0,
            events: [ev('SELL', 200e6, 20)],
        });
        expect(r.side).toBe('NONE');
        expect(r.reason).toMatch(/baseline/i);
    });

    test('o linie de baza din prea puţine evenimente NU se accepta', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0,
            baseline: { imbalance: 0.4, n: 5, hours: 24 },
            events: [ev('SELL', 200e6, 20)],
        });
        expect(r.side).toBe('NONE');
        expect(r.reason).toMatch(/baseline/i);
    });

    test('o linie de baza din prea puţine ORE NU se accepta', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0,
            baseline: { imbalance: 0.4, n: 500, hours: 1 },
            events: [ev('SELL', 200e6, 20)],
        });
        expect(r.side).toBe('NONE');
        expect(r.reason).toMatch(/baseline/i);
    });

    test('dezechilibrul relativ e raportat, ca sa se poata verifica', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0,
            baseline: base(0.428),
            events: [ev('SELL', 90e6, 20), ev('BUY', 10e6, 20)],
        });
        expect(r.baselineImbalance).toBeCloseTo(0.428, 3);
        expect(r.relativeImbalance).toBeCloseTo(0.8 - 0.428, 2);
    });
});

describe('linia de baza se calculeaza din evenimente', () => {
    test('cota de ardere long devine dezechilibrul normal', () => {
        const b = P.buildBaseline([
            ev('SELL', 241.5e6, 100), ev('BUY', 96.7e6, 100),
        ], T0, 13);
        expect(b.imbalance).toBeCloseTo(0.428, 2);
        expect(b.n).toBe(2);
    });

    test('NU se pondereaza cu varsta — linia de baza e despre NORMAL, nu despre ACUM', () => {
        const proaspat = P.buildBaseline([ev('SELL', 100e6, 1), ev('BUY', 100e6, 1)], T0, 13);
        const vechi = P.buildBaseline([ev('SELL', 100e6, 2000), ev('BUY', 100e6, 2000)], T0, 13);
        expect(proaspat.imbalance).toBeCloseTo(vechi.imbalance, 6);
    });

    test('fara evenimente nu exista linie de baza', () => {
        expect(P.buildBaseline([], T0, 13)).toBeNull();
    });
});

describe('MOTIVUL nu are voie sa afirme ceva fals in absolut', () => {
    // [2026-10-26] Prins uitandu-ma la ieşirea pe date vii: pe BTC motivul
    // scria „shorts burned" desi in absolut arsesera mai mult LONGURILE
    // (52,7M vs 45,1M). Directia vine din masura RELATIVA la linia de baza,
    // deci motivul trebuie sa spuna exact asta, altfel panoul afirma o
    // neadevarata verificabila cu doua randuri mai jos, in dreptul „Burned".
    const base = (imb) => ({ imbalance: imb, n: 500, hours: 24 });

    test('DOWN cu longuri arse mai mult in absolut NU spune „shorts burned"', () => {
        const r = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0,
            baseline: base(0.428),
            events: [ev('SELL', 52.7e6, 20), ev('BUY', 45.1e6, 20)],
        });
        expect(r.side).toBe('DOWN');
        expect(r.longBurnedUsd).toBeGreaterThan(r.shortBurnedUsd);
        expect(r.reason).not.toMatch(/^shorts burned/);
        expect(r.reason).toMatch(/norm|normal|than usual/i);
    });

    test('motivul numeste linia de baza, ca afirmaţia sa fie verificabila', () => {
        const up = P.score({
            symbol: 'BTCUSDT', price: 80000, now: T0,
            baseline: base(0), events: [ev('SELL', 200e6, 20)],
        });
        expect(up.side).toBe('UP');
        expect(up.reason).toMatch(/norm|normal|than usual/i);
        expect(up.reason).toMatch(/above/);
    });

    test('ambele motive sunt in ENGLEZA (R-P-10)', () => {
        const txt = [
            P.score({ symbol: 'X', price: 1, now: T0, baseline: base(0), events: [ev('SELL', 200e6, 20)] }).reason,
            P.score({ symbol: 'X', price: 1, now: T0, baseline: base(0), events: [ev('BUY', 200e6, 20)] }).reason,
            P.score({ symbol: 'X', price: 1, now: T0, baseline: base(0.428), events: [ev('SELL', 71e6, 20), ev('BUY', 29e6, 20)] }).reason,
            P.score({ symbol: 'X', price: 1, now: T0, events: [ev('SELL', 200e6, 20)] }).reason,
        ].join(' ').toLowerCase();
        for (const r of ['lichid', 'arse', 'linia', 'piata', 'piaţa', 'combustibil', 'deasupra', 'dedesubt']) {
            expect(txt).not.toContain(r);
        }
    });
});

describe('GRUPUL DE CONTROL — fara el, un procent poate minti in ambele direcţii', () => {
    // [2026-10-26] Masurat pe 125h de bare reale: o ţinta la -0,58% pe BTC e
    // atinsa NECONDITIONAT in 9% din cazuri pe 1h, dar in 86% pe 24h.
    //
    // Deci „30% hit rate pe 1h" e de fapt de 3 ori rata de baza, iar „86% hit
    // rate pe 24h" e EXACT rata de baza, adica zero informaţie. Un procent fara
    // rata de baza induce in eroare in AMBELE direcţii.
    //
    // Soluţia care nu cere date in plus: oglinda. Pentru fiecare semnal se
    // verifica si ţinta SIMETRICA, pe aceleasi bare. Daca semnalul loveste 30%
    // si oglinda 9%, exista avantaj; daca amandoua dau 86%, nu exista.
    const bars = (...hl) => hl.map(([h, l, c], i) => ({ time: (T0 / 1000) + i * 300, high: h, low: l, close: c }));

    test('semnalul atinge ţinta, oglinda NU ⇒ avantaj', () => {
        const r = P.evaluate({ side: 'UP', priceAt: 80000, targetPrice: 80500,
            bars: bars([80600, 79900, 80550]) });
        expect(r.outcome).toBe('HIT');
        expect(r.controlOutcome).toBe('MISS');   // oglinda ar fi 79500
    });

    test('amandoua atinse ⇒ semnalul NU a adus nimic, si se vede', () => {
        const r = P.evaluate({ side: 'UP', priceAt: 80000, targetPrice: 80500,
            bars: bars([80700, 79400, 80100]) });
        expect(r.outcome).toBe('HIT');
        expect(r.controlOutcome).toBe('HIT');
    });

    test('oglinda e la ACEEASI distanţa, in partea opusa', () => {
        const r = P.evaluate({ side: 'DOWN', priceAt: 80000, targetPrice: 79200,
            bars: bars([80810, 79900, 80700]) });
        expect(r.outcome).toBe('MISS');          // n-a cobaorat la 79200
        expect(r.controlOutcome).toBe('HIT');     // dar a urcat la 80800
    });

    test('fara ţinta NU exista control — pe direcţie oglinda e complementul, deci nu spune nimic', () => {
        const r = P.evaluate({ side: 'UP', priceAt: 80000, targetPrice: null,
            bars: bars([80200, 79900, 80300]) });
        expect(r.rule).toBe('DIRECTION');
        expect(r.controlOutcome).toBeNull();
    });

    test('distanţa ţintei e raportata, ca ratele sa poata fi grupate pe distanţa', () => {
        const r = P.evaluate({ side: 'DOWN', priceAt: 80000, targetPrice: 79536,
            bars: bars([80100, 79500, 79600]) });
        expect(r.targetPct).toBeCloseTo(-0.58, 2);
    });
});

describe('avantajul se raporteaza ca RAPORT, nu ca procent singur', () => {
    test('fara control nu exista raport', () => {
        const l = P.lift({ resolved: 40, hits: 28, controlResolved: 0, controlHits: 0 });
        expect(l.ratio).toBeNull();
    });

    test('30% fata de 9% da un raport de peste 3', () => {
        const l = P.lift({ resolved: 100, hits: 30, controlResolved: 100, controlHits: 9 });
        expect(l.ratio).toBeCloseTo(3.33, 1);
        expect(l.controlPct).toBe(9);
    });

    test('86% fata de 86% da raport 1 — adica NICIUN avantaj', () => {
        const l = P.lift({ resolved: 100, hits: 86, controlResolved: 100, controlHits: 86 });
        expect(l.ratio).toBeCloseTo(1, 2);
    });

    test('control zero nu produce impartire la zero', () => {
        const l = P.lift({ resolved: 100, hits: 30, controlResolved: 100, controlHits: 0 });
        expect(Number.isFinite(l.ratio) || l.ratio === null).toBe(true);
    });
});
