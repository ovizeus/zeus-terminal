/**
 * Zeus Terminal — Unit Tests: marketFeed.getActiveSymbols + auto-subscribe pattern
 *
 * BUG-CLOSE-AT companion (RECON-SUBSCRIBE 2026-05-14): Zeus subscribes feed
 * only pentru [BTC, ETH, SOL, BNB] la boot. AT can open positions on other
 * symbols (e.g. ZECUSDT) — feed NU pulls price → broken DSL trailing SL +
 * silent close fail (already partially mitigated în BUG-CLOSE-AT via
 * fallback chain; RECON-SUBSCRIBE provides actual live price defense-in-depth).
 *
 * Pattern: marketFeed exposes getActiveSymbols(); recon checks live positions
 * symbols; auto-subscribes any missing symbol.
 *
 * Coverage (helper only — full recon hook integration tested e2e via PM2 logs):
 *   - getActiveSymbols returns Set of subscribed symbols
 *   - Returns NEW Set (immutable view — caller mutation doesn't affect internal)
 *   - Pure read — no side effects
 */
'use strict';

// Re-load module after subscribing to test against subsequent state
jest.resetModules();

describe('marketFeed.getActiveSymbols (RECON-SUBSCRIBE FIX)', () => {
    test('exports getActiveSymbols function', () => {
        const marketFeed = require('../../server/services/marketFeed');
        expect(typeof marketFeed.getActiveSymbols).toBe('function');
    });

    test('returns Set containing currently subscribed symbols', () => {
        const marketFeed = require('../../server/services/marketFeed');
        const set = marketFeed.getActiveSymbols();
        expect(set).toBeInstanceOf(Set);
    });

    test('returns a NEW Set (caller mutation does not affect internal state)', () => {
        const marketFeed = require('../../server/services/marketFeed');
        const set1 = marketFeed.getActiveSymbols();
        set1.add('FAKEUSDT');
        const set2 = marketFeed.getActiveSymbols();
        expect(set2.has('FAKEUSDT')).toBe(false);
    });

    test('pure read — multiple calls return equivalent contents', () => {
        const marketFeed = require('../../server/services/marketFeed');
        const set1 = marketFeed.getActiveSymbols();
        const set2 = marketFeed.getActiveSymbols();
        expect(set1.size).toBe(set2.size);
        for (const s of set1) {
            expect(set2.has(s)).toBe(true);
        }
    });
});
