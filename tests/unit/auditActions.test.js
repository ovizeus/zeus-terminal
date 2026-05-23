'use strict';

/**
 * auditActions.test.js
 *
 * Uses a pure mock for `database` — no native SQLite required.
 */

// --- in-memory mock DB state ---
let _auditLog = [];
let _seqCounter = 1;

function _makeDb() {
    return {
        prepare(sql) {
            return {
                run(...params) {
                    if (/INSERT INTO audit_log/.test(sql)) {
                        const [user_id, action, details] = params;
                        _auditLog.push({ id: _seqCounter++, user_id, action, details });
                    }
                    return { lastInsertRowid: _seqCounter };
                },
            };
        },
    };
}

const mockDb = _makeDb();

jest.mock('../../server/services/database', () => ({ db: mockDb }));

const { ACTIONS, log } = require('../../server/services/auditActions');

beforeEach(() => {
    _auditLog = [];
    _seqCounter = 1;
});

// ─── Test 1: log(uid, 'ENTRY_PLACED', {symbol}) → inserts correct row ────────
test('log inserts row with correct user_id, action, and details', () => {
    log('user42', 'ENTRY_PLACED', { symbol: 'BTCUSDT', side: 'BUY' });

    expect(_auditLog).toHaveLength(1);
    expect(_auditLog[0].user_id).toBe('user42');
    expect(_auditLog[0].action).toBe('ENTRY_PLACED');
    const parsed = JSON.parse(_auditLog[0].details);
    expect(parsed.symbol).toBe('BTCUSDT');
    expect(parsed.side).toBe('BUY');
});

// ─── Test 2: log(null, 'RECOVERY_BOOT_COMPLETE', summary) → system-level ─────
test('log with null userId → system-level audit row', () => {
    log(null, 'RECOVERY_BOOT_COMPLETE', { usersScanned: 5, positionsRecovered: 2 });

    expect(_auditLog).toHaveLength(1);
    expect(_auditLog[0].user_id).toBeNull();
    expect(_auditLog[0].action).toBe('RECOVERY_BOOT_COMPLETE');
    const parsed = JSON.parse(_auditLog[0].details);
    expect(parsed.usersScanned).toBe(5);
});

// ─── Test 3: unknown action throws ───────────────────────────────────────────
test('log with unknown action throws with descriptive message', () => {
    expect(() => log('user1', 'UNKNOWN_ACTION', {}))
        .toThrow("auditActions: unknown action 'UNKNOWN_ACTION'. Use ACTIONS constant.");
    expect(_auditLog).toHaveLength(0);
});

// ─── Bonus: ACTIONS has all 18 expected keys ─────────────────────────────────
test('ACTIONS constant contains expected canonical labels', () => {
    expect(ACTIONS.ENTRY_PLACED).toBe('ENTRY_PLACED');
    expect(ACTIONS.PNL_RECON_MISMATCH).toBe('PNL_RECON_MISMATCH');
    expect(ACTIONS.EMERGENCY_CLOSE_CATASTROPHIC).toBe('EMERGENCY_CLOSE_CATASTROPHIC');
    expect(Object.keys(ACTIONS)).toHaveLength(18);
    // Verify it's frozen
    expect(Object.isFrozen(ACTIONS)).toBe(true);
});
