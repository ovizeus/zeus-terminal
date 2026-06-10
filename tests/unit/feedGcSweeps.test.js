'use strict';

// GC sweep tests for the 3 unbounded feed maps (P1 leak remainder):
//  - bybitFeed._failedTopics      (permanently-failed subscription topics)
//  - bybitFeed._pendingByReqId    (subscribe batches orphaned by socket death pre-ACK)
//  - wsMarketProxy._healthState   (per-symbol health entries never evicted)
// Sweeps are pure-callable with injected `now` — no fake timers needed.

const EventEmitter = require('events');

// Mock ws BEFORE requiring the modules (same pattern as bybitFeed.test.js)
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
const proxy = require('../../server/services/wsMarketProxy');

const HOUR_MS = 60 * 60 * 1000;

describe('bybitFeed GC sweep — _failedTopics + _pendingByReqId', () => {
    beforeEach(() => bybitFeed._resetForTest());
    afterEach(() => {
        bybitFeed.stop();
        bybitFeed._resetForTest();
    });

    test('failed topic with retries >= 10 evicted; fresh low-retry topic kept', () => {
        const now = Date.now();
        const { failedTopics } = bybitFeed._getSubscriptionState();
        failedTopics.set('kline.5.DEADUSDT', { retries: 10, nextRetryAt: now + 1000, failedAt: now - 5000 });
        failedTopics.set('kline.5.FRESHUSDT', { retries: 2, nextRetryAt: now + 1000, failedAt: now - 5000 });

        bybitFeed._gcSweep(now);

        expect(failedTopics.has('kline.5.DEADUSDT')).toBe(false);
        expect(failedTopics.has('kline.5.FRESHUSDT')).toBe(true);
        expect(bybitFeed._getGcStatsForTest().failedTopics).toBe(1);
    });

    test('failed topic older than 1h evicted even with low retries', () => {
        const now = Date.now();
        const { failedTopics } = bybitFeed._getSubscriptionState();
        failedTopics.set('publicTrade.OLDUSDT', { retries: 1, nextRetryAt: 0, failedAt: now - HOUR_MS - 1 });
        failedTopics.set('publicTrade.NEWUSDT', { retries: 1, nextRetryAt: 0, failedAt: now - HOUR_MS + 60_000 });

        bybitFeed._gcSweep(now);

        expect(failedTopics.has('publicTrade.OLDUSDT')).toBe(false);
        expect(failedTopics.has('publicTrade.NEWUSDT')).toBe(true);
    });

    test('entries created via failed ACK carry failedAt and age out', () => {
        // Drive the public path: pending batch + failed ack → _failedTopics entry
        const { pendingByReqId, failedTopics } = bybitFeed._getSubscriptionState();
        pendingByReqId.set('req-1', { topics: ['tickers.XUSDT'], sentAt: Date.now() });
        bybitFeed._dispatchMessage({ op: 'subscribe', req_id: 'req-1', success: false, ret_msg: 'fail' });

        const entry = failedTopics.get('tickers.XUSDT');
        expect(entry).toBeDefined();
        expect(typeof entry.failedAt).toBe('number');

        // 1h+ later the entry is swept
        bybitFeed._gcSweep(entry.failedAt + HOUR_MS + 1);
        expect(failedTopics.has('tickers.XUSDT')).toBe(false);
    });

    test('pending request older than 120s evicted; recent one kept', () => {
        const now = Date.now();
        const { pendingByReqId } = bybitFeed._getSubscriptionState();
        pendingByReqId.set('req-orphan', { topics: ['kline.5.BTCUSDT'], sentAt: now - 120_001 });
        pendingByReqId.set('req-live', { topics: ['kline.5.ETHUSDT'], sentAt: now - 5_000 });

        bybitFeed._gcSweep(now);

        expect(pendingByReqId.has('req-orphan')).toBe(false);
        expect(pendingByReqId.has('req-live')).toBe(true);
        expect(bybitFeed._getGcStatsForTest().pendingByReqId).toBe(1);
    });

    test('sweep never throws on empty maps', () => {
        expect(() => bybitFeed._gcSweep()).not.toThrow();
        expect(bybitFeed._getGcStatsForTest()).toEqual({ failedTopics: 0, pendingByReqId: 0 });
    });
});

describe('wsMarketProxy GC sweep — _healthState TTL', () => {
    afterEach(() => proxy._resetForTest());

    test('stale unsubscribed symbol evicted after 1h', () => {
        const now = Date.now();
        proxy._recordEventAt('OLDCOIN', 'price', 1.23, now - HOUR_MS - 1);

        proxy._healthStateSweep(now);

        expect(proxy._getHealthStateStatsForTest().healthState).toBe(0);
        expect(proxy.getHealthSnapshot().streams.OLDCOIN).toBeUndefined();
    });

    test('symbol with active subscription kept regardless of age', () => {
        const now = Date.now();
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');
        proxy._recordEventAt('BTCUSDT', 'price', 50000, now - 10 * HOUR_MS);

        proxy._healthStateSweep(now);

        expect(proxy._getHealthStateStatsForTest().healthState).toBe(1);
        expect(proxy.getHealthSnapshot().streams.BTCUSDT).toBeDefined();
    });

    test('fresh unsubscribed symbol kept', () => {
        const now = Date.now();
        proxy._recordEventAt('FRESHCOIN', 'price', 9.99, now - 60_000);

        proxy._healthStateSweep(now);

        expect(proxy._getHealthStateStatsForTest().healthState).toBe(1);
    });

    test('mixed: only stale unsubscribed entry evicted', () => {
        const now = Date.now();
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'ETHUSDT');
        proxy._recordEventAt('ETHUSDT', 'price', 3000, now - 2 * HOUR_MS);  // subscribed, old → kept
        proxy._recordEventAt('GHOSTCOIN', 'price', 1, now - 2 * HOUR_MS);   // unsubscribed, old → evicted
        proxy._recordEventAt('NEWCOIN', 'price', 2, now - 1000);            // unsubscribed, fresh → kept

        proxy._healthStateSweep(now);

        const snap = proxy.getHealthSnapshot().streams;
        expect(snap.ETHUSDT).toBeDefined();
        expect(snap.GHOSTCOIN).toBeUndefined();
        expect(snap.NEWCOIN).toBeDefined();
    });

    test('sweep never throws on empty map', () => {
        expect(() => proxy._healthStateSweep()).not.toThrow();
        expect(proxy._getHealthStateStatsForTest().healthState).toBe(0);
    });
});
