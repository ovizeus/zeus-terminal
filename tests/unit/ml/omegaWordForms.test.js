'use strict';
// [2026-11-04] "e cam tranga": el scrie romaneste firesc si rutarea nu prinde.
//
// Probat pe 17 formulari naturale, 13 rateau. Tiparul e unul singur -- SUFIXELE
// de articol si plural: regexurile cereau `zid`/`ziduri` dar nu `zidurile`,
// `deschise` dar nu `deschis`, `decizii` dar nu `decizie`, `carte de ordine`
// dar nu `cartea de ordine`.
//
// ⚠️ O ratare NU e catastrofa: cade la model, care are tot contextul. Dar TREI
// cazuri erau mai rele decat o ratare -- nimereau intentia `symbol` si dadeau
// un rezumat de simbol in locul zidurilor sau al cartii de ordine. Un raspuns
// greşit e mai rau decat niciunul.
const responder = require('../../../server/services/ml/_voice/chatResponder');

const route = (q) => {
    const hit = responder._routeIntentForTest(String(q).toLowerCase().trim(), String(q));
    return hit ? hit.name : null;
};

describe('forme de cuvinte — articolul si pluralul', () => {
    it('REGRESIE: formele articulate nu mai cad pe `symbol`', () => {
        // Astea trei dadeau un rezumat de simbol, adica alt raspuns, nu niciunul.
        expect(route('zidurile pe BTCUSDT')).toBe('liquidity_walls');
        expect(route('cartea de ordine pe BTCUSDT')).toBe('order_book');
        expect(route('pozitia pe BTCUSDT')).toBe('positions');
    });

    it('pozitii — toate formele', () => {
        for (const q of ['pozitii', 'pozitiile', 'pozitiile mele', 'pozitia', 'ce am deschis', 'ce e deschis']) {
            expect(route(q)).toBe('positions');
        }
    });

    it('decizii — singular si articulat', () => {
        for (const q of ['decizii', 'deciziile', 'deciziile tale', 'ce decizie ai luat']) {
            expect(route(q)).toBe('decisions');
        }
    });

    it('pnl — castig si pierdere, articulate', () => {
        for (const q of ['castigurile', 'castigul', 'pierderile de azi', 'pierderea']) {
            expect(route(q)).toBe('pnl');
        }
    });

    it('doctor — probleme si alerte, articulate', () => {
        for (const q of ['problemele tale', 'problema', 'alerta', 'alertele']) {
            expect(route(q)).toBe('doctor');
        }
    });

    it('starea si formele verbului a simti', () => {
        for (const q of ['starea', 'cum te simteai', 'cum te-ai simtit', 'ce simteai']) {
            expect(route(q)).toBe('mood');
        }
    });

    it('influenta, articulata', () => {
        for (const q of ['influenta', 'influenta ml']) {
            expect(route(q)).toBe('bandit');
        }
    });

    it('ziduri — toate formele', () => {
        for (const q of ['ziduri pe BTCUSDT', 'zidurile pe BTCUSDT', 'zidul pe BTCUSDT']) {
            expect(route(q)).toBe('liquidity_walls');
        }
    });

    // ── Partea care conteaza la fel de mult: sa NU se lacomeasca ──────────
    it('un regex lacom e alt bug — intrebari fara legatura rămân la model', () => {
        for (const q of [
            'care e sensul vietii',
            'spune-mi o gluma',
            'cat costa un start de proiect',
            'starter pack',
            'ce inseamna influenza',
            'am pierdut cheile',
        ]) {
            const got = route(q);
            // Pot cadea la model (null) sau la o intentie fireasca, dar NU au
            // voie sa fie prinse de formele largite mai sus.
            expect(['pnl', 'mood', 'bandit', 'doctor']).not.toContain(got);
        }
    });

    it('`start` nu devine `stare`', () => {
        expect(route('cand a fost startul')).not.toBe('mood');
        expect(route('starter')).not.toBe('mood');
    });

    it('vecinii nu se fura intre ei', () => {
        expect(route('cum te simti')).toBe('mood');
        expect(route('cum e piata')).toBe('market');
        expect(route('ce reguli ai')).toBe('constitution');
        expect(route('BTCUSDT')).toBe('symbol');
        expect(route('rsi pe BTCUSDT')).toBe('indicators');
    });
});
