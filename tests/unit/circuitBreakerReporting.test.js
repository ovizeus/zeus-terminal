'use strict';

/**
 * [2026-11-07] One line per circuit TRANSITION, not one per refused caller.
 *
 * Measured before this change: all 21 kline pollers share one
 * exchange:endpoint circuit, so a single upstream failure blinded every one of
 * them and each wrote its own warning every poll cycle — 19,112 lines on
 * 6 Nov, 33,227 on 5 Nov, a third of the day's minutes affected. A log that
 * loud cannot distinguish a blip from an outage, and it buried everything
 * else: the lines were WARN, so every health check grepping for "error"
 * missed them completely.
 */

const cb = require('../../server/services/circuitBreaker');

function circuitLines(spy) {
    return spy.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('"_t":"CIRCUIT"'))
        .map((l) => JSON.parse(l));
}

describe('circuit breaker reporting', () => {
    let spy;
    beforeEach(() => {
        cb._resetForTest();
        spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => spy.mockRestore());

    it('says nothing while everything works', () => {
        for (let i = 0; i < 20; i++) cb.record('binance', '/klines', 200);
        expect(circuitLines(spy)).toHaveLength(0);
    });

    it('reports the open ONCE, however many failures follow', () => {
        for (let i = 0; i < 30; i++) cb.record('binance', '/klines', 500);
        const opens = circuitLines(spy).filter((l) => l.event === 'open');
        expect(opens).toHaveLength(1);
        expect(opens[0].endpoint).toBe('/klines');
    });

    it('stays silent while callers are refused — the flood this replaces', () => {
        for (let i = 0; i < 5; i++) cb.record('binance', '/klines', 500);
        spy.mockClear();
        // 21 pollers x several cycles, exactly the shape measured in the logs
        for (let i = 0; i < 21 * 10; i++) cb.canRequest('binance', '/klines');
        expect(circuitLines(spy)).toHaveLength(0);
    });

    it('counts what it refused and reports the total on recovery', () => {
        for (let i = 0; i < 5; i++) cb.record('binance', '/klines', 500);
        for (let i = 0; i < 37; i++) cb.canRequest('binance', '/klines');
        spy.mockClear();
        cb.record('binance', '/klines', 200); // upstream came back
        const rec = circuitLines(spy).filter((l) => l.event === 'recovered');
        expect(rec).toHaveLength(1);
        expect(rec[0].refused).toBe(37);
        expect(typeof rec[0].openMs).toBe('number');
    });

    it('a whole episode is two lines, not two thousand', () => {
        for (let i = 0; i < 5; i++) cb.record('binance', '/klines', 500);
        for (let i = 0; i < 2000; i++) cb.canRequest('binance', '/klines');
        cb.record('binance', '/klines', 200);
        expect(circuitLines(spy)).toHaveLength(2);
    });

    it('does not report recovery for a circuit that never opened', () => {
        cb.record('binance', '/klines', 200);
        expect(circuitLines(spy).filter((l) => l.event === 'recovered')).toHaveLength(0);
    });

    it('names the reason it opened', () => {
        cb.record('binance', '/klines', 429);
        const opens = circuitLines(spy).filter((l) => l.event === 'open');
        expect(opens[0].why).toBe('rate_limit');
    });

    it('reports an IP ban as its own reason, not a generic one', () => {
        cb.record('binance', '/order', 418);
        const opens = circuitLines(spy).filter((l) => l.event === 'open');
        expect(opens[0].why).toBe('ip_ban_418');
    });

    it('keeps circuits independent — one endpoint opening is not another opening', () => {
        for (let i = 0; i < 5; i++) cb.record('binance', '/klines', 500);
        spy.mockClear();
        expect(cb.canRequest('binance', '/depth')).toBe(true);
        expect(circuitLines(spy)).toHaveLength(0);
    });

    it('a second episode reports again — the counter resets, it does not latch', () => {
        for (let i = 0; i < 5; i++) cb.record('binance', '/klines', 500);
        for (let i = 0; i < 4; i++) cb.canRequest('binance', '/klines');
        cb.record('binance', '/klines', 200);
        spy.mockClear();
        for (let i = 0; i < 5; i++) cb.record('binance', '/klines', 500);
        for (let i = 0; i < 9; i++) cb.canRequest('binance', '/klines');
        cb.record('binance', '/klines', 200);
        const lines = circuitLines(spy);
        expect(lines.filter((l) => l.event === 'open')).toHaveLength(1);
        const rec = lines.filter((l) => l.event === 'recovered');
        expect(rec).toHaveLength(1);
        expect(rec[0].refused).toBe(9); // not 13 — the first episode's tally is gone
    });

    it('logging cannot break the request path', () => {
        spy.mockImplementation(() => { throw new Error('stdout is gone'); });
        expect(() => { for (let i = 0; i < 5; i++) cb.record('binance', '/klines', 500); }).not.toThrow();
        expect(() => cb.canRequest('binance', '/klines')).not.toThrow();
    });
});
