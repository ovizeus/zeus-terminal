'use strict';
// tests/unit/bookmap-wiring.test.js
//
// [BOOKMAP 2026-10-26] Testele pe sursa dovedesc lantul; cele care INCARCA
// modulul dovedesc ca require-urile se rezolva. Lectia de ieri: serviciul
// PREDICT a plecat MORT cu „Cannot find module ../utils/logger" iar toate cele
// 15 teste de cablare treceau, fiindca citeau TEXTUL sursei.
//
// ⚠️ COMENTARIILE SUNT FILTRATE inainte de citire — de patru ori am scris teste
// care se agatau de propriile mele comentarii.

const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const FEED = read('server', 'services', 'bookFeed.js');
const SERVER = read('server.js');
const ROUTE = read('server', 'routes', 'market.js');

// Corpul EXACT al unei rute, pana la urmatoarea. Feliile pe numar de caractere
// s-au dovedit fragile: cand am adaugat `trades` si `liqs`, o felie fixa
// ajungea in ruta urmatoare (de unde un `status(500)` strain) si `} catch`
// nimerea INTR-UNA din functiile adaugate, nu in prinderea rutei.
function routeBody(src, routePath) {
    const i = src.indexOf("'" + routePath + "'");
    if (i < 0) return '';
    const next = src.indexOf('\nrouter.', i);
    return src.slice(i, next > 0 ? next : src.length);
}

describe('⛔ modulele se INCARCA (lectia de la serviciul PREDICT mort)', () => {
    test('bookMap se incarca si expune ce trebuie', () => {
        const m = require('../../server/services/bookMap');
        for (const fn of ['normalize', 'aggregate', 'heat', 'walls']) {
            expect(typeof m[fn]).toBe('function');
        }
    });

    test('bookFeed se incarca si expune start/stop/health', () => {
        const m = require('../../server/services/bookFeed');
        for (const fn of ['start', 'stop', 'health', 'deepFrames', 'topFrames']) {
            expect(typeof m[fn]).toBe('function');
        }
        expect(m.SYMBOLS).toEqual(['BTCUSDT', 'ETHUSDT']);
    });

    test('health() merge inainte de start si NU arunca', () => {
        const m = require('../../server/services/bookFeed');
        const h = m.health();
        expect(h.running).toBe(false);
        expect(h.symbols.BTCUSDT).toEqual({ deep: 0, top: 0 });
    });

    test('cererea de cadre pentru un simbol necunoscut da lista goala', () => {
        const m = require('../../server/services/bookFeed');
        expect(m.deepFrames('NUEXISTA')).toEqual([]);
        expect(m.topFrames(null)).toEqual([]);
    });
});

describe('cele doua surse sunt tinute SEPARAT — altfel harta minte', () => {
    // WS are 40 de niveluri pe ±0,005%; REST are 2000 pe ±0,155%. Amestecate
    // in aceeasi medie, randurile de langa pret ar primi contributii din
    // amandoua si cele departate numai din REST: densitatea desenata ar
    // depinde de PROPORTIA cadrelor, nu de piata.
    test('exista DOUA inele distincte, si doua citiri distincte', () => {
        expect(FEED).toMatch(/_deep\s*=\s*new Map/);
        expect(FEED).toMatch(/_top\s*=\s*new Map/);
        expect(FEED).toMatch(/function deepFrames/);
        expect(FEED).toMatch(/function topFrames/);
    });

    test('cadrele WS merg in inelul de SUS, nu in cel adanc', () => {
        const i = FEED.indexOf('_ws.on(\'message\'');
        const body = FEED.slice(i, i + 1600);
        expect(body).toMatch(/_push\(_top,/);
        expect(body).not.toMatch(/_push\(_deep,/);
    });

    test('cadrele REST merg in inelul ADANC', () => {
        const i = FEED.indexOf('async function _deepTick');
        expect(FEED.slice(i, i + 600)).toMatch(/_push\(_deep,/);
    });
});

describe('multiplicatorul e EXPLICIT (lectia Gate)', () => {
    test('ambele cai trec mult: 1, nu se bazeaza pe implicit', () => {
        const ocurente = (FEED.match(/mult:\s*1/g) || []).length;
        expect(ocurente).toBeGreaterThanOrEqual(2);
    });

    test('nu exista nicio chemare de normalize fara mult', () => {
        const chemari = FEED.match(/BM\.normalize\(\{[\s\S]*?\}\)/g) || [];
        expect(chemari.length).toBeGreaterThanOrEqual(2);
        for (const c of chemari) expect(c).toMatch(/mult:/);
    });
});

describe('costul de rata e stapanit, nu sperat', () => {
    test('trece prin binanceGateway, nu pe langa limitator', () => {
        expect(FEED).toMatch(/binanceGateway['"]\)\.fetch\(/);
        expect(FEED).not.toMatch(/^\s*(await\s+)?fetch\(/m);
    });

    test('greutatea declarata pe cerere e cea reala a endpointului (20)', () => {
        const i = FEED.indexOf('__src: \'bookmap:depth\'');
        expect(i).toBeGreaterThan(-1);
        expect(FEED.slice(Math.max(0, i - 200), i + 100)).toMatch(/__weight:\s*20/);
    });

    test('ritmul se INCETINESTE cand greutatea raportata de Binance urca', () => {
        // Logica a trecut in _intervalFor cand am adaugat ritmul la cerere;
        // comportamentul e apărat de testele pe _intervalFor de mai jos.
        expect(FEED).toMatch(/x-mbx-used-weight-1m/);
        expect(FEED).toMatch(/WEIGHT_SLOW_AT/);
        const i = FEED.indexOf('const next =');
        expect(i).toBeGreaterThan(-1);
        expect(FEED.slice(i, i + 160)).toMatch(/_intervalFor\(/);
        const j = FEED.indexOf('function _intervalFor');
        expect(FEED.slice(j, j + 400)).toMatch(/DEEP_MS_SLOW/);
    });

    test('cadrele WS sunt SUBESANTIONATE — 10 pe secunda n-au ce cauta in RAM', () => {
        expect(FEED).toMatch(/WS_SAMPLE_MS/);
        const i = FEED.indexOf('_lastWs.get(sym)');
        expect(i).toBeGreaterThan(-1);
        expect(FEED.slice(i - 80, i + 120)).toMatch(/return/);
    });

    test('inelele au plafon DUR de memorie, nu doar de timp', () => {
        expect(FEED).toMatch(/RING_MAX/);
        const i = FEED.indexOf('function _push');
        expect(FEED.slice(i, i + 400)).toMatch(/arr\.length > maxN/);
    });
});

describe('pornirea si oprirea', () => {
    test('server.js porneste fluxul, in try', () => {
        expect(SERVER).toMatch(/bookFeed['"]\)\s*\.start\(\)/);
        const i = SERVER.indexOf('bookFeed');
        expect(SERVER.slice(Math.max(0, i - 400), i)).toMatch(/try\s*\{/);
    });

    test('stop() inchide WS-ul SI ambele temporizatoare — altfel se scurg', () => {
        const i = FEED.indexOf('function stop');
        const body = FEED.slice(i, i + 500);
        expect(body).toMatch(/clearTimeout\(_wsTimer\)/);
        expect(body).toMatch(/clearTimeout\(_deepTimer\)/);
        expect(body).toMatch(/_ws\.close\(\)/);
    });

    test('temporizatoarele sunt unref — nu tin procesul in viata', () => {
        expect((FEED.match(/\.unref\(\)/g) || []).length).toBeGreaterThanOrEqual(3);
    });
});

describe('ruta', () => {
    test('GET /bookmap e inregistrata in stiva routerului', () => {
        const router = require('../../server/routes/market');
        const paths = (router.stack || []).filter(l => l.route)
            .map(l => ({ p: l.route.path, m: Object.keys(l.route.methods) }));
        const hit = paths.find(x => x.p === '/bookmap');
        expect(hit).toBeTruthy();
        expect(hit.m).toContain('get');
    });

    test('celelalte rute sunt inca acolo (non-vacuitate)', () => {
        const router = require('../../server/routes/market');
        const paths = (router.stack || []).filter(l => l.route).map(l => l.route.path);
        expect(paths).toContain('/liq-panel');
        expect(paths).toContain('/liq-predict');
    });

    test('nu intoarce 500 pe eroare — un panou gol e onest', () => {
        const body = routeBody(ROUTE, '/bookmap');
        expect(body).toMatch(/status\(200\)/);
        expect(body).not.toMatch(/status\(500\)/);
    });

    test('parametrii de ZOOM sunt marginiti FIECARE, nu trecuti orbeste', () => {
        // Prima versiune a testului cerea doar sa existe un Math.min pe undeva
        // in ruta — si trecea, fiindca `band` si `window` il satisfaceau singuri
        // in timp ce cols/rows plecau nemarginite. O cerere cu rows=1e9 ajunge
        // in bucle si alocari, deci e o cale de a inghetat serverul.
        const body = routeBody(ROUTE, '/bookmap');
        // Bucla de la prima incercare cauta `const window`, dar in cod e
        // `windowMs` — cadea pe o ruta CORECTA. A cincea data cand un test al
        // meu se inseala, nu codul. Rămân cele trei verificari precise.
        expect(body).toMatch(/const cols = Math\.max\([^)]*Math\.min\(/);
        expect(body).toMatch(/const rows = Math\.max\([^)]*Math\.min\(/);
        expect(body).toMatch(/const windowMs = Math\.max\([^)]*Math\.min\(/);
    });
});

describe('⛔ CEREREA LA CERERE — masurat pe viu, mergea continuu degeaba', () => {
    // [2026-10-26] Dupa reload am masurat greutatea raportata de Binance la
    // fiecare 10 secunde: 268, 492, 804, 1031, 1255 — adica ~1.380 pe minut,
    // 57% din plafon, de la 748 (31%) inainte. Si interogarea adanca mergea
    // CONTINUU, din boot, chiar cand nimeni nu avea rubrica deschisa.
    //
    // Reparat: ritmul e la CERERE. Rapid cat timp cineva se uita, lent in rest,
    // ca sa existe mereu un istoric minim. Costul de baza scade de la 480/min
    // la 80/min.
    test('exista o notiune de CERERE, si ruta o anunta', () => {
        expect(FEED).toMatch(/_lastDemand/);
        expect(FEED).toMatch(/function noteDemand/);
        expect(ROUTE).toMatch(/noteDemand\(/);
    });

    test('noteDemand e exportat si se poate chema fara sa arunce', () => {
        const m = require('../../server/services/bookFeed');
        expect(typeof m.noteDemand).toBe('function');
        expect(() => m.noteDemand()).not.toThrow();
    });

    test('ritmul ALEGE intre rapid si lent dupa cerere', () => {
        const m = require('../../server/services/bookFeed');
        const now = 1793000000000;
        expect(m._intervalFor(now, now - 1000, 0)).toBe(m.DEEP_MS);
        expect(m._intervalFor(now, now - 10 * 60000, 0)).toBe(m.DEEP_MS_IDLE);
        expect(m._intervalFor(now, null, 0)).toBe(m.DEEP_MS_IDLE);
    });

    test('ritmul LENT nu e oprire — istoricul minim trebuie sa existe', () => {
        const m = require('../../server/services/bookFeed');
        expect(m.DEEP_MS_IDLE).toBeGreaterThan(m.DEEP_MS);
        expect(m.DEEP_MS_IDLE).toBeLessThanOrEqual(60000);
    });

    test('greutatea mare BATE cererea — un ban pe tot Zeus e mai rau', () => {
        const m = require('../../server/services/bookFeed');
        const now = 1793000000000;
        expect(m._intervalFor(now, now - 1000, m.WEIGHT_SLOW_AT + 10)).toBe(m.DEEP_MS_SLOW);
    });

    test('costul de baza scade sub un sfert din cel de dinainte', () => {
        const m = require('../../server/services/bookFeed');
        const perMin = (ms) => (60000 / ms) * 20 * m.SYMBOLS.length;
        expect(perMin(m.DEEP_MS_IDLE)).toBeLessThan(perMin(m.DEEP_MS) / 4);
        expect(perMin(m.DEEP_MS_IDLE)).toBeLessThan(150);
    });
});
