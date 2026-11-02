'use strict';
// [2026-11-02] Intrebarea lui: "i raspunde manual long etc de ce".
//
// Fiindca `tradeReaction` isi scria comentariile la tranzactiile lui manuale
// ("manual LONG BTCUSDT. watching.") cu `utterance_type = 'CHAT_REPLY'` —
// acelasi tip ca raspunsurile din chat. Masurat pe contul lui: din 322 de
// randuri CHAT_REPLY, 262 erau reactii si doar 60 conversatie. 81 la suta.
//
// Costul: numaratoarea de mesaje umflata, randuri "(?)" in panou pentru
// raspunsuri fara intrebare, si — cel mai rau — memoria trimisa modelului
// plina de replici orfane, adica exact ce-l facea sa sune trangă-langa.
const fs = require('fs');
const path = require('path');
const filter = require('../../../server/services/ml/_voice/chatHistoryFilter');

const SRC = (rel) => fs.readFileSync(path.join(__dirname, '../../../server', rel), 'utf8');

describe('isRealChatRow', () => {
    test('REGRESIE: o reactie la tranzactie NU e conversatie', () => {
        expect(filter.isRealChatRow({ utterance_type: 'CHAT_REPLY', template_id: 'omega_reaction' })).toBe(false);
    });
    test('un raspuns adevarat din chat trece', () => {
        expect(filter.isRealChatRow({ utterance_type: 'CHAT_REPLY', template_id: 'wave1_groq_stream' })).toBe(true);
        expect(filter.isRealChatRow({ utterance_type: 'CHAT_REPLY', template_id: null })).toBe(true);
    });
    test('alt tip de rostire nu e conversatie', () => {
        expect(filter.isRealChatRow({ utterance_type: 'THOUGHT', template_id: null })).toBe(false);
        expect(filter.isRealChatRow({ utterance_type: 'REACTION', template_id: 'omega_reaction' })).toBe(false);
    });
    test('gunoi la intrare, false la iesire', () => {
        for (const v of [null, undefined, 'x', 42]) expect(filter.isRealChatRow(v)).toBe(false);
    });
});

describe('sursa — cele trei locuri nu mai pot sa se contrazica', () => {
    test('REGRESIE: reactiile se scriu ca REACTION, nu ca CHAT_REPLY', () => {
        const src = SRC('services/ml/_voice/tradeReaction.js');
        expect(src).toContain("utteranceType: 'REACTION'");
        expect(src).not.toContain("utteranceType: 'CHAT_REPLY'");
    });

    test('REGRESIE: memoria conversatiei filtreaza reactiile', () => {
        // Fara filtru, modelul primea pana la zece replici fara intrebare.
        const src = SRC('services/ml/_voice/chatResponder.js');
        expect(src).toContain('chatHistoryFilter.REAL_CHAT_SQL');
    });

    test('REGRESIE: panoul si NUMARATOAREA folosesc acelasi filtru', () => {
        // Daca doar lista s-ar filtra, caseta ar scrie in continuare 52 de
        // mesaje peste o conversatie de 12 — alt fel de a minti.
        const src = SRC('routes/omega.js');
        const hits = src.split('chatHistoryFilter.REAL_CHAT_SQL').length - 1;
        expect(hits).toBe(2);
    });

    test('filtrul prinde SI randurile vechi, gresit tipizate', () => {
        // 262 de randuri sunt deja in baza cu tipul gresit; fara conditia pe
        // template ar ramane in istoric pentru totdeauna.
        expect(filter.REAL_CHAT_SQL).toContain('template_id');
        expect(filter.REAL_CHAT_SQL).toContain('omega_reaction');
    });
});
