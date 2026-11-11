'use strict';
/**
 * De ce exista acest test.
 *
 * 11 nov 2026, dupa reload: graficul a aratat "cannot load data (HTTP 502)"
 * timp de 108 secunde. La pornire, propria noastra poarta a refuzat trei
 * cereri de klines Bybit (503 sintetic), iar disjunctorul le-a numarat ca
 * erori ALE BURSEI si s-a deschis: 263 de cereri refuzate, inclusiv rezerva
 * pe Bybit a graficului. Un refuz al nostru nu e o cadere a bursei.
 */
const path = require('path');
const S = (m) => path.join(__dirname, '../../server/services', m);
const URL = 'https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=30&limit=200';

function load(response) {
    jest.resetModules();
    const calls = { n: 0 };
    jest.doMock(S('binanceTelemetry'), () => ({
        wrapFetch: async () => { calls.n++; return response(); },
        recordCall: () => {},
    }));
    const gw = require(S('binanceGateway'));
    require(S('circuitBreaker'))._resetForTest();
    require(S('rateLimiter'))._resetForTest();
    return { gw, calls };
}

const synthetic = () => ({ status: 503, ok: false, _synthetic: true, headers: { get: () => null }, json: async () => ({ synthetic: true, reason: 'warm_class_b' }) });
const real503 = () => ({ status: 503, ok: false, headers: { get: () => null }, json: async () => ({}) });

test('refuzul PROPRIEI porti nu deschide disjunctorul bursei', async () => {
    const { gw, calls } = load(synthetic);
    for (let i = 0; i < 6; i++) await gw.fetch(URL, { __weight: 1, __src: 't' });
    expect(calls.n).toBe(6); // toate au ajuns la poarta; niciuna oprita de disjunctor
    const last = await gw.fetch(URL, { __weight: 1, __src: 't' });
    expect(last._reason).not.toBe('circuit_open');
});

test('REGRESIE: un 503 adevarat al bursei deschide in continuare disjunctorul', async () => {
    const { gw, calls } = load(real503);
    for (let i = 0; i < 6; i++) await gw.fetch(URL, { __weight: 1, __src: 't' });
    expect(calls.n).toBeLessThan(6);
    const last = await gw.fetch(URL, { __weight: 1, __src: 't' });
    expect(last._reason).toBe('circuit_open');
});

test('raspunsul sintetic al portii se declara singur ca sintetic', async () => {
    jest.resetModules();
    jest.dontMock(S('binanceTelemetry'));
    jest.doMock(S('binanceScheduler'), () => ({
        canProceed: () => ({ accept: false, lane: 'P4', pressure: 0.1, retryable: true, reason: 'warm_class_b' }),
        getStats: () => ({}), getActiveCriticalSections: () => [],
    }));
    const telem = require(S('binanceTelemetry'));
    let reached = false;
    const res = await telem.wrapFetch(async () => { reached = true; return { status: 200, ok: true }; }, URL, { __src: 't' });
    expect(reached).toBe(false);
    expect(res.status).toBe(503);
    expect(res._synthetic).toBe(true);
});
