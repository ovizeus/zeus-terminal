'use strict';

/**
 * [2026-11-07] Refusals must reach telemetry.
 *
 * binanceGateway synthesizes a 503 and returns BEFORE calling fetch for both
 * pre-flight refusals, so neither passed through the telemetry wrapper:
 * errors5xx stayed at 0 while thousands of polls were turned away, and
 * /api/diag/binance-rates reported perfect health. A dashboard that is blind
 * in exactly the situation it exists to report is worse than no dashboard.
 */

const path = require('path');

const TELEM = path.resolve(__dirname, '../../server/services/binanceTelemetry');
const CB = path.resolve(__dirname, '../../server/services/circuitBreaker');
const RL = path.resolve(__dirname, '../../server/services/rateLimiter');

function build({ circuitOpen = false, rateOk = true } = {}) {
    jest.resetModules();
    const recordCall = jest.fn();
    jest.doMock(TELEM, () => ({
        recordCall,
        wrapFetch: jest.fn(async () => ({ status: 200, ok: true, headers: { get: () => null } })),
    }));
    jest.doMock(CB, () => ({
        canRequest: jest.fn(() => !circuitOpen),
        getBackoffMs: jest.fn(() => 1234),
        record: jest.fn(),
        statusAll: jest.fn(() => ({})),
    }));
    jest.doMock(RL, () => ({
        canFetch: jest.fn(() => rateOk),
        reserve: jest.fn(),
        parseHeaders: jest.fn(),
        statusAll: jest.fn(() => ({})),
    }));
    const gw = require('../../server/services/binanceGateway');
    return { gw, recordCall };
}

const URL_K = 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT';

describe('gateway refusals reach telemetry', () => {
    it('records the refusal when the circuit is open', async () => {
        const { gw, recordCall } = build({ circuitOpen: true });
        const res = await gw.fetch(URL_K, { __src: 'marketFeed:alt-klines' });
        expect(res.status).toBe(503);
        expect(res._reason).toBe('circuit_open');
        expect(recordCall).toHaveBeenCalledTimes(1);
        const e = recordCall.mock.calls[0][0];
        expect(e.status).toBe(503);
        expect(e.refused).toBe('circuit_open');
        expect(e.source).toBe('marketFeed:alt-klines');
        expect(e.host).toBe('fapi.binance.com');
        expect(e.path).toBe('/fapi/v1/klines');
    });

    it('records a rate-limit refusal too, and names it separately', async () => {
        const { gw, recordCall } = build({ rateOk: false });
        const res = await gw.fetch(URL_K, { __src: 'marketFeed:alt-klines' });
        expect(res._reason).toBe('rate_limit');
        expect(recordCall.mock.calls[0][0].refused).toBe('rate_limit');
    });

    it('does not record a refusal when the request actually goes out', async () => {
        const { gw, recordCall } = build();
        await gw.fetch(URL_K, { __src: 'x' });
        expect(recordCall).not.toHaveBeenCalled(); // wrapFetch does the recording
    });

    it('charges no weight for a request that never left', async () => {
        const { gw, recordCall } = build({ circuitOpen: true });
        await gw.fetch(URL_K, { __src: 'x', __weight: 10 });
        expect(recordCall.mock.calls[0][0].weight).toBe(0);
    });

    it('survives a url it cannot parse', async () => {
        const { gw, recordCall } = build({ circuitOpen: true });
        const res = await gw.fetch('not a url', { __src: 'x' });
        expect(res.status).toBe(503);
        expect(recordCall.mock.calls[0][0].host).toBe('unknown');
    });

    it('a telemetry failure never breaks the request path', async () => {
        jest.resetModules();
        jest.doMock(TELEM, () => ({ recordCall: () => { throw new Error('ring full'); }, wrapFetch: jest.fn() }));
        jest.doMock(CB, () => ({ canRequest: () => false, getBackoffMs: () => 1, record: jest.fn(), statusAll: () => ({}) }));
        jest.doMock(RL, () => ({ canFetch: () => true, reserve: jest.fn(), parseHeaders: jest.fn(), statusAll: () => ({}) }));
        const gw = require('../../server/services/binanceGateway');
        const res = await gw.fetch(URL_K, { __src: 'x' });
        expect(res.status).toBe(503);
    });
});
