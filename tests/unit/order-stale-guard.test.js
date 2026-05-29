'use strict';

// Bug fix 2026-05-29 — testnet/live orders were ALL blocked with HTTP 423 STALE_DATA.
// ROOT CAUSE: the order route's stale guard gated ONLY on wsProxy.isSymbolStale, but
// wsProxy's per-symbol Binance WS is IP-blocked (no _healthState → staleness=Infinity),
// so every order was refused — even though serverState had a FRESH price (marketFeed
// @bookTicker, used for SL/TP/PnL/brain). FIX: block only when BOTH wsProxy is stale
// AND serverState's live price is stale/unknown (fail-closed). Pure decision tested here.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-staleguard';

let resolveStaleBlock;
beforeAll(() => {
    const trading = require('../../server/routes/trading');
    resolveStaleBlock = trading._staleTest.resolveStaleBlock;
});

describe('_resolveStaleBlock — order stale guard (wsProxy + serverState, fail-closed)', () => {
    const T = 10000; // threshold ms

    test('wsProxy stale but serverState FRESH → NOT blocked (live source good)', () => {
        expect(resolveStaleBlock(true, 2000, T)).toBe(false);
    });

    test('wsProxy stale AND serverState stale → BLOCKED (truly blind)', () => {
        expect(resolveStaleBlock(true, 15000, T)).toBe(true);
    });

    test('wsProxy stale AND serverState price UNKNOWN (null) → BLOCKED (fail-closed)', () => {
        expect(resolveStaleBlock(true, null, T)).toBe(true);
    });

    test('wsProxy stale AND serverState age undefined → BLOCKED (fail-closed)', () => {
        expect(resolveStaleBlock(true, undefined, T)).toBe(true);
    });

    test('wsProxy FRESH → NOT blocked regardless of serverState (unchanged path)', () => {
        expect(resolveStaleBlock(false, 99999, T)).toBe(false);
        expect(resolveStaleBlock(false, null, T)).toBe(false);
    });

    test('boundary: serverState age == threshold → fresh → NOT blocked', () => {
        expect(resolveStaleBlock(true, T, T)).toBe(false);
    });

    test('boundary: serverState age just over threshold → BLOCKED', () => {
        expect(resolveStaleBlock(true, T + 1, T)).toBe(true);
    });
});
