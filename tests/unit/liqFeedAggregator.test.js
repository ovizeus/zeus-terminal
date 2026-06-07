/**
 * Zeus Terminal — Unit Tests: liqFeedAggregator (Plan A 2026-05-14)
 *
 * Server-side liquidation feed aggregator. Wraps 3 exchange WS connections
 * (Binance forceOrder, Bybit liquidation, OKX liquidation-orders), buffers
 * last 1000 events per exchange, broadcasts each event via
 * `global.__zeusWsBroadcastAll` as `liq.feed` frame.
 *
 * Tests cover pure helpers — `_normalizeBinance`, `_normalizeBybit`,
 * `_normalizeOkx`, `_buffer` add/snapshot, `_broadcast` payload shape.
 * Actual WS lifecycle integration tested manual + PM2 logs post-deploy.
 *
 * Spec: _review/audit/LIQ_FEED_PROXY_PLAN_20260514.md
 */
'use strict';

jest.resetModules();

describe('liqFeedAggregator (Plan A — server-side proxy)', () => {
    test('exports start + stop + getState + _internal_for_test', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        expect(typeof mod.start).toBe('function');
        expect(typeof mod.stop).toBe('function');
        expect(typeof mod.getState).toBe('function');
        expect(typeof mod._internal_for_test).toBe('object');
    });

    test('_normalizeBinance parses forceOrder shape into canonical liq event', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _normalizeBinance } = mod._internal_for_test;
        const msg = { e: 'forceOrder', E: 1700000000000, o: { s: 'BTCUSDT', S: 'SELL', ap: '60000', q: '0.5', T: 1700000000001 } };
        const liq = _normalizeBinance(msg);
        expect(liq).toEqual({
            exchange: 'binance',
            symbol: 'BTCUSDT',
            side: 'SELL',
            isLong: true,
            p: 60000,
            q: 0.5,
            vol: 30000,
            time: 1700000000001,
        });
    });

    test('_normalizeBinance returns null on malformed/empty input', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _normalizeBinance } = mod._internal_for_test;
        expect(_normalizeBinance(null)).toBeNull();
        expect(_normalizeBinance({})).toBeNull();
        expect(_normalizeBinance({ e: 'forceOrder', o: { s: 'BTCUSDT', S: 'INVALID' } })).toBeNull();
        expect(_normalizeBinance({ e: 'forceOrder', o: { s: 'BTCUSDT', S: 'SELL', ap: '0', q: '0.5' } })).toBeNull();
    });

    test('_normalizeBybit parses Bybit liquidation payload', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _normalizeBybit } = mod._internal_for_test;
        const data = { symbol: 'BTCUSDT', side: 'Buy', size: '0.3', price: '61000', updatedTime: 1700000000123 };
        const liq = _normalizeBybit(data);
        expect(liq).toEqual({
            exchange: 'bybit',
            symbol: 'BTCUSDT',
            side: 'SELL',
            isLong: true,
            p: 61000,
            q: 0.3,
            vol: 18300,
            time: 1700000000123,
        });
    });

    test('_normalizeOkx parses OKX liquidation-orders payload', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _normalizeOkx } = mod._internal_for_test;
        const d = { instId: 'BTC-USDT-SWAP', side: 'sell', sz: '0.2', bkPx: '60500', ts: '1700000000456' };
        const liq = _normalizeOkx(d);
        expect(liq).toEqual({
            exchange: 'okx',
            symbol: 'BTCUSDT',
            side: 'SELL',
            isLong: true,
            p: 60500,
            q: 0.2,
            vol: 12100,
            time: 1700000000456,
        });
    });

    test('_buffer add caps at 1000 per exchange (oldest evicted)', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _buffer } = mod._internal_for_test;
        _buffer.clear();
        for (let i = 0; i < 1050; i++) {
            _buffer.add({ exchange: 'binance', symbol: 'BTCUSDT', time: i, p: 60000, q: 0.1, vol: 6000, side: 'SELL', isLong: true });
        }
        const snap = _buffer.snapshot('binance');
        expect(snap.length).toBe(1000);
        expect(snap[0].time).toBe(50);
        expect(snap[999].time).toBe(1049);
    });

    test('_broadcast invokes __zeusWsBroadcastAll with liq.feed frame shape', () => {
        const sent = [];
        global.__zeusWsBroadcastAll = (p) => { sent.push(p); return 1; };
        const mod = require('../../server/services/liqFeedAggregator');
        const { _broadcast } = mod._internal_for_test;
        const liq = { exchange: 'binance', symbol: 'BTCUSDT', side: 'SELL', isLong: true, p: 60000, q: 0.5, vol: 30000, time: 1700000000000 };
        const count = _broadcast(liq);
        expect(count).toBe(1);
        expect(sent.length).toBe(1);
        expect(sent[0]).toEqual({ type: 'liq.feed', data: liq });
        delete global.__zeusWsBroadcastAll;
    });

    test('_broadcast returns 0 when __zeusWsBroadcastAll undefined (boot ordering safety)', () => {
        delete global.__zeusWsBroadcastAll;
        const mod = require('../../server/services/liqFeedAggregator');
        const { _broadcast } = mod._internal_for_test;
        const liq = { exchange: 'binance', symbol: 'BTCUSDT', side: 'SELL', isLong: true, p: 60000, q: 0.5, vol: 30000, time: 1700000000000 };
        const count = _broadcast(liq);
        expect(count).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// [LIQ-FIX 2026-06-06] Bybit DEPRECATED the `liquidation.*` topic — live probe
// returned `error:handler not found,topic:liquidation.BTCUSDT` and the server
// sat at ev=0 with 600+ frames (pings only). Replacement: `allLiquidation.*`
// with a NEW payload shape {T,s,S,v,p} and INVERTED side semantics (docs:
// "when you receive a Buy update, a LONG position has been liquidated").
// ═══════════════════════════════════════════════════════════════════════════
describe('[LIQ-FIX] _normalizeBybit — allLiquidation shape {T,s,S,v,p}', () => {
    test('S=Buy → LONG liquidated → canonical side SELL / isLong true (docs semantics)', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _normalizeBybit } = mod._internal_for_test;
        const liq = _normalizeBybit({ T: 1780800000123, s: 'BTCUSDT', S: 'Buy', v: '0.5', p: '60000' });
        expect(liq).toEqual({
            exchange: 'bybit', symbol: 'BTCUSDT',
            side: 'SELL', isLong: true,
            p: 60000, q: 0.5, vol: 30000, time: 1780800000123,
        });
    });

    test('S=Sell → SHORT liquidated → canonical side BUY / isLong false', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _normalizeBybit } = mod._internal_for_test;
        const liq = _normalizeBybit({ T: 1780800000456, s: 'ETHUSDT', S: 'Sell', v: '2', p: '1500' });
        expect(liq).toMatchObject({ exchange: 'bybit', symbol: 'ETHUSDT', side: 'BUY', isLong: false, vol: 3000 });
    });

    test('legacy object shape still parses (defensive back-compat)', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _normalizeBybit } = mod._internal_for_test;
        const liq = _normalizeBybit({ symbol: 'BTCUSDT', side: 'Buy', size: '0.3', price: '61000', updatedTime: 1700000000123 });
        expect(liq).toMatchObject({ exchange: 'bybit', symbol: 'BTCUSDT', q: 0.3 });
    });

    test('malformed new-shape input → null', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _normalizeBybit } = mod._internal_for_test;
        expect(_normalizeBybit({ T: 1, s: 'BTCUSDT', S: 'Buy', v: '0', p: '60000' })).toBeNull();
        expect(_normalizeBybit({ T: 1, s: 'BTCUSDT', S: 'Hold', v: '1', p: '60000' })).toBeNull();
    });
});

// [LIQ-FIX 2026-06-06 #2] OKX liquidation-orders wraps the actual liquidation
// fields in data[i].details[] (push example from the official docs) — the
// handler fed data[i] directly into _normalizeOkx, which found no side/sz →
// ev=0 forever despite frames flowing. The handler now flattens details with
// the parent instId.
describe('[LIQ-FIX] OKX details[] flattening', () => {
    test('_normalizeOkx parses a flattened details item (docs push example)', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _normalizeOkx } = mod._internal_for_test;
        const liq = _normalizeOkx({ instId: 'BTC-USDT-SWAP', side: 'buy', sz: '13', bkPx: '60000', ts: '1692266434010' });
        expect(liq).toMatchObject({ exchange: 'okx', symbol: 'BTCUSDT', side: 'BUY', isLong: false, q: 13, p: 60000 });
    });

    test('_okxFlatten expands the wrapped docs shape into normalizable items', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _okxFlatten } = mod._internal_for_test;
        const wrapped = [{
            instId: 'BTC-USDT-SWAP', instType: 'SWAP', instFamily: 'BTC-USDT',
            details: [
                { side: 'buy', sz: '13', bkPx: '60000', ts: '1692266434010' },
                { side: 'sell', sz: '2', bkPx: '59000', ts: '1692266434020' },
            ],
        }]
        const flat = _okxFlatten(wrapped);
        expect(flat.length).toBe(2);
        expect(flat[0]).toMatchObject({ instId: 'BTC-USDT-SWAP', side: 'buy', sz: '13' });
        expect(flat[1]).toMatchObject({ instId: 'BTC-USDT-SWAP', side: 'sell' });
    });

    test('_okxFlatten passes through legacy un-wrapped items (no details)', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _okxFlatten } = mod._internal_for_test;
        const flat = _okxFlatten([{ instId: 'ETH-USDT-SWAP', side: 'buy', sz: '1', bkPx: '1500', ts: '1' }]);
        expect(flat.length).toBe(1);
        expect(flat[0].instId).toBe('ETH-USDT-SWAP');
    });
});

describe('[LIQ-WARMUP 2026-06-07] getRecent — new-client warmup buffer access', () => {
    test('returns merged buffer sorted by time ascending, capped by limit', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        const { _buffer } = mod._internal_for_test;
        _buffer.clear();
        _buffer.add({ exchange: 'okx', symbol: 'BTCUSDT', side: 'SELL', isLong: true, p: 60000, q: 0.1, vol: 6000, time: 3000 });
        _buffer.add({ exchange: 'bybit', symbol: 'ETHUSDT', side: 'BUY', isLong: false, p: 1600, q: 1, vol: 1600, time: 1000 });
        _buffer.add({ exchange: 'binance', symbol: 'BTCUSDT', side: 'SELL', isLong: true, p: 60001, q: 0.2, vol: 12000, time: 2000 });

        const all = mod.getRecent();
        expect(all.map(e => e.time)).toEqual([1000, 2000, 3000]); // ascending — replay order
        expect(all.map(e => e.exchange)).toEqual(['bybit', 'binance', 'okx']);

        const capped = mod.getRecent(2);
        expect(capped.length).toBe(2);
        // cap keeps the MOST RECENT events (tail), still ascending
        expect(capped.map(e => e.time)).toEqual([2000, 3000]);
        _buffer.clear();
    });

    test('empty buffers → empty array (never throws)', () => {
        const mod = require('../../server/services/liqFeedAggregator');
        mod._internal_for_test._buffer.clear();
        expect(mod.getRecent()).toEqual([]);
    });
});
