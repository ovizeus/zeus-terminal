'use strict';
/**
 * [2026-11-27] Securitate extra 3 — email la intrarea de pe un IP nou (ca la Binance).
 * Chemat dupa LOGIN_SUCCESS in /auth/verify-code. Nu la prima intrare din viata contului (n-avem cu ce
 * compara), nu de pe un IP folosit in ultimele 180 de zile, nu fara IP.
 */
function shouldNotify(uid, ip, loginAuditId) {
    if (!ip) return false;
    const { db } = require('./database');
    const prior = db.prepare("SELECT ip FROM audit_log WHERE user_id = ? AND action = 'LOGIN_SUCCESS' AND id < ? AND created_at > datetime('now', '-180 days')")
        .all(uid, loginAuditId);
    if (!prior.length) return false;
    return !prior.some((r) => r.ip === ip);
}

function deviceOf(ua) {
    const s = String(ua || '');
    if (!s) return 'Unknown device';
    const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox'
        : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser';
    const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
        : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'unknown system';
    return `${browser} on ${os}`;
}

module.exports = { shouldNotify, deviceOf };
