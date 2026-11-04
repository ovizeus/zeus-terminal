'use strict';
// [2026-11-04] O invitatie e o PROMISIUNE. Daca nu poate fi tinuta, nu se face.
//
// Randat pe o conversatie adevarata, asta ieşea:
//   » cum te simti  -> "...want to know what is driving it?"
//   » si de ce?     -> "pot raspunde despre: pozitii/deschise, pnl/azi, ..."
//
// Adica OMEGA ofera ceva, el accepta, si primeste UN MENIU DE COMENZI. Nu
// exista fel mai bun de a suna a robot. (In teste modelul e inchis prin
// construcţie, deci exact calea care ar fi raspuns e suprimata -- dar asta e si
// ce se intampla cand modelul e picat sau limitat pe viu.)
//
// Reparatia: deschiderea devine o promisiune pe care sistemul o poate tine
// SINGUR, din date, fara model.
const responder = require('../../../server/services/ml/_voice/chatResponder');

describe('acceptarea unei deschideri', () => {
    beforeEach(() => responder._resetFollowUpForTest && responder._resetFollowUpForTest());

    it('fara nicio deschidere in asteptare, nimic nu se intampla', () => {
        expect(responder._matchFollowUpForTest(1, 'si de ce?')).toBeNull();
        expect(responder._matchFollowUpForTest(1, 'da')).toBeNull();
    });

    it('dupa o deschidere, un `da` o accepta', () => {
        responder._setFollowUpForTest(1, 'mood');
        expect(responder._matchFollowUpForTest(1, 'da')).toBe('mood');
    });

    it('formele fireşti de acceptare', () => {
        for (const q of ['da', 'da vreau', 'si de ce?', 'de ce', 'spune', 'spune-mi', 'arata', 'zi', 'yes', 'sure', 'go', 'ok', 'hai']) {
            responder._setFollowUpForTest(1, 'bandit');
            expect(responder._matchFollowUpForTest(1, q)).toBe('bandit');
        }
    });

    it('o intrebare NOUA nu e o acceptare — deschiderea se uita', () => {
        responder._setFollowUpForTest(1, 'mood');
        expect(responder._matchFollowUpForTest(1, 'ce pozitii am')).toBeNull();
        // si nu mai e in asteptare, ca sa nu se aplice peste doua ture
        expect(responder._matchFollowUpForTest(1, 'da')).toBeNull();
    });

    it('se consuma o singura data', () => {
        responder._setFollowUpForTest(1, 'doctor');
        expect(responder._matchFollowUpForTest(1, 'da')).toBe('doctor');
        expect(responder._matchFollowUpForTest(1, 'da')).toBeNull();
    });

    it('deschiderile sunt per utilizator, nu globale', () => {
        responder._setFollowUpForTest(1, 'mood');
        expect(responder._matchFollowUpForTest(2, 'da')).toBeNull();
        expect(responder._matchFollowUpForTest(1, 'da')).toBe('mood');
    });

    it('fiecare deschidere din tabel are un raspuns de urmare', () => {
        // Altfel se ofera ceva ce nu se poate livra — exact bugul reparat.
        for (const o of responder._OPENINGS_FOR_TEST) {
            expect(typeof responder._FOLLOWUPS_FOR_TEST[o.intent]).toBe('function');
        }
    });

    it('`nu` nu e o acceptare', () => {
        responder._setFollowUpForTest(1, 'mood');
        expect(responder._matchFollowUpForTest(1, 'nu')).toBeNull();
        responder._setFollowUpForTest(1, 'mood');
        expect(responder._matchFollowUpForTest(1, 'nu vreau')).toBeNull();
    });

    it('nu arunca pe intrari stricate', () => {
        for (const v of [null, undefined, '', 0, {}]) {
            expect(() => responder._matchFollowUpForTest(1, v)).not.toThrow();
        }
        expect(() => responder._setFollowUpForTest(null, 'mood')).not.toThrow();
    });
});

describe('urmarea de la doctor — sa nu se contrazica', () => {
    it('REGRESIE: nu spune `nothing to detail` cand randul anterior a listat evenimente', () => {
        // Randat pe viu: "last hour top 3: P2 serverBrain.reflection..." urmat de
        // "nothing in the last hour to detail." Cauza: interogarea mea cerea o
        // coloana `message` care NU EXISTA, arunca, si catch-ul o facea sa arate
        // ca o lipsa de date. O contradictie e mai rea decat o eroare.
        const rows = [{ severity: 'P2', module_id: 'serverBrain.reflection', event_type: 'alert',
                        payload_json: JSON.stringify({ concerns: ['anti_pattern:SHORT in TREND'] }), ts: 1 }];
        const db = { prepare: () => ({ all: () => rows }) };
        const out = responder._doctorDetailForTest(db);
        expect(out.reply).not.toMatch(/nothing/i);
        expect(out.reply).toContain('serverBrain.reflection');
        expect(out.reply).toMatch(/anti_pattern/);
    });

    it('fara evenimente, spune asta — si nu arunca', () => {
        const db = { prepare: () => ({ all: () => [] }) };
        expect(responder._doctorDetailForTest(db).reply).toMatch(/nothing/i);
    });

    it('o interogare care arunca nu se randeaza ca `fara evenimente`', () => {
        // Diferenta dintre "n-am date" si "n-am putut citi" conteaza.
        const db = { prepare: () => { throw new Error('no such column'); } };
        const out = responder._doctorDetailForTest(db);
        expect(out.reply).toMatch(/could not read|cannot read/i);
        expect(out.reply).not.toMatch(/nothing in the last hour/i);
    });

    it('payload stricat nu arunca si nu scrie `undefined`', () => {
        for (const bad of ['nu e json', '', null, '{}', '{"concerns":null}', '{"concerns":[]}']) {
            const db = { prepare: () => ({ all: () => [{ severity: 'P2', module_id: 'm', event_type: 'alert', payload_json: bad, ts: 1 }] }) };
            const out = responder._doctorDetailForTest(db);
            expect(() => out.reply).not.toThrow();
            expect(out.reply).not.toMatch(/undefined|\[object/);
        }
    });
});

describe('legatura: deschiderea isi tine minte promisiunea', () => {
    beforeEach(() => responder._resetFollowUpForTest());

    it('REGRESIE: `_withOpening` INREGISTREAZA promisiunea, nu doar o scrie', () => {
        // Prins de o mutatie: testele mele puneau promisiunea cu MANA, deci
        // legatura reala dintre oferta si tinerea ei minte putea lipsi cu totul
        // si tot ar fi fost verde.
        const out = responder._withOpeningForTest('mood', { userId: 77 },
            { reply: 'feeling nervous. x.', mood: 'NERVOUS' });
        expect(out.reply).toMatch(/driving it\?$/);
        expect(responder._matchFollowUpForTest(77, 'da')).toBe('mood');
    });

    it('un raspuns FARA deschidere nu lasa nimic in asteptare', () => {
        responder._withOpeningForTest('mood', { userId: 78 }, { reply: 'feeling calm.', mood: 'CALM' });
        expect(responder._matchFollowUpForTest(78, 'da')).toBeNull();
    });

    it('promisiunea e a utilizatorului din ctx', () => {
        responder._withOpeningForTest('bandit', { userId: 79 },
            { reply: 'influence: NEVER APPLIED.', mood: 'FOCUSED' });
        expect(responder._matchFollowUpForTest(80, 'da')).toBeNull();
        expect(responder._matchFollowUpForTest(79, 'da')).toBe('bandit');
    });

    it('aceeasi grija nu se scrie de doua ori in detaliu', () => {
        // Payload-ul real avea aceeasi grija de TREI ori in acelasi eveniment.
        const dup = JSON.stringify({ concerns: ['anti_pattern:SHORT in TREND', 'anti_pattern:SHORT in TREND'] });
        const db = { prepare: () => ({ all: () => [{ severity: 'P2', module_id: 'm', event_type: 'alert', payload_json: dup, ts: 1 }] }) };
        const reply = responder._doctorDetailForTest(db).reply;
        expect(reply.match(/anti_pattern/g)).toHaveLength(1);
    });
});
