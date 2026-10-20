/**
 * Zeus Terminal — serverPendingEntry: auditul intrarilor sterse la restart
 *
 * [PENDING-AUDIT 2026-10-20] Gasit la auditul manual/autotrade cerut de operator.
 * `_loadFromDisk` sterge intrarile pending la boot (sunt sensibile la timp) si a
 * fost instrumentat cu [M4] ca "userul sa vada de ce i-a dispart intrarea".
 * Nu putea: `_persist` scrie un DICTIONAR cheiat pe simbol
 * ({ BTCUSDT: {...} }), iar auditul citea `data.symbol` / `data.side` /
 * `data.triggerPrice` ca pe un obiect PLAT — toate undefined.
 * JSON.stringify le arunca → `details` ajungea exact "{}".
 *
 * Dovada vie inainte de fix: 68 de randuri PENDING_WIPED_ON_RESTART, TOATE cu
 * details="{}" si user_id=NULL. In plus `pending:1` ramane in tabel ca `{}`
 * dupa fiecare boot, deci se scria un rand FALS la FIECARE restart, chiar si
 * cand nu era nimic in asteptare.
 *
 * userId nu e persistat deloc — dar e chiar in cheia `pending:<uid>`, pe care
 * regexul o captura si nu o folosea nimeni.
 */
'use strict';

const _rows = [];
const auditLog = jest.fn();
const _run = jest.fn();

jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => _rows), run: _run })) },
    atSetState: jest.fn(),
    auditLog,
}));
jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../server/services/telegram', () => ({ sendToUser: jest.fn() }));

/** Reincarca modulul, care ruleaza `_loadFromDisk()` la require. */
function bootWith(rows) {
    _rows.length = 0;
    for (const r of rows) _rows.push(r);
    auditLog.mockClear();
    _run.mockClear();
    jest.resetModules();
    require('../../server/services/serverPendingEntry');
}

/** Forma pe care o scrie chiar `_persist`: dictionar cheiat pe simbol. */
function persistShape(entries) {
    const data = {};
    for (const e of entries) {
        data[e.symbol] = {
            symbol: e.symbol, dir: e.dir, tier: 'MEDIUM', confidence: 75,
            entryPrice: e.entryPrice, targetPrice: e.targetPrice,
            candleCount: 0, maxCandles: 6, createdAt: e.createdAt, status: 'WAITING',
        };
    }
    return JSON.stringify(data);
}

describe('auditul intrarilor pending sterse la restart', () => {
    test('scrie UN rand per intrare, cu campurile completate', () => {
        bootWith([{
            key: 'pending:7',
            value: persistShape([
                { symbol: 'BTCUSDT', dir: 'LONG', entryPrice: 50000, targetPrice: 49950, createdAt: 1700000000000 },
                { symbol: 'ETHUSDT', dir: 'SHORT', entryPrice: 3000, targetPrice: 3003, createdAt: 1700000000001 },
            ]),
        }]);

        expect(auditLog).toHaveBeenCalledTimes(2);

        const byDetails = auditLog.mock.calls.map(c => c[2]);
        // Bug-ul: inainte de fix fiecare obiect era { symbol: undefined, ... } → "{}".
        for (const d of byDetails) {
            expect(JSON.stringify(d)).not.toBe('{}');
            expect(d.symbol).toBeTruthy();
        }

        const btc = byDetails.find(d => d.symbol === 'BTCUSDT');
        expect(btc).toBeDefined();
        expect(btc.dir).toBe('LONG');
        expect(btc.targetPrice).toBe(49950);
        expect(btc.createdAt).toBe(1700000000000);
    });

    test('userId vine din cheia `pending:<uid>`, nu din corp', () => {
        bootWith([{
            key: 'pending:7',
            value: persistShape([{ symbol: 'BTCUSDT', dir: 'LONG', entryPrice: 1, targetPrice: 1, createdAt: 1 }]),
        }]);

        expect(auditLog).toHaveBeenCalledTimes(1);
        // Inainte de fix: `data.userId` nu era niciodata persistat → NULL.
        expect(auditLog.mock.calls[0][0]).toBe(7);
        expect(auditLog.mock.calls[0][1]).toBe('PENDING_WIPED_ON_RESTART');
    });

    test('un dictionar GOL nu scrie nimic — nu mai minte la fiecare restart', () => {
        // `pending:1` sta in at_state ca `{}` dupa fiecare boot. Asta producea
        // un rand fals de audit la FIECARE restart: 68 dintre ele, pe viu.
        bootWith([{ key: 'pending:1', value: '{}' }]);
        expect(auditLog).not.toHaveBeenCalled();
    });

    test('valoare corupta nu arunca si nu scrie audit', () => {
        expect(() => bootWith([{ key: 'pending:1', value: 'nu-e-json' }])).not.toThrow();
        expect(auditLog).not.toHaveBeenCalled();
    });

    test('mai multi useri — fiecare rand ajunge la userul lui', () => {
        bootWith([
            { key: 'pending:7', value: persistShape([{ symbol: 'BTCUSDT', dir: 'LONG', entryPrice: 1, targetPrice: 1, createdAt: 1 }]) },
            { key: 'pending:9', value: persistShape([{ symbol: 'SOLUSDT', dir: 'SHORT', entryPrice: 2, targetPrice: 2, createdAt: 2 }]) },
        ]);

        expect(auditLog).toHaveBeenCalledTimes(2);
        const pairs = auditLog.mock.calls.map(c => [c[0], c[2].symbol]).sort();
        expect(pairs).toEqual([[7, 'BTCUSDT'], [9, 'SOLUSDT']]);
    });

    test('rândurile se sterg oricum — comportamentul pastrat', () => {
        bootWith([{ key: 'pending:1', value: '{}' }]);
        expect(_run).toHaveBeenCalled();
    });
});
