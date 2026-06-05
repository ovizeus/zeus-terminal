'use strict';

// [BUG A+B 2026-06-05]
//
// BUG A — SL/TP conditional algo orders set no workingType → Binance default
// CONTRACT_PRICE (last price). On testnet the book is thin and prints wild
// wicks: both 2026-06-04 SP2-a positions were killed in <11s by their OWN SLs
// (verified on-exchange: close clientOrderId sl_SAT_...; BNB filled 611.07
// while mark was ~596). MARK_PRICE is the standard anti-wick trigger and is
// the correct semantic for protection orders on REAL too. Per official docs,
// /fapi/v1/algoOrder accepts workingType MARK_PRICE|CONTRACT_PRICE.
//
// BUG B — when the exchange-side SL fires first, serverAT's ACCOUNT_UPDATE
// handler classifies the close as EXTERNAL_CLOSE with PnL=$0.00 (the position
// payload's unrealizedPnL is 0 at amt=0 and exitPrice falls back to entry).
// The SL child's ORDER_TRADE_UPDATE arrives ~40ms later carrying clientOrderId
// 'sl_<decisionKey>_<i>' (proven by exchange query), avgPrice (real exit) and
// rp (REAL realized PnL). Fix: correlate via _exitFillTracker — record sl_/tp_
// fills, match them (immediately or via short defer) when POSITION_CLOSED
// lands → HIT_SL/HIT_TP with real exit price + real PnL; EXTERNAL_CLOSE stays
// as the fallback (fail-closed: unknown closes still surface as external).

describe('BUG A — binanceOps._placeConditionalAlgo workingType=MARK_PRICE', () => {
    let mockSend;
    beforeEach(() => {
        jest.resetModules();
        mockSend = jest.fn(() => Promise.resolve({ algoId: 999 }));
        jest.doMock('../../server/services/database', () => ({
            db: { prepare: () => ({ get: () => null, run: () => ({ lastInsertRowid: 7 }), all: () => [] }) },
        }));
        jest.doMock('../../server/services/binanceSigner', () => ({ sendSignedRequest: (...a) => mockSend(...a) }));
        jest.doMock('../../server/services/exchangeInfo', () => ({ roundOrderParams: (s, q) => ({ quantity: String(q) }) }));
        jest.doMock('../../server/services/orderLock', () => ({ acquire: async () => true, release: () => {} }));
        jest.doMock('../../server/services/positionStateMachine', () => ({ transition: () => {} }));
        jest.doMock('../../server/services/positionEvents', () => ({ append: () => {} }));
    });
    afterEach(() => jest.dontMock('../../server/services/binanceSigner'));

    test('THE FIX: SL algo body includes workingType=MARK_PRICE', async () => {
        const binanceOps = require('../../server/services/binanceOps');
        mockSend.mockImplementation((method, path) => {
            if (path === '/fapi/v1/order') return Promise.resolve({ orderId: 1, status: 'FILLED', avgPrice: '100', executedQty: '1' });
            if (path === '/fapi/v1/algoOrder') return Promise.resolve({ algoId: 555 });
            return Promise.resolve({});
        });
        const r = await binanceOps.placeEntry('1', {
            symbol: 'ETHUSDT', side: 'SHORT', qty: '1', entryType: 'MARKET',
            sl: { price: '110' }, tp: null, leverage: 5, decisionKey: 'SAT_t_1', source: 'serverAT',
        }, { apiKey: 'k', apiSecret: 's', mode: 'testnet' });
        expect(r.ok).toBe(true);
        const algoCalls = mockSend.mock.calls.filter(c => c[1] === '/fapi/v1/algoOrder');
        expect(algoCalls.length).toBeGreaterThanOrEqual(1);
        for (const c of algoCalls) expect(c[2].workingType).toBe('MARK_PRICE');
    });
});

describe('BUG B — userDataStream.parseOrderUpdate extracts clientOrderId', () => {
    test('THE FIX: o.c (clientOrderId) surfaces in parsed result', () => {
        jest.resetModules();
        const uds = require('../../server/services/userDataStream');
        const parsed = uds.parseOrderUpdate({
            e: 'ORDER_TRADE_UPDATE', E: 123,
            o: { s: 'BNBUSDT', S: 'BUY', o: 'MARKET', x: 'TRADE', X: 'FILLED', i: 1460828466, c: 'sl_SAT_1776859653168_1d96d4bb_0', p: '0', ap: '611.07', q: '16.73', z: '16.73', rp: '-292.40', T: 1 },
        });
        expect(parsed.clientOrderId).toBe('sl_SAT_1776859653168_1d96d4bb_0');
        expect(parsed.avgPrice).toBeCloseTo(611.07);
        expect(parsed.realizedPnL).toBeCloseTo(-292.40);
    });
});

describe('BUG B — serverAT._exitFillTracker correlation (pure)', () => {
    let tracker;
    beforeEach(() => {
        jest.resetModules();
        tracker = require('../../server/services/serverAT')._exitFillTracker;
        tracker._clear();
    });

    test('sl_ fill recorded → matched once for same user+symbol → HIT_SL with real numbers', () => {
        tracker.record(1, 'BNBUSDT', { clientOrderId: 'sl_SAT_x_0', avgPrice: 611.07, realizedPnL: -292.4 }, 1000);
        const m = tracker.match(1, 'BNBUSDT', 1200);
        expect(m).not.toBeNull();
        expect(m.kind).toBe('HIT_SL');
        expect(m.avgPrice).toBeCloseTo(611.07);
        expect(m.realizedPnL).toBeCloseTo(-292.4);
        // consumed — second match returns null (no double-journal)
        expect(tracker.match(1, 'BNBUSDT', 1300)).toBeNull();
    });

    test('tp_ fill → HIT_TP', () => {
        tracker.record(1, 'ETHUSDT', { clientOrderId: 'tp_SAT_y_0', avgPrice: 1700, realizedPnL: 80.5 }, 1000);
        expect(tracker.match(1, 'ETHUSDT', 1500).kind).toBe('HIT_TP');
    });

    test('non-protection clientOrderId is NOT recorded (manual/unknown closes stay EXTERNAL)', () => {
        tracker.record(1, 'BNBUSDT', { clientOrderId: 'close_SAT_z', avgPrice: 600, realizedPnL: 5 }, 1000);
        tracker.record(1, 'BNBUSDT', { clientOrderId: undefined, avgPrice: 600, realizedPnL: 5 }, 1000);
        expect(tracker.match(1, 'BNBUSDT', 1100)).toBeNull();
    });

    test('stale fill (>5s) does not match (fail-closed to EXTERNAL_CLOSE)', () => {
        tracker.record(1, 'BNBUSDT', { clientOrderId: 'sl_SAT_x_0', avgPrice: 611, realizedPnL: -290 }, 1000);
        expect(tracker.match(1, 'BNBUSDT', 7000)).toBeNull();
    });

    test('per-user + per-symbol isolation', () => {
        tracker.record(1, 'BNBUSDT', { clientOrderId: 'sl_a_0', avgPrice: 611, realizedPnL: -1 }, 1000);
        expect(tracker.match(2, 'BNBUSDT', 1100)).toBeNull();
        expect(tracker.match(1, 'SOLUSDT', 1100)).toBeNull();
        expect(tracker.match(1, 'BNBUSDT', 1100)).not.toBeNull();
    });
});
