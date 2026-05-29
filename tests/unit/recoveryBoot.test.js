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
                    if (/SELECT DISTINCT user_id, exchange FROM exchange_accounts WHERE status/.test(sql)) {
                        // [P2c.3] DISTINCT (user_id, exchange) among verified accounts.
                        const seen = new Set();
                        const out = [];
                        for (const r of _exchangeAccounts) {
                            if (r.status !== 'verified') continue;
                            const k = r.user_id + '|' + r.exchange;
                            if (seen.has(k)) continue;
                            seen.add(k);
                            out.push({ user_id: r.user_id, exchange: r.exchange });
                        }
                        return out;
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

// [Task E 2026-05-28] Telegram mock for exchange-only auto-SL alerts
const mockTelegramSendToUser = jest.fn(async () => ({ ok: true }));
jest.mock('../../server/services/telegram', () => ({
    sendToUser: (...a) => mockTelegramSendToUser(...a),
}));

const recoveryBoot = require('../../server/services/recoveryBoot');

function resetState() {
    _exchangeAccounts.length = 0;
    _atPositions.length = 0;
    _positionEvents.length = 0;
    _auditLog.length = 0;
    _seqCounter = 1;
}

function addExchangeAccount(user_id, exchange = 'binance', is_active = 1) {
    // [P2c.3] recoveryBoot now iterates all status='verified' accounts (not just is_active=1).
    _exchangeAccounts.push({ id: _seqCounter++, user_id, exchange, is_active, status: 'verified', mode: 'testnet', api_key_encrypted: '' });
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
    mockTelegramSendToUser.mockReset().mockResolvedValue({ ok: true });
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

    it('[P2c.3] position on a NON-active connected exchange is reconciled against ITS OWN exchange (not orphaned)', async () => {
        // User 1: binance ACTIVE (is_active=1) + bybit connected but NOT active (is_active=0).
        addExchangeAccount(1, 'binance', 1);
        addExchangeAccount(1, 'bybit', 0);
        // Open position lives on bybit (data.exchange='bybit'), with an SL already set.
        const seq = addPosition(1, { symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', slOrderId: 'sl_b', exchange: 'bybit' }, 'OPEN', 'bybit');
        // Bybit reports it live; binance holds nothing.
        mockGetPositions.mockImplementation(async (uid, params) => {
            const ex = params && params.exchangeOverride;
            if (ex === 'bybit') return [{ symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', entryPrice: '60000', markPrice: '60000' }];
            return [];
        });

        await recoveryBoot.run();

        // Must NOT be orphaned — it was confirmed live on its own exchange.
        const pos = _atPositions.find(p => p.seq === seq);
        expect(pos.status).toBe('OPEN');
        expect(mockGetPositions).toHaveBeenCalledWith(1, expect.objectContaining({ exchangeOverride: 'bybit' }));
        expect(mockPositionEventsAppend).not.toHaveBeenCalledWith(
            expect.objectContaining({ event_type: 'RECOVERY_ORPHANED_NO_EXCHANGE' })
        );
    });

    it('run never throws (defensive)', async () => {
        // Simulate a completely broken DB by replacing prepare with a thrower
        const origPrepare = mockDb.prepare;
        mockDb.prepare = () => { throw new Error('DB completely down'); };
        await expect(recoveryBoot.run()).resolves.toBeDefined();
        mockDb.prepare = origPrepare;
    });

    // ─── Task E 2026-05-28: Exchange-only position auto-SL (markPrice-based) ──
    describe('exchange-only position → auto-SL placement', () => {
        it('LONG exchange-only → SL = markPrice * 0.98 (NOT entryPrice * 0.98)', async () => {
            addExchangeAccount(1, 'binance');
            // Deliberately set markPrice != entryPrice to verify which is used
            mockGetPositions.mockResolvedValue([{
                symbol: 'BTCUSDT', side: 'LONG', qty: '0.01',
                entryPrice: '50000',   // would yield 49000 SL — WRONG
                markPrice: '60000',    // yields 58800 SL — CORRECT
            }]);

            await recoveryBoot.run();

            expect(mockPlaceStopLoss).toHaveBeenCalledTimes(1);
            const slArg = mockPlaceStopLoss.mock.calls[0][1];
            expect(slArg.symbol).toBe('BTCUSDT');
            expect(slArg.side).toBe('LONG');
            // SL = 60000 * 0.98 = 58800 (markPrice-based, NOT 50000 * 0.98 = 49000)
            expect(Number(slArg.stopPrice)).toBeCloseTo(58800, -1);
            expect(Number(slArg.stopPrice)).not.toBeCloseTo(49000, -1);

            expect(_auditLog.find(a => a.action === 'RECOVERY_EXCHANGE_ONLY_POSITION')).toBeDefined();
            expect(_auditLog.find(a => a.action === 'RECOVERY_EXCHANGE_ONLY_AUTOSL_PLACED')).toBeDefined();
            expect(mockTelegramSendToUser).toHaveBeenCalledWith(1, expect.stringMatching(/EXCHANGE-ONLY POSITION/));
        });

        it('SHORT exchange-only → SL = markPrice * 1.02', async () => {
            addExchangeAccount(1, 'binance');
            mockGetPositions.mockResolvedValue([{
                symbol: 'ETHUSDT', side: 'SHORT', qty: '0.5',
                entryPrice: '2500',
                markPrice: '3000',
            }]);

            await recoveryBoot.run();

            expect(mockPlaceStopLoss).toHaveBeenCalledTimes(1);
            const slArg = mockPlaceStopLoss.mock.calls[0][1];
            // SL = 3000 * 1.02 = 3060 (markPrice-based)
            expect(Number(slArg.stopPrice)).toBeCloseTo(3060, -1);
        });

        it('non-trigger error (exchange down) → NO retry, immediate globalHalt + critical alert', async () => {
            addExchangeAccount(1, 'binance');
            mockGetPositions.mockResolvedValue([{
                symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', markPrice: '60000',
            }]);
            mockPlaceStopLoss.mockRejectedValue(new Error('exchange down'));

            await recoveryBoot.run();

            // No retry on non-trigger errors
            expect(mockPlaceStopLoss).toHaveBeenCalledTimes(1);
            expect(_auditLog.find(a => a.action === 'RECOVERY_EXCHANGE_ONLY_AUTOSL_FAILED')).toBeDefined();
            expect(mockSetGlobalHalt).toHaveBeenCalledWith(true, 1, expect.stringMatching(/RECOVERY_AUTOSL_FAILED/));
            expect(mockTelegramSendToUser).toHaveBeenCalledWith(1, expect.stringMatching(/CRITICAL|UNPROTECTED/));
        });

        it('placeStopLoss returns ok:false (non-trigger) → NO retry, globalHalt', async () => {
            addExchangeAccount(1, 'binance');
            mockGetPositions.mockResolvedValue([{
                symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', markPrice: '60000',
            }]);
            mockPlaceStopLoss.mockResolvedValue({ ok: false, error: 'signature_mismatch' });

            await recoveryBoot.run();

            expect(mockPlaceStopLoss).toHaveBeenCalledTimes(1);
            expect(_auditLog.find(a => a.action === 'RECOVERY_EXCHANGE_ONLY_AUTOSL_FAILED')).toBeDefined();
            expect(mockSetGlobalHalt).toHaveBeenCalledWith(true, 1, expect.stringMatching(/RECOVERY_AUTOSL_FAILED/));
        });

        it('would-trigger error → refetch markPrice → retry succeeds (NO halt)', async () => {
            addExchangeAccount(1, 'binance');
            // First getPositions = initial (mark=60000), second = refetch (mark=59500)
            mockGetPositions
                .mockResolvedValueOnce([{ symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', markPrice: '60000' }])
                .mockResolvedValueOnce([{ symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', markPrice: '59500' }]);
            // First placeStopLoss = would-trigger, second = success
            mockPlaceStopLoss
                .mockResolvedValueOnce({ ok: false, error: '"Order would immediately trigger" (-2021)' })
                .mockResolvedValueOnce({ ok: true, slOrderId: 'sl_retry' });

            await recoveryBoot.run();

            expect(mockPlaceStopLoss).toHaveBeenCalledTimes(2);
            // Retry should use refreshed mark=59500 → SL = 59500 * 0.98 = 58310
            const retryArg = mockPlaceStopLoss.mock.calls[1][1];
            expect(Number(retryArg.stopPrice)).toBeCloseTo(58310, -1);

            expect(_auditLog.find(a => a.action === 'RECOVERY_EXCHANGE_ONLY_AUTOSL_PLACED')).toBeDefined();
            expect(_auditLog.find(a => a.action === 'RECOVERY_EXCHANGE_ONLY_AUTOSL_FAILED')).toBeUndefined();
            expect(mockSetGlobalHalt).not.toHaveBeenCalledWith(true, 1, expect.anything());
        });

        it('would-trigger error → retry also fails → globalHalt + critical alert', async () => {
            addExchangeAccount(1, 'binance');
            mockGetPositions.mockResolvedValue([{
                symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', markPrice: '60000',
            }]);
            // Both attempts return would-trigger
            mockPlaceStopLoss.mockResolvedValue({ ok: false, error: '-2021 Order would immediately trigger' });

            await recoveryBoot.run();

            expect(mockPlaceStopLoss).toHaveBeenCalledTimes(2);  // retry attempted
            expect(_auditLog.find(a => a.action === 'RECOVERY_EXCHANGE_ONLY_AUTOSL_FAILED')).toBeDefined();
            expect(mockSetGlobalHalt).toHaveBeenCalledWith(true, 1, expect.stringMatching(/RECOVERY_AUTOSL_FAILED/));
        });

        it('invalid exchPos data (no markPrice + no entryPrice) → audit invalid, no SL attempt', async () => {
            addExchangeAccount(1, 'binance');
            mockGetPositions.mockResolvedValue([{
                symbol: 'BTCUSDT', side: 'LONG', qty: '0.01',
                // markPrice + entryPrice both missing
            }]);

            await recoveryBoot.run();

            expect(mockPlaceStopLoss).not.toHaveBeenCalled();
            expect(_auditLog.find(a => a.action === 'RECOVERY_EXCHANGE_ONLY_INVALID_DATA')).toBeDefined();
        });

        it('uses entryPrice as markPrice fallback if markPrice missing', async () => {
            addExchangeAccount(1, 'binance');
            mockGetPositions.mockResolvedValue([{
                symbol: 'BTCUSDT', side: 'LONG', qty: '0.01',
                entryPrice: '60000',
                // markPrice missing
            }]);

            await recoveryBoot.run();

            expect(mockPlaceStopLoss).toHaveBeenCalledTimes(1);
            const slArg = mockPlaceStopLoss.mock.calls[0][1];
            expect(Number(slArg.stopPrice)).toBeCloseTo(60000 * 0.98, -1);
        });
    });
});
