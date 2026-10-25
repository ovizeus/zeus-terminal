'use strict';
// tests/unit/liq-history-wiring.test.js
//
// [LIQ-HISTORY 2026-10-25] Modulul care ţine minte lichidările e inutil dacă
// nimeni nu-l cheamă. Zeus are deja trei cicatrici exact pe forma asta:
// `SMART_CUT` era cod mort în spatele unui comutator care părea pornit,
// verdictul R1 se calcula şi nu-l citea nimeni, iar `atPruneClosed` e scris şi
// neapelat. Deci cablarea se verifică, nu se presupune.
//
// Trei verigi: cine SCRIE, cine CURĂŢĂ, cine SERVEŞTE.

const fs = require('fs');
const path = require('path');

const SRV = path.join(__dirname, '..', '..', 'server');
// A TREIA oara azi cand un test de-al meu se agata de propriul meu comentariu:
// scrisesem „liqStore.record nu arunca niciodata" deasupra apelului, iar testul
// gasea acolo numele si concluziona ca lipseste `try`. Nu mai e un accident, e
// un TIPAR — asa ca se repara pe clasa: cand verific CODUL, citesc codul.
function codeOnly(src) {
    return src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
}

const AGG = codeOnly(fs.readFileSync(path.join(SRV, 'services', 'liqFeedAggregator.js'), 'utf8'));
const MARKET = codeOnly(fs.readFileSync(path.join(SRV, 'routes', 'market.js'), 'utf8'));
const SERVER = codeOnly(fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8'));

describe('veriga 1 — cine SCRIE', () => {
    test('agregatorul cere modulul de istoric', () => {
        expect(AGG).toMatch(/require\(['"]\.\/liqStore['"]\)/);
    });

    test('scrie pe calea prin care trece FIECARE eveniment', () => {
        // _emitLiq e punctul unic prin care trec toate cele 3 burse.
        const i = AGG.indexOf('function _emitLiq');
        expect(i).toBeGreaterThan(-1);
        const end = AGG.indexOf('\n}', i);
        const body = AGG.slice(i, end);
        expect(body).toMatch(/liqStore\.record|_record\(/);
    });

    test('scrierea nu poate darama fluxul — e inchisa intr-un try', () => {
        const i = AGG.indexOf('function _emitLiq');
        const body = AGG.slice(i, AGG.indexOf('\n}', i));
        const j = body.search(/liqStore\.record|_record\(/);
        expect(body.slice(0, j)).toMatch(/try\s*\{/);
    });
});

describe('veriga 2 — cine CURATA', () => {
    test('retentia e programata in server.js, nu doar scrisa', () => {
        expect(SERVER).toMatch(/liqStore/);
        const i = SERVER.indexOf('liqStore');
        expect(SERVER.slice(i - 400, i + 400)).toMatch(/prune/);
    });

    test('ruleaza si la boot, nu doar pe interval — un proces care reporneste zilnic n-ar curata niciodata', () => {
        // Exact lectia de la brain-decisions-prune-runs-at-boot.
        const i = SERVER.indexOf('_runLiqPrune');
        expect(i).toBeGreaterThan(-1);
        expect(SERVER).toMatch(/setTimeout\(_runLiqPrune,\s*\d+\)/);
        expect(SERVER).toMatch(/setInterval\(_runLiqPrune,\s*\d+\)/);
    });
});

describe('veriga 3 — cine SERVESTE', () => {
    test('exista ruta de harta', () => {
        expect(MARKET).toMatch(/router\.get\(['"]\/liq-map['"]/);
    });

    test('ruta citeste simbolul, referinta si fereastra din cerere', () => {
        const i = MARKET.indexOf("'/liq-map'");
        const body = MARKET.slice(i, i + 900);
        expect(body).toMatch(/req\.query/);
        expect(body).toMatch(/symbol/);
        expect(body).toMatch(/ref/);
        expect(body).toMatch(/days/);
    });

    test('ruta nu poate arunca 500 pe o cerere stricata', () => {
        const i = MARKET.indexOf("'/liq-map'");
        expect(MARKET.slice(i, i + 900)).toMatch(/try\s*\{/);
    });

    test('fisierele au fost chiar citite (garda impotriva unei treceri in gol)', () => {
        expect(AGG.length).toBeGreaterThan(5000);
        expect(MARKET.length).toBeGreaterThan(1000);
        expect(SERVER.length).toBeGreaterThan(50000);
    });
});
