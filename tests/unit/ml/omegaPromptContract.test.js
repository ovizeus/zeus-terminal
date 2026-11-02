'use strict';
// [2026-11-02] Contractul dintre ce stie Zeus si ce AJUNGE in fata modelului.
//
// Un context bogat pe care promptul nu-l scrie nu ajuta pe nimeni: modelul vede
// doar textul. Testele astea cer ca fiecare felie noua sa fie SCRISA, si ca
// vechiul zgomot sa nu se mai scrie.
const responder = require('../../../server/services/ml/_voice/chatResponder');

function prompt(text) {
    return responder._buildSystemPromptForTest({ userId: 1, text: text || 'cum stam', _memoryFacts: [] });
}

describe('promptul de sistem al lui OMEGA', () => {
    test('REGRESIE: scrie contul — balanta, ziua, rata de castig', () => {
        // Nu aparea NICAIERI, desi "cum stau?" e prima intrebare a oricui.
        expect(prompt()).toContain('Account:');
    });

    test('REGRESIE: scrie deciziile reale, cu ce le-a oprit', () => {
        const p = prompt();
        expect(p).toContain('Brain decisions (last 5min');
        expect(p).toContain('what stopped it');
    });

    test('REGRESIE: scrie de ce NU a intrat', () => {
        expect(prompt()).toContain('Entries BLOCKED (last 24h)');
    });

    test('REGRESIE: scrie propriile lui ganduri din THE VOICE', () => {
        // Fara ele raspundea "Nu am un mesaj anterior de la echipa" despre un
        // gand pe care tocmai il emisese el insusi.
        const p = prompt();
        expect(p).toContain('Your own recent thoughts');
        expect(p).toContain('THE VOICE');
    });

    test('REGRESIE: scrie ultimele inchideri', () => {
        expect(prompt()).toContain('Last closes:');
    });

    test('REGRESIE: scrie lichidarile din ultimele 24h', () => {
        expect(prompt()).toContain('Liquidations burned (last 24h');
    });

    test('ii explica vocabularul deciziilor, ca sa nu ghiceasca', () => {
        const p = prompt();
        for (const word of ['no_trade', 'blocked_gates', 'blocked_reflection', 'entry_blocked', 'pending_expire']) {
            expect(p).toContain(word);
        }
        expect(p).toContain('never guess');
    });

    test('nu mai cere modelului sa citeasca "Recent decisions" din auditul ML', () => {
        // Eticheta veche mergea cu sursa veche; daca reapare, a revenit si zgomotul.
        expect(prompt()).not.toContain('Recent decisions (last 5min):');
    });

    test('promptul ramane un singur sir, fara undefined scurs in el', () => {
        const p = prompt('cum vezi BTC');
        expect(typeof p).toBe('string');
        expect(p).not.toContain('undefined');
        expect(p).not.toContain('[object Object]');
    });
});
