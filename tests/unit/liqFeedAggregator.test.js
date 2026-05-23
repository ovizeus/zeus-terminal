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
