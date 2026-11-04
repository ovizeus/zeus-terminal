'use strict';
// [2026-11-04] "de ce nu iese pe castig" — intrebarea lui de luni de zile — are
// o masuratoare in casa pe care OMEGA n-o vedea: `ml_dsl_outcome` compara, pe
// FIECARE poziţie inchisa, ce a scos ieşirea ML (`ml_pnl_pct`) cu ce ar fi scos
// linia de baza (`baseline_pnl_pct`). 2.299 randuri.
//
// ⚠️ Convenţia de semn a fost VERIFICATA pe date, nu presupusa:
// advantage = ml - baseline, 1387 din 1387 randuri unde difera se potrivesc,
// zero pe convenţia inversa. Exact clasa de greşeala retrasa pe 23 octombrie.
//
// ⚠️ Si disciplina de eşantion: `ml:EXIT` are n=8 si avantaj +0,45 — de zece
// ori mai mare decat orice altceva. Daca se randeaza ca "cel mai bun bra[", e o
// minciuna construita din opt randuri.
const C = require('../../../server/services/ml/_voice/omegaContext');

describe('formatDslAdvantage', () => {
    it('spune cat de des ML-ul schimba ceva, nu doar media', () => {
        // O medie de +0,005 pp arata ca "aproape zero". Dar daca in 40% din
        // cazuri n-a schimbat NIMIC, media ascunde doua lucruri diferite.
        const s = C.formatDslAdvantage({
            total: 100, better: 30, same: 40, worse: 30, meanAdvantage: 0.005, arms: [],
        });
        expect(s).toMatch(/40/);
        expect(s).toMatch(/same|identical|no different/i);
    });

    it('nu prezinta un brat cu esantion mic drept cel mai bun', () => {
        const s = C.formatDslAdvantage({
            total: 900, better: 300, same: 300, worse: 300, meanAdvantage: 0.004,
            arms: [
                { arm: 'fast', n: 679, advantage: -0.0371 },
                { arm: 'ml:EXIT', n: 8, advantage: 0.4482 },
            ],
        });
        expect(s).toContain('fast');
        expect(s).not.toContain('ml:EXIT');
    });

    it('numeste bratul cel mai FOLOSIT si cum merge — ala conteaza', () => {
        const s = C.formatDslAdvantage({
            total: 900, better: 1, same: 1, worse: 1, meanAdvantage: 0,
            arms: [
                { arm: 'fast', n: 679, advantage: -0.0371 },
                { arm: 'tp', n: 144, advantage: 0.0303 },
            ],
        });
        expect(s).toMatch(/fast/);
        expect(s).toMatch(/-0\.04|-0\.0371|worse|behind/i);
    });

it('REGRESIE: un brat mic nu se numeste nici cand e SINGURUL din lista', () => {
        // Testul de dinainte trecea si cu filtrul scos, fiindca `fast` era
        // oricum primul si doar primul se randeaza. Cazul adevarat e cand
        // bratul mic vine PRIMUL -- atunci filtrul e singurul care-l opreste.
        const s = C.formatDslAdvantage({
            total: 900, better: 300, same: 300, worse: 300, meanAdvantage: 0.004,
            arms: [{ arm: 'ml:EXIT', n: 8, advantage: 0.4482 }],
        });
        expect(s).not.toContain('ml:EXIT');
        expect(s).not.toMatch(/most used/i);
    });

    it('REGRESIE: o diferenta sub o sutime se numeste NIMIC, nu `ahead`', () => {
        // +0,003pp randat ca "ahead by 0.00pp" ar fi un avantaj inventat.
        const s = C.formatDslAdvantage({
            total: 900, better: 300, same: 300, worse: 300, meanAdvantage: 0.00316, arms: [],
        });
        expect(s).toMatch(/call it nothing|nothing/i);
        expect(s).not.toMatch(/\bahead\b/i);
        expect(s).not.toMatch(/\bbehind\b/i);
    });

    it('nu scrie un verdict cand nu sunt destule date', () => {
        const s = C.formatDslAdvantage({ total: 5, better: 2, same: 2, worse: 1, meanAdvantage: 0.3, arms: [] });
        expect(s).toMatch(/too few|not enough/i);
        expect(s).not.toMatch(/ahead|behind/i);
    });

    it('gol se spune ca gol', () => {
        expect(C.formatDslAdvantage({ total: 0, better: 0, same: 0, worse: 0, meanAdvantage: null, arms: [] }))
            .toMatch(/no comparison|nothing/i);
    });

    it('nu arunca si nu scrie null/undefined pe intrari stricate', () => {
        for (const v of [null, undefined, {}, { total: 'x' }, { total: 100, arms: null }, { total: 100, arms: [null] }]) {
            const out = C.formatDslAdvantage(v);
            expect(typeof out).toBe('string');
            expect(out).not.toMatch(/undefined|null|NaN/);
        }
    });

    it('semnul se vede — un avantaj negativ nu are voie sa arate ca un castig', () => {
        const s = C.formatDslAdvantage({
            total: 900, better: 100, same: 100, worse: 700, meanAdvantage: -0.25,
            arms: [{ arm: 'fast', n: 679, advantage: -0.0371 }],
        });
        expect(s).toMatch(/behind|worse|-0\.25/i);
        expect(s).not.toMatch(/\bahead\b/i);
    });
});

describe('gatherDslAdvantage', () => {
    it('intoarce forma asteptata si nu arunca pe baza cazuta', () => {
        const broken = { prepare() { throw new Error('nope'); } };
        const got = C.gatherDslAdvantage(broken, 1);
        expect(got.total).toBe(0);
        expect(got.arms).toEqual([]);
    });

    it('cere bratele cu un prag de esantion, nu pe toate', () => {
        const sqls = [];
        const db = { prepare(sql) { sqls.push(sql); return { get: () => ({ total: 10, better: 3, same: 4, worse: 3, meanAdvantage: 0.01 }), all: () => [] }; } };
        C.gatherDslAdvantage(db, 1);
        expect(sqls.join(' ')).toMatch(/HAVING|COUNT\(\*\) >=/);
    });
});
