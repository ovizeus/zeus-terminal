'use strict';
/**
 * [2026-11-27] Securitate extra 1 — cheile de exchange sunt ce e mai valoros intr-un cont Zeus.
 *  - SECURITY_HOLD: 24 h dupa schimbarea parolei / emailului sau oprirea 2FA, cheile nu se pot adauga sau
 *    schimba (ca retragerile blocate la Binance) — cine preia un cont nu poate muta imediat legatura cu bursa.
 *  - TOTP_REQUIRED / TOTP_INVALID: cu 2FA pornit, salvarea cheilor cere codul din aplicatie (`totpCode`).
 * Folosit in routes/exchange.js POST /save, INAINTE de orice verificare la bursa sau scriere in baza.
 * Nu atinge tranzactionarea: doar refuza o salvare.
 */
const HOLD_MS = 24 * 3600 * 1000;
const HOLD_ACTIONS = ['CHANGE_PASSWORD_SUCCESS', 'FORGOT_PASSWORD_SUCCESS', 'CHANGE_EMAIL_SUCCESS', 'TWO_FACTOR_DISABLED'];

function lastCredentialChange(uid) {
    const { db } = require('./database');
    const r = db.prepare(`SELECT max(created_at) t FROM audit_log WHERE user_id = ? AND action IN (${HOLD_ACTIONS.map(() => '?').join(',')})
        AND created_at > datetime('now', '-1 day')`).get(uid, ...HOLD_ACTIONS);
    if (!r || !r.t) return null;
    const ts = Date.parse(String(r.t).replace(' ', 'T') + 'Z');
    return Number.isFinite(ts) ? ts : null;
}

function check(uid, body) {
    const last = lastCredentialChange(uid);
    if (last && Date.now() - last < HOLD_MS) {
        const until = last + HOLD_MS;
        return { ok: false, status: 403, code: 'SECURITY_HOLD', until,
            error: `For your safety, exchange keys can't be added or changed for 24 hours after a password, email or two-factor change. Try again after ${new Date(until).toISOString().replace('T', ' ').slice(0, 16)} UTC.` };
    }
    const tf = require('./twoFactor');
    if (tf.isEnabled(uid)) {
        const code = body && typeof body.totpCode === 'string' ? body.totpCode.trim() : '';
        if (!code) return { ok: false, status: 403, code: 'TOTP_REQUIRED', error: 'Enter the 6-digit code from your authenticator app to save exchange keys.' };
        if (!tf.verifyLogin(uid, code).ok) return { ok: false, status: 403, code: 'TOTP_INVALID', error: 'Wrong code — try again.' };
    }
    return { ok: true };
}

module.exports = { check, lastCredentialChange, HOLD_MS, HOLD_ACTIONS };
