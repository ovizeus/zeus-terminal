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

    describe('kline normalization (_normalizeKline)', () => {
        it('normalizes Bybit V5 kline message to canonical shape', () => {
            const result = bybitFeed._normalizeKline({
                topic: 'kline.5.BTCUSDT',
                data: [{
                    start: 1672304400000,
                    end: 1672304699999,
                    interval: '5',
                    open: '16649.50',
                    close: '16652.00',
                    high: '16660.00',
                    low: '16645.00',
                    volume: '125.5',
                    turnover: '2089100',
                    confirm: false,
                    timestamp: 1672304492714,
                }],
                ts: 1672304492714,
                type: 'snapshot',
            });
            expect(result).toEqual([{
                symbol: 'BTCUSDT',
                tf: '5m',
                open: 16649.50,
                high: 16660.00,
                low: 16645.00,
                close: 16652.00,
                volume: 125.5,
                ts: 1672304400000,
                confirmed: false,
                rawExchange: 'bybit',
            }]);
        });

        it('maps interval 60 → 1h timeframe', () => {
            const result = bybitFeed._normalizeKline({
                topic: 'kline.60.ETHUSDT',
                data: [{ start: 1, interval: '60', open: '1', close: '2', high: '3', low: '0.5', volume: '10', confirm: true }],
            });
            expect(result[0].tf).toBe('1h');
            expect(result[0].confirmed).toBe(true);
        });

        it('maps interval 240 → 4h timeframe', () => {
            const result = bybitFeed._normalizeKline({
                topic: 'kline.240.SOLUSDT',
                data: [{ start: 1, interval: '240', open: '1', close: '2', high: '3', low: '0.5', volume: '10', confirm: false }],
            });
            expect(result[0].tf).toBe('4h');
        });

        it('returns null/empty for invalid messages', () => {
            expect(bybitFeed._normalizeKline(null)).toEqual([]);
            expect(bybitFeed._normalizeKline({})).toEqual([]);
            expect(bybitFeed._normalizeKline({ topic: 'kline.5.BTCUSDT' })).toEqual([]);
            expect(bybitFeed._normalizeKline({ topic: 'kline.5.BTCUSDT', data: [] })).toEqual([]);
            expect(bybitFeed._normalizeKline({ topic: 'kline.99.BTCUSDT', data: [{ start: 1, open: '1', close: '1', high: '1', low: '1', volume: '1' }] })).toEqual([]); // unknown interval
        });

        it('handles array with multiple klines (snapshot can have many)', () => {
            const result = bybitFeed._normalizeKline({
                topic: 'kline.5.BTCUSDT',
                data: [
                    { start: 1, interval: '5', open: '1', close: '2', high: '3', low: '0.5', volume: '10', confirm: true },
                    { start: 2, interval: '5', open: '2', close: '3', high: '4', low: '1', volume: '20', confirm: false },
                ],
            });
            expect(result.length).toBe(2);
            expect(result[0].ts).toBe(1);
            expect(result[1].ts).toBe(2);
        });

        it('emits "kline" event when WS receives kline message', async () => {
            bybitFeed.start();
            await new Promise(r => setTimeout(r, 50));

            const events = [];
            bybitFeed.on('kline', (data) => events.push(data));

            // Simulate WS message via _dispatchMessage
            bybitFeed._dispatchMessage({
                topic: 'kline.5.BTCUSDT',
                data: [{ start: 1, interval: '5', open: '50000', close: '50100', high: '50200', low: '49900', volume: '5', confirm: true }],
            });

            expect(events.length).toBe(1);
            expect(events[0].symbol).toBe('BTCUSDT');
            expect(events[0].tf).toBe('5m');
            expect(events[0].confirmed).toBe(true);

            bybitFeed.stop();
        });
    });

    describe('trade normalization (_normalizeTrade)', () => {
        it('normalizes Bybit V5 publicTrade message', () => {
            const result = bybitFeed._normalizeTrade({
                topic: 'publicTrade.BTCUSDT',
                data: [{ T: 1672304486865, s: 'BTCUSDT', S: 'Buy', v: '0.001', p: '16578.50' }],
            });
            expect(result).toEqual([{
                symbol: 'BTCUSDT', side: 'BUY', price: 16578.50, qty: 0.001, ts: 1672304486865, rawExchange: 'bybit',
            }]);
        });

        it('maps "Sell" → SELL', () => {
            const result = bybitFeed._normalizeTrade({
                topic: 'publicTrade.ETHUSDT',
                data: [{ T: 1, s: 'ETHUSDT', S: 'Sell', v: '0.5', p: '1900' }],
            });
            expect(result[0].side).toBe('SELL');
        });

        it('returns [] on invalid input', () => {
            expect(bybitFeed._normalizeTrade(null)).toEqual([]);
            expect(bybitFeed._normalizeTrade({})).toEqual([]);
            expect(bybitFeed._normalizeTrade({ topic: 'publicTrade.BTCUSDT', data: [] })).toEqual([]);
            expect(bybitFeed._normalizeTrade({ topic: 'publicTrade.BTCUSDT', data: [{ T: 1, S: 'Other', v: '1', p: '1' }] })).toEqual([]);
        });

        it('skips rows with invalid numeric fields', () => {
            const result = bybitFeed._normalizeTrade({
                topic: 'publicTrade.BTCUSDT',
                data: [
                    { T: 1, s: 'BTC', S: 'Buy', v: 'abc', p: '1' },
                    { T: 2, s: 'BTC', S: 'Buy', v: '1', p: '50000' },
                ],
            });
            expect(result.length).toBe(1);
            expect(result[0].ts).toBe(2);
        });
    });

    describe('bookTicker normalization (_normalizeBookTicker)', () => {
        it('normalizes orderbook.1 message to canonical bookTicker', () => {
            const result = bybitFeed._normalizeBookTicker({
                topic: 'orderbook.1.BTCUSDT',
                data: { s: 'BTCUSDT', b: [['16578.50', '0.5']], a: [['16578.60', '0.6']], u: 1, seq: 1 },
                ts: 1672304484978,
            });
            expect(result).toEqual({
                symbol: 'BTCUSDT', bid: 16578.50, bidQty: 0.5, ask: 16578.60, askQty: 0.6,
                ts: 1672304484978, rawExchange: 'bybit',
            });
        });

        it('returns null on invalid input', () => {
            expect(bybitFeed._normalizeBookTicker(null)).toBeNull();
            expect(bybitFeed._normalizeBookTicker({})).toBeNull();
            expect(bybitFeed._normalizeBookTicker({ topic: 'orderbook.1.BTC', data: { b: [], a: [] } })).toBeNull();
            expect(bybitFeed._normalizeBookTicker({ topic: 'orderbook.1.BTC', data: { b: [['x', 'y']], a: [['z', 'w']] } })).toBeNull();
        });

        it('uses Date.now() when ts missing', () => {
            const before = Date.now();
            const result = bybitFeed._normalizeBookTicker({
                topic: 'orderbook.1.BTCUSDT',
                data: { s: 'BTCUSDT', b: [['1', '1']], a: [['2', '2']] },
            });
            const after = Date.now();
            expect(result.ts).toBeGreaterThanOrEqual(before);
            expect(result.ts).toBeLessThanOrEqual(after);
        });
    });

    describe('markPrice normalization (_normalizeMarkPrice)', () => {
        it('normalizes tickers message to canonical markPrice', () => {
            const result = bybitFeed._normalizeMarkPrice({
                topic: 'tickers.BTCUSDT',
                data: {
                    symbol: 'BTCUSDT',
                    markPrice: '16574.16',
                    indexPrice: '16573.50',
                    fundingRate: '-0.000034',
                    nextFundingTime: '1672387200000',
                },
                ts: 1672304486868,
            });
            expect(result).toEqual({
                symbol: 'BTCUSDT', markPrice: 16574.16, indexPrice: 16573.50,
                fundingRate: -0.000034, nextFundingTime: 1672387200000,
                ts: 1672304486868, rawExchange: 'bybit',
            });
        });

        it('returns null when markPrice missing/invalid', () => {
            expect(bybitFeed._normalizeMarkPrice(null)).toBeNull();
            expect(bybitFeed._normalizeMarkPrice({})).toBeNull();
            expect(bybitFeed._normalizeMarkPrice({ topic: 'tickers.BTC', data: {} })).toBeNull();
            expect(bybitFeed._normalizeMarkPrice({ topic: 'tickers.BTC', data: { markPrice: 'NaN' } })).toBeNull();
        });

        it('handles partial updates (only markPrice present, no funding)', () => {
            const result = bybitFeed._normalizeMarkPrice({
                topic: 'tickers.ETHUSDT',
                data: { symbol: 'ETHUSDT', markPrice: '1900.5' },
                ts: 999,
            });
            expect(result.markPrice).toBe(1900.5);
            expect(result.indexPrice).toBeNull();
            expect(result.fundingRate).toBeNull();
        });
    });

    describe('event dispatch for new topics', () => {
        it('emits "trade" event on publicTrade message', async () => {
            bybitFeed.start();
            await new Promise(r => setTimeout(r, 50));
            const events = [];
            bybitFeed.on('trade', d => events.push(d));
            bybitFeed._dispatchMessage({
                topic: 'publicTrade.BTCUSDT',
                data: [{ T: 1, s: 'BTC', S: 'Buy', v: '1', p: '50000' }],
            });
            expect(events.length).toBe(1);
            expect(events[0].side).toBe('BUY');
            bybitFeed.stop();
        });

        it('emits "bookTicker" event on orderbook.1 message', async () => {
            bybitFeed.start();
            await new Promise(r => setTimeout(r, 50));
            const events = [];
            bybitFeed.on('bookTicker', d => events.push(d));
            bybitFeed._dispatchMessage({
                topic: 'orderbook.1.BTCUSDT',
                data: { s: 'BTC', b: [['1', '1']], a: [['2', '2']] },
                ts: 5,
            });
            expect(events.length).toBe(1);
            expect(events[0].bid).toBe(1);
            bybitFeed.stop();
        });

        it('emits "markPrice" event on tickers message', async () => {
            bybitFeed.start();
            await new Promise(r => setTimeout(r, 50));
            const events = [];
            bybitFeed.on('markPrice', d => events.push(d));
            bybitFeed._dispatchMessage({
                topic: 'tickers.BTCUSDT',
                data: { symbol: 'BTC', markPrice: '1.5' },
                ts: 5,
            });
            expect(events.length).toBe(1);
            expect(events[0].markPrice).toBe(1.5);
            bybitFeed.stop();
        });
    });
});
