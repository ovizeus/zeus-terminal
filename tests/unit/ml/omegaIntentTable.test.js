'use strict';
// [2026-11-04] O SINGURA masa de intentii, citita de ambele lanturi.
//
// Erau doua lanturi de ~27 regexuri scrise de mana: `_tryLocalIntent` (fluxul,
// ce atinge el) si `_respondImpl` (fara flux, ce ating majoritatea testelor).
// Driftul s-a inchis la b362 cu un test care COMPARA cele doua texte -- adica
// il prindea dupa ce se intampla. Cu o masa unica driftul devine imposibil, nu
// prins: fiecare intentie noua se scrie o data.
//
// Si avea drift: `market` era declarat in LLM_PREFERRED_INTENTS, dar numai
// lantul cu flux il respecta; celalalt raspundea mereu cu sablonul.
const responder = require('../../../server/services/ml/_voice/chatResponder');

describe('masa de intentii', () => {
    it('exista si e expusa pentru proba', () => {
        const t = responder._INTENTS_FOR_TEST;
        expect(Array.isArray(t)).toBe(true);
        expect(t.length).toBeGreaterThanOrEqual(25);
    });

    it('fiecare intrare are nume, potrivire si executie', () => {
        for (const e of responder._INTENTS_FOR_TEST) {
            expect(typeof e.name).toBe('string');
            expect(e.name.length).toBeGreaterThan(0);
            expect(typeof e.match).toBe('function');
            expect(typeof e.run).toBe('function');
        }
    });

    it('numele sunt unice — doua intentii cu acelasi nume fac preferinta ambigua', () => {
        const names = responder._INTENTS_FOR_TEST.map(e => e.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('fiecare nume din LLM_PREFERRED_INTENTS exista in masa', () => {
        const names = new Set(responder._INTENTS_FOR_TEST.map(e => e.name));
        for (const n of responder.LLM_PREFERRED_INTENTS) expect(names.has(n)).toBe(true);
    });
});

describe('routeIntent — ordinea e contractul', () => {
    const route = (q) => {
        const hit = responder._routeIntentForTest(String(q).toLowerCase().trim(), String(q));
        return hit ? hit.name : null;
    };

    it('intentiile cu simbol bat calea de simbol gol', () => {
        // "RSI on BTC" trebuie sa mearga la indicatori, nu la rezumatul de simbol.
        expect(route('rsi on BTCUSDT')).toBe('indicators');
        expect(route('ziduri pe BTCUSDT')).toBe('liquidity_walls');
        expect(route('order book pe ETHUSDT')).toBe('order_book');
        expect(route('structura pe BTCUSDT')).toBe('structure');
        expect(route('market cap pe BTCUSDT')).toBe('fundamentals');
        expect(route('ce prezice ai-ul pe BTCUSDT')).toBe('predictivity');
    });

    it('intentiile de piata bat calea de simbol', () => {
        // "care a urcat cel mai mult" nu are voie sa cada pe simbol.
        expect(route('care a urcat cel mai mult')).toBe('top_gainers');
        expect(route('top losers')).toBe('top_losers');
        expect(route('cel mai mare volum')).toBe('top_volume');
        expect(route('cum e piata')).toBe('market');
    });

    it('un simbol singur merge la rezumatul de simbol', () => {
        expect(route('BTCUSDT')).toBe('symbol');
        expect(route('cum e BTCUSDT')).toBe('symbol');
    });

    it('intentiile despre el insusi se potrivesc', () => {
        expect(route('cum te simti')).toBe('mood');
        expect(route('ce pozitii am')).toBe('positions');
        expect(route('ce decizii ai luat')).toBe('decisions');
        expect(route('cum e bandit-ul')).toBe('bandit');
        expect(route('ai probleme')).toBe('doctor');
        expect(route('salut')).toBe('greeting');
    });

    it('ce nu se potriveste intoarce null — adica merge la model', () => {
        expect(route('care e sensul vietii')).toBeNull();
        expect(route('povesteste-mi o gluma despre pescari')).toBeNull();
    });

    it('potrivirile sunt pure — nu au nevoie de ctx sau de baza', () => {
        // Daca `match` ar atinge baza, n-ar putea fi probata aici.
        for (const e of responder._INTENTS_FOR_TEST) {
            expect(() => e.match('text oarecare fara sens', 'text oarecare fara sens')).not.toThrow();
        }
    });
});

describe('_withOpening — selectorul, nu lipitorul', () => {
    const W = responder._withOpeningForTest;

    it('pune deschiderea cand intentia SI semnalul se potrivesc', () => {
        const out = W('pnl', {}, { reply: 'today -10.31. loss streak 3.', mood: 'NERVOUS' });
        expect(out.reply).toMatch(/in common\?$/);
    });

    it('NU pune nimic cand semnalul lipseste din raspuns', () => {
        const r = { reply: 'today +42.00. 3 wins.', mood: 'EXCITED' };
        expect(W('pnl', {}, r).reply).toBe(r.reply);
    });

    it('NU pune deschiderea altei intentii, chiar daca semnalul ei e in text', () => {
        // Acelasi text, alta intentie: deschiderea de pnl nu are ce cauta aici.
        const r = { reply: 'loss streak 3 showed up in the decisions.', mood: 'CALM' };
        expect(W('decisions', {}, r).reply).toBe(r.reply);
    });

    it('starea calma nu primeste intrebarea pentru starea nervoasa', () => {
        const r = { reply: 'feeling calm. nothing unusual.', mood: 'CALM' };
        expect(W('mood', {}, r).reply).toBe(r.reply);
        const n = { reply: 'feeling nervous. 3 losses back to back.', mood: 'NERVOUS' };
        expect(W('mood', {}, n).reply).toMatch(/driving it\?$/);
    });

    it('cartea mixta primeste explicatia constitutiei', () => {
        const r = { reply: 'BNBUSDT short x1, ETHUSDT long x1.', mood: 'CALM' };
        expect(W('positions', {}, r).reply).toMatch(/advisory/);
    });

    it('o carte pe o singura parte NU o primeste', () => {
        const r = { reply: 'BNBUSDT short x1, ETHUSDT short x1.', mood: 'CALM' };
        expect(W('positions', {}, r).reply).toBe(r.reply);
    });

    it('influenta care n-a rulat niciodata primeste deschiderea', () => {
        const r = { reply: 'influence: NEVER APPLIED — 20174 evaluations.', mood: 'FOCUSED' };
        expect(W('bandit', {}, r).reply).toMatch(/unlock it\?$/);
    });

    it('pastreaza celelalte campuri ale raspunsului', () => {
        const out = W('mood', {}, { reply: 'feeling nervous. x.', mood: 'NERVOUS', extra: 7 });
        expect(out.mood).toBe('NERVOUS');
        expect(out.extra).toBe(7);
    });

    it('intoarce neatins ce nu e un raspuns', () => {
        for (const v of [null, undefined, 'text', 42, { noReply: 1 }, { reply: 5 }]) {
            expect(W('pnl', {}, v)).toBe(v);
        }
    });

    it('un `reply` care nu e sir dar se CONVERTESTE intr-unul nu goleste raspunsul', () => {
        // Fara garda de tip, String(['alert']) === 'alert' se potriveste, iar
        // lipitorul primeste un ne-sir si intoarce '' — raspunsul dispare.
        const r = { reply: ['alert'], mood: 'CALM' };
        expect(W('doctor', {}, r)).toBe(r);
        expect(W('doctor', {}, { reply: ['P0'] }).reply).toEqual(['P0']);
    });

    it('o intentie fara deschidere definita nu capata una', () => {
        const r = { reply: 'help: ask me about positions.', mood: 'CALM' };
        expect(W('help', {}, r).reply).toBe(r.reply);
    });
});

describe('deschiderile (#12) — raspunsul lasa o usa', () => {
    it('nu adauga o intrebare peste una existenta', () => {
        const out = responder._appendOpeningForTest('what do you want — positions, pnl, mood?', 'vrei sa vedem?');
        expect(out).toBe('what do you want — positions, pnl, mood?');
    });

    it('adauga deschiderea cand raspunsul se termina cu punct', () => {
        const out = responder._appendOpeningForTest('3 losses in a row.', 'want me to look at what they share?');
        expect(out).toBe('3 losses in a row. want me to look at what they share?');
    });

    it('fara deschidere, raspunsul ramane neatins', () => {
        expect(responder._appendOpeningForTest('calm.', null)).toBe('calm.');
        expect(responder._appendOpeningForTest('calm.', '')).toBe('calm.');
    });

it('pune un punct cand raspunsul nu se termina cu semn de punctuatie', () => {
        // Randat pe viu, iesea: "...serverBrain.reflection want the detail..."
        // Doua propozitii lipite arata ca o eroare de randare, nu ca o oferta.
        const out = responder._appendOpeningForTest('P2 serverBrain.reflection', 'want the detail?');
        expect(out).toBe('P2 serverBrain.reflection. want the detail?');
    });

    it('nu dubleaza punctuatia cand deja exista', () => {
        expect(responder._appendOpeningForTest('3 losses.', 'why?')).toBe('3 losses. why?');
        expect(responder._appendOpeningForTest('3 losses!', 'why?')).toBe('3 losses! why?');
        expect(responder._appendOpeningForTest('3 losses:', 'why?')).toBe('3 losses: why?');
    });

    it('nu arunca pe intrari stricate', () => {
        for (const v of [null, undefined, 0, {}]) {
            expect(() => responder._appendOpeningForTest(v, 'x?')).not.toThrow();
        }
    });
});
