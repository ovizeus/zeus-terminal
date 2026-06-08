'use strict';

// [2026-06-06] Two completions from the server-side punch list:
//
// C — REAL gate on _executeLiveEntryCore: the manual/unified route (order/place
//     → registerManualPosition → core) bypassed BOTH _liveExecAllowed (by
//     design — manual path) AND _realBlocked (gap): with REAL creds a manual
//     live order would hit the REAL exchange while _SRV_POS_REAL_ENABLED=false,
//     contradicting the standing operator directive (REAL impossible until the
//     formal flip). Fail-closed gate INSIDE core: creds.mode!=='testnet'
//     requires the flag strictly true.
//
// D — orphan protection orders: client-AT/manual closes can leave AT_/resl_
//     SL/TP algo orders resting on FLAT symbols (3 found+cancelled by hand in
//     the 2026-06-05 audit). orderSweeper only ran at BOOT and its prefix
//     regex missed AT_. Now: regex covers AT_, sweep() accepts
//     opts.skipSymbols (NEVER cancel on symbols with a live exchange position
//     — adopted positions track slOrderId:null so the DB cross-check alone
//     would strip a LIVE position's protection), and recon's idle sweep calls
//     it periodically.

describe('C — _executeLiveEntryCore REAL gate (fail-closed)', () => {
    function freshAT(realEnabled) {
        jest.resetModules();
        jest.doMock('../../server/migrationFlags', () => {
            const real = jest.requireActual('../../server/migrationFlags');
            return { ...real, _SRV_POS_REAL_ENABLED: realEnabled, SERVER_AT: false, SERVER_AT_TESTNET_EXEC: true };
        });
        return require('../../server/services/serverAT');
    }
    const ENTRY = { symbol: 'BTCUSDT', side: 'BUY', quantity: 0.01, entryPrice: 60000, sl: 59000, mode: 'live' };

    test('THE FIX: REAL creds (mode=live) + flag false → SafetyAssertionError, NO order placed', async () => {
        const at = freshAT(false);
        await expect(at._executeLiveEntryCore({ ...ENTRY }, null, { apiKey: 'k', apiSecret: 's', mode: 'live' }))
            .rejects.toThrow(/REAL_EXECUTION_DISABLED/);
    });

    test('testnet creds PASS the gate (downstream failure is fine — must NOT be the REAL gate)', async () => {
        const at = freshAT(false);
        const r = await at._executeLiveEntryCore({ ...ENTRY }, null, { apiKey: 'k', apiSecret: 's', mode: 'testnet', baseUrl: 'http://127.0.0.1:1' })
            .catch(e => ({ _rejected: e.message }));
        expect(JSON.stringify(r)).not.toMatch(/REAL_EXECUTION_DISABLED/);
    });

    test('missing creds.mode → treated as REAL → blocked (fail-closed)', async () => {
        const at = freshAT(false);
        await expect(at._executeLiveEntryCore({ ...ENTRY }, null, { apiKey: 'k', apiSecret: 's' }))
            .rejects.toThrow(/REAL_EXECUTION_DISABLED/);
    });
});

describe('D — orderSweeper: AT_ prefix + skipSymbols (held-position guard)', () => {
    let cancelled, openOrders;
    function freshSweeper() {
        jest.resetModules();
        cancelled = [];
        jest.doMock('../../server/services/exchangeOps', () => ({
            getOpenOrders: async () => openOrders,
            cancelOrder: async (uid, p) => { cancelled.push(p.orderId); return { ok: true }; },
        }));
        // [2026-06-08] Mock the MODULE-LEVEL exports orderSweeper actually calls
        // (database.getZeusOrderIds / database.auditLog). The old mock provided
        // `db.getZeusOrderIds`, but the 2026-06-07 B5 fix moved the call to the
        // module-level export — so the stale mock left database.getZeusOrderIds
        // undefined → dbOrderIds empty → DB-tracked order '111' was wrongly swept.
        jest.doMock('../../server/services/database', () => ({
            getZeusOrderIds: () => new Set(['111']),
            auditLog: () => {},
        }));
        return require('../../server/services/orderSweeper');
    }

    test('THE FIX: AT_-prefixed orphan (not in DB) on a flat symbol → cancelled', async () => {
        const sweeper = freshSweeper();
        openOrders = [
            { orderId: '201', clientOrderId: 'AT_1780693350884_2_263106', symbol: 'SOLUSDT' },
            { orderId: '202', clientOrderId: 'resl_AT_1780693350316_1', symbol: 'SOLUSDT' },
        ];
        const r = await sweeper.sweep(1, 'binance', { skipSymbols: new Set() });
        expect(cancelled.sort()).toEqual(['201', '202']);
        expect(r.cancelled.length).toBe(2);
    });

    test('THE GUARD: orphan-looking orders on a HELD symbol are preserved (adopted positions track slOrderId:null)', async () => {
        const sweeper = freshSweeper();
        openOrders = [
            { orderId: '301', clientOrderId: 'AT_1780700353546_2_275334', symbol: 'ETHUSDT' },
            { orderId: '302', clientOrderId: 'resl_AT_1780700352978_1', symbol: 'ETHUSDT' },
        ];
        const r = await sweeper.sweep(1, 'binance', { skipSymbols: new Set(['ETHUSDT']) });
        expect(cancelled).toEqual([]);
        expect(r.preserved.length).toBe(2);
    });

    test('DB-tracked order preserved; non-Zeus prefix preserved (unchanged behaviour)', async () => {
        const sweeper = freshSweeper();
        openOrders = [
            { orderId: '111', clientOrderId: 'sl_SAT_x_0', symbol: 'BNBUSDT' }, // in DB
            { orderId: '112', clientOrderId: 'web_user_custom', symbol: 'BNBUSDT' }, // not ours
        ];
        const r = await sweeper.sweep(1, 'binance', { skipSymbols: new Set() });
        expect(cancelled).toEqual([]);
        expect(r.preserved.length).toBe(2);
    });

    test('no opts → boot behaviour intact (no skip set, sweeps as before)', async () => {
        const sweeper = freshSweeper();
        openOrders = [{ orderId: '401', clientOrderId: 'sl_SAT_y_1', symbol: 'BTCUSDT' }];
        const r = await sweeper.sweep(1, 'binance');
        expect(cancelled).toEqual(['401']);
        expect(r.cancelled.length).toBe(1);
    });
});
