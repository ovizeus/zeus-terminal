'use strict';
// tests/unit/liq-predict-wiring.test.js
//
// [LIQ-PREDICT 2026-10-26] Un semnal corect intr-un modul pe care NIMENI nu-l
// porneste e cod mort — exact capcana SMART_CUT, si exact felul in care mi-a
// supravietuit o mutatie pe 25 octombrie (scosesem un setInterval si n-a cazut
// nimic). Testele de aici apara LANTUL: serviciul e pornit la boot, ruta
// exista, retentia e programata, si serviciul chiar cheama ce trebuie.
//
// ⚠️ COMENTARIILE SUNT FILTRATE inainte de citire. De TREI ori am scris teste
// care se agatau de propriile mele comentarii si treceau fara ca codul sa faca
// nimic; filtrul e aparara impotriva mea.

const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const SERVER = read('server.js');
const ROUTE = read('server', 'routes', 'market.js');
const SVC = read('server', 'services', 'liqPredictService.js');

describe('serviciul e PORNIT la boot, nu doar scris', () => {
    test('fisierele au fost citite (non-vacuitate)', () => {
        expect(SERVER.length).toBeGreaterThan(10000);
        expect(ROUTE.length).toBeGreaterThan(1000);
        expect(SVC.length).toBeGreaterThan(1000);
    });

    test('server.js cheama liqPredictService.start()', () => {
        expect(SERVER).toMatch(/liqPredictService['"]\)\s*\.start\(\)/);
    });

    test('retentia instantaneelor e PROGRAMATA, nu doar definita', () => {
        expect(SERVER).toMatch(/_runLiqPredictPrune/);
        expect(SERVER).toMatch(/setInterval\(_runLiqPredictPrune/);
        expect(SERVER).toMatch(/setTimeout\(_runLiqPredictPrune/);
    });

    test('pornirea serviciului NU poate darama boot-ul', () => {
        // Ancora de prima incercare era "liqPredictService');" — nu exista in
        // cod, fiindca apelul e `...liqPredictService').start()`. indexOf da -1
        // si testul cadea pe o cablare CORECTA. A patra oara cand un test al
        // meu se inseala, nu codul.
        const i = SERVER.indexOf('liqPredictService');
        expect(i).toBeGreaterThan(-1);
        expect(SERVER.slice(Math.max(0, i - 400), i)).toMatch(/try\s*\{/);
    });
});

describe('ruta exista si e marginita', () => {
    test('GET /liq-predict e inregistrata', () => {
        expect(ROUTE).toMatch(/router\.get\(\s*['"]\/liq-predict['"]/);
    });

    test('nu intoarce 500 pe eroare — un panou gol e onest', () => {
        const i = ROUTE.indexOf("'/liq-predict'");
        const body = ROUTE.slice(i, i + 2000);
        expect(body).toMatch(/status\(200\)/);
        expect(body).not.toMatch(/status\(500\)/);
    });

    test('simbolurile cerute sunt FILTRATE pe lista permisa', () => {
        const i = ROUTE.indexOf("'/liq-predict'");
        const body = ROUTE.slice(i, i + 2000);
        expect(body).toMatch(/svc\.SYMBOLS\.includes/);
        expect(body).toMatch(/slice\(0,\s*\d+\)/);
    });
});

describe('serviciul leaga chiar piesele care trebuie', () => {
    test('citeste lichidari MASURATE, nu un model', () => {
        expect(SVC).toMatch(/liqStore\.events\(/);
    });

    test('SALVEAZA semnalul — altfel procentul n-ar putea fi numarat niciodata', () => {
        const i = SVC.indexOf('async function tick');
        expect(i).toBeGreaterThan(-1);
        expect(SVC.slice(i, i + 1200)).toMatch(/store\.record\(/);
    });

    test('REZOLVA scadentele din klines reale', () => {
        expect(SVC).toMatch(/store\.due\(/);
        expect(SVC).toMatch(/fetchKlines\(/);
        expect(SVC).toMatch(/store\.resolveWith\(/);
    });

    test('tick-ul e programat periodic, nu chemat o singura data', () => {
        const i = SVC.indexOf('function start');
        const body = SVC.slice(i, i + 700);
        expect(body).toMatch(/setInterval\(/);
        expect(body).toMatch(/tick\(/);
    });

    test('temporizatoarele sunt unref — nu tin procesul in viata la oprire', () => {
        const i = SVC.indexOf('function start');
        expect(SVC.slice(i, i + 700)).toMatch(/unref\(\)/);
    });

    test('stop() OPRESTE intervalul — altfel se scurg la fiecare repornire de serviciu', () => {
        const i = SVC.indexOf('function stop');
        expect(SVC.slice(i, i + 300)).toMatch(/clearInterval\(/);
    });

    test('contextul Binance trece prin GATEWAY, nu pe lângă limitatorul de rata', () => {
        const CTXS = read('server', 'services', 'liqPredictContext.js');
        expect(CTXS).toMatch(/binanceGateway['"]\)\.fetch\(/);
        expect(CTXS).not.toMatch(/^\s*(await\s+)?fetch\(/m);
    });

    test('doar BTC si ETH — un procent pe 3 cazuri ar fi exact „fake"-ul interzis', () => {
        expect(SVC).toMatch(/SYMBOLS = \['BTCUSDT', 'ETHUSDT'\]/);
    });
});

describe('⛔ modulele se INCARCA — nu doar arata bine in sursa', () => {
    // [2026-10-26] Serviciul a picat la pornire cu „Cannot find module
    // '../utils/logger'". Testele de mai sus citeau TEXTUL sursei si treceau
    // toate; nimic nu dovedea ca require-urile se rezolva. L-am prins uitandu-ma
    // in loguri dupa reload, adica prea tarziu — aceeasi clasa cu „fix livrat in
    // cod mort" de la b285.
    //
    // Un test care incarca modulul chiar prinde asta. Pur: niciunul din cele
    // trei nu porneste nimic la require.
    test('liqPredict se incarca si expune ce trebuie', () => {
        const m = require('../../server/services/liqPredict');
        for (const fn of ['score', 'target', 'evaluate', 'buildBaseline', 'hitRate', 'lift', 'decayedUsd', 'weight']) {
            expect(typeof m[fn]).toBe('function');
        }
    });

    test('liqPredictContext se incarca', () => {
        const m = require('../../server/services/liqPredictContext');
        expect(typeof m.getContext).toBe('function');
    });

    test('liqPredictService se incarca si expune start/stop/tick', () => {
        const m = require('../../server/services/liqPredictService');
        for (const fn of ['start', 'stop', 'tick', 'computeFor', 'lastFor']) {
            expect(typeof m[fn]).toBe('function');
        }
        expect(m.SYMBOLS).toEqual(['BTCUSDT', 'ETHUSDT']);
    });

    test('ruta de piaţa se incarca (require-urile ei se rezolva)', () => {
        const r = require('../../server/routes/market');
        expect(typeof r).toBe('function');
    });
});

describe('ruta e CHIAR inregistrata in router, nu doar scrisa', () => {
    // Sondarea cu curl da 401 si pentru /liq-predict si pentru o ruta
    // inexistenta, fiindca autentificarea e inaintea rutarii. Deci 401 NU
    // dovedeste ca ruta exista. Stiva routerului o dovedeste.
    test('/liq-predict e in stiva, si e GET', () => {
        const router = require('../../server/routes/market');
        const paths = (router.stack || [])
            .filter(l => l.route)
            .map(l => ({ path: l.route.path, methods: Object.keys(l.route.methods) }));
        const hit = paths.find(p => p.path === '/liq-predict');
        expect(hit).toBeTruthy();
        expect(hit.methods).toContain('get');
    });

    test('celelalte rute de lichidari sunt inca acolo (non-vacuitate)', () => {
        const router = require('../../server/routes/market');
        const paths = (router.stack || []).filter(l => l.route).map(l => l.route.path);
        expect(paths).toContain('/liq-panel');
        expect(paths).toContain('/liq-map');
    });
});
