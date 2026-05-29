'use strict';

// Phase A / Task A1 — marketProxy stale-serve.
// When Binance fails, serve the last-good payload (stale) instead of a 502 blank,
// so the chart shows last-known data instead of going dark. Pure decision tested
// here; wiring into _proxyFetch + routes verified by code-read.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-stale';

let resolveServe;
beforeAll(() => {
    const mp = require('../../server/routes/marketProxy');
    resolveServe = mp._serveTest.resolveServe;
});

describe('_resolveServe — stale-serve decision (no blank on Binance failure)', () => {
    test('fresh present → serve fresh, not stale', () => {
        const out = resolveServe([1, 2, 3], null, 5000);
        expect(out).toEqual({ data: [1, 2, 3], stale: false });
    });

    test('fresh present takes precedence even if last-good exists', () => {
        const out = resolveServe([7], { data: [9], ts: 1000 }, 5000);
        expect(out.data).toEqual([7]);
        expect(out.stale).toBe(false);
    });

    test('no fresh, last-good exists → serve last-good as STALE with age', () => {
        const out = resolveServe(null, { data: [9, 9], ts: 1000 }, 4000);
        expect(out.data).toEqual([9, 9]);
        expect(out.stale).toBe(true);
        expect(out.ageMs).toBe(3000);
    });

    test('no fresh, no last-good → miss (route should 502)', () => {
        const out = resolveServe(null, null, 4000);
        expect(out.data).toBeNull();
        expect(out.stale).toBe(false);
        expect(out.miss).toBe(true);
    });

    test('fresh=null with last-good preserves exact payload shape (array)', () => {
        const payload = [[1, 2], [3, 4]];
        const out = resolveServe(null, { data: payload, ts: 0 }, 100);
        expect(out.data).toBe(payload); // same reference — shape untouched
        expect(out.stale).toBe(true);
    });
});
