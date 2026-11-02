'use strict';
// [2026-11-02] Cele DOUA lanturi de rutare ale lui OMEGA nu au voie sa se
// desparta.
//
// `_tryLocalIntent` serveste chatul in flux — ce foloseste operatorul pe
// telefon. `_respondImpl` serveste calea fara flux, pe care cad majoritatea
// testelor. Comentariul din cod spune de mult ca al doilea "mirrors exactly"
// pe primul, dar nimic nu verifica asta: sunt doua liste lungi de `if`-uri
// tinute in acord cu mana.
//
// Daca se despart, se intampla cel mai urat fel de bug: testele trec pe o cale
// si operatorul primeste alt raspuns pe cealalta. Testul asta compara ordinea
// intentiilor din SURSA, fiindca ordinea e tot contractul — intentiile sunt
// `if`-uri in cascada, deci cine vine primul castiga.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.join(__dirname, '../../../server/services/ml/_voice/chatResponder.js'), 'utf8');

function chain(startMarker, endMarker) {
    const i = SRC.indexOf(startMarker);
    expect(i).toBeGreaterThan(-1);
    const j = SRC.indexOf(endMarker, i);
    expect(j).toBeGreaterThan(i);
    // Numele intentiei, in ordinea in care sunt incercate. `_replyLLMFallback`
    // se scoate: in lantul cu flux el e `return null`, in celalalt un apel —
    // aceeasi hotarare, scrisa diferit fiindca iesirile difera.
    return (SRC.slice(i, j).match(/_reply([A-Za-z]+)\(ctx/g) || [])
        .map(m => m.replace('_reply', '').replace('(ctx', ''))
        .filter(n => n !== 'LLMFallback');
}

const streaming = chain('async function _tryLocalIntent', '\n    return null;\n}');
const plain = chain('async function _respondImpl', '\nmodule.exports');

describe('rutarea intentiilor — un singur adevar, doua locuri', () => {
    test('ambele lanturi chiar exista si au intentii', () => {
        expect(streaming.length).toBeGreaterThan(20);
        expect(plain.length).toBeGreaterThan(20);
    });

    test('REGRESIE: aceleasi intentii, in ACEEASI ordine', () => {
        // Ordinea nu e un detaliu: sunt `if`-uri in cascada. Daca `pnl` urca
        // peste `market`, "cum e piata in 24h" ajunge la raspunsul de pnl — e
        // chiar clasa de bug reparata odata in trecut cu cuvantul "azi".
        expect(streaming).toEqual(plain);
    });

    test('REGRESIE: preferinta pentru model se aplica in AMBELE lanturi', () => {
        // Altfel operatorul primeste o citire pe telefon si un sablon in teste,
        // sau invers — si nimeni nu stie care e adevarul.
        const n = (SRC.match(/preferLLMForIntent\(/g) || []).length;
        // una e definitia, restul sunt apeluri: doua intentii x doua lanturi.
        expect(n).toBe(1 + 2 * 2);
    });

    test('nu raman ramuri de preferinta pentru intentii scoase din lista', () => {
        // Dupa ce lista s-a restrans de la 5 la 2, ramurile pentru celelalte
        // trei ar fi fost cod mort care sugereaza ce nu se intampla.
        const responder = require('../../../server/services/ml/_voice/chatResponder');
        for (const name of ['greeting', 'mood', 'decisions']) {
            expect(SRC).not.toContain(`preferLLMForIntent('${name}'`);
            expect(responder.preferLLMForIntent(name, true)).toBe(false);
        }
    });
});
