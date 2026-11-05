'use strict';
// [2026-11-04] Recompensa bandit-ului era POLUATA de doua fluxuri cu semn opus.
//
// Pe ACEEASI pozitie se scriu doua randuri:
//   cohort 'shadow'       → outcome = PnL REALIZAT, baseline = sim(presetul care a rulat)
//   cohort 'shadow_geom'  → outcome = sim(preset),  baseline = PnL REALIZAT
// Pentru presetul care a rulat, cele doua sunt EXACT oglinzi: advantage = ±acelasi
// numar. Masurat pe date vii: sh_adv -0,15 vs geom_adv +0,15, pe acelasi pos_id.
//
// Si amandoua chemau `bandit.update` sub ACELASI nume de brat. `fast` primea 422
// randuri negative (shadow) + 144 pozitive (shadow_geom) → sta la 0,355, in timp
// ce `atr`/`swing`/`tp` primeau numai fluxul shadow_geom si stau la ~0,92.
// Clasamentul bratelor era deci un ARTEFACT, nu o masuratoare.
//
// Cohortul 'shadow' nu masoara calitatea unei geometrii -- compara realitatea cu
// RE-SIMULAREA ACELUIASI preset, adica optimismul simulatorului. Nu are ce cauta
// in bandit. Tiparul exista deja: cohortul 'lossside' trimite `arm: null` exact
// ca sa nu antreneze.
const path = require('path');
const learner = require('../../../server/services/mlDslLearner');
const bandit = require('../../../server/services/mlDslBandit');

function fakeDb() {
    const rows = [];
    const updates = [];
    const db = {
        rows, updates,
        prepare(sql) {
            return {
                run: (...args) => {
                    if (/INSERT INTO ml_dsl_outcome/.test(sql)) rows.push(args);
                    else updates.push([sql, args]);
                },
                get: () => ({ alpha: 1, beta: 1 }),
                all: () => [],
            };
        },
    };
    return db;
}

describe('recompensa bandit-ului', () => {
    it('cohortul `shadow` NU antreneaza bandit-ul', () => {
        const db = fakeDb();
        learner._setDb(db);
        const spy = [];
        const realUpdate = bandit.update;
        bandit.update = (...a) => { spy.push(a); };
        try {
            learner.learn({
                posId: 1, userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'TREND',
                arm: 'fast', cohort: 'shadow',
                outcome: { pnlPct: -0.814 }, baseline: { pnlPct: -0.664 },
            });
        } finally { bandit.update = realUpdate; }
        expect(spy).toHaveLength(0);
        // Dar rândul se SCRIE in continuare: masuratoarea rămâne, doar nu antreneaza.
        expect(db.rows).toHaveLength(1);
    });

    it('cohortul `shadow_geom` ANTRENEAZA — el compara geometrii', () => {
        const db = fakeDb();
        learner._setDb(db);
        const spy = [];
        const realUpdate = bandit.update;
        bandit.update = (...a) => { spy.push(a); };
        try {
            learner.learn({
                posId: 2, userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'TREND',
                arm: 'atr', cohort: 'shadow_geom',
                outcome: { pnlPct: 1.2 }, baseline: { pnlPct: 0.9 },
            });
        } finally { bandit.update = realUpdate; }
        expect(spy).toHaveLength(1);
        expect(spy[0][1]).toBe('atr');
    });

    it('cohortul `mlctl` ANTRENEAZA — el masoara deciziile ML reale', () => {
        const db = fakeDb();
        learner._setDb(db);
        const spy = [];
        const realUpdate = bandit.update;
        bandit.update = (...a) => { spy.push(a); };
        try {
            learner.learn({
                posId: 3, userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'TREND',
                arm: 'ml:LOOSEN', cohort: 'mlctl',
                outcome: { pnlPct: 1.0 }, baseline: { pnlPct: 0.5 },
            });
        } finally { bandit.update = realUpdate; }
        expect(spy).toHaveLength(1);
        expect(spy[0][1]).toBe('ml:LOOSEN');
    });

    it('`lossside` nu antreneaza — avea deja arm null, si asa rămâne', () => {
        const db = fakeDb();
        learner._setDb(db);
        const spy = [];
        const realUpdate = bandit.update;
        bandit.update = (...a) => { spy.push(a); };
        try {
            learner.learn({
                posId: 4, userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'TREND',
                arm: null, cohort: 'lossside',
                outcome: { pnlPct: -0.2 }, baseline: { pnlPct: -0.5 },
            });
        } finally { bandit.update = realUpdate; }
        expect(spy).toHaveLength(0);
    });

    it('un cohort necunoscut NU antreneaza — fail-closed', () => {
        // Daca maine apare un cohort nou, implicitul trebuie sa fie „nu antrenez",
        // nu „antrenez cu un semn pe care nu l-a verificat nimeni".
        const db = fakeDb();
        learner._setDb(db);
        const spy = [];
        const realUpdate = bandit.update;
        bandit.update = (...a) => { spy.push(a); };
        try {
            learner.learn({
                posId: 5, userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'TREND',
                arm: 'fast', cohort: 'cohort_nou_inventat',
                outcome: { pnlPct: 1 }, baseline: { pnlPct: 0 },
            });
        } finally { bandit.update = realUpdate; }
        expect(spy).toHaveLength(0);
        expect(db.rows).toHaveLength(1);
    });

    it('lista cohortelor care antreneaza e EXPLICITA si mica', () => {
        expect(learner.TRAINING_COHORTS).toBeDefined();
        const s = new Set(learner.TRAINING_COHORTS);
        expect(s.has('shadow_geom')).toBe(true);
        expect(s.has('mlctl')).toBe(true);
        expect(s.has('shadow')).toBe(false);
        expect(s.has('lossside')).toBe(false);
        // 'ml' = alegerile PROPRII ale bandit-ului, cand bucla se inchide.
        expect(s.has('ml')).toBe(true);
        expect(s.size).toBe(3);
    });

    it('raportul spune daca a antrenat, ca sa se poata proba', () => {
        const db = fakeDb();
        learner._setDb(db);
        const a = learner.learn({ posId: 6, userId: 1, arm: 'fast', cohort: 'shadow', outcome: { pnlPct: 1 }, baseline: { pnlPct: 0 } });
        const b = learner.learn({ posId: 7, userId: 1, arm: 'atr', cohort: 'shadow_geom', outcome: { pnlPct: 1 }, baseline: { pnlPct: 0 } });
        expect(a.trained).toBe(false);
        expect(b.trained).toBe(true);
        expect(a.recorded).toBe(true);
        expect(b.recorded).toBe(true);
    });
});

describe('bandit-ul foloseste recompensa RELATIVA cand exista', () => {
    function spyLearn(rec) {
        const db = fakeDb();
        learner._setDb(db);
        const spy = [];
        const real = bandit.update;
        bandit.update = (...a) => { spy.push(a); };
        let out;
        try { out = learner.learn(rec); } finally { bandit.update = real; }
        return { spy, out, db };
    }

    it('relWin=0 BATE advantage>0 — asta era bugul de saturare', () => {
        // Toate presetele bat baza comuna, deci advantage>0 pentru toate. Daca
        // bandit-ul ar lua `advantage>0`, toate cele cinci brate ar primi 1.
        const { spy } = spyLearn({
            posId: 10, userId: 1, arm: 'swing', cohort: 'shadow_geom',
            outcome: { pnlPct: 1.1 }, baseline: { pnlPct: 0.1 }, relWin: 0,
        });
        expect(spy).toHaveLength(1);
        expect(spy[0][2]).toBe(false);   // NU castigator, desi advantage = +1.0
    });

    it('relWin=1 da punctul chiar cand advantage e NEGATIV', () => {
        // Geometria cea mai putin rea pe o urma pierduta e tot cea de preferat.
        const { spy } = spyLearn({
            posId: 11, userId: 1, arm: 'fast', cohort: 'shadow_geom',
            outcome: { pnlPct: -1.0 }, baseline: { pnlPct: 0.5 }, relWin: 1,
        });
        expect(spy[0][2]).toBe(true);
    });

    it('fara relWin se pastreaza vechiul comportament (mlctl nu are clasament)', () => {
        const { spy } = spyLearn({
            posId: 12, userId: 1, arm: 'ml:LOOSEN', cohort: 'mlctl',
            outcome: { pnlPct: 1.0 }, baseline: { pnlPct: 0.5 },
        });
        expect(spy[0][2]).toBe(true);
        const r2 = spyLearn({
            posId: 13, userId: 1, arm: 'ml:LOOSEN', cohort: 'mlctl',
            outcome: { pnlPct: 0.2 }, baseline: { pnlPct: 0.5 },
        });
        expect(r2.spy[0][2]).toBe(false);
    });

    it('coloana `win` RAMANE advantage>0 — istoricul nu-si schimba sensul', () => {
        // Daca `win` ar deveni relWin, cele 2.299 de randuri vechi n-ar mai fi
        // comparabile cu cele noi, si nicio masuratoare pe istoric n-ar mai sta.
        const { out, db } = spyLearn({
            posId: 14, userId: 1, arm: 'swing', cohort: 'shadow_geom',
            outcome: { pnlPct: 1.1 }, baseline: { pnlPct: 0.1 }, relWin: 0,
        });
        expect(out.win).toBe(true);           // advantage = +1.0
        expect(db.rows[0][10]).toBe(1);       // coloana win din INSERT
        expect(out.trained).toBe(true);
    });

    it('relWin invalid e ignorat, nu crezut', () => {
        for (const bad of [null, undefined, 2, -1, 'da', {}, NaN]) {
            const { spy } = spyLearn({
                posId: 15, userId: 1, arm: 'swing', cohort: 'shadow_geom',
                outcome: { pnlPct: 1.1 }, baseline: { pnlPct: 0.1 }, relWin: bad,
            });
            expect(spy[0][2]).toBe(true);   // cade pe advantage>0
        }
    });
});
