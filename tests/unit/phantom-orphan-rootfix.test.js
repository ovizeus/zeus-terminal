'use strict';

// [PHANTOM/ORPHAN ROOT FIX 2026-06-05] Operator-reported: "phantom manual
// positions appear/disappear, AT-testnet positions I never opened" — old bug,
// previously 'fixed' (Bug#3 merged-dup) but only the duplicate-seq class was;
// the CLOSE-RACE class remained, proven today with full evidence:
//
// (1) CLOSE-RACE PHANTOMS: _closePosition runs internally BEFORE the
//     exchange's mid-close partial ACCOUNT_UPDATE snapshots arrive; a snapshot
//     with amt≠0 finds no OPEN internal position → adopted as an "external"
//     (manual-looking) position. 3 today (11:24, 12:38, 14:00), each at the
//     exact second of a DSL close. Fix: _closeRaceGuard — record internal
//     closes, suppress userdata adoption for 30s per uid|symbol (the 60s recon
//     truth-path adopts genuinely-external positions anyway, race-free).
// (2) STUCK PHANTOMS: _buildExternalEntry set NO status field → the amt=0
//     close path (requires status==='OPEN') could never close an adopted
//     position → phantoms 187/189 stuck OPEN for 7+ hours. Fix: status:'OPEN'.
// (3) DEAD QUEUE: "ALL close retries failed — queued for reconciliation"
//     queued NOTHING (log lie). ETH orphan bled 6h on the exchange while the
//     journal recorded a FICTIVE +$17.32 (real: -$42.72). Fix:
//     _enqueueEmergencyClose actually inserts into emergency_close_queue, and
//     emergencyCloseProcessor drains that queue every 60s (it was previously
//     processed at BOOT only — the 06:31 incident's orphans sat 3.5h).

describe('F2a — _closeRaceGuard (suppress phantom adoption after internal close)', () => {
    let guard;
    beforeEach(() => {
        jest.resetModules();
        guard = require('../../server/services/serverAT')._closeRaceGuard;
        guard._clear();
    });

    test('THE FIX: adoption suppressed within 30s of an internal close (same uid+symbol)', () => {
        guard.record(1, 'SOLUSDT', 1000);
        expect(guard.isRecent(1, 'SOLUSDT', 1000 + 5_000)).toBe(true);
        expect(guard.isRecent(1, 'SOLUSDT', 1000 + 29_000)).toBe(true);
    });

    test('after 30s the suppression lifts (genuine external opens adoptable again)', () => {
        guard.record(1, 'SOLUSDT', 1000);
        expect(guard.isRecent(1, 'SOLUSDT', 1000 + 31_000)).toBe(false);
    });

    test('per-user and per-symbol isolation', () => {
        guard.record(1, 'SOLUSDT', 1000);
        expect(guard.isRecent(2, 'SOLUSDT', 2000)).toBe(false);
        expect(guard.isRecent(1, 'BNBUSDT', 2000)).toBe(false);
    });

    test('no record → not recent (fail-open for genuine externals)', () => {
        expect(guard.isRecent(1, 'ETHUSDT', 5000)).toBe(false);
    });
});

describe('F2b — _buildExternalEntry gets status OPEN (adopted positions join the normal lifecycle)', () => {
    test('THE FIX: status === OPEN so amt=0 close path and existing-lookups see it', () => {
        jest.resetModules();
        const at = require('../../server/services/serverAT');
        const e = at._buildExternalEntry({ userId: 1, symbol: 'SOLUSDT', side: 'SHORT', entryPrice: 65.25, qty: 81.07 }, 9999, 66.5);
        expect(e.status).toBe('OPEN');
        expect(e.source).toBe('external');
        expect(e.live.status).toBe('EXTERNAL');
    });
});

describe('F4 — _enqueueEmergencyClose actually persists to emergency_close_queue', () => {
    test('THE FIX: inserts row with user, symbol, exchange, qty, decision key', () => {
        jest.resetModules();
        const runs = [];
        const _prep = (sql) => ({ run: (...a) => { runs.push({ sql, a }); return {}; }, get: () => null, all: () => [] });
        jest.doMock('../../server/services/database', () => ({
            prepare: _prep,
            db: { prepare: _prep },
            atGetState: () => null, atSetState: () => {},
        }));
        const at = require('../../server/services/serverAT');
        const r = at._enqueueEmergencyClose(1, { seq: 42, symbol: 'ETHUSDT', side: 'SHORT', qty: 4.511, exchange: 'binance', live: { executedQty: 4.511 } }, 'DSL_PL');
        expect(r).toBe(true);
        const ins = runs.find(x => /INSERT (OR IGNORE )?INTO emergency_close_queue/i.test(x.sql));
        expect(ins).toBeTruthy();
        expect(ins.a.join('|')).toMatch(/ETHUSDT/);
        jest.dontMock('../../server/services/database');
    });
});

describe('F5 — emergencyCloseProcessor drains the queue (was boot-only)', () => {
    let mockRows, deleted, mockSend;
    function freshProcessor() {
        jest.resetModules();
        mockRows = [];
        deleted = [];
        mockSend = jest.fn();
        jest.doMock('../../server/services/database', () => ({
            db: {
                prepare: (sql) => ({
                    all: () => mockRows,
                    run: (...a) => { if (/UPDATE emergency_close_queue SET resolved_at/i.test(sql)) deleted.push(a[a.length - 1]); return {}; },
                    get: () => null,
                }),
            },
        }));
        jest.doMock('../../server/services/credentialStore', () => ({
            getExchangeCreds: () => ({ apiKey: 'k', apiSecret: 's', mode: 'testnet' }),
            getExchangeCredsFor: () => ({ apiKey: 'k', apiSecret: 's', mode: 'testnet' }),
        }));
        jest.doMock('../../server/services/binanceSigner', () => ({ sendSignedRequest: (...a) => mockSend(...a) }));
        return require('../../server/services/emergencyCloseProcessor');
    }

    test('successful reduceOnly close (position held) → row resolved + RESULT/reduceOnly on POST', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 7, user_id: 1, symbol: 'ETHUSDT', exchange: 'binance', qty: '4.511', decision_key: 'SAT_x' }];
        mockSend.mockImplementation((method) => {
            if (method === 'GET') return Promise.resolve([{ symbol: 'ETHUSDT', positionAmt: '-4.511' }]);
            return Promise.resolve({ status: 'FILLED', avgPrice: '1607.82', executedQty: '4.511', orderId: 1 });
        });
        await proc._tick();
        expect(deleted).toEqual([7]);
        const post = mockSend.mock.calls.find(c => c[0] === 'POST');
        expect(post[2].reduceOnly).toBe('true');
        expect(post[2].newOrderRespType).toBe('RESULT');
        expect(post[2].side).toBe('BUY'); // closes the SHORT actually held
    });

    test('position already flat on exchange → row resolved WITHOUT placing any order', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 8, user_id: 1, symbol: 'BNBUSDT', exchange: 'binance', qty: '9.56', decision_key: 'SAT_y' }];
        mockSend.mockImplementation((method) => {
            if (method === 'GET') return Promise.resolve([]); // nothing held
            return Promise.reject(new Error('should not POST'));
        });
        await proc._tick();
        expect(deleted).toEqual([8]);
        expect(mockSend.mock.calls.find(c => c[0] === 'POST')).toBeUndefined();
    });

    test('-2022 ReduceOnly rejected mid-close → row resolved (flat)', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 9, user_id: 1, symbol: 'BNBUSDT', exchange: 'binance', qty: '9.56', decision_key: 'SAT_w' }];
        mockSend.mockImplementation((method) => {
            if (method === 'GET') return Promise.resolve([{ symbol: 'BNBUSDT', positionAmt: '-9.56' }]);
            const e = new Error('ReduceOnly Order is rejected.'); e.code = -2022; return Promise.reject(e);
        });
        await proc._tick();
        expect(deleted).toEqual([9]);
    });

    test('transient failure (CB open / timeout) → row KEPT for next tick', async () => {
        const proc = freshProcessor();
        mockRows = [{ id: 10, user_id: 1, symbol: 'SOLUSDT', exchange: 'binance', qty: '77.4', decision_key: 'SAT_z' }];
        mockSend.mockImplementation((method) => {
            if (method === 'GET') return Promise.resolve([{ symbol: 'SOLUSDT', positionAmt: '77.4' }]);
            const e = new Error('Binance exchange CB open'); e.code = -1007; return Promise.reject(e);
        });
        await proc._tick();
        expect(deleted).toEqual([]);
    });

    test('empty queue → no exchange calls at all', async () => {
        const proc = freshProcessor();
        mockRows = [];
        await proc._tick();
        expect(mockSend).not.toHaveBeenCalled();
    });
});
