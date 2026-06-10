'use strict';
// [REAL-GATE P0-3 2026-06-09] Per-user explicit opt-in for REAL ML influence.
// Fail-closed: no row === not opted in. Every change is audited.

const { db } = require('../database');

let _readWarned = false;

function isOptedIn(userId) {
    if (!userId) return false;
    try {
        const row = db.prepare('SELECT opted_in FROM ml_live_optin WHERE user_id = ?').get(userId);
        return !!(row && row.opted_in === 1);
    } catch (e) {
        if (!_readWarned) { _readWarned = true; console.warn('[mlLiveOptin] read failed, fail-closed:', e.message); }
        return false; // table missing / DB error → fail-closed
    }
}

function setOptin(userId, optedIn, source, ip) {
    if (!userId) throw new Error('mlLiveOptin.setOptin: userId required');
    const val = optedIn === true ? 1 : 0;
    const upsert = db.prepare(`
        INSERT INTO ml_live_optin (user_id, opted_in, updated_at, source)
        VALUES (?, ?, datetime('now'), ?)
        ON CONFLICT(user_id) DO UPDATE SET
            opted_in = excluded.opted_in,
            updated_at = excluded.updated_at,
            source = excluded.source
    `);
    const audit = db.prepare(
        "INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, 'ML_LIVE_OPTIN_SET', ?, ?)"
    );
    const details = JSON.stringify({ optedIn: val === 1, source: source || null });

    if (val === 1) {
        // Grant: no consent without trace — upsert + audit are atomic.
        // If the audit row cannot be written, the grant must NOT happen.
        const tx = db.transaction(() => {
            upsert.run(userId, val, source || null);
            audit.run(userId, details, ip || null);
        });
        tx();
    } else {
        // Revoke: must never be blocked — audit stays best-effort.
        upsert.run(userId, val, source || null);
        try {
            audit.run(userId, details, ip || null);
        } catch (e) {
            console.warn('[mlLiveOptin] audit write failed on revoke:', e.message);
        }
    }
    return { userId, optedIn: val === 1 };
}

module.exports = { isOptedIn, setOptin };
