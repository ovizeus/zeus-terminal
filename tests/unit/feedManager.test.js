'use strict';

const mockBinanceFeed = {
    start: jest.fn(),
    stop: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    getConnectionState: jest.fn(() => ({ connected: true })),
};
const mockBybitFeed = {
    start: jest.fn(),
    stop: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    getConnectionState: jest.fn(() => ({ connected: true })),
};

jest.mock('../../server/services/marketFeed', () => mockBinanceFeed);
jest.mock('../../server/services/bybitFeed', () => mockBybitFeed);

const fm = require('../../server/services/feedManager');

describe('feedManager', () => {
    beforeEach(() => {
        fm._resetForTest();
        jest.clearAllMocks();
    });

    afterEach(() => {
        fm._resetForTest();
    });

    describe('activateForUser', () => {
        it('starts binanceFeed on first activation', () => {
            fm.activateForUser(1, 'binance');
            expect(mockBinanceFeed.start).toHaveBeenCalledTimes(1);
        });

        it('refcount: second activation on same exchange does NOT start twice', () => {
            fm.activateForUser(1, 'binance');
            fm.activateForUser(2, 'binance');
            expect(mockBinanceFeed.start).toHaveBeenCalledTimes(1);
        });

        it('idempotent for same user', () => {
            fm.activateForUser(1, 'binance');
            fm.activateForUser(1, 'binance');
            expect(mockBinanceFeed.start).toHaveBeenCalledTimes(1);
            expect(fm.getRefcount('binance')).toBe(1);
        });

        it('switching user from binance to bybit deactivates old + activates new', () => {
            fm.activateForUser(1, 'binance');
            fm.activateForUser(1, 'bybit');
            expect(fm.getUserExchange(1)).toBe('bybit');
            expect(fm.getRefcount('binance')).toBe(0);
            expect(fm.getRefcount('bybit')).toBe(1);
        });

        it('throws on unknown exchange', () => {
            expect(() => fm.activateForUser(1, 'unknown')).toThrow(/unknown exchange/i);
        });

        it('both feeds run concurrently for different users', () => {
            fm.activateForUser(1, 'binance');
            fm.activateForUser(2, 'bybit');
            expect(mockBinanceFeed.start).toHaveBeenCalledTimes(1);
            expect(mockBybitFeed.start).toHaveBeenCalledTimes(1);
            expect(fm.getRefcount('binance')).toBe(1);
            expect(fm.getRefcount('bybit')).toBe(1);
        });
    });

    describe('deactivateForUser', () => {
        it('decrements refcount', () => {
            fm.activateForUser(1, 'binance');
            fm.activateForUser(2, 'binance');
            fm.deactivateForUser(1, 'binance');
            expect(fm.getRefcount('binance')).toBe(1);
            expect(mockBinanceFeed.stop).not.toHaveBeenCalled();
        });

        it('refcount = 0 schedules stop after grace period', () => {
            fm.activateForUser(1, 'binance');
            fm.deactivateForUser(1, 'binance');
            expect(fm.getRefcount('binance')).toBe(0);
            // Stop is NOT called immediately — scheduled with grace
            expect(mockBinanceFeed.stop).not.toHaveBeenCalled();
        });

        it('no-op when user not active on that exchange', () => {
            fm.deactivateForUser(99, 'binance');
            expect(mockBinanceFeed.stop).not.toHaveBeenCalled();
            expect(fm.getRefcount('binance')).toBe(0);
        });
    });

    describe('getFeedForUser', () => {
        it('returns binance feed for user on binance', () => {
            fm.activateForUser(1, 'binance');
            expect(fm.getFeedForUser(1)).toBe(mockBinanceFeed);
        });

        it('returns bybit feed for user on bybit', () => {
            fm.activateForUser(2, 'bybit');
            expect(fm.getFeedForUser(2)).toBe(mockBybitFeed);
        });

        it('returns null for unknown user', () => {
            expect(fm.getFeedForUser(999)).toBeNull();
        });
    });

    describe('getActiveExchanges', () => {
        it('returns empty array when no users active', () => {
            expect(fm.getActiveExchanges()).toEqual([]);
        });

        it('returns binance only when only binance users', () => {
            fm.activateForUser(1, 'binance');
            expect(fm.getActiveExchanges()).toEqual(['binance']);
        });

        it('returns both when binance + bybit active', () => {
            fm.activateForUser(1, 'binance');
            fm.activateForUser(2, 'bybit');
            const active = fm.getActiveExchanges().sort();
            expect(active).toEqual(['binance', 'bybit']);
        });
    });

    // ─── [P5] managed-position feed holds ───────────────────────────────
    describe('[P5] markPositionOpen / markPositionClosed / isManaged', () => {
        it('markPositionOpen on an exchange with no active user starts + holds its feed', () => {
            fm.markPositionOpen(1, 'bybit');
            expect(mockBybitFeed.start).toHaveBeenCalledTimes(1);
            expect(fm.getRefcount('bybit')).toBe(1);
            expect(fm.isManaged(1, 'bybit')).toBe(true);
        });

        it('switching away keeps the old exchange feed ALIVE while a position is open there', () => {
            fm.activateForUser(1, 'binance');     // active binance (ref 1)
            fm.markPositionOpen(1, 'binance');    // open binance position (ref 2)
            expect(fm.getRefcount('binance')).toBe(2);

            fm.activateForUser(1, 'bybit');       // switch → deactivates binance (ref 1 remains from position)
            expect(fm.getRefcount('binance')).toBe(1);
            expect(mockBinanceFeed.stop).not.toHaveBeenCalled();  // feed stays alive
            expect(fm.isManaged(1, 'binance')).toBe(true);        // still managed via position
            expect(fm.getUserExchange(1)).toBe('bybit');          // active is bybit
        });

        it('closing the last position releases the hold (grace-stop, not immediate)', () => {
            fm.activateForUser(1, 'bybit');
            fm.markPositionOpen(1, 'binance');
            expect(fm.getRefcount('binance')).toBe(1);
            fm.markPositionClosed(1, 'binance');
            expect(fm.getRefcount('binance')).toBe(0);
            expect(mockBinanceFeed.stop).not.toHaveBeenCalled();  // grace period, not sync
            expect(fm.isManaged(1, 'binance')).toBe(false);
        });

        it('refcounts multiple positions; feed held until the last closes', () => {
            fm.markPositionOpen(1, 'binance');
            fm.markPositionOpen(1, 'binance');    // 2 positions, 1 feed hold
            expect(fm.getRefcount('binance')).toBe(1);
            fm.markPositionClosed(1, 'binance');
            expect(fm.getRefcount('binance')).toBe(1);  // still 1 position open
            expect(fm.isManaged(1, 'binance')).toBe(true);
            fm.markPositionClosed(1, 'binance');
            expect(fm.getRefcount('binance')).toBe(0);
        });

        it('markPositionClosed below zero is safe (no negative refcount)', () => {
            fm.markPositionClosed(1, 'binance');
            expect(fm.getRefcount('binance')).toBe(0);
        });

        it('unknown exchange is ignored (never breaks the entry/close path)', () => {
            expect(() => fm.markPositionOpen(1, 'kraken')).not.toThrow();
            expect(() => fm.markPositionClosed(1, 'kraken')).not.toThrow();
            expect(fm.isManaged(1, 'kraken')).toBe(false);
        });
    });

    describe('GRACE_MS constant', () => {
        it('is 30 seconds', () => {
            expect(fm.GRACE_MS).toBe(30_000);
        });
    });

    // [Phase B / Task B1.2] stopAll — used by graceful shutdown so the dying
    // process closes all feed WS connections cleanly (no flap → no restart-boundary
    // connection storm). Stops every active feed regardless of refcount.
    describe('stopAll', () => {
        it('stops all active feeds and clears state', () => {
            fm.activateForUser(1, 'bybit');
            fm.activateForUser(2, 'binance');
            fm.stopAll();
            expect(mockBybitFeed.stop).toHaveBeenCalled();
            expect(mockBinanceFeed.stop).toHaveBeenCalled();
            expect(fm.getActiveExchanges()).toEqual([]);
            expect(fm.getRefcount('bybit')).toBe(0);
            expect(fm.getRefcount('binance')).toBe(0);
        });

        it('is safe to call with no active feeds (idempotent)', () => {
            expect(() => fm.stopAll()).not.toThrow();
            expect(fm.getActiveExchanges()).toEqual([]);
        });
    });
});
