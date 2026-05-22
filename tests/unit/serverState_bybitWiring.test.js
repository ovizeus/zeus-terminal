'use strict';

// Mock bybitFeed BEFORE requiring serverState — so when serverState.init() wires
// listeners, it uses our mock instead of real WS.
const EventEmitter = require('events');
const mockBybitFeed = new EventEmitter();
mockBybitFeed.start = jest.fn();
mockBybitFeed.stop = jest.fn();
mockBybitFeed.getConnectionState = jest.fn(() => ({ connected: true }));

jest.mock('../../server/services/bybitFeed', () => mockBybitFeed);

const serverState = require('../../server/services/serverState');

describe('serverState ↔ bybitFeed wiring (Phase 1A Task 22)', () => {
    beforeAll(() => {
        // Ensure Bybit handlers wired (init() also wires them now)
        if (typeof serverState._wireBybitListeners === 'function') {
            serverState._wireBybitListeners();
        }
    });

    beforeEach(() => {
        // Clear bybit namespace between tests
        const bybitMap = serverState.forExchange('bybit')._getMap();
        bybitMap.clear();
    });

    it('kline event populates _sdMap_bybit with bars[tf]', () => {
        mockBybitFeed.emit('kline', {
            symbol: 'BTCUSDT', tf: '5m',
            open: 50000, high: 50100, low: 49900, close: 50050, volume: 10,
            ts: 1672304400000, confirmed: false, rawExchange: 'bybit',
        });
        const snap = serverState.forExchange('bybit').getSnapshotForSymbol('BTCUSDT');
        expect(snap).not.toBeNull();
        expect(snap.bars['5m']).toBeDefined();
        expect(snap.bars['5m'].length).toBeGreaterThan(0);
        expect(snap.bars['5m'][snap.bars['5m'].length - 1].close).toBe(50050);
    });

    it('kline updates existing bar when same ts', () => {
        mockBybitFeed.emit('kline', { symbol: 'BTCUSDT', tf: '5m', open: 1, high: 2, low: 0.5, close: 1.5, volume: 5, ts: 1000, confirmed: false, rawExchange: 'bybit' });
        mockBybitFeed.emit('kline', { symbol: 'BTCUSDT', tf: '5m', open: 1, high: 3, low: 0.4, close: 2.0, volume: 8, ts: 1000, confirmed: false, rawExchange: 'bybit' });
        const bars = serverState.forExchange('bybit').getBarsForSymbol('BTCUSDT', '5m');
        expect(bars.length).toBe(1);
        expect(bars[0].close).toBe(2.0);
        expect(bars[0].high).toBe(3);
        expect(bars[0].low).toBe(0.4);
    });

    it('trade event updates price + priceTs in bybit namespace', () => {
        mockBybitFeed.emit('trade', {
            symbol: 'ETHUSDT', side: 'BUY', price: 1900, qty: 1, ts: 2000, rawExchange: 'bybit',
        });
        const snap = serverState.forExchange('bybit').getSnapshotForSymbol('ETHUSDT');
        expect(snap.price).toBe(1900);
        expect(typeof snap.priceTs).toBe('number');
    });

    it('bookTicker event updates bid/ask + price as mid', () => {
        mockBybitFeed.emit('bookTicker', {
            symbol: 'SOLUSDT', bid: 100, bidQty: 5, ask: 101, askQty: 6, ts: 3000, rawExchange: 'bybit',
        });
        const snap = serverState.forExchange('bybit').getSnapshotForSymbol('SOLUSDT');
        expect(snap.bid).toBe(100);
        expect(snap.ask).toBe(101);
        expect(snap.price).toBe(100.5); // mid
    });

    it('markPrice event updates fr (funding rate) + markPrice fields', () => {
        // First populate the symbol via a trade so _sdMap_bybit has an entry
        mockBybitFeed.emit('trade', { symbol: 'BNBUSDT', side: 'BUY', price: 300, qty: 1, ts: 100, rawExchange: 'bybit' });
        mockBybitFeed.emit('markPrice', {
            symbol: 'BNBUSDT', markPrice: 300.5, indexPrice: 300.3, fundingRate: 0.0001, nextFundingTime: 999999, ts: 4000, rawExchange: 'bybit',
        });
        const snap = serverState.forExchange('bybit').getSnapshotForSymbol('BNBUSDT');
        expect(snap.fr).toBe(0.0001);
        expect(snap.markPrice).toBe(300.5);
    });

    it('bybit namespace is ISOLATED from binance namespace', () => {
        mockBybitFeed.emit('trade', {
            symbol: 'BTCUSDT', side: 'BUY', price: 99999, qty: 1, ts: 5000, rawExchange: 'bybit',
        });
        const bybitSnap = serverState.forExchange('bybit').getSnapshotForSymbol('BTCUSDT');
        expect(bybitSnap.price).toBe(99999);

        // Binance namespace should NOT have this price (we didn't emit there)
        const binanceSnap = serverState.forExchange('binance').getSnapshotForSymbol('BTCUSDT');
        if (binanceSnap) {
            expect(binanceSnap.price).not.toBe(99999);
        }
        // OR null if no Binance data — either way, the 99999 only landed in bybit
    });

    it('forExchange("bybit").getReadySymbols() includes only populated symbols', () => {
        mockBybitFeed.emit('kline', { symbol: 'BTCUSDT', tf: '5m', open: 1, high: 1, low: 1, close: 1, volume: 1, ts: 1, confirmed: false, rawExchange: 'bybit' });
        mockBybitFeed.emit('trade', { symbol: 'BTCUSDT', side: 'BUY', price: 50000, qty: 1, ts: 100, rawExchange: 'bybit' });
        const ready = serverState.forExchange('bybit').getReadySymbols();
        expect(ready).toContain('BTCUSDT');
    });
});
