'use strict';
// [2026-11-04] "cum te simti" raspundea doar despre CLIPA asta.
//
// Starea lui e deja scrisa de 6 luni: `ml_voice_log.mood`, 58.658 randuri in
// ultimele 7 zile. Nu lipsea un scriitor -- lipsea cititorul. Dar datele au o
// forma care te poate pacali: in ACEEASI secunda apar mai multe stari, cate
// una per rostire, deci "sunt nervos de trei zile" nu se poate afirma. Ce se
// poate afirma e AMESTECUL si cum s-a mutat de ieri.
//
// Capcana pe care o apara testul: ziua de azi e PARTIALA. Comparand numere
// BRUTE, orice zi in curs pare mai liniştita decat ieri, pur si simplu fiindca
// are mai putine ore in ea. De-aia comparatia e pe COTE.
const C = require('../../../server/services/ml/_voice/omegaContext');

describe('formatMoodTrend', () => {
    it('spune amestecul de azi in cote, nu in numere brute', () => {
        const s = C.formatMoodTrend({
            today: [{ mood: 'CALM', n: 60 }, { mood: 'FOCUSED', n: 30 }, { mood: 'NERVOUS', n: 10 }],
            yesterday: [{ mood: 'CALM', n: 600 }, { mood: 'FOCUSED', n: 300 }, { mood: 'NERVOUS', n: 100 }],
        });
        // Acelasi amestec, de zece ori mai putine randuri: NU e o schimbare.
        expect(s).toMatch(/calm/i);
        expect(s).toMatch(/60%|61%|59%/);
        expect(s).not.toMatch(/more nervous|less nervous|calmer|edgier/i);
    });

    it('REGRESIE: o zi partiala nu se raporteaza ca schimbare de dispozitie', () => {
        // Azi are 1/10 din randuri, acelasi amestec. Pe numere brute ar zice
        // "mult mai putin nervos"; pe cote, nimic nu s-a schimbat.
        const s = C.formatMoodTrend({
            today: [{ mood: 'NERVOUS', n: 10 }, { mood: 'CALM', n: 90 }],
            yesterday: [{ mood: 'NERVOUS', n: 100 }, { mood: 'CALM', n: 900 }],
        });
        expect(s).not.toMatch(/less nervous|calmer/i);
    });

    it('cand cota creste cu adevarat, o spune', () => {
        const s = C.formatMoodTrend({
            today: [{ mood: 'NERVOUS', n: 400 }, { mood: 'CALM', n: 600 }],
            yesterday: [{ mood: 'NERVOUS', n: 50 }, { mood: 'CALM', n: 950 }],
        });
        expect(s).toMatch(/more nervous|edgier/i);
    });

    it('cand cota scade cu adevarat, o spune invers', () => {
        const s = C.formatMoodTrend({
            today: [{ mood: 'NERVOUS', n: 50 }, { mood: 'CALM', n: 950 }],
            yesterday: [{ mood: 'NERVOUS', n: 400 }, { mood: 'CALM', n: 600 }],
        });
        expect(s).toMatch(/less nervous|calmer/i);
    });

    it('fara ziua de ieri nu compara -- spune doar azi', () => {
        const s = C.formatMoodTrend({
            today: [{ mood: 'CALM', n: 10 }],
            yesterday: [],
        });
        expect(s).toMatch(/calm/i);
        expect(s).not.toMatch(/more|less|than yesterday/i);
    });

    it('un eşantion prea mic nu produce un verdict', () => {
        // 3 randuri azi nu pot spune nimic despre dispozitie.
        const s = C.formatMoodTrend({
            today: [{ mood: 'NERVOUS', n: 3 }],
            yesterday: [{ mood: 'CALM', n: 1000 }],
        });
        expect(s).not.toMatch(/more nervous|edgier/i);
    });

    it('gol se spune ca gol, nu ca 0% calm', () => {
        const s = C.formatMoodTrend({ today: [], yesterday: [] });
        expect(s).toMatch(/nothing|no utterances|quiet/i);
        expect(s).not.toMatch(/\b\w+ 0%/);
    });

it('o stare care se rotunjeste la 0% nu se scrie — un zero care pare masuratoare', () => {
        // 8 din 7583 = 0,1%. Randat ca "sad 0%" arata ca o afirmatie despre tristete.
        const s = C.formatMoodTrend({
            today: [{ mood: 'CALM', n: 7000 }, { mood: 'SAD', n: 8 }],
            yesterday: [],
        });
        // Atentie: `not.toContain('0%')` ar cadea pe "calm 100%". Ce nu are
        // voie sa apara e o stare cu cota zero, nu secventa de caractere.
        expect(s).not.toMatch(/\b\w+ 0%/);
        expect(s).not.toMatch(/sad/i);
        expect(s).toMatch(/calm/i);
    });

    it('nu arunca pe intrari stricate', () => {
        for (const v of [null, undefined, {}, { today: null }, { today: [null] }, { today: [{ mood: null, n: 'x' }] }]) {
            expect(() => C.formatMoodTrend(v)).not.toThrow();
        }
    });

    it('nu scrie procente pentru stari absente', () => {
        const s = C.formatMoodTrend({ today: [{ mood: 'CALM', n: 100 }], yesterday: [] });
        expect(s).not.toMatch(/SAD|BORED/i);
    });
});

describe('gatherMoodTrend', () => {
    it('cere DOUA ferestre separate si le intoarce separat', () => {
        const calls = [];
        const db = {
            prepare(sql) {
                return { all: (...args) => { calls.push(args); return [{ mood: 'CALM', n: 1 }]; } };
            },
        };
        const got = C.gatherMoodTrend(db, 1, 1800000000000);
        expect(got.today).toEqual([{ mood: 'CALM', n: 1 }]);
        expect(got.yesterday).toEqual([{ mood: 'CALM', n: 1 }]);
        expect(calls).toHaveLength(2);
        // Ferestrele nu au voie sa se suprapuna.
        const [t, y] = calls;
        expect(t[1]).toBeGreaterThanOrEqual(y[2]);
    });

    it('nu arunca si intoarce ferestre goale cand baza cade', () => {
        const broken = { prepare() { throw new Error('nope'); } };
        const got = C.gatherMoodTrend(broken, 1, 1800000000000);
        expect(got).toEqual({ today: [], yesterday: [] });
    });
});
