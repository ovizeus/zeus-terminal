'use strict';

/**
 * [2026-11-07] End-to-end proof of the new circuit log, without waiting for a
 * real upstream failure.
 *
 * After shipping the fix I could only report "zero lines of the old flood",
 * which proved nothing had broken — not that the new format works, because the
 * breaker never opened in those minutes. This drives the REAL gateway and the
 * REAL breaker and reads the actual lines that come out. Only the network is
 * faked.
 *
 * Two mistakes of mine are worth recording, because both would have made this
 * test lie: the circuit key is the LAST path segment ("klines"), not the full
 * path, and calling jest.resetModules() mid-test rebuilt the breaker and threw
 * away the very state under examination.
 */

const path = require('path');

const TELEM = path.resolve(__dirname, '../../server/services/binanceTelemetry');
const URL_K = 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m';
const KEY_ENDPOINT = 'klines';   // _extractEndpoint takes the last segment

function circuitLines(spy) {
    return spy.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('"_t":"CIRCUIT"'))
        .map((l) => JSON.parse(l));
}

describe('a whole outage, end to end', () => {
    let gw, cb, spy, recorded, upstreamOk;

    beforeEach(() => {
        jest.resetModules();
        recorded = [];
        upstreamOk = false;
        jest.doMock(TELEM, () => ({
            recordCall: (e) => recorded.push(e),
            // one mock, flipped by a variable — resetting modules here would
            // rebuild the breaker and lose the state being tested
            wrapFetch: async () => (upstreamOk
                ? { status: 200, ok: true, headers: { get: () => null } }
                : { status: 503, ok: false, headers: { get: () => null } }),
        }));
        gw = require('../../server/services/binanceGateway');
        cb = require('../../server/services/circuitBreaker');
        cb._resetForTest();
        spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => spy.mockRestore());

    async function tripBreaker() {
        for (let i = 0; i < 3; i++) await gw.fetch(URL_K, { __src: 'marketFeed:alt-klines' });
    }
    async function waitOutOpenWindow() {
        const c = cb.status('binance', KEY_ENDPOINT);
        const wait = Math.max(0, (c.openUntil || 0) - Date.now()) + 10;
        await new Promise((r) => setTimeout(r, Math.min(wait, 12000)));
    }

    it('21 pollers through one failing endpoint produce TWO lines, not thousands', async () => {
        await tripBreaker();
        // the fleet keeps polling while it is open: 21 pollers, 10 cycles
        for (let i = 0; i < 21 * 10; i++) await gw.fetch(URL_K, { __src: 'marketFeed:alt-klines' });

        upstreamOk = true;
        await waitOutOpenWindow();
        await gw.fetch(URL_K, { __src: 'marketFeed:alt-klines' });

        const lines = circuitLines(spy);
        expect(lines.filter((l) => l.event === 'open')).toHaveLength(1);
        const recs = lines.filter((l) => l.event === 'recovered');
        expect(recs).toHaveLength(1);
        expect(lines).toHaveLength(2);                 // the entire episode
        expect(recs[0].refused).toBeGreaterThan(100);  // it counted the fleet
        expect(typeof recs[0].openMs).toBe('number');
    }, 30000);

    it('every refused poll reaches telemetry, which used to see none of them', async () => {
        await tripBreaker();
        const before = recorded.filter((e) => e.refused === 'circuit_open').length;
        for (let i = 0; i < 25; i++) await gw.fetch(URL_K, { __src: 'marketFeed:alt-klines' });
        const after = recorded.filter((e) => e.refused === 'circuit_open').length;
        expect(after - before).toBe(25);
        // charged no weight, because nothing left the box
        expect(recorded.filter((e) => e.refused).every((e) => e.weight === 0)).toBe(true);
    }, 20000);

    it('the refused count is the number of pollers turned away', async () => {
        await tripBreaker();
        spy.mockClear();
        const REFUSALS = 47;
        for (let i = 0; i < REFUSALS; i++) await gw.fetch(URL_K, { __src: 'marketFeed:alt-klines' });
        cb.record('binance', KEY_ENDPOINT, 200);
        const recs = circuitLines(spy).filter((l) => l.event === 'recovered');
        expect(recs).toHaveLength(1);
        expect(recs[0].refused).toBe(REFUSALS);
    }, 20000);

    it('names the real reason, so a blip and a ban do not read alike', async () => {
        await tripBreaker();
        const open = circuitLines(spy).find((l) => l.event === 'open');
        expect(open.why).toBe('server_error');
        expect(open.endpoint).toBe(KEY_ENDPOINT);
        expect(open.exchange).toBe('binance');
    }, 20000);
});
