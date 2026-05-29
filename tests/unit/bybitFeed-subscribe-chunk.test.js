'use strict';

// Phase B / Task B1 — Bybit subscribe batching bug.
// ROOT CAUSE: _sendSubscribeBatches put all 12 kline topics (4 symbols × 3 TFs)
// in ONE subscribe message, but Bybit V5 allows max ~10 args per request → that
// batch got ret_msg=fail → klines never subscribed (half-failing feed).
// FIX: chunk ALL topics into batches of <=10. Pure _chunkTopics tested here;
// wiring into _sendSubscribeBatches verified by code-read + the real-topics test.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-bybitchunk';

let chunkTopics, buildTopics, MAX;
beforeAll(() => {
    const bf = require('../../server/services/bybitFeed');
    chunkTopics = bf._chunkTopics;
    buildTopics = bf._buildTopics;
    MAX = bf.BYBIT_MAX_TOPICS_PER_MSG;
});

describe('_chunkTopics — never exceed Bybit per-message arg limit', () => {
    test('exposes a max-per-message limit of 10 (Bybit V5)', () => {
        expect(MAX).toBe(10);
    });

    test('24 topics → [10,10,4]', () => {
        const arr = Array.from({ length: 24 }, (_, i) => 't' + i);
        const out = chunkTopics(arr, 10);
        expect(out.map(b => b.length)).toEqual([10, 10, 4]);
    });

    test('12 topics → [10,2] (the kline batch that was failing)', () => {
        const arr = Array.from({ length: 12 }, (_, i) => 'k' + i);
        const out = chunkTopics(arr, 10);
        expect(out.map(b => b.length)).toEqual([10, 2]);
    });

    test('exactly 10 → single batch', () => {
        expect(chunkTopics(Array(10).fill('x'), 10).map(b => b.length)).toEqual([10]);
    });

    test('empty → no batches', () => {
        expect(chunkTopics([], 10)).toEqual([]);
    });

    test('no topic lost and order preserved', () => {
        const arr = Array.from({ length: 23 }, (_, i) => 'a' + i);
        const flat = chunkTopics(arr, 10).flat();
        expect(flat).toEqual(arr);
    });

    test('REAL built topics: every batch <= limit (regression guard)', () => {
        const t = buildTopics();
        const all = [...t.kline, ...t.trade, ...t.tickers, ...t.orderbook];
        const batches = chunkTopics(all, MAX);
        for (const b of batches) expect(b.length).toBeLessThanOrEqual(MAX);
        // and nothing dropped
        expect(batches.flat().length).toBe(all.length);
        // kline must be present (the bug dropped these)
        expect(all.filter(x => x.startsWith('kline.')).length).toBe(12);
    });
});
