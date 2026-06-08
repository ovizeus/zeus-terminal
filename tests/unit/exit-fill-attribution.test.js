'use strict';
const serverAT = require('../../server/services/serverAT');
const uds = require('../../server/services/userDataStream');

// [T-EXTCLOSE 2026-06-08] EXTERNAL_CLOSE was journaled PnL=$0.00 (exit=entry)
// because _exitFillTracker only recorded sl_/tp_ fills. But the closing fill of
// an externally-closed position (testnet force-close / manual / liquidation)
// carries the REAL avgPrice + realizedPnL — it was discarded for lacking the
// sl_/tp_ prefix. Evidence (06-08 01:16): BUY BNBUSDT @601.53 closed a SHORT
// (entry 604.32) ≈ +$23 real, logged $0.00. Fix: capture realizedPnL+avgPrice
// from ANY reduceOnly closing fill → EXTERNAL_CLOSE with the real numbers.

describe('[T-EXTCLOSE] classifyExitFill', () => {
    test('sl_ prefix → HIT_SL (unchanged)', () => {
        expect(serverAT.classifyExitFill('sl_abc_0', true)).toBe('HIT_SL');
    });
    test('tp_ prefix → HIT_TP (unchanged)', () => {
        expect(serverAT.classifyExitFill('tp_abc_0', true)).toBe('HIT_TP');
    });
    test('reduceOnly non-sl/tp fill → EXTERNAL (the fix)', () => {
        expect(serverAT.classifyExitFill('x_123', true)).toBe('EXTERNAL');
        expect(serverAT.classifyExitFill('SAT_RECON_CLOSE_1', true)).toBe('EXTERNAL');
    });
    test('non-reduceOnly entry fill → null (ignored, never an exit)', () => {
        expect(serverAT.classifyExitFill('AT_entry_1', false)).toBeNull();
    });
    test('null/blank clientOrderId + reduceOnly → EXTERNAL (testnet close w/o our cid)', () => {
        expect(serverAT.classifyExitFill(null, true)).toBe('EXTERNAL');
        expect(serverAT.classifyExitFill('', true)).toBe('EXTERNAL');
    });
    test('null clientOrderId + not reduceOnly → null', () => {
        expect(serverAT.classifyExitFill(null, false)).toBeNull();
    });
});

describe('[T-EXTCLOSE] parseOrderUpdate exposes reduceOnly (o.R)', () => {
    test('reduceOnly true + realizedPnL + avgPrice extracted', () => {
        const p = uds.parseOrderUpdate({ e: 'ORDER_TRADE_UPDATE', E: 1, o: { s: 'BNBUSDT', S: 'BUY', o: 'MARKET', x: 'TRADE', X: 'FILLED', i: 1, c: 'x', ap: '601.53', rp: '23.5', R: true } });
        expect(p.reduceOnly).toBe(true);
        expect(p.realizedPnL).toBe(23.5);
        expect(p.avgPrice).toBe(601.53);
    });
    test('reduceOnly false when o.R absent', () => {
        const p = uds.parseOrderUpdate({ e: 'ORDER_TRADE_UPDATE', E: 1, o: { s: 'X', S: 'BUY', o: 'MARKET', x: 'TRADE', X: 'FILLED', i: 1, c: 'AT_e', ap: '1', rp: '0' } });
        expect(p.reduceOnly).toBe(false);
    });
});

describe('[T-EXTCLOSE] _exitFillTracker captures EXTERNAL closing fills with real PnL', () => {
    const t = serverAT._exitFillTrackerForTest;
    beforeEach(() => t._clear());

    test('reduceOnly non-sl/tp fill → EXTERNAL with realizedPnL + avgPrice (was discarded)', () => {
        t.record(1, 'BNBUSDT', { clientOrderId: 'x_1', reduceOnly: true, avgPrice: 601.53, realizedPnL: 23.5 }, 1000);
        const m = t.match(1, 'BNBUSDT', 1100);
        expect(m).toMatchObject({ kind: 'EXTERNAL', avgPrice: 601.53, realizedPnL: 23.5 });
    });
    test('non-reduceOnly entry fill is NOT recorded (no false external match)', () => {
        t.record(1, 'BNBUSDT', { clientOrderId: 'AT_e', reduceOnly: false, avgPrice: 607, realizedPnL: 0 }, 1000);
        expect(t.match(1, 'BNBUSDT', 1100)).toBeNull();
    });
    test('sl_ fill still classified HIT_SL with its real numbers', () => {
        t.record(1, 'BTCUSDT', { clientOrderId: 'sl_k_0', reduceOnly: true, avgPrice: 63000, realizedPnL: -50 }, 1000);
        expect(t.match(1, 'BTCUSDT', 1100)).toMatchObject({ kind: 'HIT_SL', realizedPnL: -50 });
    });
    test('stale fill beyond 5s window not matched', () => {
        t.record(1, 'BNBUSDT', { clientOrderId: 'x_1', reduceOnly: true, avgPrice: 601, realizedPnL: 10 }, 1000);
        expect(t.match(1, 'BNBUSDT', 1000 + 6000)).toBeNull();
    });
});

describe('[T-EXTCLOSE] exitKindToCloseType', () => {
    test('EXTERNAL → EXTERNAL_CLOSE; HIT_SL/HIT_TP unchanged', () => {
        expect(serverAT.exitKindToCloseType('EXTERNAL')).toBe('EXTERNAL_CLOSE');
        expect(serverAT.exitKindToCloseType('HIT_SL')).toBe('HIT_SL');
        expect(serverAT.exitKindToCloseType('HIT_TP')).toBe('HIT_TP');
    });
});
