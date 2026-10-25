'use strict';
// tests/unit/liq-store.test.js
//
// [LIQ-HISTORY 2026-10-25] Harta de lichidari din Quantitative Monitor arata
// date doar in +-0,75% de pret, iar operatorul a cerut sa vada lichidari
// „pana sus si pana jos, cu date reale".
//
// Randurile goale NU erau un bug. Harta arata numai lichidari care chiar s-au
// intamplat, pe o fereastra de 24h — iar BTC s-a miscat +0,6% / -0,6% in 24h.
// Nu lipseau date: n-aveau ce exista acolo. (Modelul sintetic care umplea
// scara a fost scos deliberat la BUG5.5 fiindca producea „clustere fantoma de
// miliarde".)
//
// Deci singura cale ONESTA de a umple scara e o fereastra mai lunga de
// evenimente REALE. Masurat pe pretul real: la 30 de zile BTC a acoperit
// +8,3% / -1,7%, fata de +-0,6% la 24h.
//
// Ce exista azi: liqFeedAggregator primeste evenimentele de la 3 burse si le
// tine intr-un inel de 1000 in RAM, plus clientul pastreaza 24h in
// localStorage PE TELEFONUL LUI. Nimic nu supravietuieste unei reporniri si
// nimic nu e comun intre dispozitive. Modulul asta e memoria care lipsea.
//
// NOTA onesta despre acoperire: Binance futures NU livreaza nimic catre acest
// server — abonarea e confirmata cu {"result":null,"id":1} si apoi tacere,
// in timp ce SPOT-ul curge normal. Deci istoricul se construieste din Bybit +
// OKX. Asta e o limitare de retea, nu a modulului.

const fs = require('fs');
const os = require('os');
const path = require('path');

let api, db, store;
const DAY = 86400000;

beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-liq-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    api = require('../../server/services/database');
    db = api.db;
    store = require('../../server/services/liqStore');
});

afterEach(() => { try { db.exec('DELETE FROM liq_events;'); } catch (_) {} });

function ev(over = {}) {
    return Object.assign({
        exchange: 'bybit', symbol: 'BTCUSDT', side: 'SELL', isLong: true,
        p: 80000, q: 0.5, vol: 40000, time: Date.now(),
    }, over);
}

describe('depozitul de lichidari — scrierea', () => {

    test('tabela exista, creata de migratie', () => {
        const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='liq_events'").get();
        expect(t).toBeTruthy();
    });

    test('un eveniment valid se scrie si se citeste inapoi intreg', () => {
        store.record(ev({ p: 81234.5, q: 0.25, vol: 20308.6, side: 'BUY' }));
        const rows = db.prepare('SELECT * FROM liq_events').all();
        expect(rows).toHaveLength(1);
        expect(rows[0].symbol).toBe('BTCUSDT');
        expect(rows[0].side).toBe('BUY');
        expect(rows[0].price).toBeCloseTo(81234.5, 2);
        expect(rows[0].usd).toBeCloseTo(20308.6, 2);
    });

    test('un eveniment stricat NU se scrie si NU arunca — fluxul nu moare din cauza bazei', () => {
        for (const bad of [null, {}, ev({ p: 0 }), ev({ p: NaN }), ev({ vol: -5 }), ev({ symbol: '' })]) {
            expect(() => store.record(bad)).not.toThrow();
        }
        expect(db.prepare('SELECT COUNT(*) c FROM liq_events').get().c).toBe(0);
    });

    test('nu arunca nici daca tabela dispare sub el', () => {
        db.exec('DROP TABLE liq_events');
        expect(() => store.record(ev())).not.toThrow();
        db.exec(`CREATE TABLE liq_events (id INTEGER PRIMARY KEY AUTOINCREMENT, exchange TEXT NOT NULL,
            symbol TEXT NOT NULL, side TEXT NOT NULL, price REAL NOT NULL, qty REAL NOT NULL,
            usd REAL NOT NULL, ts INTEGER NOT NULL)`);
    });
});

describe('depozitul de lichidari — harta ceruta de client', () => {

    test('grupeaza pe procent fata de pretul de referinta, nu pe pret absolut', () => {
        store.record(ev({ p: 82000, vol: 2000 }));   // +2,5%
        store.record(ev({ p: 78400, vol: 1000 }));   // -2,0%
        const m = store.map({ symbol: 'BTCUSDT', ref: 80000, days: 30 });
        const pcts = m.buckets.map(b => b.pct);
        expect(pcts).toContain(2.5);
        expect(pcts).toContain(-2);
        expect(m.events).toBe(2);
    });

    test('o lichidare EXACT la pret e tremurat, nu semnal — se filtreaza', () => {
        // Prima varianta a testului de mai sus punea un eveniment la ref si
        // astepta 2. Codul il arunca, si avea DREPTATE: MIN_PCT taie jitterul
        // de la pret, exact ca liqMap.ts in client. Testul gresea, nu codul —
        // asa ca pinuiesc comportamentul in loc sa-l slabesc.
        store.record(ev({ p: 80000, vol: 9999 }));
        expect(store.map({ symbol: 'BTCUSDT', ref: 80000, days: 30 }).events).toBe(0);
    });

    test('separa lichidarile de LONG de cele de SHORT', () => {
        store.record(ev({ p: 82000, side: 'SELL', vol: 1000 })); // long lichidat
        store.record(ev({ p: 82000, side: 'BUY', vol: 300 }));   // short lichidat
        const b = store.map({ symbol: 'BTCUSDT', ref: 80000, days: 30 }).buckets.find(x => x.pct === 2.5);
        expect(b.longUsd).toBeCloseTo(1000, 2);
        expect(b.shortUsd).toBeCloseTo(300, 2);
    });

    test('fereastra chiar taie: ce e mai vechi decat `days` nu intra', () => {
        store.record(ev({ p: 82000, time: Date.now() - 40 * DAY }));
        store.record(ev({ p: 82000, time: Date.now() - 2 * DAY }));
        expect(store.map({ symbol: 'BTCUSDT', ref: 80000, days: 30 }).events).toBe(1);
    });

    test('alt simbol nu se amesteca', () => {
        store.record(ev({ symbol: 'ETHUSDT', p: 82000 }));
        expect(store.map({ symbol: 'BTCUSDT', ref: 80000, days: 30 }).events).toBe(0);
    });

    test('ACOPERIREA e raportata, nu presupusa — cat de departe ajung datele', () => {
        store.record(ev({ p: 86640 }));   // +8,3%
        store.record(ev({ p: 78640 }));   // -1,7%
        const m = store.map({ symbol: 'BTCUSDT', ref: 80000, days: 30 });
        // Fara asta, o scara goala in jos arata identic cu una fara date deloc.
        expect(m.coverage.upPct).toBeCloseTo(8.3, 1);
        expect(m.coverage.downPct).toBeCloseTo(-1.7, 1);
    });

    test('fara date, harta e goala dar ONESTA — nu inventeaza nimic', () => {
        const m = store.map({ symbol: 'BTCUSDT', ref: 80000, days: 30 });
        expect(m.buckets).toEqual([]);
        expect(m.events).toBe(0);
        expect(m.coverage.upPct).toBe(0);
        expect(m.coverage.downPct).toBe(0);
    });

    test('intoarce un REPER de timp, ca sa nu se numere de doua ori', () => {
        // Serverul are tot istoricul, dar clientul primeste aceleasi evenimente
        // si in direct. Fara reper, fiecare lichidare din ultimul minut ar intra
        // de doua ori in scara si barele ar fi de doua ori mai mari decat
        // adevarul — adica exact genul de cifra umflata din care a pornit tot.
        const before = Date.now();
        const m = store.map({ symbol: 'BTCUSDT', ref: 80000, days: 30 });
        expect(m.asOf).toBeGreaterThanOrEqual(before);
        expect(m.asOf).toBeLessThanOrEqual(Date.now());
    });

    test('un ref absurd nu arunca', () => {
        store.record(ev());
        for (const ref of [0, -1, NaN, undefined, null]) {
            expect(() => store.map({ symbol: 'BTCUSDT', ref, days: 30 })).not.toThrow();
        }
    });
});

describe('depozitul de lichidari — retentia', () => {

    test('sterge ce e mai vechi de 30 de zile, pastreaza restul', async () => {
        store.record(ev({ time: Date.now() - 40 * DAY }));
        store.record(ev({ time: Date.now() - 31 * DAY }));
        store.record(ev({ time: Date.now() - 29 * DAY }));
        store.record(ev({ time: Date.now() }));
        const n = await store.prune();
        expect(n).toBe(2);
        expect(db.prepare('SELECT COUNT(*) c FROM liq_events').get().c).toBe(2);
    });

    test('e LOTIZATA — un DELETE nelimitat pe o tabela mare inghetata bucla (lectia G-5)', async () => {
        for (let i = 0; i < 25; i++) store.record(ev({ time: Date.now() - 40 * DAY }));
        const n = await store.prune(Date.now(), 30, 5);   // loturi de 5
        expect(n).toBe(25);
        expect(db.prepare('SELECT COUNT(*) c FROM liq_events').get().c).toBe(0);
    });

    test('nu arunca pe tabela goala', async () => {
        await expect(store.prune()).resolves.not.toThrow();
    });

    test('instructiunea de stergere are LIMIT — nu e doar o promisiune in teste', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'server', 'services', 'liqStore.js'), 'utf8');
        expect(src).toMatch(/LIMIT \?/);
        expect(src.length).toBeGreaterThan(1000);
    });
});
