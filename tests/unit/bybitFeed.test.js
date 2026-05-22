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
});
