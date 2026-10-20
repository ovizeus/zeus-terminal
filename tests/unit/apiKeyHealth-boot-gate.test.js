'use strict';
// [BOOT-PROBE 2026-10-20] Gasit la auditul manual/autotrade cerut de operator.
//
// Cronul OPS-1 de sanatate a cheilor API trebuie sa ruleze o data pe ZI —
// comentariul lui o spune explicit: „day-tracked via _lastApiHealthCheckDate so
// multiple boots/day don't re-run the probe (cheap but still respects exchange
// API rate limits)".
//
// Dar `_lastApiHealthCheckDate` era o variabila de MODUL, deci nu supravietuia
// unei reporniri. Cu 1109 reporniri, sonda se relua la FIECARE boot: un apel
// semnat in plus per cont de bursa (pe un sistem cu istoric de banuri Binance)
// si un avertisment pe Telegram catre operator la fiecare restart.
//
// Semnatura pe viu: 14 randuri EXCHANGE_KEY_HEALTH_FAIL pe 19 octombrie — exact
// numarul de reload-uri din acea zi — si 2 azi cu o singura pornire de server.

const _atState = new Map();          // supravietuieste „reporniri" (resetModules)
const telegramSend = jest.fn();
let _testKeysCalls = 0;
let _auditRows = [];

jest.mock('../../server/services/database', () => ({
    db: { prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }) },
    atGetState: (k) => (_atState.has(k) ? _atState.get(k) : null),
    atSetState: (k, v) => { _atState.set(k, v); },
    auditLog: (userId, action, details) => { _auditRows.push({ userId, action, details }); },
    listUsers: () => [{ id: 2 }],
    getAllExchanges: () => [{ exchange: 'bybit', mode: 'testnet', api_key_encrypted: 'x', api_secret_encrypted: 'y' }],
    getConnectedExchanges: () => [],
    getExchangeByName: () => null,
    saveExchangeByName: () => 1,
    disconnectExchangeByName: () => {},
}));

jest.mock('../../server/services/encryption', () => ({
    encrypt: (v) => 'enc:' + v,
    // Cheia se decripteaza bine; ceea ce eueaza e PROBA, ca pe viu
    // („Your api key has expired").
    decrypt: (v) => 'plain:' + v,
}));

jest.mock('../../server/services/telegram', () => ({
    sendToUser: telegramSend,
    escapeMarkdown: (s) => s,
}));

jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// `_testBybitKeys` cheama `fetch` DIRECT, deci numaram apelurile de retea.
// E si instrumentarea corecta: dauna reala e un apel in plus catre bursa.
global.fetch = jest.fn(async () => {
    _testKeysCalls++;
    return { ok: true, json: async () => ({ retCode: 10003, retMsg: 'Your api key has expired.' }) };
});

/** Simuleaza o PORNIRE de proces: modulele se reincarca, at_state rameane. */
function bootProcess() {
    jest.resetModules();
    return require('../../server/routes/exchange');
}

describe('gardul de o-data-pe-zi al sondei de chei API', () => {
    beforeEach(() => {
        _atState.clear();
        _auditRows = [];
        _testKeysCalls = 0;
        if (global.fetch && global.fetch.mockClear) global.fetch.mockClear();
        telegramSend.mockClear();
    });

    test('prima rulare sondeaza si noteaza ziua in at_state', async () => {
        const r = bootProcess();
        await r._runApiKeyHealthCheck();

        expect(_testKeysCalls).toBeGreaterThan(0);
        const today = new Date().toISOString().slice(0, 10);
        expect(_atState.get('ops:apiKeyHealthDate')).toBe(today);
        expect(_auditRows.filter(a => a.action === 'EXCHANGE_KEY_HEALTH_FAIL')).toHaveLength(1);
    });

    test('THE FIX: dupa o REPORNIRE in aceeasi zi nu se mai sondeaza', async () => {
        const r1 = bootProcess();
        await r1._runApiKeyHealthCheck();
        const dupaPrima = _testKeysCalls;
        expect(dupaPrima).toBeGreaterThan(0);

        // Reporneste procesul — exact ce facea pm2 reload de 1109 ori.
        const r2 = bootProcess();
        await r2._runApiKeyHealthCheck();

        expect(_testKeysCalls).toBe(dupaPrima);               // zero apeluri noi
        expect(telegramSend).toHaveBeenCalledTimes(1);        // un singur avertisment, nu doua
        expect(_auditRows.filter(a => a.action === 'EXCHANGE_KEY_HEALTH_FAIL')).toHaveLength(1);
    });

    test('a doua rulare in ACELASI proces nu sondeaza nici ea (comportament pastrat)', async () => {
        const r = bootProcess();
        await r._runApiKeyHealthCheck();
        const dupaPrima = _testKeysCalls;
        await r._runApiKeyHealthCheck();
        expect(_testKeysCalls).toBe(dupaPrima);
    });

    test('o zi noua sondeaza din nou — gardul nu blocheaza pe veci', async () => {
        _atState.set('ops:apiKeyHealthDate', '2001-01-01');
        const r = bootProcess();
        await r._runApiKeyHealthCheck();

        expect(_testKeysCalls).toBeGreaterThan(0);
        expect(_atState.get('ops:apiKeyHealthDate')).toBe(new Date().toISOString().slice(0, 10));
    });

    test('at_state care arunca nu opreste sonda (fail-open, nu fail-silent)', async () => {
        const r = bootProcess();
        const dbMock = require('../../server/services/database');
        const orig = dbMock.atGetState;
        dbMock.atGetState = () => { throw new Error('db jos'); };
        try {
            await r._runApiKeyHealthCheck();
            expect(_testKeysCalls).toBeGreaterThan(0);
        } finally { dbMock.atGetState = orig; }
    });
});
