'use strict';

// Task J — Exchange-level Circuit Breaker (global per exchange)
// Sits ABOVE the existing per-endpoint/per-user circuitBreaker.js.
// Trips when 5 consecutive 5xx within 30s for a given exchange.
// Opens for 60s, then auto-closes (CLOSED on next canDispatch).
// Per-exchange isolation: binance trip doesn't block bybit.

describe('exchangeCircuitBreaker — global per-exchange CB', () => {
    let ecb;

    beforeEach(() => {
        jest.resetModules();
        ecb = require('../../server/services/exchangeCircuitBreaker');
        ecb._reset();
    });

    test('canDispatch returns true initially (CLOSED state)', () => {
        expect(ecb.canDispatch('binance')).toBe(true);
        expect(ecb.getStatus('binance').state).toBe('CLOSED');
    });

    test('5 consecutive 5xx → opens, canDispatch returns false', () => {
        for (let i = 0; i < 5; i++) ecb.recordResponse('binance', 502);
        expect(ecb.canDispatch('binance')).toBe(false);
        expect(ecb.getStatus('binance').state).toBe('OPEN');
    });

    test('4 consecutive 5xx + 1 success resets counter', () => {
        for (let i = 0; i < 4; i++) ecb.recordResponse('binance', 502);
        ecb.recordResponse('binance', 200);
        expect(ecb.canDispatch('binance')).toBe(true);
        expect(ecb.getStatus('binance').state).toBe('CLOSED');
    });

    test('OPEN state auto-closes after 60s window expires', () => {
        for (let i = 0; i < 5; i++) ecb.recordResponse('binance', 502);
        expect(ecb.canDispatch('binance')).toBe(false);
        // Simulate openUntil in the past
        ecb._testSetOpenUntil('binance', Date.now() - 1);
        expect(ecb.canDispatch('binance')).toBe(true);
        expect(ecb.getStatus('binance').state).toBe('CLOSED');
    });

    test('binance OPEN does not block bybit dispatches (per-exchange isolation)', () => {
        for (let i = 0; i < 5; i++) ecb.recordResponse('binance', 502);
        expect(ecb.canDispatch('binance')).toBe(false);
        expect(ecb.canDispatch('bybit')).toBe(true);
    });

    test('non-5xx responses (200/400/429) do not contribute to failure count', () => {
        ecb.recordResponse('binance', 200);
        ecb.recordResponse('binance', 429);  // rate-limited but NOT 5xx
        ecb.recordResponse('binance', 400);  // client error
        ecb.recordResponse('binance', 404);  // not found
        ecb.recordResponse('binance', 499);  // edge of 4xx
        expect(ecb.canDispatch('binance')).toBe(true);
        expect(ecb.getStatus('binance').state).toBe('CLOSED');
    });

    test('failures older than 30s window pruned (sliding window)', () => {
        for (let i = 0; i < 4; i++) ecb.recordResponse('binance', 502);
        // Push the 4 failures out of the 30s window
        ecb._testAdvanceFailureWindow('binance', -35000);
        // Now record 1 more 5xx — count should be 1, not 5
        ecb.recordResponse('binance', 502);
        expect(ecb.canDispatch('binance')).toBe(true);
    });

    test('event sink fires on OPEN transition', () => {
        const events = [];
        ecb.setEventSink((evt) => events.push(evt));
        for (let i = 0; i < 5; i++) ecb.recordResponse('binance', 502);
        expect(events.some(e => e.type === 'CB_OPENED' && e.exchange === 'binance')).toBe(true);
    });

    test('event sink fires on auto-CLOSED transition', () => {
        const events = [];
        ecb.setEventSink((evt) => events.push(evt));
        for (let i = 0; i < 5; i++) ecb.recordResponse('binance', 502);
        ecb._testSetOpenUntil('binance', Date.now() - 1);
        ecb.canDispatch('binance');  // triggers auto-close
        expect(events.some(e => e.type === 'CB_CLOSED_AUTO' && e.exchange === 'binance')).toBe(true);
    });

    test('does NOT open twice while already OPEN (idempotent)', () => {
        const events = [];
        ecb.setEventSink((evt) => events.push(evt));
        for (let i = 0; i < 10; i++) ecb.recordResponse('binance', 502);
        const openedEvents = events.filter(e => e.type === 'CB_OPENED');
        expect(openedEvents.length).toBe(1);
    });

    test('getStatus returns state, openUntil, recentFailures', () => {
        for (let i = 0; i < 3; i++) ecb.recordResponse('binance', 502);
        const status = ecb.getStatus('binance');
        expect(status.state).toBe('CLOSED');
        expect(status.recentFailures).toBe(3);
        expect(status.openUntil).toBe(0);
    });
});
