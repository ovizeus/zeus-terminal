'use strict';

const EventEmitter = require('events');

// Mock ws BEFORE requiring bybitFeed
class MockWebSocket extends EventEmitter {
    constructor(url) {
        super();
        this.url = url;
        this.readyState = 0;
        setTimeout(() => { this.readyState = 1; this.emit('open'); }, 10);
    }
    send(data) { this.lastSend = data; }
    ping() { this.pingCalled = true; }
    close() {
        this.readyState = 3;
        this.emit('close', 1000);
    }
}
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSED = 3;
jest.mock('ws', () => MockWebSocket);

const bybitFeed = require('../../server/services/bybitFeed');

describe('bybitFeed — connection lifecycle', () => {
    beforeEach(() => {
        bybitFeed._resetForTest();
    });
    afterEach(() => {
        bybitFeed.stop();
        bybitFeed._resetForTest();
    });

    it('start() connects to stream.bybit.com/v5/public/linear', async () => {
        bybitFeed.start();
        await new Promise(r => setTimeout(r, 50));
        const state = bybitFeed.getConnectionState();
        expect(state.url).toContain('stream.bybit.com/v5/public/linear');
        expect(state.connected).toBe(true);
    });

    it('stop() closes connection', async () => {
        bybitFeed.start();
        await new Promise(r => setTimeout(r, 50));
        bybitFeed.stop();
        const state = bybitFeed.getConnectionState();
        expect(state.connected).toBe(false);
    });

    it('start() is idempotent (second call no-op)', async () => {
        bybitFeed.start();
        await new Promise(r => setTimeout(r, 50));
        const before = bybitFeed.getConnectionState();
        bybitFeed.start(); // second call
        const after = bybitFeed.getConnectionState();
        // running flag prevents double connect — same state
        expect(after.running).toBe(before.running);
    });

    it('getConnectionState exposes shape', async () => {
        const state = bybitFeed.getConnectionState();
        expect(state).toHaveProperty('url');
        expect(state).toHaveProperty('connected');
        expect(state).toHaveProperty('running');
        expect(state).toHaveProperty('framesReceived');
        expect(state).toHaveProperty('eventsEmitted');
        expect(state).toHaveProperty('lastMessageTs');
    });

    it('start() then stop() sets running false', async () => {
        bybitFeed.start();
        await new Promise(r => setTimeout(r, 50));
        expect(bybitFeed.getConnectionState().running).toBe(true);
        bybitFeed.stop();
        expect(bybitFeed.getConnectionState().running).toBe(false);
    });

    it('on/off exposed (EventEmitter API)', () => {
        const handler = () => {};
        expect(() => bybitFeed.on('test', handler)).not.toThrow();
        expect(() => bybitFeed.off('test', handler)).not.toThrow();
    });

    it('exposes SYMBOLS array (BTC/ETH/SOL/BNB)', () => {
        expect(bybitFeed.SYMBOLS).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']);
    });

    it('exposes TIMEFRAMES_BYBIT map (5m→5, 1h→60, 4h→240)', () => {
        expect(bybitFeed.TIMEFRAMES_BYBIT).toEqual({ '5m': '5', '1h': '60', '4h': '240' });
    });

    describe('subscribe batched on open', () => {
        it('sends 3 subscribe messages on connection open', async () => {
            // Note: mock ws captures `lastSend` only. To verify multiple sends,
            // we need to instrument the mock.
            const sends = [];
            const WebSocketModule = require('ws');
            const origSend = WebSocketModule.prototype.send;
            // Patch send to collect
            WebSocketModule.prototype.send = function(data) {
                sends.push(data);
                this.lastSend = data;
            };

            try {
                bybitFeed.start();
                await new Promise(r => setTimeout(r, 50));
                // Should have sent at least 3 subscribe batches
                const subscribeMsgs = sends.filter(s => {
                    try {
                        const parsed = JSON.parse(s);
                        return parsed.op === 'subscribe';
                    } catch (_) { return false; }
                });
                expect(subscribeMsgs.length).toBe(3);
            } finally {
                WebSocketModule.prototype.send = origSend;
                bybitFeed.stop();
            }
        });

        it('subscribe message 1 contains 12 kline topics for 4 symbols x 3 timeframes', async () => {
            const sends = [];
            const WebSocketModule = require('ws');
            const origSend = WebSocketModule.prototype.send;
            WebSocketModule.prototype.send = function(data) { sends.push(data); this.lastSend = data; };
            try {
                bybitFeed.start();
                await new Promise(r => setTimeout(r, 50));
                const subs = sends.map(s => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(s => s && s.op === 'subscribe');
                const allTopics = subs.flatMap(s => s.args || []);
                const klineTopics = allTopics.filter(t => t.startsWith('kline.'));
                expect(klineTopics.length).toBe(12);
                expect(klineTopics).toContain('kline.5.BTCUSDT');
                expect(klineTopics).toContain('kline.60.ETHUSDT');
                expect(klineTopics).toContain('kline.240.SOLUSDT');
                expect(klineTopics).toContain('kline.5.BNBUSDT');
            } finally {
                WebSocketModule.prototype.send = origSend;
                bybitFeed.stop();
            }
        });

        it('subscribe contains 4 publicTrade + 4 tickers + 4 orderbook.1 topics', async () => {
            const sends = [];
            const WebSocketModule = require('ws');
            const origSend = WebSocketModule.prototype.send;
            WebSocketModule.prototype.send = function(data) { sends.push(data); this.lastSend = data; };
            try {
                bybitFeed.start();
                await new Promise(r => setTimeout(r, 50));
                const subs = sends.map(s => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(s => s && s.op === 'subscribe');
                const allTopics = subs.flatMap(s => s.args || []);
                const trade = allTopics.filter(t => t.startsWith('publicTrade.'));
                const tickers = allTopics.filter(t => t.startsWith('tickers.'));
                const orderbook = allTopics.filter(t => t.startsWith('orderbook.1.'));
                expect(trade.length).toBe(4);
                expect(tickers.length).toBe(4);
                expect(orderbook.length).toBe(4);
            } finally {
                WebSocketModule.prototype.send = origSend;
                bybitFeed.stop();
            }
        });

        it('subscribe message includes unique req_id per batch', async () => {
            const sends = [];
            const WebSocketModule = require('ws');
            const origSend = WebSocketModule.prototype.send;
            WebSocketModule.prototype.send = function(data) { sends.push(data); this.lastSend = data; };
            try {
                bybitFeed.start();
                await new Promise(r => setTimeout(r, 50));
                const subs = sends.map(s => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(s => s && s.op === 'subscribe');
                const reqIds = subs.map(s => s.req_id);
                expect(reqIds.length).toBe(3);
                expect(new Set(reqIds).size).toBe(3); // all unique
            } finally {
                WebSocketModule.prototype.send = origSend;
                bybitFeed.stop();
            }
        });
    });
});
