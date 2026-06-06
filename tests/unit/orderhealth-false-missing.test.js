'use strict';

// [2026-06-06 evening] Bug chain found in SP2-a soak day 1 (IP ban 14:46 UTC):
//
// F1 — _checkOrderHealth queried /fapi/v1/openAlgoOrders with a SWALLOWED catch.
//      During the rate-limit ban the algo query failed, orderIds was built from
//      regular orders only → the (algo) SL looked MISSING → a DUPLICATE SL was
//      placed. Verdicts on partial data are forbidden: algo query fails → skip.
//
// F3 — when a re-placement happens, the OLD slOrderId may still rest on the
//      exchange (false-missing race). It was simply overwritten (success) or
//      nulled (failure) → leaked orphan blocked all BTC entries 15:36→17:45
//      ("Margin type cannot be changed if there exists open orders").
//      Now: best-effort cancel of the old id on re-place; on failure the old id
//      is retained as live.staleSlOrderId so the watchdog cancels it after its
//      repair succeeds.
//
// (F2 — periodic orphan sweep gating — tested in realgate-orphan-sweep.test.js
//  via _shouldRunOrphanSweep below.)

const CREDS = { apiKey: 'k', apiSecret: 's', mode: 'testnet', exchange: 'binance' };

function freshAT(mockSendImpl) {
    jest.resetModules();
    const mockSend = jest.fn(mockSendImpl);
    const telegramSent = [];
    jest.doMock('../../server/services/binanceSigner', () => ({ sendSignedRequest: (...a) => mockSend(...a) }));
    jest.doMock('../../server/services/database', () => {
        const _prep = () => ({ run: () => ({}), get: () => null, all: () => [] });
        return {
            prepare: _prep,
            db: { prepare: _prep, atSavePosition: () => {}, auditLog: () => {} },
            atGetState: () => null, atSetState: () => {},
        };
    });
    jest.doMock('../../server/services/credentialStore', () => ({
        getExchangeCreds: () => CREDS,
        getExchangeCredsFor: () => CREDS,
    }));
    jest.doMock('../../server/services/telegram', () => ({
        sendToUser: (uid, msg) => { telegramSent.push(msg); return Promise.resolve(); },
    }));
    jest.doMock('../../server/services/exchangeInfo', () => ({
        roundOrderParams: (sym, qty, price) => ({ quantity: qty, stopPrice: price }),
        getFilters: () => null,
    }));
    const at = require('../../server/services/serverAT');
    return { at, mockSend, telegramSent };
}

function mkPos() {
    return {
        seq: 1776800000001, userId: 1, symbol: 'BTCUSDT', side: 'SHORT',
        sl: 61710.9, status: 'OPEN', mode: 'live',
        live: { status: 'LIVE', slOrderId: 555, executedQty: 0.01, liveSeq: 'L1' },
    };
}

// Route helper: openOrders/openAlgoOrders GETs + algo POST/DELETE
function router({ algoOrders, algoThrows, postThrows }) {
    return (method, path) => {
        if (method === 'GET' && path === '/fapi/v1/openOrders') return Promise.resolve([]);
        if (method === 'GET' && path === '/fapi/v1/openAlgoOrders') {
            if (algoThrows) return Promise.reject(new Error('Binance IP rate-limit — paused (HTTP 418)'));
            return Promise.resolve({ orders: algoOrders || [] });
        }
        if (method === 'POST' && path === '/fapi/v1/algoOrder') {
            if (postThrows) return Promise.reject(new Error('HTTP 418 banned'));
            return Promise.resolve({ algoId: 999 });
        }
        if (method === 'DELETE') return Promise.resolve({ code: '200' });
        return Promise.resolve([]);
    };
}

describe('F1 — _checkOrderHealth must NOT issue MISSING verdicts on partial data', () => {
    test('THE FIX: openAlgoOrders query fails → NO re-placement, slOrderId untouched', async () => {
        const { at, mockSend } = freshAT(router({ algoThrows: true }));
        const pos = mkPos();
        await at._checkOrderHealth(pos, CREDS, 'TEST');
        const placed = mockSend.mock.calls.filter(c => c[0] === 'POST');
        expect(placed).toEqual([]);              // no duplicate SL placed
        expect(pos.live.slOrderId).toBe(555);    // tracking untouched
        expect(pos.live.status).toBe('LIVE');
    });

    test('control: SL present in algo list → nothing placed/cancelled', async () => {
        const { at, mockSend } = freshAT(router({ algoOrders: [{ algoId: 555 }] }));
        const pos = mkPos();
        await at._checkOrderHealth(pos, CREDS, 'TEST');
        expect(mockSend.mock.calls.filter(c => c[0] === 'POST' || c[0] === 'DELETE')).toEqual([]);
        expect(pos.live.slOrderId).toBe(555);
    });
});

describe('F3 — re-placement must not leak the old SL order', () => {
    test('THE FIX: genuine missing → old id gets best-effort DELETE after successful re-place (never reduce protection first)', async () => {
        const { at, mockSend } = freshAT(router({ algoOrders: [] }));
        const pos = mkPos();
        await at._checkOrderHealth(pos, CREDS, 'TEST');
        expect(pos.live.slOrderId).toBe(999); // re-placed (existing behaviour intact)
        const del = mockSend.mock.calls.find(c => c[0] === 'DELETE' && String(JSON.stringify(c[2])).includes('555'));
        expect(del).toBeTruthy(); // old id cancel attempted (idempotent — 'Unknown order' is fine live)
    });

    test('THE FIX: re-placement FAILS → old id retained as staleSlOrderId for the watchdog', async () => {
        const { at } = freshAT(router({ algoOrders: [], postThrows: true }));
        const pos = mkPos();
        await at._checkOrderHealth(pos, CREDS, 'TEST');
        expect(pos.live.status).toBe('LIVE_NO_SL');
        expect(pos.live.slOrderId).toBeNull();
        expect(pos.live.staleSlOrderId).toBe(555); // NOT lost — watchdog will clean it
    });

    test('THE FIX: watchdog repair cancels the retained staleSlOrderId and clears it', async () => {
        const { at, mockSend } = freshAT(router({ algoOrders: [] }));
        const pos = mkPos();
        pos.live.status = 'LIVE_NO_SL';
        pos.live.slOrderId = null;
        pos.live.staleSlOrderId = 555;
        at._reconTestHooks.seedPositions([pos]);
        await at._watchdogLiveNoSL();
        expect(pos.live.status).toBe('LIVE');
        expect(pos.live.slOrderId).toBe(999);
        const del = mockSend.mock.calls.find(c => c[0] === 'DELETE' && String(JSON.stringify(c[2])).includes('555'));
        expect(del).toBeTruthy();
        expect(pos.live.staleSlOrderId).toBeUndefined();
        at._reconTestHooks.seedPositions([]);
    });
});

describe('F2 — orphan sweep cadence is time-based, independent of idle state', () => {
    test('THE FIX: _shouldRunOrphanSweep true once per interval, false within it', () => {
        const { at } = freshAT(router({}));
        const t0 = 1_780_800_000_000;
        expect(at._shouldRunOrphanSweep(t0)).toBe(true);            // first tick fires
        expect(at._shouldRunOrphanSweep(t0 + 60_000)).toBe(false);  // 1 min later — no
        expect(at._shouldRunOrphanSweep(t0 + 9 * 60_000)).toBe(false);
        expect(at._shouldRunOrphanSweep(t0 + 10 * 60_000)).toBe(true);  // interval elapsed
        expect(at._shouldRunOrphanSweep(t0 + 10 * 60_000 + 1)).toBe(false);
    });
});
