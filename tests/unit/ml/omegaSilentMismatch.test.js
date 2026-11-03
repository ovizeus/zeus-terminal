'use strict';
// [2026-11-03] Doua defecte gasite RANDAND sabloanele si uitandu-ma la ce spun.
//
// (1) `_replyPredictivity` cauta celulele de bandit cu `cell_key LIKE
//     '<uid>|%|<sym>|%'` — cu BARA VERTICALA. Cheile reale sunt cu DOUA PUNCTE:
//     `1:DEMO:BNBUSDT:BREAKOUT`. Interogarea intorcea ZERO randuri mereu, deci
//     raspunsul era "bandit cold start, no edge yet" indiferent de date —
//     inclusiv pentru BTCUSDT, care are celule cu 36, 29, 27 si 20 de
//     observatii. O interogare care nu se potriveste niciodata nu da eroare:
//     da un raspuns linistit si fals.
//
// (2) Intrebarea "is btc manipulated" nu ajungea la verificarea de manipulare:
//     regexul avea `manipulation` dar nu si `manipulated`, deci cadea pe
//     intentia de simbol. Aceeasi clasa cu bugul reparat odata pe cuvantul
//     "azi" — un regex de intentie care rateaza o forma a cuvantului.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.join(__dirname, '../../../server/services/ml/_voice/chatResponder.js'), 'utf8');

describe('cheia de celula — separatorul potrivit', () => {
    const body = SRC.slice(SRC.indexOf('function _replyPredictivity'),
                           SRC.indexOf('function _reply', SRC.indexOf('function _replyPredictivity') + 10));

    test('REGRESIE: prefixul vine din constructorul COMUN, nu scris de mana', () => {
        // Prima versiune cerea forma scrisa inline, `${ctx.userId}:%:${sym}:%`.
        // Era corecta, dar a doua aparitie a aceleiasi forme, in raspunsul
        // despre invataminte, a ramas pe bara verticala inca un build — am
        // reparat instanta, nu clasa. Acum exista un singur constructor si
        // testul cere sa fie FOLOSIT; forma propriu-zisa e probata separat,
        // in omegaCellKey.test.js.
        expect(body).toContain('omegaContext.cellKeyPrefix(');
        expect(body).not.toContain('|%|');
    });

    test('REGRESIE: si desparte cheia tot cu doua puncte', () => {
        // Cu bara, `parts[3]` era undefined si regimul iesea "?".
        expect(body).toContain(".split(':')");
        expect(body).not.toContain(".split('|')");
    });

    test('arata MEDIUL celulei — cele mai invatate sunt pe testnet', () => {
        // Fara eticheta, cifra pare a lui si nu e: el tradeaza demo.
        expect(body).toMatch(/parts\[1\]/);
    });
});

describe('intentia de manipulare prinde formele cuvantului', () => {
    const RE = /\b(pump|wash|spoof|manipul\w*|outlier|schem[ăa])\b/i;

    test('REGRESIE: formele verbale, nu doar substantivul', () => {
        for (const q of ['is btc manipulated', 'are they manipulating btc',
                         'btc manipulat?', 'manipulare pe btc', 'manipulation check']) {
            expect(RE.test(q)).toBe(true);
        }
    });

    test('celelalte cuvinte raman prinse', () => {
        for (const q of ['pump and dump', 'wash trading', 'spoof the book', 'outlier volume', 'schema asta']) {
            expect(RE.test(q)).toBe(true);
        }
    });

    test('NU prinde intrebari obisnuite — un regex prea lacom e alt bug', () => {
        for (const q of ['how is btc', 'cum e piata', 'pnl today', 'positions', 'manual long']) {
            expect(RE.test(q)).toBe(false);
        }
    });

    test('regexul e acelasi in AMBELE lanturi de rutare', () => {
        // OMEGA are doua liste de intentii tinute in acord cu mana (vezi b362).
        // Daca una prinde forma verbala si cealalta nu, operatorul primeste alt
        // raspuns pe telefon decat dovedesc testele.
        const occurrences = (SRC.match(/manipul\\w\*/g) || []).length;
        expect(occurrences).toBe(2);
    });
});
