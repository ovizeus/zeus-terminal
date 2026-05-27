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
