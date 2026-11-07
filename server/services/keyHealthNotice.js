'use strict';

/**
 * [2026-11-07] Telling a user their exchange keys stopped working.
 *
 * The daily health check already sends a Telegram message, and that is the
 * right first channel. But Telegram is optional: measured tonight, three of
 * the accounts on this box have none linked, so for them a dead key fails
 * SILENTLY — the only notice goes somewhere they will never look, and the
 * first they learn of it is an order that does not place.
 *
 * The support thread is the in-app channel they already see, with an unread
 * badge, so a system notice there reaches everyone.
 *
 * Deduped on purpose, and this is the same lesson as the circuit-breaker
 * flood earlier tonight: the check runs daily, so posting on every failure
 * would put an identical message in the thread every single day until the key
 * is fixed, and a thread like that is one nobody reads. One notice per spell
 * of breakage.
 */

const MARKER = '[zeus:key-health]';
const REPEAT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function _noticeText(exchange, mode) {
    return `${MARKER} Your ${String(exchange).toUpperCase()} (${mode}) API keys failed verification. ` +
        'They may have expired or been revoked. Until you replace them in Settings, ' +
        'orders on that exchange will not go through.';
}

/**
 * Parses the stored timestamp whatever shape it is in. Returns NULL when it
 * cannot be read — deliberately not 0, which would read as "very old" and
 * trigger exactly the daily repeat this module exists to prevent.
 */
function _ts(row) {
    if (!row) return null;
    const raw = row.created_at != null ? row.created_at : row.ts;
    if (raw == null) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const n = Date.parse(raw);
    return Number.isFinite(n) ? n : null;
}

/**
 * Returns true when a notice should be posted now.
 * Exported separately so the rule is testable without a database.
 */
function shouldNotify(thread, exchange, mode, now) {
    if (!Array.isArray(thread)) return true;
    const text = _noticeText(exchange, mode);
    for (let i = thread.length - 1; i >= 0; i--) {
        const m = thread[i];
        if (!m || m.sender !== 'admin' || typeof m.message !== 'string') continue;
        if (m.message !== text) continue;
        const t = _ts(m);
        // An unreadable timestamp counts as RECENT: repeating one message late
        // is a smaller harm than spamming someone daily because a date would
        // not parse.
        if (t === null) return false;
        return (now - t) >= REPEAT_AFTER_MS;
    }
    return true;
}

/** Posts the in-app notice if it is due. Never throws. */
function notifyKeyHealthFailure(db, userId, exchange, mode, now = Date.now()) {
    try {
        const thread = db.getSupportThread(userId);
        if (!shouldNotify(thread, exchange, mode, now)) return false;
        db.insertSupportMessage(userId, 'admin', _noticeText(exchange, mode));
        return true;
    } catch (_) {
        // A failed notice must never break the health check that found the problem.
        return false;
    }
}

module.exports = { notifyKeyHealthFailure, shouldNotify, _noticeText, MARKER, REPEAT_AFTER_MS };
