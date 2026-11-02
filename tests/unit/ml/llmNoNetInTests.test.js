'use strict';
// [2026-11-02] Descoperit livrand: dupa ce `symbol` si `market` au trecut la
// model, un test a inceput sa primeasca "brain is rate-limited right now (Groq
// free tier)". Adica suita CHEMA cu adevarat Groq si lua 429 — ardea cota
// operatorului si trecea sau cadea dupa cum raspundea un serviciu extern.
//
// Fisierul acela se apara cu `delete process.env.GROQ_API_KEY` la incarcare,
// dar cheia revenea prin dotenv din lantul de require-uri: o aparare care
// ARATA ca functioneaza si nu functiona.
const llm = require('../../../server/services/ml/_voice/llmClient');

describe('llmClient — nicio iesire pe retea dintr-un test', () => {
    test('REGRESIE: sub executorul de teste, reteaua e inchisa CHIAR CU CHEIE', () => {
        // Prima versiune a acestui test nu punea cheia si cerea doar ca
        // `available()` sa fie fals. Era adevarat si FARA garda — fara cheie
        // raspunde oricum fals — deci mutatia care scotea garda supravietuia.
        // Un test adevarat si pentru varianta stricata nu apara nimic.
        expect(process.env.JEST_WORKER_ID).toBeDefined();   // chiar suntem sub jest
        const prev = process.env.GROQ_API_KEY;
        process.env.GROQ_API_KEY = 'cheie-falsa-de-test';
        try {
            expect(llm._netAllowedForTest()).toBe(false);
            expect(llm.available()).toBe(false);   // cheia exista, si tot nu iese
        } finally {
            if (prev === undefined) delete process.env.GROQ_API_KEY;
            else process.env.GROQ_API_KEY = prev;
        }
    });

    test('REGRESIE: si usile din spate sunt inchise, nu doar available()', async () => {
        // Un apelant care sare peste verificare tot nu iese pe retea.
        const r = await llm.chat({ messages: [{ role: 'user', content: 'x' }] });
        expect(r.ok).toBe(false);
        expect(r.error).toBe('blocked_in_test');
        const rs = await llm.chatStream({ messages: [{ role: 'user', content: 'x' }], onChunk: () => {} });
        expect(rs.ok).toBe(false);
        expect(rs.error).toBe('blocked_in_test');
    });

    test('exista o portita explicita, pentru cand chiar vrei calea reala', () => {
        const prev = process.env.OMEGA_LLM_ALLOW_NET_IN_TEST;
        process.env.OMEGA_LLM_ALLOW_NET_IN_TEST = '1';
        expect(llm._netAllowedForTest()).toBe(true);
        if (prev === undefined) delete process.env.OMEGA_LLM_ALLOW_NET_IN_TEST;
        else process.env.OMEGA_LLM_ALLOW_NET_IN_TEST = prev;
        expect(llm._netAllowedForTest()).toBe(false);
    });
});
