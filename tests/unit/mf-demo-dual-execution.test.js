'use strict';
// tests/unit/mf-demo-dual-execution.test.js
//
// [2026-10-27] Operatorul: „vezi de ce am 27 de pozitii pe demo deschise care
// tot dispar si apar, ca nu e in regula asta".
//
// GASIT: pe DEMO ruleaza DOUA motoare in acelasi timp.
//   CLIENT_AT = true        -> motorul din browser deschide pozitii demo
//   SERVER_AT_DEMO = true   -> si motorul de pe server deschide pozitii demo
//
// Fisierul migrationFlags.js isi declara singur invariantul, la linia 8:
// „CLIENT_AT and SERVER_AT must NEVER both be true simultaneously". Dar garda
// verifica DOAR perechea de productie, nu si variantele de demo — deci
// executia dubla pe demo trece neobservata.
//
// Si fiindca SERVER_AUTHORITATIVE_POSITIONS + POSITIONS_WS sunt pornite,
// serverul trimite periodic instantanee cu pozitiile LUI (citite din
// at_positions). Cand ale lui sunt zero, instantaneul le STERGE pe cele ale
// clientului — de aici „dispar"; motorul din browser deschide altele — „apar".
//
// ⚠️ TESTUL NU CERE CA GARDA STRICTA SA PRINDA ASTA, dinadins: `_validateMutex`
// e chemata la incarcarea modulului si ARUNCA, deci adaugarea perechii de demo
// acolo ar face serverul sa REFUZE SA PORNEASCA cu steagurile de azi. Decizia
// care motor se stinge e a operatorului, nu a mea. Deci: detectie zgomotoasa,
// fara sa omoare boot-ul.

const MF = require('../../server/migrationFlags');

describe('executia dubla pe DEMO — detectata, nu ascunsa', () => {
    test('detectorul exista si e exportat', () => {
        expect(typeof MF.detectDemoDualExecution).toBe('function');
    });

    test('prinde CLIENT_AT + SERVER_AT_DEMO amandoua pornite', () => {
        const v = MF.detectDemoDualExecution({ CLIENT_AT: true, SERVER_AT_DEMO: true });
        expect(v.length).toBeGreaterThan(0);
        expect(v.join(' ')).toMatch(/CLIENT_AT/);
        expect(v.join(' ')).toMatch(/SERVER_AT_DEMO/);
    });

    test('prinde si perechea de decizie: CLIENT_BRAIN + SERVER_BRAIN_DEMO', () => {
        const v = MF.detectDemoDualExecution({ CLIENT_BRAIN: true, SERVER_BRAIN_DEMO: true });
        expect(v.join(' ')).toMatch(/BRAIN/);
    });

    test('chemat fara argument NU arunca — detectia nu are voie sa rupa boot-ul', () => {
        // Garda asta a supravietuit primei mutatii: testul meu trimitea `{}`,
        // nu `undefined`, deci nu o atingea.
        expect(() => MF.detectDemoDualExecution(undefined)).not.toThrow();
        expect(MF.detectDemoDualExecution(undefined)).toEqual([]);
        expect(MF.detectDemoDualExecution(null)).toEqual([]);
    });

    test('o singura parte pornita NU e o incalcare', () => {
        expect(MF.detectDemoDualExecution({ CLIENT_AT: true, SERVER_AT_DEMO: false })).toEqual([]);
        expect(MF.detectDemoDualExecution({ CLIENT_AT: false, SERVER_AT_DEMO: true })).toEqual([]);
        expect(MF.detectDemoDualExecution({})).toEqual([]);
    });

    test('⛔ NU arunca si NU omoara boot-ul — decizia e a operatorului', () => {
        expect(() => MF.detectDemoDualExecution({ CLIENT_AT: true, SERVER_AT_DEMO: true })).not.toThrow();
    });

    test('garda STRICTA rameane neatinsa: perechea de demo nu intra in ea', () => {
        // Daca cineva o muta in _validateMutex, serverul refuza sa porneasca
        // cu steagurile de azi. Testul asta pazeste exact impotriva acelui pas.
        const v = MF._validateMutex({ CLIENT_AT: true, SERVER_AT_DEMO: true, SERVER_AT: false });
        expect(v.ok).toBe(true);
    });

    test('starea REALA de azi e raportata, nu presupusa', () => {
        // Citeste steagurile chiar cum sunt incarcate in proces.
        const viu = MF.detectDemoDualExecution({
            CLIENT_AT: MF.CLIENT_AT, SERVER_AT_DEMO: MF.SERVER_AT_DEMO,
            CLIENT_BRAIN: MF.CLIENT_BRAIN, SERVER_BRAIN_DEMO: MF.SERVER_BRAIN_DEMO,
        });
        expect(Array.isArray(viu)).toBe(true);
    });
});

describe('CORECTIE 2026-10-27 — mesajul meu spunea mai mult decat era adevarat', () => {
    // Prima varianta afirma „two engines open demo positions at once". Verificat
    // in cod: NU e adevarat azi. Clientul REFUZA sa deschida demo cat timp
    // serverul detine autoritatea — garda S6-B5 din placeAutoTrade, hranita de
    // flagul serverATDemoEnabled pe care chiar procesul asta il trimite.
    //
    // Deci riscul real nu e „se intampla acum", ci „garda aia e SINGURUL lucru
    // care opreste al doilea motor". Mesajul trebuie sa spuna exact asta.
    const fs = require('fs');
    const path = require('path');
    const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'migrationFlags.js'), 'utf8');

    test('mesajul NU mai afirma ca ambele motoare deschid acum', () => {
        expect(SRC).not.toMatch(/two engines open demo positions at once/);
    });

    test('mesajul numeste garda care chiar opreste al doilea motor', () => {
        expect(SRC).toMatch(/S6-B5/);
        expect(SRC).toMatch(/serverATDemoEnabled/);
    });

    test('si spune care e riscul REAL: garda ramasa singura', () => {
        expect(SRC).toMatch(/if it ever goes inert/i);
    });

    test('garda din client exista inca — daca dispare, mesajul devine fals', () => {
        const C = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'src',
            'trading', 'autotrade.ts'), 'utf8');
        expect(C).toMatch(/_isServerDemoATActive\(\)/);
        const i = C.indexOf('export function placeAutoTrade');
        expect(i).toBeGreaterThan(-1);
        expect(C.slice(i, i + 600)).toMatch(/_isServerDemoATActive\(\)/);
    });
});
