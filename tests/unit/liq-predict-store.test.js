'use strict';
// tests/unit/liq-predict-store.test.js
//
// [LIQ-PREDICT 2026-10-26] Operatorul a cerut o rubrica de predictie long/short
// pe BTC si ETH, „dar date reale, nu fake". Un procent de probabilitate nu se
// poate deduce dintr-o formula: inseamna „din 100 de ori cand semnalul a aratat
// asa, in N a nimerit", deci se NUMARA. Tabela de aici e numaratoarea, si
// testele apara exact ce ar face numaratoarea mincinoasa.

const fs = require('fs');
const os = require('os');
const path = require('path');

let api, db, store, LP;
const H1 = 3600000, H4 = 4 * 3600000, H24 = 24 * 3600000;
const T0 = 1793000000000;

beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-lpred-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    api = require('../../server/services/database');
    db = api.db;
    store = require('../../server/services/liqPredictStore');
    LP = require('../../server/services/liqPredict');
});

afterEach(() => { try { db.exec('DELETE FROM liq_predict_snapshots;'); } catch (_) {} });

const sig = (over = {}) => Object.assign({
    symbol: 'BTCUSDT', side: 'UP', strength: 70, price: 80000,
    target: { price: 80500 }, imbalance: 0.6,
    longBurnedUsd: 200e6, shortBurnedUsd: 20e6,
    crowdLongPct: 69, oiChangePct: -1.2,
}, over);

describe('tabela si scrierea', () => {
    test('tabela exista, creata de migratia 421', () => {
        const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='liq_predict_snapshots'").get();
        expect(t).toBeTruthy();
    });

    test('un semnal scrie un rand pe FIECARE orizont', () => {
        expect(store.record(sig(), T0)).toBe(store.HORIZONS_MS.length);
        const hor = db.prepare('SELECT horizon_ms FROM liq_predict_snapshots ORDER BY horizon_ms').all()
            .map(r => r.horizon_ms);
        expect(hor).toEqual([...store.HORIZONS_MS].sort((a, b) => a - b));
    });

    test('randul naste NEREZOLVAT — verdictul nu se poate sti la naştere', () => {
        store.record(sig(), T0);
        const r = db.prepare('SELECT * FROM liq_predict_snapshots LIMIT 1').get();
        expect(r.resolved_at).toBeNull();
        expect(r.outcome).toBeNull();
        expect(r.price_at).toBeCloseTo(80000, 6);
    });

    test('un semnal NONE nu se scrie — se masoara numai ce panoul a AFIRMAT', () => {
        expect(store.record(sig({ side: 'NONE' }), T0)).toBe(0);
        expect(db.prepare('SELECT COUNT(*) n FROM liq_predict_snapshots').get().n).toBe(0);
    });

    test('tinta lipsa se scrie ca NULL, nu ca zero', () => {
        store.record(sig({ target: null }), T0);
        const r = db.prepare('SELECT target_price FROM liq_predict_snapshots LIMIT 1').get();
        expect(r.target_price).toBeNull();
    });

    test('REZISTA la dublare: o cascada nu produce sute de randuri', () => {
        store.record(sig(), T0);
        store.record(sig(), T0 + 60000);
        store.record(sig(), T0 + 5 * 60000);
        expect(db.prepare('SELECT COUNT(*) n FROM liq_predict_snapshots').get().n)
            .toBe(store.HORIZONS_MS.length);
    });

    test('dupa pauza PROPRIE fiecarui orizont se scrie din nou', () => {
        // [2026-10-26] Testul asta cerea DEDUPE_MS pentru toate orizonturile.
        // Contractul s-a schimbat dinadins: pauza e LUNGIMEA ORIZONTULUI, ca
        // ferestrele sa nu se suprapuna si cazurile sa fie independente (vezi
        // dedupeFor). Deci la DEDUPE_MS + 1s nu se mai scrie NIMIC, iar fiecare
        // orizont se redeschide la timpul LUI.
        store.record(sig(), T0);
        store.record(sig(), T0 + store.DEDUPE_MS + 1000);
        expect(db.prepare('SELECT COUNT(*) n FROM liq_predict_snapshots').get().n)
            .toBe(store.HORIZONS_MS.length);

        for (const h of store.HORIZONS_MS) {
            const inainte = db.prepare(
                'SELECT COUNT(*) n FROM liq_predict_snapshots WHERE horizon_ms = ?').get(h).n;
            store.record(sig(), T0 + store.dedupeFor(h) + 1000);
            const dupa = db.prepare(
                'SELECT COUNT(*) n FROM liq_predict_snapshots WHERE horizon_ms = ?').get(h).n;
            expect(dupa).toBe(inainte + 1);
        }
    });
});

describe('rezolvarea — verdictul vine din bare, nu din presupuneri', () => {
    const bars = (from, n, hi, lo, close) => Array.from({ length: n }, (_, i) => ({
        time: (from / 1000) + i * 300, high: hi, low: lo, close,
    }));

    test('randul se inchide cu HIT cand barele ating tinta', () => {
        store.record(sig(), T0);
        const row = db.prepare('SELECT * FROM liq_predict_snapshots WHERE horizon_ms = ?').get(H1);
        const r = store.resolveWith(row, bars(T0, 12, 80600, 79900, 80400), T0 + H1 + 1000);
        expect(r.outcome).toBe('HIT');
        const after = db.prepare('SELECT * FROM liq_predict_snapshots WHERE id = ?').get(row.id);
        expect(after.resolved_at).toBe(T0 + H1 + 1000);
        expect(after.rule).toBe('TARGET');
    });

    test('FARA bare in fereastra randul rameane NEREZOLVAT, nu devine MISS', () => {
        // Un MISS inventat ar trage rata in jos exact acolo unde n-avem date.
        store.record(sig(), T0);
        const row = db.prepare('SELECT * FROM liq_predict_snapshots WHERE horizon_ms = ?').get(H1);
        const departe = bars(T0 + 10 * 86400000, 12, 80600, 79900, 80400);
        expect(store.resolveWith(row, departe, T0 + H1)).toBeNull();
        const after = db.prepare('SELECT * FROM liq_predict_snapshots WHERE id = ?').get(row.id);
        expect(after.resolved_at).toBeNull();
        expect(after.outcome).toBeNull();
    });

    test('barele de DINCOLO de orizont nu intra in judecata', () => {
        // Altfel un semnal pe 1h ar fi judecat cu ce s-a intamplat in 24h, si
        // orizonturile n-ar mai masura lucruri diferite.
        store.record(sig(), T0);
        const row = db.prepare('SELECT * FROM liq_predict_snapshots WHERE horizon_ms = ?').get(H1);
        const inauntru = bars(T0, 12, 80200, 79900, 80100);           // nu atinge 80500
        const dupa = bars(T0 + H1 + 600000, 6, 81000, 80800, 80900);  // atinge, dar prea tarziu
        const r = store.resolveWith(row, [...inauntru, ...dupa], T0 + H24);
        expect(r.outcome).toBe('MISS');
    });

    test('„due" da numai randurile carora a trecut orizontul', () => {
        store.record(sig(), T0);
        const d1 = store.due(T0 + H1 + store.SETTLE_MS + 1000, 50);
        expect(d1.map(r => r.horizon_ms)).toEqual([H1]);
        const d2 = store.due(T0 + H24 + store.SETTLE_MS + 1000, 50);
        expect(d2.map(r => r.horizon_ms).sort((a, b) => a - b)).toEqual([H1, H4, H24]);
    });

    test('un rand rezolvat nu mai apare in „due" — nu se rejudeca', () => {
        store.record(sig(), T0);
        const row = db.prepare('SELECT * FROM liq_predict_snapshots WHERE horizon_ms = ?').get(H1);
        store.resolveWith(row, bars(T0, 12, 80600, 79900, 80400), T0 + H1);
        expect(store.due(T0 + H1 + store.SETTLE_MS + 1000, 50)).toHaveLength(0);
    });
});

describe('rata masurata — pragul nu se poate ocoli', () => {
    function seed(n, hits, horizon = H1) {
        const ins = db.prepare(
            'INSERT INTO liq_predict_snapshots (symbol, ts, horizon_ms, side, strength, price_at,'
            + ' resolved_at, outcome) VALUES (?,?,?,?,?,?,?,?)');
        for (let i = 0; i < n; i++) {
            ins.run('BTCUSDT', T0 + i * 1000, horizon, 'UP', 70, 80000, T0 + i * 2000,
                i < hits ? 'HIT' : 'MISS');
        }
    }

    test('sub prag: CALIBRATING, si niciun procent', () => {
        seed(10, 9);
        const s = store.stats('BTCUSDT', H1);
        expect(s.calibrating).toBe(true);
        expect(s.pct).toBeNull();
        expect(s.resolved).toBe(10);
        expect(s.need).toBe(LP.MIN_SAMPLES);
    });

    test('peste prag: apare rata OBSERVATA', () => {
        seed(40, 28);
        const s = store.stats('BTCUSDT', H1);
        expect(s.calibrating).toBe(false);
        expect(s.pct).toBe(70);
    });

    test('randurile NEREZOLVATE nu intra in numitor', () => {
        seed(40, 28);
        store.record(sig(), T0 + 99999999);
        const s = store.stats('BTCUSDT', H1);
        expect(s.resolved).toBe(40);
        expect(s.pct).toBe(70);
    });

    test('orizonturile se numara SEPARAT — altfel se amesteca trei intrebari', () => {
        seed(40, 40, H1);
        seed(40, 10, H24);
        expect(store.stats('BTCUSDT', H1).pct).toBe(100);
        expect(store.stats('BTCUSDT', H24).pct).toBe(25);
    });

    test('simbolurile se numara SEPARAT', () => {
        seed(40, 40, H1);
        expect(store.stats('ETHUSDT', H1).resolved).toBe(0);
    });
});

describe('oglinda se SCRIE si intra in rate — altfel ar fi calculata degeaba', () => {
    const bars = (from, n, hi, lo, close) => Array.from({ length: n }, (_, i) => ({
        time: (from / 1000) + i * 300, high: hi, low: lo, close,
    }));

    test('coloanele de control exista (migratia 422)', () => {
        const cols = db.prepare("SELECT name FROM pragma_table_info('liq_predict_snapshots')")
            .all().map(r => r.name);
        expect(cols).toContain('control_outcome');
        expect(cols).toContain('target_pct');
    });

    test('rezolvarea scrie si rezultatul oglinzii, si distanţa ţintei', () => {
        store.record(sig(), T0);
        const row = db.prepare('SELECT * FROM liq_predict_snapshots WHERE horizon_ms = ?').get(H1);
        store.resolveWith(row, bars(T0, 12, 80600, 79900, 80400), T0 + H1);
        const a = db.prepare('SELECT * FROM liq_predict_snapshots WHERE id = ?').get(row.id);
        expect(a.control_outcome).toBe('MISS');       // oglinda ar fi 79500
        expect(a.target_pct).toBeCloseTo(0.625, 2);   // 80500 fata de 80000
    });

    test('rata oglinzii si RAPORTUL apar in statistici cand sunt destule cazuri', () => {
        const ins = db.prepare(
            'INSERT INTO liq_predict_snapshots (symbol, ts, horizon_ms, side, strength, price_at,'
            + ' resolved_at, outcome, control_outcome, target_pct) VALUES (?,?,?,?,?,?,?,?,?,?)');
        for (let i = 0; i < 100; i++) {
            ins.run('BTCUSDT', T0 + i * 1000, H1, 'DOWN', 60, 80000, T0 + i * 2000,
                i < 30 ? 'HIT' : 'MISS', i < 9 ? 'HIT' : 'MISS', -0.58);
        }
        const s = store.stats('BTCUSDT', H1);
        expect(s.pct).toBe(30);
        expect(s.controlPct).toBe(9);
        expect(s.lift).toBeCloseTo(3.33, 1);
        expect(s.avgTargetPct).toBeCloseTo(0.58, 2);
    });

    test('86% fata de 86% da raport 1 — panoul NU are voie sa laude asta', () => {
        const ins = db.prepare(
            'INSERT INTO liq_predict_snapshots (symbol, ts, horizon_ms, side, strength, price_at,'
            + ' resolved_at, outcome, control_outcome, target_pct) VALUES (?,?,?,?,?,?,?,?,?,?)');
        for (let i = 0; i < 100; i++) {
            ins.run('ETHUSDT', T0 + i * 1000, H24, 'DOWN', 60, 2600, T0 + i * 2000,
                i < 86 ? 'HIT' : 'MISS', i < 86 ? 'HIT' : 'MISS', -0.58);
        }
        const s = store.stats('ETHUSDT', H24);
        expect(s.pct).toBe(86);
        expect(s.lift).toBeCloseTo(1, 2);
    });

    test('IN CALIBRARE nici raportul nu apare — nicio cifra inainte de prag', () => {
        const ins = db.prepare(
            'INSERT INTO liq_predict_snapshots (symbol, ts, horizon_ms, side, strength, price_at,'
            + ' resolved_at, outcome, control_outcome, target_pct) VALUES (?,?,?,?,?,?,?,?,?,?)');
        for (let i = 0; i < 5; i++) {
            ins.run('BTCUSDT', T0 + i * 1000, H4, 'UP', 60, 80000, T0 + i * 2000, 'HIT', 'MISS', 0.5);
        }
        const s = store.stats('BTCUSDT', H4);
        expect(s.calibrating).toBe(true);
        expect(s.pct).toBeNull();
        expect(s.lift).toBeNull();
        expect(s.controlPct).toBeNull();
    });
});

describe('⛔ CAZURILE TREBUIE SA FIE INDEPENDENTE — altfel 30/30 e un caz numarat de 30 de ori', () => {
    // [2026-10-26] Operatorul a intrebat daca „peste cateva zile poate prezice".
    // Verificand cat de repede ajunge la 30 de cazuri am gasit un defect in ce
    // construisem: cu o pauza de 15 minute pe TOATE orizonturile, doua
    // instantanee consecutive pe orizontul de 24h masoara ferestre care SE
    // SUPRAPUN 99%. Contorul ar fi atins 30/30 intr-o zi, si procentul afisat
    // ar fi fost un singur episod numarat de 30 de ori — adica exact cifra
    // falsa pe care el a interzis-o.
    //
    // Reparat: pauza = LUNGIMEA ORIZONTULUI. Ferestrele nu se mai suprapun,
    // deci fiecare caz e independent. Costul e timpul, si e spus pe faţa.

    test('pauza creste cu orizontul — nu e aceeasi pentru toate', () => {
        for (const h of store.HORIZONS_MS) {
            expect(store.dedupeFor(h)).toBeGreaterThanOrEqual(h);
        }
        expect(store.dedupeFor(24 * 3600000)).toBeGreaterThan(store.dedupeFor(3600000));
    });

    test('pe 24h, doua semnale la 15 minute distanţa dau UN SINGUR rand', () => {
        store.record(sig(), T0);
        store.record(sig(), T0 + 15 * 60000);
        const n = db.prepare('SELECT COUNT(*) n FROM liq_predict_snapshots WHERE horizon_ms = ?').get(H24).n;
        expect(n).toBe(1);
    });

    test('pe 1h, la 15 minute tot e UN rand; dupa o ora apare al doilea', () => {
        store.record(sig(), T0);
        store.record(sig(), T0 + 15 * 60000);
        expect(db.prepare('SELECT COUNT(*) n FROM liq_predict_snapshots WHERE horizon_ms = ?').get(H1).n).toBe(1);
        store.record(sig(), T0 + H1 + 60000);
        expect(db.prepare('SELECT COUNT(*) n FROM liq_predict_snapshots WHERE horizon_ms = ?').get(H1).n).toBe(2);
    });

    test('FERESTRELE NU SE SUPRAPUN — proprietatea care face cazurile independente', () => {
        // Scriu la fiecare 5 minute timp de 3 zile si verific, pe fiecare
        // orizont, ca intervalele [ts, ts+horizon] sunt disjuncte.
        for (let t = T0; t < T0 + 3 * 86400000; t += 5 * 60000) store.record(sig(), t);
        for (const h of store.HORIZONS_MS) {
            const rows = db.prepare(
                'SELECT ts FROM liq_predict_snapshots WHERE horizon_ms = ? ORDER BY ts').all(h);
            expect(rows.length).toBeGreaterThan(1);
            for (let i = 1; i < rows.length; i++) {
                expect(rows[i].ts - rows[i - 1].ts).toBeGreaterThanOrEqual(h);
            }
        }
    });

    test('pe 3 zile, orizontul de 24h strange CEL MULT 3 cazuri — cifra reala, nu umflata', () => {
        for (let t = T0; t < T0 + 3 * 86400000; t += 5 * 60000) store.record(sig(), t);
        const n = db.prepare('SELECT COUNT(*) n FROM liq_predict_snapshots WHERE horizon_ms = ?').get(H24).n;
        expect(n).toBeLessThanOrEqual(3);
        expect(n).toBeGreaterThanOrEqual(2);
    });
});

describe('CAND vine verdictul — estimat din ritmul MASURAT, nu promis', () => {
    // Operatorul a intrebat „peste cateva zile poate prezice?". Raspunsul
    // trebuie sa fie pe ECRAN, nu doar in discutie — si trebuie sa vina din
    // ritmul cu care chiar se strang cazuri, nu dintr-o promisiune.
    function seedAt(horizon, times) {
        const ins = db.prepare(
            'INSERT INTO liq_predict_snapshots (symbol, ts, horizon_ms, side, strength, price_at,'
            + ' resolved_at, outcome) VALUES (?,?,?,?,?,?,?,?)');
        for (const t of times) ins.run('BTCUSDT', t, horizon, 'UP', 60, 80000, t + horizon, 'HIT');
    }

    test('cu 10 cazuri in ultima zi, ritmul masurat e ~10/zi', () => {
        const now = T0;
        seedAt(H1, Array.from({ length: 10 }, (_, i) => now - i * 2 * 3600000));
        const s = store.stats('BTCUSDT', H1, now);
        expect(s.perDay).toBeGreaterThan(5);
        expect(s.perDay).toBeLessThan(20);
    });

    test('estimarea pana la prag se calculeaza din ritm', () => {
        const now = T0;
        seedAt(H1, Array.from({ length: 10 }, (_, i) => now - i * 2 * 3600000));
        const s = store.stats('BTCUSDT', H1, now);
        expect(s.etaDays).toBeGreaterThan(0);
        // 20 de cazuri lipsa la ~10/zi ⇒ ordinul a 2 zile
        expect(s.etaDays).toBeLessThan(10);
    });

    test('fara cazuri NU se estimeaza nimic — nu se inventeaza un termen', () => {
        const s = store.stats('BTCUSDT', H24, T0);
        expect(s.perDay).toBeNull();
        expect(s.etaDays).toBeNull();
    });

    test('peste prag nu mai exista estimare — nu mai are rost', () => {
        const now = T0;
        seedAt(H4, Array.from({ length: 40 }, (_, i) => now - i * 3600000));
        const s = store.stats('BTCUSDT', H4, now);
        expect(s.calibrating).toBe(false);
        expect(s.etaDays).toBeNull();
    });
});
