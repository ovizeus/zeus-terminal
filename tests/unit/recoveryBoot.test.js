'use strict';

/**
 * recoveryBoot.test.js
 *
 * Uses a pure mock for `database` (no better-sqlite3 native module required),
 * matching the pattern used by tests that cannot rely on native SQLite bindings
 * due to NODE_MODULE_VERSION mismatch in this environment.
 */

// --- in-memory mock DB state ---
let _exchangeAccounts = [];
let _atPositions = [];
let _positionEvents = [];
let _auditLog = [];
let _seqCounter = 1;

function _makeDb() {
    return {
        prepare(sql) {
            return {
                all(...params) {
                    if (/SELECT DISTINCT user_id, exchange FROM exchange_accounts WHERE is_active/.test(sql)) {
                        return _exchangeAccounts.filter(r => r.is_active === 1);
                    }
                    if (/SELECT seq, data, status FROM at_positions WHERE user_id = \? AND status IN/.test(sql)) {
                        const uid = params[0];
                        return _atPositions.filter(r => r.user_id === uid && ['OPEN', 'OPENING'].includes(r.status));
                    }
                    return [];
                },
                run(...params) {
                    if (/INSERT INTO exchange_accounts/.test(sql)) {
                        // Not used in service code
                    } else if (/INSERT INTO at_positions/.test(sql)) {
                        // Not used in service code
                    } else if (/UPDATE at_positions SET data = \? WHERE seq = \?/.test(sql)) {
                        const [data, seq] = params;
                        const pos = _atPositions.find(p => p.seq === seq);
                        if (pos) pos.data = data;
                    } else if (/UPDATE at_positions SET status = 'ORPHANED' WHERE seq = \?/.test(sql)) {
                        const [seq] = params;
                        const pos = _atPositions.find(p => p.seq === seq);
                        if (pos) pos.status = 'ORPHANED';
                    } else if (/INSERT INTO audit_log/.test(sql)) {
                        // Extract action from SQL (may be a literal string in SQL or a ? param)
                        // Pattern 1: VALUES (NULL, 'ACTION_LITERAL', ?) → params=[details]
                        // Pattern 2: VALUES (?, 'ACTION_LITERAL', ?) → params=[uid, details]
                        // Pattern 3: VALUES (?, ?, ?) → params=[uid, action, details]
                        const literalActionMatch = sql.match(/'([A-Z_]+)'/);
                        if (literalActionMatch) {
                            const action = literalActionMatch[1];
                            // params could be [details] or [uid, details]
                            const user_id = params.length === 2 ? params[0] : null;
                            const details = params[params.length - 1];
                            _auditLog.push({ id: _seqCounter++, user_id, action, details, created_at: new Date().toISOString() });
                        } else {
                            const [user_id, action, details] = params;
                            _auditLog.push({ id: _seqCounter++, user_id, action, details, created_at: new Date().toISOString() });
                        }
                    }
                    return { lastInsertRowid: _seqCounter };
                },
                get(...params) {
                    if (/SELECT \* FROM audit_log WHERE action=/.test(sql)) {
                        const match = sql.match(/action='([^']+)'/);
                        if (match) return _auditLog.find(r => r.action === match[1]) || undefined;
                    }
                    if (/SELECT status FROM at_positions WHERE seq=\?/.test(sql)) {
                        const [seq] = params;
                        return _atPositions.find(p => p.seq === seq);
                    }
                    if (/SELECT status FROM at_positions/.test(sql)) {
                        return _atPositions[0];
                    }
                    return undefined;
                },
            };
        },
    };
}

const mockDb = _makeDb();

jest.mock('../../server/services/database', () => ({ db: mockDb }));

const mockGetPositions = jest.fn(async () => []);
const mockPlaceStopLoss = jest.fn(async () => ({ ok: true, slOrderId: 'sl_recovery' }));
const mockSetGlobalHalt = jest.fn();
const mockPositionEventsAppend = jest.fn();

jest.mock('../../server/services/exchangeOps', () => ({
    getPositions: (...a) => mockGetPositions(...a),
    placeStopLoss: (...a) => mockPlaceStopLoss(...a),
}));

jest.mock('../../server/services/positionEvents', () => ({
    append: (...a) => mockPositionEventsAppend(...a),
}));

jest.mock('../../server/services/serverAT', () => ({
    setGlobalHalt: (...a) => mockSetGlobalHalt(...a),
}));

const recoveryBoot = require('../../server/services/recoveryBoot');

function resetState() {
    _exchangeAccounts.length = 0;
    _atPositions.length = 0;
    _positionEvents.length = 0;
    _auditLog.length = 0;
    _seqCounter = 1;
}

function addExchangeAccount(user_id, exchange = 'binance') {
    _exchangeAccounts.push({ id: _seqCounter++, user_id, exchange, is_active: 1, mode: 'testnet', api_key_encrypted: '' });
}

function addPosition(user_id, data, status = 'OPEN', exchange = 'binance') {
    const seq = _seqCounter++;
    _atPositions.push({ seq, data: JSON.stringify(data), status, user_id, exchange });
    return seq;
}

beforeEach(() => {
    resetState();
    mockGetPositions.mockReset().mockResolvedValue([]);
    mockPlaceStopLoss.mockReset().mockResolvedValue({ ok: true, slOrderId: 'sl_recovery' });
    mockSetGlobalHalt.mockReset();
    mockPositionEventsAppend.mockReset();
});

describe('recoveryBoot', () => {
    it('no users → clean pass with summary', async () => {
        const r = await recoveryBoot.run();
        expect(r.totalUsers).toBe(0);
        expect(r.errors).toBe(0);
        expect(_auditLog.some(a => a.action === 'RECOVERY_BOOT_COMPLETE')).toBe(true);
    });

    it('user with matching exchange+DB position → verifies + lifts halt', async () => {
        addExchangeAccount(1, 'binance');
        addPosition(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', slOrderId: 'sl1' });
        mockGetPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryPrice: '50000' }]);

        const r = await recoveryBoot.run();
        expect(r.totalReconciled).toBe(1);
        // Actual serverAT.setGlobalHalt signature: (active, byUserId, reason)
        expect(mockSetGlobalHalt).toHaveBeenCalledWith(false, 1, 'RECOVERY_BOOT_COMPLETE');
    });

    it('position missing SL → places SL via exchangeOps', async () => {
        addExchangeAccount(1, 'binance');
        addPosition(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001' }); // NO slOrderId
        mockGetPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryPrice: '50000' }]);

        await recoveryBoot.run();
        expect(mockPlaceStopLoss).toHaveBeenCalled();
        expect(mockPositionEventsAppend).toHaveBeenCalledWith(
            expect.objectContaining({ event_type: 'RECOVERY_SL_PLACED' })
        );
    });

    it('position only in DB (not on exchange) → marks ORPHANED', async () => {
        addExchangeAccount(1, 'binance');
        const seq = addPosition(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', slOrderId: 'sl1' });
        mockGetPositions.mockResolvedValue([]); // nothing on exchange

        await recoveryBoot.run();
        const pos = _atPositions.find(p => p.seq === seq);
        expect(pos.status).toBe('ORPHANED');
        expect(mockPositionEventsAppend).toHaveBeenCalledWith(
            expect.objectContaining({ event_type: 'RECOVERY_ORPHANED_NO_EXCHANGE' })
        );
    });

    it('position only on exchange (not in DB) → audit_log warning', async () => {
        addExchangeAccount(1, 'binance');
        mockGetPositions.mockResolvedValue([{ symbol: 'ETHUSDT', side: 'SHORT', qty: '1', entryPrice: '2000' }]);

        await recoveryBoot.run();
        const audit = _auditLog.find(a => a.action === 'RECOVERY_EXCHANGE_ONLY_POSITION');
        expect(audit).toBeDefined();
        expect(JSON.parse(audit.details).symbol).toBe('ETHUSDT');
    });

    it('SL placement fails → marks ORPHANED', async () => {
        addExchangeAccount(1, 'binance');
        addPosition(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.001' }); // no SL
        mockGetPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryPrice: '50000' }]);
        mockPlaceStopLoss.mockRejectedValue(new Error('SL placement timeout'));

        await recoveryBoot.run();
        const pos = _atPositions[0];
        expect(pos.status).toBe('ORPHANED');
    });

    it('getPositions fails for user → user stays halted, other users proceed', async () => {
        addExchangeAccount(1, 'binance');
        addExchangeAccount(2, 'bybit');
        mockGetPositions.mockImplementation(async (uid) => {
            if (uid === 1) throw new Error('API timeout');
            return [];
        });

        const r = await recoveryBoot.run();
        expect(r.errors).toBe(1);
        expect(r.totalReconciled).toBe(1);
        // User 2 halt lifted, user 1 NOT
        expect(mockSetGlobalHalt).toHaveBeenCalledWith(false, 2, 'RECOVERY_BOOT_COMPLETE');
        expect(mockSetGlobalHalt).not.toHaveBeenCalledWith(false, 1, expect.anything());
    });

    it('run never throws (defensive)', async () => {
        // Simulate a completely broken DB by replacing prepare with a thrower
        const origPrepare = mockDb.prepare;
        mockDb.prepare = () => { throw new Error('DB completely down'); };
        await expect(recoveryBoot.run()).resolves.toBeDefined();
        mockDb.prepare = origPrepare;
    });
});
