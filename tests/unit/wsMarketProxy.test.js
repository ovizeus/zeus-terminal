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

describe('wsMarketProxy broadcast + cache', () => {
    test('broadcast sends JSON to all subscribers of a symbol', () => {
        const ws1 = { readyState: 1, send: jest.fn() };
        const ws2 = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws1, 'BTCUSDT');
        proxy.subscribe(ws2, 'BTCUSDT');

        proxy._broadcast('BTCUSDT', { type: 'market.price', symbol: 'BTCUSDT', price: 75000 });

        expect(ws1.send).toHaveBeenCalledTimes(1);
        expect(ws2.send).toHaveBeenCalledTimes(1);
        const parsed = JSON.parse(ws1.send.mock.calls[0][0]);
        expect(parsed.type).toBe('market.price');
        expect(parsed.price).toBe(75000);
    });

    test('broadcast skips closed clients', () => {
        const wsOpen = { readyState: 1, send: jest.fn() };
        const wsClosed = { readyState: 3, send: jest.fn() };
        proxy.subscribe(wsOpen, 'BTCUSDT');
        proxy.subscribe(wsClosed, 'BTCUSDT');

        proxy._broadcast('BTCUSDT', { type: 'market.price', symbol: 'BTCUSDT', price: 75000 });

        expect(wsOpen.send).toHaveBeenCalled();
        expect(wsClosed.send).not.toHaveBeenCalled();
    });

    test('broadcast does not send to subscribers of different symbol', () => {
        const wsBtc = { readyState: 1, send: jest.fn() };
        const wsEth = { readyState: 1, send: jest.fn() };
        proxy.subscribe(wsBtc, 'BTCUSDT');
        proxy.subscribe(wsEth, 'ETHUSDT');

        proxy._broadcast('BTCUSDT', { type: 'market.price', symbol: 'BTCUSDT', price: 75000 });

        expect(wsBtc.send).toHaveBeenCalled();
        expect(wsEth.send).not.toHaveBeenCalled();
    });

    test('last value cache updated on broadcast', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');

        proxy._broadcast('BTCUSDT', { type: 'market.price', symbol: 'BTCUSDT', price: 75000 });

        const cached = proxy.getLastValue('BTCUSDT', 'market.price');
        expect(cached).not.toBeNull();
        expect(cached.price).toBe(75000);
    });

    test('getLastValue returns null for unknown', () => {
        expect(proxy.getLastValue('XYZUSDT', 'market.price')).toBeNull();
    });

    test('new subscriber receives last cached values immediately', () => {
        const ws1 = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws1, 'BTCUSDT');
        proxy._broadcast('BTCUSDT', { type: 'market.price', symbol: 'BTCUSDT', price: 75000 });
        proxy._broadcast('BTCUSDT', { type: 'market.depth', symbol: 'BTCUSDT', bids: [], asks: [] });
        ws1.send.mockClear();

        const ws2 = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws2, 'BTCUSDT');

        // ws2 should get cached price + depth immediately
        expect(ws2.send).toHaveBeenCalledTimes(2);
        // ws1 should NOT get them again
        expect(ws1.send).not.toHaveBeenCalled();
    });
});

describe('wsMarketProxy _handleBinanceMessage', () => {
    test('markPrice stream → market.price broadcast', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');

        proxy._handleBinanceMessage('BTCUSDT', {
            stream: 'btcusdt@markPrice@1s',
            data: { p: '75000.50', r: '0.0001', T: 1779900000000 }
        });

        const msg = JSON.parse(ws.send.mock.calls[0][0]);
        expect(msg.type).toBe('market.price');
        expect(msg.price).toBe(75000.50);
        expect(msg.fr).toBe(0.0001);
    });

    test('depth20 stream → market.depth broadcast', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');

        proxy._handleBinanceMessage('BTCUSDT', {
            stream: 'btcusdt@depth20@500ms',
            data: { b: [['74999', '1.5']], a: [['75001', '2.0']] }
        });

        const msg = JSON.parse(ws.send.mock.calls[0][0]);
        expect(msg.type).toBe('market.depth');
        expect(msg.bids[0]).toEqual({ p: 74999, q: 1.5 });
        expect(msg.asks[0]).toEqual({ p: 75001, q: 2.0 });
    });

    test('kline stream → market.kline broadcast', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');

        proxy._handleBinanceMessage('BTCUSDT', {
            stream: 'btcusdt@kline_5m',
            data: { k: { i: '5m', t: 1779900000000, o: '75000', h: '75100', l: '74900', c: '75050', v: '100', x: false } }
        });

        const msg = JSON.parse(ws.send.mock.calls[0][0]);
        expect(msg.type).toBe('market.kline');
        expect(msg.tf).toBe('5m');
        expect(msg.bar.close).toBe(75050);
        expect(msg.closed).toBe(false);
    });

    test('aggTrade stream → market.aggTrade broadcast', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');

        proxy._handleBinanceMessage('BTCUSDT', {
            stream: 'btcusdt@aggTrade',
            data: { p: '75000', q: '0.5', m: true, T: 1779900000000 }
        });

        const msg = JSON.parse(ws.send.mock.calls[0][0]);
        expect(msg.type).toBe('market.aggTrade');
        expect(msg.p).toBe(75000);
        expect(msg.q).toBe(0.5);
        expect(msg.m).toBe(true);
    });

    test('forceOrder stream → market.liq broadcast to ALL subscribers', () => {
        const wsBtc = { readyState: 1, send: jest.fn() };
        const wsEth = { readyState: 1, send: jest.fn() };
        proxy.subscribe(wsBtc, 'BTCUSDT');
        proxy.subscribe(wsEth, 'ETHUSDT');

        proxy._handleBinanceMessage('BTCUSDT', {
            stream: '!forceOrder@arr',
            data: { o: { s: 'BTCUSDT', S: 'SELL', q: '1.5', p: '74500' } }
        });

        // Liquidation broadcasts to ALL (not just BTCUSDT subscribers)
        expect(wsBtc.send).toHaveBeenCalled();
        expect(wsEth.send).toHaveBeenCalled();
        const msg = JSON.parse(wsBtc.send.mock.calls[0][0]);
        expect(msg.type).toBe('market.liq');
        expect(msg.side).toBe('SELL');
    });

    test('ignores message without stream/data', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');

        proxy._handleBinanceMessage('BTCUSDT', { result: null });
        proxy._handleBinanceMessage('BTCUSDT', {});

        expect(ws.send).not.toHaveBeenCalled();
    });
});

describe('wsMarketProxy handleClientMessage', () => {
    test('market.subscribe adds client + returns isNewSymbol', () => {
        const ws = { readyState: 1, send: jest.fn(), _uid: 1 };
        jest.spyOn(proxy, '_connectSymbol').mockImplementation(() => {});

        proxy.handleClientMessage(ws, { type: 'market.subscribe', symbol: 'BTCUSDT' });

        expect(proxy.getSubscribers('BTCUSDT').size).toBe(1);
        expect(proxy._connectSymbol).toHaveBeenCalledWith('BTCUSDT', expect.any(Array));

        proxy._connectSymbol.mockRestore();
    });

    test('market.unsubscribe removes client + disconnects if last', () => {
        const ws = { readyState: 1, send: jest.fn(), _uid: 1 };
        jest.spyOn(proxy, '_connectSymbol').mockImplementation(() => {});
        jest.spyOn(proxy, '_disconnectSymbol').mockImplementation(() => {});

        proxy.handleClientMessage(ws, { type: 'market.subscribe', symbol: 'BTCUSDT' });
        proxy.handleClientMessage(ws, { type: 'market.unsubscribe', symbol: 'BTCUSDT' });

        expect(proxy.getSubscribers('BTCUSDT').size).toBe(0);
        expect(proxy._disconnectSymbol).toHaveBeenCalledWith('BTCUSDT');

        proxy._connectSymbol.mockRestore();
        proxy._disconnectSymbol.mockRestore();
    });

    test('handleClientDisconnect cleans all subscriptions', () => {
        const ws = { readyState: 1, send: jest.fn() };
        jest.spyOn(proxy, '_connectSymbol').mockImplementation(() => {});
        jest.spyOn(proxy, '_disconnectSymbol').mockImplementation(() => {});

        proxy.handleClientMessage(ws, { type: 'market.subscribe', symbol: 'BTCUSDT' });
        proxy.handleClientMessage(ws, { type: 'market.subscribe', symbol: 'ETHUSDT' });
        proxy.handleClientDisconnect(ws);

        expect(proxy.getSubscribers('BTCUSDT').size).toBe(0);
        expect(proxy.getSubscribers('ETHUSDT').size).toBe(0);
        expect(proxy._disconnectSymbol).toHaveBeenCalledTimes(2);

        proxy._connectSymbol.mockRestore();
        proxy._disconnectSymbol.mockRestore();
    });

    test('ignores unknown message types', () => {
        const ws = { readyState: 1, send: jest.fn() };
        expect(() => {
            proxy.handleClientMessage(ws, { type: 'random.thing' });
            proxy.handleClientMessage(ws, null);
            proxy.handleClientMessage(ws, {});
        }).not.toThrow();
    });

    test('market.subscribe.wl subscribes to multiple symbols', () => {
        const ws = { readyState: 1, send: jest.fn() };

        proxy.handleClientMessage(ws, { type: 'market.subscribe.wl', symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] });

        expect(proxy.getSubscribers('BTCUSDT').size).toBe(1);
        expect(proxy.getSubscribers('ETHUSDT').size).toBe(1);
        expect(proxy.getSubscribers('SOLUSDT').size).toBe(1);
    });
});

describe('wsMarketProxy watchlist', () => {
    test('buildWatchlistUrl creates combined miniTicker URL for symbols', () => {
        const url = proxy._buildWatchlistUrl(['BTCUSDT', 'ETHUSDT']);
        expect(url).toContain('fstream.binance.com/stream?streams=');
        expect(url).toContain('btcusdt@miniTicker');
        expect(url).toContain('ethusdt@miniTicker');
    });

    test('buildWatchlistUrl uses default 8 symbols when none provided', () => {
        const url = proxy._buildWatchlistUrl();
        expect(url).toContain('btcusdt@miniTicker');
        expect(url).toContain('ethusdt@miniTicker');
        expect(url).toContain('solusdt@miniTicker');
        expect(url).toContain('bnbusdt@miniTicker');
    });

    test('startWatchlist opens WS to Binance', () => {
        const mockWs = { on: jest.fn(), send: jest.fn(), close: jest.fn(), ping: jest.fn(), readyState: 0 };
        jest.spyOn(proxy, '_createBinanceWs').mockReturnValue(mockWs);

        proxy.startWatchlist();
        expect(proxy._createBinanceWs).toHaveBeenCalledWith(expect.stringContaining('miniTicker'));
        expect(proxy.isWatchlistActive()).toBe(true);

        proxy._createBinanceWs.mockRestore();
    });

    test('startWatchlist is idempotent — second call does nothing', () => {
        const mockWs = { on: jest.fn(), send: jest.fn(), close: jest.fn(), ping: jest.fn(), readyState: 0 };
        const spy = jest.spyOn(proxy, '_createBinanceWs').mockReturnValue(mockWs);

        proxy.startWatchlist();
        proxy.startWatchlist();
        expect(spy).toHaveBeenCalledTimes(1);

        spy.mockRestore();
    });
});

describe('wsMarketProxy circuit breaker', () => {
    test('recordReconnectFailure increments failure count', () => {
        proxy._recordReconnectFailure('BTCUSDT');
        proxy._recordReconnectFailure('BTCUSDT');
        const health = proxy.getStreamHealth('BTCUSDT');
        expect(health.reconnectFailures).toBe(2);
    });

    test('circuit opens after 5 failures within 60s', () => {
        for (let i = 0; i < 5; i++) proxy._recordReconnectFailure('BTCUSDT');
        const health = proxy.getStreamHealth('BTCUSDT');
        expect(health.circuitState).toBe('OPEN');
    });

    test('circuit stays CLOSED under 5 failures', () => {
        for (let i = 0; i < 4; i++) proxy._recordReconnectFailure('BTCUSDT');
        const health = proxy.getStreamHealth('BTCUSDT');
        expect(health.circuitState).toBe('CLOSED');
    });

    test('clearReconnectFailures resets circuit to CLOSED', () => {
        for (let i = 0; i < 5; i++) proxy._recordReconnectFailure('BTCUSDT');
        expect(proxy.getStreamHealth('BTCUSDT').circuitState).toBe('OPEN');
        proxy._clearReconnectFailures('BTCUSDT');
        expect(proxy.getStreamHealth('BTCUSDT').circuitState).toBe('CLOSED');
    });

    test('isCircuitOpen returns true when OPEN', () => {
        for (let i = 0; i < 5; i++) proxy._recordReconnectFailure('BTCUSDT');
        expect(proxy._isCircuitOpen('BTCUSDT')).toBe(true);
    });

    test('isCircuitOpen returns false when CLOSED', () => {
        expect(proxy._isCircuitOpen('BTCUSDT')).toBe(false);
    });
});

describe('wsMarketProxy backpressure', () => {
    test('_safeSend delivers to healthy client', () => {
        const ws = { readyState: 1, send: jest.fn(), bufferedAmount: 0 };
        const result = proxy._safeSend(ws, '{"test":1}');
        expect(result).toBe(true);
        expect(ws.send).toHaveBeenCalled();
    });

    test('_safeSend skips closed client', () => {
        const ws = { readyState: 3, send: jest.fn(), bufferedAmount: 0 };
        const result = proxy._safeSend(ws, '{"test":1}');
        expect(result).toBe(false);
        expect(ws.send).not.toHaveBeenCalled();
    });

    test('_safeSend skips when bufferedAmount exceeds threshold', () => {
        const ws = { readyState: 1, send: jest.fn(), bufferedAmount: 200000 };
        const result = proxy._safeSend(ws, '{"test":1}');
        expect(result).toBe(false);
        expect(ws.send).not.toHaveBeenCalled();
    });

    test('_safeSend handles send exception gracefully', () => {
        const ws = { readyState: 1, send: jest.fn(() => { throw new Error('write fail'); }), bufferedAmount: 0 };
        const result = proxy._safeSend(ws, '{"test":1}');
        expect(result).toBe(false);
    });
});
