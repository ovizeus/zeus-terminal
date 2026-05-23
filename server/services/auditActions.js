'use strict';

const { db } = require('./database');

// Canonical action labels (per spec pillar 16)
const ACTIONS = Object.freeze({
    // Entry
    ENTRY_PLACED: 'ENTRY_PLACED',
    ENTRY_PLACED_BYBIT: 'ENTRY_PLACED_BYBIT',
    ENTRY_REJECTED: 'ENTRY_REJECTED',
    // Close
    POSITION_CLOSED: 'POSITION_CLOSED',
    POSITION_CLOSED_BY_SL_RACE: 'POSITION_CLOSED_BY_SL_RACE',
    // Emergency
    EMERGENCY_CLOSE_CATASTROPHIC: 'EMERGENCY_CLOSE_CATASTROPHIC',
    EMERGENCY_CLOSE_SUCCESS: 'EMERGENCY_CLOSE_SUCCESS',
    // Exchange switch
    EXCHANGE_SWITCH_REQUESTED: 'EXCHANGE_SWITCH_REQUESTED',
    EXCHANGE_SWITCH_APPLIED: 'EXCHANGE_SWITCH_APPLIED',
    EXCHANGE_SWITCH_BLOCKED: 'EXCHANGE_SWITCH_BLOCKED',
    // Ensure symbol ready
    ENSURE_SYMBOL_READY_OK: 'ENSURE_SYMBOL_READY_OK',
    ENSURE_SYMBOL_READY_FAIL: 'ENSURE_SYMBOL_READY_FAIL',
    // Order lock
    ORDER_LOCK_TIMEOUT: 'ORDER_LOCK_TIMEOUT',
    ORDER_LOCK_ACQUIRED: 'ORDER_LOCK_ACQUIRED',
    // Recovery
    RECOVERY_BOOT_COMPLETE: 'RECOVERY_BOOT_COMPLETE',
    RECOVERY_EXCHANGE_ONLY_POSITION: 'RECOVERY_EXCHANGE_ONLY_POSITION',
    // PnL
    PNL_RECON_MISMATCH: 'PNL_RECON_MISMATCH',
    PNL_RECON_DAILY_COMPLETE: 'PNL_RECON_DAILY_COMPLETE',
});

function log(userId, action, details) {
    if (!ACTIONS[action]) {
        throw new Error(`auditActions: unknown action '${action}'. Use ACTIONS constant.`);
    }
    const detailsJson = typeof details === 'string' ? details : JSON.stringify(details || {});
    db.prepare(
        `INSERT INTO audit_log (user_id, action, details, created_at) VALUES (?, ?, ?, datetime('now'))`
    ).run(userId, action, detailsJson);
}

module.exports = { ACTIONS, log };
