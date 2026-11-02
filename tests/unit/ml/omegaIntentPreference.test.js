'use strict';
// [2026-11-02] 27 din 58 de replici recente (47%) veneau din sabloane: 38 de
// intentii pe expresii regulate prindeau intrebarea inainte ca modelul sa
// apuce sa gandeasca. Era corect cand modelul nu stia nimic; de la b360 are in
// fata exact datele lor.
const responder = require('../../../server/services/ml/_voice/chatResponder');

describe('preferLLMForIntent', () => {
    test('REGRESIE: intentiile unde raspunsul bun e o CITIRE trec la model', () => {
        for (const i of ['symbol', 'market']) {
            expect(responder.preferLLMForIntent(i, true)).toBe(true);
        }
    });

    test('REGRESIE: salutul NU trece la model — costa o secunda si cota degeaba', () => {
        // Prima varianta il mutase. Testele au aratat pretul: fiecare „salut"
        // devenea un drum la model, pe un plan gratuit care deja ne da
        // rate-limit. Un salut nu castiga nimic din gandire.
        expect(responder.preferLLMForIntent('greeting', true)).toBe(false);
    });

    test('REGRESIE: deciziile NU trec la model — aveau nevoie de sursa corecta, nu de gandire', () => {
        expect(responder.preferLLMForIntent('decisions', true)).toBe(false);
    });

    test('REGRESIE: comenzile si listele exacte RAMAN sabloane', () => {
        // `remember` schimba o stare — un model care parafrazeaza e un bug.
        // `positions` / `pnl` / `doctor` sunt cifre: exactitatea bate proza.
        for (const i of ['remember', 'forget', 'profile', 'positions', 'pnl', 'doctor', 'bandit', 'orderbook', 'help', 'greeting', 'decisions', 'mood']) {
            expect(responder.preferLLMForIntent(i, true)).toBe(false);
        }
    });

    test('REGRESIE: fara model disponibil, sablonul ramane — nu se raspunde cu nimic', () => {
        for (const i of ['symbol', 'market']) {
            expect(responder.preferLLMForIntent(i, false)).toBe(false);
        }
    });

    test('doar un `true` strict conteaza ca disponibil', () => {
        for (const v of [undefined, null, 1, 'yes', {}]) {
            expect(responder.preferLLMForIntent('symbol', v)).toBe(false);
        }
    });

    test('lista e mica si explicita — mutarea se face pe rand, nu in bloc', () => {
        expect(responder.LLM_PREFERRED_INTENTS.size).toBe(2);
    });
});

describe('intentia `decizii` — sursa, nu modelul', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../../server/services/ml/_voice/chatResponder.js'), 'utf8');
    const body = src.slice(src.indexOf('function _replyDecisions'), src.indexOf('function _replyDoctor'));

    test('REGRESIE: numara deciziile reale, nu randurile de audit ML', () => {
        // Varianta veche raporta cate perechi simbol/regim a vazut in
        // `ml_influence_audit` — 20.160 de randuri pe zi, toate `skipped`.
        expect(body).toContain('FROM brain_decisions');
        // Pe INTEROGARE, nu pe comentariu: comentariul explica tocmai de ce
        // s-a plecat de la auditul ML, deci numele lui apare acolo legitim.
        expect(body).not.toContain('FROM ml_influence_audit');
    });

    test('grupeaza dupa CE S-A INTAMPLAT cu ele, fiindca aia e intrebarea', () => {
        expect(body).toContain('final_action');
        expect(body).toContain('what happened to them');
    });

    test('ramane scopat pe utilizator', () => {
        expect(body).toContain('user_id = ?');
    });
});
