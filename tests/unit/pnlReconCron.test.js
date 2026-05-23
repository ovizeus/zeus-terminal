'use strict';

/**
 * pnlReconCron.test.js
 *
 * Uses a pure mock for `database` and `exchangeOps` — no native SQLite required.
 */

// --- in-memory mock DB state ---
let _exchangeAccounts = [];
let _atClosed = [];
let _auditLog = [];
let _seqCounter = 1;

function _makeDb() {
    return {
        prepare(sql) {
            return {
                all(...params) {
                    if (/SELECT DISTINCT user_id FROM exchange_accounts WHERE is_active/.test(sql)) {
                        return _exchangeAccounts.filter(r => r.is_active === 1);
                    }
                    if (/SELECT seq, data, user_id, exchange FROM at_closed WHERE user_id/.test(sql)) {
                        const uid = params[0];
                        return _atClosed.filter(r => r.user_id === uid);
                    }
                    return [];
                },
                run(...params) {
                    if (/INSERT INTO audit_log/.test(sql)) {
                        // Pattern: VALUES (?, 'PNL_RECON_MISMATCH', ?) → params=[uid, details]
                        // Pattern: VALUES (NULL, 'PNL_RECON_DAILY_COMPLETE', ?) → params=[details]
                        const literalActionMatch = sql.match(/'([A-Z_]+)'/);
                        if (literalActionMatch) {
                            const action = literalActionMatch[1];
                            const user_id = params.length === 2 ? params[0] : null;
                            const details = params[params.length - 1];
                            _auditLog.push({ id: _seqCounter++, user_id, action, details });
                        } else {
                            const [user_id, action, details] = params;
                            _auditLog.push({ id: _seqCounter++, user_id, action, details });
                        }
                    }
                    return { lastInsertRowid: _seqCounter };
                },
            };
        },
    };
}

const mockDb = _makeDb();

jest.mock('../../server/services/database', () => ({ db: mockDb }));

const mockGetUserTrades = jest.fn(async () => []);

jest.mock('../../server/services/exchangeOps', () => ({
    getUserTrades: (...a) => mockGetUserTrades(...a),
}));

const { reconcileUser, runDaily, _msUntilNextHour } = require('../../server/services/pnlReconCron');

beforeEach(() => {
    _exchangeAccounts = [];
    _atClosed = [];
    _auditLog = [];
    _seqCounter = 1;
    mockGetUserTrades.mockReset();
    mockGetUserTrades.mockResolvedValue([]);
});

// ─── Test 1: reconcileUser with no closed positions ───────────────────────────
test('reconcileUser with no closed positions returns checked=0, mismatches=0', async () => {
    const result = await reconcileUser('user1');
    expect(result).toEqual({ uid: 'user1', checked: 0, mismatches: 0 });
    expect(mockGetUserTrades).not.toHaveBeenCalled();
});

// ─── Test 2: reconcileUser with matching trade → no mismatch ─────────────────
test('reconcileUser with matching trade → no mismatch logged', async () => {
    _atClosed.push({
        seq: 10,
        user_id: 'user1',
        exchange: 'binance',
        data: JSON.stringify({ symbol: 'BTCUSDT', closeOrderId: 'order123', pnl: 50 }),
    });
    mockGetUserTrades.mockResolvedValue([
        { id: 'order123', orderId: 'order123', symbol: 'BTCUSDT', qty: 0.1 },
    ]);

    const result = await reconcileUser('user1');
    expect(result.checked).toBe(1);
    expect(result.mismatches).toBe(0);
    const mismatches = _auditLog.filter(r => r.action === 'PNL_RECON_MISMATCH');
    expect(mismatches).toHaveLength(0);
});

// ─── Test 3: reconcileUser with no matching trade → mismatch + audit_log ─────
test('reconcileUser with no matching trade → mismatch + PNL_RECON_MISMATCH audit entry', async () => {
    _atClosed.push({
        seq: 20,
        user_id: 'user2',
        exchange: 'bybit',
        data: JSON.stringify({ symbol: 'ETHUSDT', closeOrderId: 'closeABC', pnl: -10 }),
    });
    // Return trades that don't match closeOrderId
    mockGetUserTrades.mockResolvedValue([
        { id: 'different1', orderId: 'different1', symbol: 'ETHUSDT', qty: 0.5 },
    ]);

    const result = await reconcileUser('user2');
    expect(result.checked).toBe(1);
    expect(result.mismatches).toBe(1);
    const mismatches = _auditLog.filter(r => r.action === 'PNL_RECON_MISMATCH');
    expect(mismatches).toHaveLength(1);
    const parsed = JSON.parse(mismatches[0].details);
    expect(parsed.symbol).toBe('ETHUSDT');
    expect(parsed.closeOrderId).toBe('closeABC');
    expect(parsed.seq).toBe(20);
});

// ─── Test 4: _msUntilNextHour returns a positive value ───────────────────────
test('_msUntilNextHour returns positive milliseconds', () => {
    const ms = _msUntilNextHour(2);
    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThan(0);
    // Should be at most 24 hours
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
});
