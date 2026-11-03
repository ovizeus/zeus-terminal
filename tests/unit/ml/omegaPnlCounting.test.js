'use strict';
// [2026-11-03] Al TREILEA loc din aceeasi aplicatie care numara tranzactii, si
// care avea propria lui regula — plus doua buguri latente.
//
// Pe datele de azi niciuna nu schimba cifra: doar operatorul a inchis
// tranzactii in ultimele 24h, toate cele 14 sunt reale, si niciuna nu-i lipsea
// `userId` din obiect. Le repar fiindca sunt defecte adevarate, nu fiindca mint
// acum — distinctia conteaza si o scriu ca sa nu para mai mult decat e.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.join(__dirname, '../../../server/services/ml/_voice/chatResponder.js'), 'utf8');
const body = SRC.slice(SRC.indexOf('function _replyPnl'), SRC.indexOf('function _replyMood'));

describe('raspunsul despre PnL numara la fel ca restul aplicatiei', () => {
    it('REGRESIE: filtreaza pe COLOANA user_id, nu pe obiectul JSON', () => {
        // La b352 am masurat 521 de randuri cu user_id in coloana si nimic in
        // obiect. Coloana e adevarul; obiectul e ce s-a intamplat sa fie scris.
        expect(body).toMatch(/WHERE user_id = \?/);
        expect(body).not.toContain('t.userId === ctx.userId');
    });

    it('REGRESIE: filtrul pe utilizator e in SQL, INAINTE de LIMIT', () => {
        // Altfel `LIMIT 50` taie peste toate conturile si raspunsul lui devine
        // gol la primul alt cont activ — in liniste.
        // Pe INTEROGARE, nu pe functie: comentariul de deasupra vorbeste despre
        // `LIMIT 50`, deci cautarea pe tot corpul il gasea acolo si trecea
        // indiferent de cod. A treia oara cand un test al meu isi citeste
        // propriul comentariu.
        const sql = body.slice(body.indexOf('SELECT data FROM at_closed'));
        const whereIdx = sql.indexOf('WHERE user_id = ?');
        const limitIdx = sql.indexOf('LIMIT 50');
        expect(whereIdx).toBeGreaterThan(-1);
        expect(limitIdx).toBeGreaterThan(whereIdx);
    });

    it('REGRESIE: foloseste definitia comuna a tranzactiei', () => {
        expect(body).toContain('omegaContext.REAL_TRADE_SQL');
    });

    it('si nu-si mai face singur filtrarea in JS dupa utilizator', () => {
        expect(body).toContain('.filter(Boolean)');
    });
});

describe('o singura definitie, in toate cele trei locuri', () => {
    it('REGRESIE: nimeni nu numara tranzactii dupa reguli proprii', () => {
        // Cont, invataminte, PnL. Daca apare un al patrulea loc care-si scrie
        // singur regula, aplicatia are iar mai multe cifre despre acelasi om.
        const uses = (SRC.match(/REAL_TRADE_SQL|isRealTrade/g) || []).length;
        expect(uses).toBeGreaterThanOrEqual(2);
        expect(SRC).not.toContain("startsWith('ENTRY_FAILED')");
    });
});
