'use strict';
// tests/unit/liq-gate-wiring.test.js
//
// [LIQ-GATE 2026-10-25] Normalizatorul poate fi perfect si sa nu-l cheme
// nimeni — Zeus are deja trei cicatrici pe forma asta (`SMART_CUT`, verdictul
// R1 calculat si necitit, `atPruneClosed` scris si neapelat). Plus una de azi:
// mutatia care a deconectat aducatorul istoricului A SUPRAVIETUIT primei
// variante de teste.
//
// Deci cablarea se verifica: cine conecteaza, cine normalizeaza, cine
// INCHIDE, si cine incarca multiplicatorii inainte sa curga date.

const fs = require('fs');
const path = require('path');

// Doar CODUL: la a treia oara azi cand un test de-al meu s-a agatat de
// propriul meu comentariu, am incetat sa repar instanta.
const AGG = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'services', 'liqFeedAggregator.js'), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

describe('Gate — cablarea in agregator', () => {

    test('fisierul a fost citit si inca are ceilalti conectori (non-vacuitate)', () => {
        expect(AGG.length).toBeGreaterThan(5000);
        expect(AGG).toMatch(/_connectBnb/);
        expect(AGG).toMatch(/_connectOkx/);
    });

    test('exista un conector Gate si e CHEMAT la pornire', () => {
        expect(AGG).toMatch(/function _connectGate/);
        const i = AGG.indexOf('function start');
        expect(i).toBeGreaterThan(-1);
        expect(AGG.slice(i, i + 900)).toMatch(/_connectGate\(\)/);
    });

    test('se aboneaza la canalul PUBLIC, pe toate simbolurile', () => {
        const i = AGG.indexOf('function _connectGate');
        const body = AGG.slice(i, i + 2000);
        expect(body).toMatch(/futures\.public_liquidates/);
        expect(body).toMatch(/!all/);
    });

    test('normalizarea trece prin liqGate — nu o a doua implementare', () => {
        expect(AGG).toMatch(/require\(['"]\.\/liqGate['"]\)/);
        const i = AGG.indexOf('function _connectGate');
        expect(AGG.slice(i, i + 2000)).toMatch(/liqGate\.normalize/);
    });

    test('MULTIPLICATORII se incarca INAINTE de a deschide fluxul', () => {
        // Altfel primele evenimente de dupa boot s-ar arunca degeaba: fara
        // multiplicator, normalize() intoarce null deliberat.
        const i = AGG.indexOf('function start');
        const body = AGG.slice(i, i + 900);
        const m = body.indexOf('_loadGateMultipliers');
        const c = body.indexOf('_connectGate()');
        expect(m).toBeGreaterThan(-1);
        expect(c).toBeGreaterThan(-1);
        expect(m).toBeLessThan(c);   // incarcarea e PRIMA
    });

    test('evenimentele Gate NU sunt contorizate ca Binance', () => {
        // _emitLiq ruteaza dupa `exchange`; fara ramura pentru gate, toate ar
        // fi numarate la bnb — si am fi „reparat" tacerea Binance cu date de
        // pe alta bursa. Exact genul de cifra care minte.
        const i = AGG.indexOf('function _emitLiq');
        expect(AGG.slice(i, i + 500)).toMatch(/'gate'/);
    });

    test('stop() INCHIDE si Gate — altfel ramane o conexiune scursa', () => {
        const i = AGG.indexOf('function stop');
        expect(i).toBeGreaterThan(-1);
        const body = AGG.slice(i, i + 600);
        expect(body).toMatch(/'gate'/);
    });

    test('si temporizatorul de multiplicatori se opreste', () => {
        const i = AGG.indexOf('function stop');
        expect(AGG.slice(i, i + 600)).toMatch(/_gateMultTimer/);
    });

    test('diagnosticul raporteaza Gate, inclusiv cati multiplicatori stie', () => {
        const i = AGG.indexOf('function getState');
        const body = AGG.slice(i, i + 900);
        expect(body).toMatch(/gate:/);
        expect(body).toMatch(/multipliers/);
    });
});
