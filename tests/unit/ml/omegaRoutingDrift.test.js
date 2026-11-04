'use strict';
// [2026-11-02, rescris 2026-11-04] Rutarea lui OMEGA — un singur adevar.
//
// VERSIUNEA DE LA b362 compara cele DOUA lanturi (`_tryLocalIntent` pentru flux,
// lantul din `_respondImpl` pentru calea fara flux) si cerea sa fie identice.
// Era gardianul corect pentru arhitectura de atunci: doua liste de ~27 `if`-uri
// tinute in acord cu MANA, iar daca se despart se intampla cel mai urat fel de
// bug — testele trec pe o cale, operatorul primeste alt raspuns pe cealalta.
//
// La b373 lanturile s-au unificat intr-o singura masa de intentii. Ce apara
// testul s-a mutat, si asta e intentionat: nu mai verific ca doua copii sunt
// identice, verific CA NU EXISTA O A DOUA COPIE. Driftul nu mai e prins dupa
// ce se intampla; a devenit imposibil de scris.
//
// (Si lanturile CHIAR se desparțiseră: `market` era declarat in
// LLM_PREFERRED_INTENTS, dar numai calea cu flux il respecta.)
const fs = require('fs');
const path = require('path');
const responder = require('../../../server/services/ml/_voice/chatResponder');

const SRC = fs.readFileSync(
    path.join(__dirname, '../../../server/services/ml/_voice/chatResponder.js'), 'utf8');

function bodyOf(startMarker, endMarker) {
    const i = SRC.indexOf(startMarker);
    expect(i).toBeGreaterThan(-1);
    const j = SRC.indexOf(endMarker, i);
    expect(j).toBeGreaterThan(i);
    return SRC.slice(i, j);
}

describe('rutarea intentiilor — o singura masa', () => {
    test('masa exista si are toate intentiile', () => {
        expect(responder._INTENTS_FOR_TEST.length).toBeGreaterThan(20);
    });

    test('REGRESIE: nu s-a intors un al doilea lant de `if`-uri', () => {
        // Semnatura vechiului lant: `if (text.match(/.../))`. Daca reapare,
        // cineva a adaugat o intentie pe langa masa.
        expect(SRC.match(/if \(text\.match\(/g)).toBeNull();
    });

    test('REGRESIE: ambele cai de raspuns trec prin routeIntent', () => {
        const streaming = bodyOf('async function _tryLocalIntent', '\n}');
        const plain = bodyOf('async function _respondImpl', '\nmodule.exports');
        expect(streaming).toContain('routeIntent(text, originalText)');
        expect(plain).toContain('routeIntent(text, originalText)');
    });

    test('REGRESIE: preferinta pentru model se citeste o data per cale', () => {
        // Una e definitia, doua sunt apelurile — cate unul pe fiecare cale.
        // Mai multe ar insemna ca s-a intors ramificarea pe intentie.
        const n = (SRC.match(/preferLLMForIntent\(/g) || []).length;
        expect(n).toBe(3);
    });

    test('REGRESIE: preferinta se aplica pe NUME de intentie, nu pe literal', () => {
        // La b362 erau `preferLLMForIntent('market', ...)` scrise de mana in
        // fiecare ramura; de-aia se putea uita una. Acum numele vine din masa.
        expect(SRC).toContain('preferLLMForIntent(hit.name');
        expect(SRC.match(/preferLLMForIntent\('[a-z]+'/g)).toBeNull();
    });

    test('fiecare intentie preferata de model exista in masa', () => {
        const names = new Set(responder._INTENTS_FOR_TEST.map(e => e.name));
        for (const n of responder.LLM_PREFERRED_INTENTS) expect(names.has(n)).toBe(true);
    });

    test('`market` — divergenta care a motivat unificarea — e acum o intrare', () => {
        const names = responder._INTENTS_FOR_TEST.map(e => e.name);
        expect(names).toContain('market');
        expect(responder.LLM_PREFERRED_INTENTS.has('market')).toBe(true);
    });
});
