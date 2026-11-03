'use strict';
// [2026-11-03] Separatorul cheii de celula, gresit in DOUA locuri.
//
// E `:` — `1:DEMO:BNBUSDT:BREAKOUT`. Scris de mana cu bara verticala,
// interogarea intoarce zero randuri MEREU si raspunsul iese linistit si fals.
// La b366 am reparat prima aparitie (predictivitate) si am RATAT clasa: a doua
// (invataminte) inca spunea "bandit cells: cold" desi exista celule cu 36, 29,
// 27 si 20 de observatii.
//
// Cartea are deja lectia asta scrisa, de la escaparea pentru Telegram: cand
// gasesti un bug de FORMA, cauta toate locurile care scriu forma aia.
const C = require('../../../server/services/ml/_voice/omegaContext');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.join(__dirname, '../../../server/services/ml/_voice/chatResponder.js'), 'utf8');

describe('cellKeyPrefix', () => {
    it('REGRESIE: separatorul e doua puncte, nu bara verticala', () => {
        expect(C.cellKeyPrefix(1, 'BTCUSDT')).toBe('1:%:BTCUSDT:%');
        expect(C.cellKeyPrefix(1)).toBe('1:%');
        expect(C.cellKeyPrefix(1, 'BTCUSDT')).not.toContain('|');
    });

    it('se potriveste cu forma reala a cheilor', () => {
        // Cheile de pe sistemul viu.
        const keys = ['1:DEMO:BNBUSDT:BREAKOUT', '1:TESTNET:BTCUSDT:TREND'];
        const like = (pattern, key) =>
            new RegExp('^' + pattern.split('%').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(key);
        expect(like(C.cellKeyPrefix(1), keys[0])).toBe(true);
        expect(like(C.cellKeyPrefix(1, 'BTCUSDT'), keys[1])).toBe(true);
        expect(like(C.cellKeyPrefix(1, 'BTCUSDT'), keys[0])).toBe(false);
    });

    it('parseCellKey desparte cu acelasi separator', () => {
        expect(C.parseCellKey('1:TESTNET:BTCUSDT:TREND'))
            .toEqual({ userId: '1', env: 'TESTNET', symbol: 'BTCUSDT', regime: 'TREND' });
    });

    it('gunoi la intrare nu arunca', () => {
        expect(C.parseCellKey(null).regime).toBeNull();
        expect(C.cellKeyPrefix(null)).toBe(':%');
    });
});

describe('nimeni nu-si mai scrie singur prefixul', () => {
    it('REGRESIE: ambele interogari folosesc constructorul comun', () => {
        const uses = (SRC.match(/omegaContext\.cellKeyPrefix\(/g) || []).length;
        expect(uses).toBe(2);
    });

    it('REGRESIE: nicio cheie construita de mana cu bara verticala', () => {
        expect(SRC).not.toMatch(/\$\{userId\}\|%/);
        expect(SRC).not.toMatch(/\$\{ctx\.userId\}\|%/);
    });
});

describe('eticheta spune ce fereastra e, nu ca e totul', () => {
    it('REGRESIE: nu mai pretinde ca numarul e totalul', () => {
        // Zicea "am 382 trade-uri inchise" cand are 1.366 — numarul e corect
        // pentru fereastra lui (ultimele 500 de randuri), dar propozitia nu.
        expect(SRC).toContain('din ultimele ${trades.length} trade-uri închise');
        expect(SRC).toContain('over the last ${trades.length} closed trades');
        expect(SRC).not.toContain('am ${trades.length} trade-uri închise. overall');
    });
});
