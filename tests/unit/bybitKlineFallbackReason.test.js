'use strict';
/**
 * De ce exista acest test.
 *
 * 11 nov 2026: graficul a aratat "cannot load data (HTTP 502)" pentru ca
 * rezerva pe Bybit a picat — si nimic din log nu spunea de ce.
 * `fetchKlines` intorcea `null` din cinci locuri diferite, iar ruta avea
 * `catch (_) { return null }`. A treia eroare inghitita gasita in aceeasi zi.
 *
 * Regula: fiecare `null` isi lasa motivul, iar ruta il scrie O DATA la cadere
 * si O DATA la revenire — nu la fiecare cerere (au fost 263 intr-un minut).
 */
const path = require('path');
const S = (m) => path.join(__dirname, '../../server/services', m);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-bybit-fallback';

function loadRest(fetchImpl) {
    jest.resetModules();
    jest.doMock(S('binanceGateway'), () => ({ fetch: fetchImpl }));
    return require(S('bybitRest'));
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe('bybitRest.fetchKlines isi lasa motivul la fiecare esec', () => {
    test('interval necunoscut', async () => {
        const br = loadRest(async () => ok({}));
        expect(await br.fetchKlines('BTCUSDT', '7m', 10)).toBeNull();
        expect(br.lastKlineFailure().reason).toBe('unsupported_interval');
    });
    test('poarta arunca', async () => {
        const br = loadRest(async () => { throw new Error('timeout'); });
        expect(await br.fetchKlines('BTCUSDT', '30m', 10)).toBeNull();
        expect(br.lastKlineFailure()).toMatchObject({ reason: 'network', detail: 'timeout' });
    });
    test('disjunctor deschis — motivul portii, nu doar codul', async () => {
        const br = loadRest(async () => ({ ok: false, status: 503, _reason: 'circuit_open' }));
        expect(await br.fetchKlines('BTCUSDT', '30m', 10)).toBeNull();
        expect(br.lastKlineFailure().reason).toBe('circuit_open');
    });
    test('raspuns HTTP rau fara motiv', async () => {
        const br = loadRest(async () => ({ ok: false, status: 502 }));
        await br.fetchKlines('BTCUSDT', '30m', 10);
        expect(br.lastKlineFailure().reason).toBe('http_502');
    });
    test('Bybit raspunde cu eroare proprie', async () => {
        const br = loadRest(async () => ok({ retCode: 10006, retMsg: 'Too many visits' }));
        await br.fetchKlines('BTCUSDT', '30m', 10);
        expect(br.lastKlineFailure()).toMatchObject({ reason: 'retCode_10006', detail: 'Too many visits' });
    });
    test('lista goala', async () => {
        const br = loadRest(async () => ok({ retCode: 0, result: { list: [] } }));
        await br.fetchKlines('BTCUSDT', '30m', 10);
        expect(br.lastKlineFailure().reason).toBe('empty');
    });
    test('un succes STERGE motivul vechi', async () => {
        let bad = true;
        const row = ['1700000000000', '1', '2', '0.5', '1.5', '10', '15'];
        const br = loadRest(async () => (bad ? { ok: false, status: 503 } : ok({ retCode: 0, result: { list: [row] } })));
        await br.fetchKlines('BTCUSDT', '30m', 10);
        expect(br.lastKlineFailure()).not.toBeNull();
        bad = false;
        expect(await br.fetchKlines('BTCUSDT', '30m', 10)).toHaveLength(1);
        expect(br.lastKlineFailure()).toBeNull();
    });
});

describe('ruta scrie pe MUCHIE, nu la fiecare cerere', () => {
    const { fallbackEdge } = require('../../server/routes/marketProxy');
    test('prima cadere se scrie, urmatoarele NU', () => {
        let st = { failing: false };
        let r = fallbackEdge(st, false, 'circuit_open'); st = r.state;
        expect(r.log).toEqual({ level: 'warn', msg: expect.stringContaining('circuit_open') });
        for (let i = 0; i < 262; i++) { r = fallbackEdge(st, false, 'circuit_open'); st = r.state; expect(r.log).toBeNull(); }
    });
    test('revenirea se scrie o data', () => {
        let r = fallbackEdge({ failing: true, reason: 'circuit_open' }, true, null);
        expect(r.log.level).toBe('info');
        r = fallbackEdge(r.state, true, null);
        expect(r.log).toBeNull();
    });
    test('schimbarea motivului in timpul caderii se scrie', () => {
        const r = fallbackEdge({ failing: true, reason: 'circuit_open' }, false, 'retCode_10006');
        expect(r.log.msg).toContain('retCode_10006');
    });
    test('mesajele sunt in engleza si nu spun "Binance"', () => {
        const r = fallbackEdge({ failing: false }, false, 'network');
        expect(r.log.msg).toMatch(/^Bybit kline fallback unavailable/);
    });
});
