'use strict';

/**
 * [2026-11-07] Which exchange keys have stopped passing their daily check.
 *
 * Found on the live box: an account read `status = 'verified'` with a
 * last-verified date four months old, while the daily check had been failing
 * on that key the whole time. The user now sees it in the app — but the
 * OPERATOR saw it nowhere, and a failing key on someone else's account is
 * exactly the thing an operator should be told about without having to read
 * a log.
 *
 * Deliberately does NOT touch `status`. exchange.js selects accounts on
 * status = 'verified', so that field decides what the server will trade with;
 * changing it is a money-path decision. This only reports.
 */

/** The health check runs daily, so two days allows one missed run. */
const STALE_AFTER_DAYS = 2;

function _days(lastVerified, now) {
    if (lastVerified == null || lastVerified === '') return null;
    const t = typeof lastVerified === 'number' ? lastVerified : Date.parse(String(lastVerified));
    if (!Number.isFinite(t)) return null;
    const ms = now - t;
    if (ms < 0) return 0;            // a clock problem, not a stale key
    return Math.floor(ms / 86400000);
}

/**
 * Pure, so the rule is testable without a database.
 * `rows` are exchange_accounts rows; only CONNECTED ones can be stale —
 * an account someone disconnected on purpose is not a problem to report.
 */
function staleAccounts(rows, now = Date.now(), staleAfterDays = STALE_AFTER_DAYS) {
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (const r of rows) {
        if (!r || r.status !== 'verified') continue;
        const days = _days(r.last_verified_at, now);
        if (days === null || days < staleAfterDays) continue;
        out.push({
            userId: r.user_id,
            email: r.email || null,
            exchange: r.exchange,
            mode: r.mode,
            days,
            isActive: r.is_active === 1,
        });
    }
    // worst first: the operator should read the oldest at the top
    return out.sort((a, b) => b.days - a.days);
}

module.exports = { staleAccounts, STALE_AFTER_DAYS, _days };
