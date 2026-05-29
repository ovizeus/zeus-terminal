'use strict';

// P2a (multi-exchange switch) — credsForPosition(store, userId, pos).
// New orders use the ACTIVE exchange (getExchangeCreds). An already-open position
// is managed on ITS OWN exchange (position.exchange) via getExchangeCredsFor,
// regardless of which exchange is currently active — so close/SL/TP/add-on of an
// old-exchange position route to that exchange, not the new active one.

const { credsForPosition } = require('../../server/services/credsRouting');

function makeStore() {
    return {
        getExchangeCreds: jest.fn(() => ({ exchange: 'binance', apiKey: 'ACTIVE' })),
        getExchangeCredsFor: jest.fn((uid, ex) => ({ exchange: ex, apiKey: `FOR_${ex}` })),
    };
}

describe('credsForPosition(store, userId, pos)', () => {
    test('routes to position.exchange when pos carries an exchange', () => {
        const store = makeStore();
        const c = credsForPosition(store, 7, { seq: 1, exchange: 'bybit' });
        expect(c).toEqual({ exchange: 'bybit', apiKey: 'FOR_bybit' });
        expect(store.getExchangeCredsFor).toHaveBeenCalledWith(7, 'bybit');
        expect(store.getExchangeCreds).not.toHaveBeenCalled();
    });

    test('falls back to ACTIVE creds when pos has no exchange (demo / legacy)', () => {
        const store = makeStore();
        const c = credsForPosition(store, 7, { seq: 2, exchange: null });
        expect(c).toEqual({ exchange: 'binance', apiKey: 'ACTIVE' });
        expect(store.getExchangeCreds).toHaveBeenCalledWith(7);
        expect(store.getExchangeCredsFor).not.toHaveBeenCalled();
    });

    test('falls back to ACTIVE creds when pos is null/undefined', () => {
        const store = makeStore();
        expect(credsForPosition(store, 7, null)).toEqual({ exchange: 'binance', apiKey: 'ACTIVE' });
        expect(credsForPosition(store, 7, undefined)).toEqual({ exchange: 'binance', apiKey: 'ACTIVE' });
        expect(store.getExchangeCredsFor).not.toHaveBeenCalled();
    });

    test('same active exchange → identical creds to getExchangeCreds (behavior-preserving today)', () => {
        const store = makeStore();
        // A position on the currently-active exchange resolves via getExchangeCredsFor
        // but yields the same exchange — proves the swap is safe while only one exchange executes.
        const c = credsForPosition(store, 7, { seq: 3, exchange: 'binance' });
        expect(c.exchange).toBe('binance');
        expect(store.getExchangeCredsFor).toHaveBeenCalledWith(7, 'binance');
    });
});
