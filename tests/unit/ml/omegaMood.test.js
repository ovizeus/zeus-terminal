'use strict';
// [2026-11-02] OMEGA nu putea sa simta decat CALM.
//
// `_currentMood()` se calcula din `ml_influence_audit`, testand `gate_status`
// pentru `accepted`, `rejected` si `no_proposal`. Tabela aia n-a avut NICIODATA
// altceva decat `skipped / insufficient_observations` — toate cele 522.400 de
// randuri, fiindca poarta de influenta ML n-a trecut niciodata (b352). Deci
// cele trei ramuri erau matematic de neatins: ramanea CALM, sau BORED cand
// fereastra era goala.
//
// Masurat pe conversatia reala a operatorului: 40 de CALM, iar putinele stari
// diferite veneau din alte cai, cu starea scrisa de mana.
//
// Un asistent care spune CALM in timp ce cartea pierde a optsprezecea oara la
// rand nu e calm, e orb — si exact asta se simte ca incoerenta.
const { moodFrom, moodReason } = require('../../../server/services/ml/_voice/omegaContext');
const fs = require('fs');
const path = require('path');

describe('moodFrom — starea din ce se misca de fapt', () => {
    test('REGRESIE: o serie lunga de pierderi NU mai e "calm"', () => {
        expect(moodFrom({ decisions: 50, lossStreak: 18, dailyPnl: -9.8 })).toBe('SAD');
    });

    test('o zi pe minus ingrijoreaza, chiar fara serie', () => {
        expect(moodFrom({ decisions: 50, lossStreak: 0, dailyPnl: -3.28 })).toBe('NERVOUS');
    });

    test('doua pierderi la rand ingrijoreaza chiar daca ziua e inca pe plus', () => {
        expect(moodFrom({ decisions: 50, lossStreak: 2, dailyPnl: 5 })).toBe('NERVOUS');
    });

    test('ziua pe plus bucura', () => {
        expect(moodFrom({ decisions: 50, dailyPnl: 12.4 })).toBe('EXCITED');
        expect(moodFrom({ decisions: 50, winStreak: 3 })).toBe('EXCITED');
    });

    test('REGRESIE: durerea bate efortul — cine pierde nu e "concentrat"', () => {
        // Motorul poate munci mult blocand intrari; daca omul pierde, starea
        // care conteaza e a omului.
        expect(moodFrom({ decisions: 100, blocked: 95, lossStreak: 3, dailyPnl: -5 })).toBe('NERVOUS');
    });

    test('mult efort fara durere si fara castig = concentrat', () => {
        expect(moodFrom({ decisions: 100, blocked: 80, dailyPnl: 0 })).toBe('FOCUSED');
    });

    test('putin efort, zi plata = calm', () => {
        expect(moodFrom({ decisions: 100, blocked: 10, dailyPnl: 0 })).toBe('CALM');
    });

    test('creierul tace = plictisit', () => {
        expect(moodFrom({ decisions: 0 })).toBe('BORED');
        expect(moodFrom({})).toBe('BORED');
        expect(moodFrom(null)).toBe('BORED');
    });

    test('ce nu e numar nu devine zero — Number(null) trece de isFinite', () => {
        // Un `dailyPnl` lipsa nu inseamna "zi plata": inseamna "nu stiu".
        expect(moodFrom({ decisions: 50, dailyPnl: null, blocked: 10 })).toBe('CALM');
        expect(moodFrom({ decisions: 50, dailyPnl: '-5', blocked: 10 })).toBe('CALM');
    });

    test('REGRESIE: toate cele sase stari sunt ATINGIBILE', () => {
        // Asta e intreaga poveste: inainte, trei dintre ele nu puteau aparea.
        const reached = new Set([
            moodFrom({ decisions: 0 }),
            moodFrom({ decisions: 50, lossStreak: 18 }),
            moodFrom({ decisions: 50, dailyPnl: -1 }),
            moodFrom({ decisions: 50, dailyPnl: 1 }),
            moodFrom({ decisions: 100, blocked: 80, dailyPnl: 0 }),
            moodFrom({ decisions: 100, blocked: 1, dailyPnl: 0 }),
        ]);
        expect(reached).toEqual(new Set(['BORED', 'SAD', 'NERVOUS', 'EXCITED', 'FOCUSED', 'CALM']));
    });
});

describe('moodReason — explicatia vine din ce a produs starea', () => {
    test('REGRESIE: nu mai vorbeste despre randuri de audit', () => {
        // Inainte: "N skipped of N = bandit cold or no eligible cells".
        const r = moodReason({ decisions: 62, blocked: 11, dailyPnl: -8.39, lossStreak: 21 });
        expect(r).not.toMatch(/audit|skipped|bandit cold/i);
        expect(r).toMatch(/21 losses in a row/);
    });

    test('starea si explicatia spun ACELASI lucru', () => {
        // Un raspuns care isi contrazice propria stare e definitia incoerentei.
        const cases = [
            { decisions: 0 },
            { decisions: 50, lossStreak: 18 },
            { decisions: 50, dailyPnl: -2 },
            { decisions: 50, dailyPnl: 2 },
            { decisions: 100, blocked: 80, dailyPnl: 0 },
            { decisions: 100, blocked: 1, dailyPnl: 0 },
        ];
        const pairs = cases.map(c => [moodFrom(c), moodReason(c)]);
        expect(pairs.find(([m]) => m === 'BORED')[1]).toMatch(/quiet|no decisions/i);
        expect(pairs.find(([m]) => m === 'SAD')[1]).toMatch(/streak|losses in a row/i);
        expect(pairs.find(([m]) => m === 'NERVOUS')[1]).toMatch(/day is -|losses/i);
        expect(pairs.find(([m]) => m === 'EXCITED')[1]).toMatch(/day is \+|wins/i);
        expect(pairs.find(([m]) => m === 'FOCUSED')[1]).toMatch(/blocked/i);
        expect(pairs.find(([m]) => m === 'CALM')[1]).toMatch(/nothing forcing/i);
    });

    test('date lipsa nu devin zero', () => {
        expect(moodReason({ decisions: 50, dailyPnl: null, blocked: 1 })).toMatch(/nothing forcing/);
        expect(moodReason(null)).toMatch(/quiet/);
    });
});

describe('chatResponder nu mai citeste tabela moarta', () => {
    const SRC = fs.readFileSync(
        path.join(__dirname, '../../../server/services/ml/_voice/chatResponder.js'), 'utf8');

    test('REGRESIE: nicio INTEROGARE nu mai atinge ml_influence_audit', () => {
        // Comentariile o pomenesc legitim — explica de ce s-a plecat de acolo.
        // Ce nu mai are voie sa existe e un `FROM` catre ea.
        expect(SRC).not.toMatch(/FROM\s+ml_influence_audit/);
    });

    test('si deciziile vin din sursa reala', () => {
        const n = (SRC.match(/FROM brain_decisions/g) || []).length;
        expect(n).toBeGreaterThanOrEqual(3);   // decizii, simbol, stare
    });
});
