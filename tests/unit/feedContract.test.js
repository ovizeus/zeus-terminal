'use strict';

// Shared IMarketFeed contract — runs same assertions against both feeds.
// If either feed deviates from the common contract, this test catches it.
//
// Common contract (subset that BOTH feeds support):
// - start(), stop() — lifecycle
// - on(event, handler), off(event, handler) — EventEmitter API
// - getConnectionState() → object with at least { connected }

const FEEDS = {
    binance: () => require('../../server/services/binanceFeed'),
    bybit:   () => require('../../server/services/bybitFeed'),
};

for (const [name, getFeed] of Object.entries(FEEDS)) {
    describe(`IMarketFeed contract — ${name}`, () => {
        let feed;
        beforeAll(() => { feed = getFeed(); });

        it('exports start()', () => {
            expect(typeof feed.start).toBe('function');
        });

        it('exports stop()', () => {
            expect(typeof feed.stop).toBe('function');
        });

        it('exports on(event, handler)', () => {
            expect(typeof feed.on).toBe('function');
        });

        it('exports off(event, handler)', () => {
            expect(typeof feed.off).toBe('function');
        });

        it('exports getConnectionState()', () => {
            expect(typeof feed.getConnectionState).toBe('function');
        });

        it('getConnectionState() returns object with connected field', () => {
            const state = feed.getConnectionState();
            expect(state).toBeDefined();
            expect(state).not.toBeNull();
            expect(typeof state).toBe('object');
            expect(state).toHaveProperty('connected');
            expect(typeof state.connected).toBe('boolean');
        });

        it('on() / off() do not throw with valid args', () => {
            const handler = () => {};
            expect(() => feed.on('kline', handler)).not.toThrow();
            expect(() => feed.off('kline', handler)).not.toThrow();
        });
    });
}
