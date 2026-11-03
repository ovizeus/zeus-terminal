'use strict';
// [2026-11-03] Un sablon care arunca nu are voie sa omoare raspunsul.
//
// Sunt 27 de intentii, fiecare citind altceva — carte de ordine, ziduri,
// indicatori, structura, fundamentale. Un singur camp lipsa intr-un rand si un
// `.toFixed` de pe el arunca, iar pana azi exceptia urca pana in ruta si
// operatorul ramane FARA NICIUN raspuns.
//
// Nu e un bug vazut pe viu: l-am gasit proband sabloanele cu date calde.
// Tocmai de aceea merita acoperit — un singur rand malformat, oriunde in 27 de
// locuri, inseamna tacere completa, iar tacerea e simptomul cel mai greu de
// diagnosticat (vezi b356: „chatul nu raspunde").
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.join(__dirname, '../../../server/services/ml/_voice/chatResponder.js'), 'utf8');

describe('scutul pe intentii', () => {
    it('REGRESIE: lantul CU FLUX prinde o intentie care arunca', () => {
        const i = SRC.indexOf('let localResult = null;');
        expect(i).toBeGreaterThan(-1);
        const near = SRC.slice(i, i + 400);
        expect(near).toContain('try {');
        expect(near).toContain('_tryLocalIntent');
        expect(near).toContain('catch');
    });

    it('REGRESIE: si lantul FARA FLUX face la fel', () => {
        // Daca doar unul e protejat, operatorul primeste tacere pe telefon si
        // un raspuns in teste — exact driftul pe care l-am inchis la b362.
        const i = SRC.indexOf('result = await _respondImpl(');
        expect(i).toBeGreaterThan(-1);
        const before = SRC.slice(Math.max(0, i - 300), i);
        expect(before).toContain('try {');
    });

    it('caderea e catre MODEL, nu catre un mesaj de eroare', () => {
        // Modelul are oricum toate datele in context; un "a aparut o eroare"
        // nu ajuta pe nimeni.
        const i = SRC.indexOf('intent threw, falling back');
        expect(i).toBeGreaterThan(-1);
        expect(SRC.slice(i, i + 300)).toContain('_replyLLMFallback');
    });

    it('logarea foloseste conventia fisierului, nu un logger inexistent', () => {
        // `logger` nu e importat aici; fisierul il foloseste doar aparat.
        const guarded = (SRC.match(/typeof logger !== 'undefined'/g) || []).length;
        expect(guarded).toBeGreaterThanOrEqual(3);
    });
});
