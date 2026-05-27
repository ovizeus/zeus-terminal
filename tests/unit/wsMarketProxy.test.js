'use strict';

const proxy = require('../../server/services/wsMarketProxy');

afterEach(() => proxy._resetForTest());

describe('wsMarketProxy subscription registry', () => {
    test('subscribe adds client to symbol set', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');
        expect(proxy.getSubscribers('BTCUSDT').size).toBe(1);
    });

    test('subscribe same client twice is idempotent', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');
        proxy.subscribe(ws, 'BTCUSDT');
        expect(proxy.getSubscribers('BTCUSDT').size).toBe(1);
    });

    test('unsubscribe removes client from symbol set', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');
        proxy.unsubscribe(ws, 'BTCUSDT');
        expect(proxy.getSubscribers('BTCUSDT').size).toBe(0);
    });

    test('unsubscribeAll removes client from all symbols', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');
        proxy.subscribe(ws, 'ETHUSDT');
        proxy.unsubscribeAll(ws);
        expect(proxy.getSubscribers('BTCUSDT').size).toBe(0);
        expect(proxy.getSubscribers('ETHUSDT').size).toBe(0);
    });

    test('getActiveSymbols returns symbols with >0 subscribers', () => {
        const ws1 = { readyState: 1, send: jest.fn() };
        const ws2 = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws1, 'BTCUSDT');
        proxy.subscribe(ws2, 'ETHUSDT');
        expect(proxy.getActiveSymbols().sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    });

    test('symbol removed from active when last subscriber leaves', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');
        proxy.unsubscribe(ws, 'BTCUSDT');
        expect(proxy.getActiveSymbols()).toEqual([]);
    });

    test('multiple clients on same symbol — one leaves, other stays', () => {
        const ws1 = { readyState: 1, send: jest.fn() };
        const ws2 = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws1, 'BTCUSDT');
        proxy.subscribe(ws2, 'BTCUSDT');
        proxy.unsubscribe(ws1, 'BTCUSDT');
        expect(proxy.getSubscribers('BTCUSDT').size).toBe(1);
        expect(proxy.getActiveSymbols()).toEqual(['BTCUSDT']);
    });
});

describe('wsMarketProxy Binance connection', () => {
    test('buildStreamUrl creates correct combined stream URL', () => {
        const url = proxy._buildStreamUrl('BTCUSDT', ['5m', '1h']);
        expect(url).toContain('fstream.binance.com/stream?streams=');
        expect(url).toContain('btcusdt@markPrice@1s');
        expect(url).toContain('btcusdt@depth20@500ms');
        expect(url).toContain('btcusdt@kline_5m');
        expect(url).toContain('btcusdt@kline_1h');
        expect(url).toContain('btcusdt@aggTrade');
        expect(url).toContain('!forceOrder@arr');
    });

    test('connectSymbol sets state to CONNECTING', () => {
        const mockWs = { on: jest.fn(), send: jest.fn(), close: jest.fn(), ping: jest.fn(), readyState: 0 };
        jest.spyOn(proxy, '_createBinanceWs').mockReturnValue(mockWs);

        proxy._connectSymbol('BTCUSDT', ['5m']);
        expect(proxy.getConnectionState('BTCUSDT')).toBe('CONNECTING');

        proxy._createBinanceWs.mockRestore();
    });

    test('disconnectSymbol closes WS and sets state CLOSED', () => {
        const mockWs = { on: jest.fn(), send: jest.fn(), close: jest.fn(), ping: jest.fn(), readyState: 1 };
        jest.spyOn(proxy, '_createBinanceWs').mockReturnValue(mockWs);

        proxy._connectSymbol('BTCUSDT', ['5m']);
        proxy._disconnectSymbol('BTCUSDT');
        expect(mockWs.close).toHaveBeenCalled();
        expect(proxy.getConnectionState('BTCUSDT')).toBe('CLOSED');

        proxy._createBinanceWs.mockRestore();
    });

    test('getConnectionState returns CLOSED for unknown symbol', () => {
        expect(proxy.getConnectionState('XYZUSDT')).toBe('CLOSED');
    });

    test('connectSymbol is idempotent — second call does nothing', () => {
        const mockWs = { on: jest.fn(), send: jest.fn(), close: jest.fn(), ping: jest.fn(), readyState: 0 };
        const spy = jest.spyOn(proxy, '_createBinanceWs').mockReturnValue(mockWs);

        proxy._connectSymbol('BTCUSDT', ['5m']);
        proxy._connectSymbol('BTCUSDT', ['5m']);
        expect(spy).toHaveBeenCalledTimes(1);

        spy.mockRestore();
    });
});
