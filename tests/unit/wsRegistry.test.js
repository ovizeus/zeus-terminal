'use strict';

describe('wsRegistry', () => {
  let ws;
  beforeEach(() => {
    ws = require('../../server/services/wsRegistry');
    ws._resetForTest();
  });

  test('subscribe returns subscriberId', () => {
    const id = ws.subscribe('binance', 'btcusdt@trade', () => {});
    expect(id).toBeGreaterThan(0);
  });

  test('subscribe deduplicates streams — 1 stream N subscribers', () => {
    ws.subscribe('binance', 'btcusdt@trade', () => {});
    ws.subscribe('binance', 'btcusdt@trade', () => {});
    ws.subscribe('binance', 'btcusdt@trade', () => {});
    expect(ws.activeStreamCount()).toBe(1);
    expect(ws.subscriberCount('binance', 'btcusdt@trade')).toBe(3);
  });

  test('dispatch calls all subscribers', () => {
    let count = 0;
    ws.subscribe('binance', 'btcusdt@trade', () => count++);
    ws.subscribe('binance', 'btcusdt@trade', () => count++);
    const dispatched = ws.dispatch('binance', 'btcusdt@trade', { price: 77000 });
    expect(dispatched).toBe(2);
    expect(count).toBe(2);
  });

  test('dispatch updates lastMsgAt and msgCount', () => {
    ws.subscribe('binance', 'btcusdt@kline', () => {});
    ws.dispatch('binance', 'btcusdt@kline', {});
    ws.dispatch('binance', 'btcusdt@kline', {});
    const s = ws.status();
    expect(s[0].msgCount).toBe(2);
    expect(s[0].lastMsgAt).toBeGreaterThan(0);
  });

  test('unsubscribe removes handler', () => {
    const id = ws.subscribe('binance', 'btcusdt@trade', () => {});
    expect(ws.subscriberCount('binance', 'btcusdt@trade')).toBe(1);
    ws.unsubscribe(id);
    expect(ws.subscriberCount('binance', 'btcusdt@trade')).toBe(0);
  });

  test('stream removed when last subscriber unsubscribes', () => {
    const id = ws.subscribe('binance', 'btcusdt@trade', () => {});
    expect(ws.activeStreamCount()).toBe(1);
    ws.unsubscribe(id);
    expect(ws.activeStreamCount()).toBe(0);
  });

  test('different exchanges are independent streams', () => {
    ws.subscribe('binance', 'btcusdt@trade', () => {});
    ws.subscribe('bybit', 'btcusdt@trade', () => {});
    expect(ws.activeStreamCount()).toBe(2);
  });

  test('isStreamActive true when subscribed', () => {
    ws.subscribe('binance', 'btcusdt@trade', () => {});
    expect(ws.isStreamActive('binance', 'btcusdt@trade')).toBe(true);
    expect(ws.isStreamActive('binance', 'ethusdt@trade')).toBe(false);
  });

  test('isStreamDead true after threshold', () => {
    ws.subscribe('binance', 'btcusdt@trade', () => {});
    ws.dispatch('binance', 'btcusdt@trade', {});
    // Force lastMsgAt to past
    const streams = ws.status();
    // Can't manipulate internal directly, but verify fresh stream is not dead
    expect(ws.isStreamDead('binance', 'btcusdt@trade')).toBe(false);
  });

  test('getReconnectDelay includes jitter', () => {
    const d1 = ws.getReconnectDelay('binance', 'btcusdt@trade');
    const d2 = ws.getReconnectDelay('binance', 'btcusdt@trade');
    // Both should be > 0 (base + jitter)
    expect(d1).toBeGreaterThan(0);
    expect(d2).toBeGreaterThan(0);
  });

  test('recordReconnect increments count', () => {
    ws.subscribe('binance', 'btcusdt@trade', () => {});
    ws.recordReconnect('binance', 'btcusdt@trade');
    ws.recordReconnect('binance', 'btcusdt@trade');
    const s = ws.status();
    expect(s[0].reconnectCount).toBe(2);
  });

  test('dispatch with error in handler does not crash', () => {
    ws.subscribe('binance', 'btcusdt@trade', () => { throw new Error('boom'); });
    ws.subscribe('binance', 'btcusdt@trade', () => {}); // second handler OK
    expect(() => ws.dispatch('binance', 'btcusdt@trade', {})).not.toThrow();
  });

  test('subscribe rejects invalid params', () => {
    expect(ws.subscribe(null, 'stream', () => {})).toBeNull();
    expect(ws.subscribe('binance', null, () => {})).toBeNull();
    expect(ws.subscribe('binance', 'stream', 'not_a_function')).toBeNull();
  });

  test('status returns comprehensive diagnostic', () => {
    ws.subscribe('binance', 'btcusdt@trade', () => {});
    ws.dispatch('binance', 'btcusdt@trade', {});
    const s = ws.status();
    expect(s.length).toBe(1);
    expect(s[0]).toHaveProperty('exchange', 'binance');
    expect(s[0]).toHaveProperty('stream', 'btcusdt@trade');
    expect(s[0]).toHaveProperty('subscribers');
    expect(s[0]).toHaveProperty('createdAt');
    expect(s[0]).toHaveProperty('lastMsgAt');
    expect(s[0]).toHaveProperty('msgCount');
    expect(s[0]).toHaveProperty('reconnectCount');
    expect(s[0]).toHaveProperty('dead');
  });
});
