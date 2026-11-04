'use strict';
// [2026-11-04] Probat pe formulari naturale, dupa b373: "de ce am long si short
// deschise" era prins de intentia `positions`, care e un sablon ce LISTEAZA
// pozitiile ("no positions open. flat."). O intrebare DE CE primea un raspuns
// CE -- iar formularea mai vaga ("...pe acelasi simbol") cadea la model si
// primea un raspuns mai bun decat cea precisa.
//
// Intentia asta exista ca sa raspunda cu CIFRELE constitutiei chiar si cand
// modelul e picat, fiindca e intrebarea pe care el a pus-o pe 1 noiembrie.
const responder = require('../../../server/services/ml/_voice/chatResponder');

const route = (q) => {
    const hit = responder._routeIntentForTest(String(q).toLowerCase().trim(), String(q));
    return hit ? hit.name : null;
};

describe('intentia constitution', () => {
    it('REGRESIE: o intrebare DE CE despre carte mixta nu mai cade pe `positions`', () => {
        for (const q of [
            'de ce am long si short deschise',
            'de ce am long si short pe acelasi simbol',
            'de ce tin long si short in acelasi timp',
            'de ce am pozitii pe ambele parti',
            'de ce intri pe ambele directii',
            'ce e cu cartea mixta',
        ]) {
            expect(route(q)).toBe('constitution');
        }
    });

    it('intrebarile despre reguli ajung aici', () => {
        for (const q of [
            'ce reguli ai',
            'ai reguli pe care le incalci',
            'constitutia ce zice',
            'cate reguli ai incalcat',
            'ce principii ai',
            'what rules do you have',
            'which rules did you break',
        ]) {
            expect(route(q)).toBe('constitution');
        }
    });

    it('o intrebare simpla despre pozitii RAMANE pe positions', () => {
        // Granita conteaza: n-am voie sa fur intentia care functiona.
        for (const q of ['ce pozitii am', 'pozitii deschise', 'ce pozitii sunt deschise', 'positions']) {
            expect(route(q)).toBe('positions');
        }
        // `ce am deschis` NU se potriveste, si nu e vina intentiei noi: regexul
        // cere `deschise` la plural. Forma asta se repara separat, cu testul ei
        // -- vezi omegaWordForms.test.js.

    });

    it('nu fura intentii vecine', () => {
        expect(route('cum te simti')).toBe('mood');
        expect(route('cum stau cu pnl')).toBe('pnl');
        expect(route('cum e piata')).toBe('market');
        expect(route('ce decizii ai luat')).toBe('decisions');
        expect(route('ai probleme')).toBe('doctor');
    });

    it('nu prinde intrebari fara legatura — un regex lacom e alt bug', () => {
        for (const q of [
            'care e sensul vietii',
            'spune-mi o gluma',
            'cat e dolarul',
            'ce lungime are un long',
        ]) {
            expect(route(q)).not.toBe('constitution');
        }
    });

    it('REGRESIE: "de ce" singur NU e constitutie — cere long SI short', () => {
        // Prins de o mutatie care scotea cerinta celor doua cuvinte: fara ea,
        // ORICE intrebare cu "de ce" ajungea la constitutie, inclusiv cele la
        // care raspunsul e in alta parte.
        for (const q of [
            'de ce nu ai intrat',
            'de ce ai pierdut',
            'de ce e piata asa',
            'de ce te simti nervos',
            'why did you skip it',
            'de ce am long pe BTCUSDT',   // doar long
            'de ce am short pe BTCUSDT',  // doar short
        ]) {
            expect(route(q)).not.toBe('constitution');
        }
    });

    it('intentia e in masa, INAINTEA lui positions', () => {
        const names = responder._INTENTS_FOR_TEST.map(e => e.name);
        expect(names).toContain('constitution');
        expect(names.indexOf('constitution')).toBeLessThan(names.indexOf('positions'));
    });

    it('potrivirea e pura — nu atinge baza', () => {
        const e = responder._INTENTS_FOR_TEST.find(x => x.name === 'constitution');
        expect(() => e.match('text fara sens', 'text fara sens')).not.toThrow();
    });
});
