'use strict';
// [REAL-GATE P0-3 2026-06-09] Per-user explicit opt-in for REAL ML influence.
// Fail-closed: no row === not opted in. Every change is audited.

const { db } = require('../database');

function isOptedIn(userId) {
    if (!userId) return false;
    try {
        const row = db.prepare('SELECT opted_in FROM ml_live_optin WHERE user_id = ?').get(userId);
        return !!(row && row.opted_in === 1);
    } catch (_) {
        return false; // table missing / DB error → fail-closed
    }
}

function setOptin(userId, optedIn, source) {
    if (!userId) throw new Error('mlLiveOptin.setOptin: userId required');
    const val = optedIn === true ? 1 : 0;
    db.prepare(`
        INSERT INTO ml_live_optin (user_id, opted_in, updated_at, source)
        VALUES (?, ?, datetime('now'), ?)
        ON CONFLICT(user_id) DO UPDATE SET
            opted_in = excluded.opted_in,
            updated_at = excluded.updated_at,
            source = excluded.source
    `).run(userId, val, source || null);
    try {
        db.prepare(
            "INSERT INTO audit_log (user_id, action, details) VALUES (?, 'ML_LIVE_OPTIN_SET', ?)"
        ).run(userId, JSON.stringify({ optedIn: val === 1, source: source || null }));
    } catch (_) { /* audit best-effort */ }
    return { userId, optedIn: val === 1 };
}

module.exports = { isOptedIn, setOptin };
