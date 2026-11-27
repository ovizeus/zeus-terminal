'use strict';
/**
 * [2026-11-27] Securitate etapa 2 — 2FA cu aplicatie de autentificare, pentru orice cont care il porneste.
 *
 * De ce: login-ul cere deja un cod pe EMAIL, deci cine are emailul si parola intra. Cu 2FA pornit,
 * codul vine din telefon (aplicatia de autentificare) IN LOCUL emailului — emailul spart nu mai ajunge.
 * Resetarea parolei pe email NU opreste 2FA: dupa resetare, login-ul cere tot codul din aplicatie.
 *
 * Secretul se tine criptat (encryption.js, aceeasi cheie ca la exchange-uri); codurile de rezerva doar
 * ca hash; fiecare cod TOTP se accepta o singura data (totpClaimStep e atomic).
 */
const db = require('./database');
const { encrypt, decrypt } = require('./encryption');
const totp = require('./totp');

const SETUP_TTL_MS = 15 * 60000;

function _row(uid) { try { return db.totpGet(uid); } catch (_) { return null; } }

function isEnabled(uid) {
    const r = _row(uid);
    return !!(r && r.enabled === 1 && r.secret_enc);
}

function _recovery(r) {
    try { const a = JSON.parse(r.recovery_json || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

function status(uid) {
    const r = _row(uid);
    if (!r || r.enabled !== 1) return { enabled: false, recoveryLeft: 0 };
    return { enabled: true, recoveryLeft: _recovery(r).length };
}

function beginSetup(uid, account, now) {
    if (isEnabled(uid)) return { ok: false, error: 'already_enabled' };
    const secret = totp.generateSecret();
    db.totpSetPending(uid, encrypt(secret), Number.isFinite(now) ? now : Date.now());
    return { ok: true, secret, uri: totp.otpauthUri(secret, account) };
}

function confirmSetup(uid, code, now) {
    const t = Number.isFinite(now) ? now : Date.now();
    const r = _row(uid);
    if (!r || r.enabled === 1 || !r.pending_enc || !r.pending_at) return { ok: false, error: 'no_setup' };
    if (t - r.pending_at > SETUP_TTL_MS) return { ok: false, error: 'setup_expired' };
    let secret;
    try { secret = decrypt(r.pending_enc); } catch (_) { return { ok: false, error: 'no_setup' }; }
    const v = totp.verify(secret, code, { now: t });
    if (!v.ok) return { ok: false, error: 'bad_code' };
    const { codes, hashes } = totp.generateRecoveryCodes();
    // pasul folosit la activare e deja „consumat" — nu mai poate deschide o sesiune
    if (!db.totpEnable(uid, encrypt(secret), JSON.stringify(hashes), v.step, t)) return { ok: false, error: 'no_setup' };
    return { ok: true, recoveryCodes: codes };
}

/** cod TOTP (6 cifre) sau cod de rezerva (XXXXX-XXXXX). → { ok, method, recoveryLeft? } */
function _check(uid, code, now) {
    const t = Number.isFinite(now) ? now : Date.now();
    const r = _row(uid);
    if (!r || r.enabled !== 1 || !r.secret_enc) return { ok: false };
    const raw = String(code == null ? '' : code).trim();
    if (/^\d{3}\s?\d{3}$/.test(raw)) {
        let secret;
        try { secret = decrypt(r.secret_enc); } catch (_) { return { ok: false }; }
        if (!secret || secret.length < 16) return { ok: false };   // asigurare: un secret gol/stricat nu verifica niciodata
        const v = totp.verify(secret, raw, { now: t, lastStep: r.last_step });
        if (!v.ok || !db.totpClaimStep(uid, v.step, t)) return { ok: false };
        return { ok: true, method: 'totp' };
    }
    const list = _recovery(r);
    const u = totp.useRecoveryCode(list, raw);
    if (!u.ok) return { ok: false };
    if (!db.totpSwapRecovery(uid, r.recovery_json, JSON.stringify(u.remaining), t)) return { ok: false };
    return { ok: true, method: 'recovery', recoveryLeft: u.remaining.length };
}

function verifyLogin(uid, code, now) { return _check(uid, code, now); }

function disable(uid, code, now) {
    const c = _check(uid, code, now);
    if (!c.ok) return { ok: false, error: 'bad_code' };
    db.totpDisable(uid);
    return { ok: true };
}

/** [2026-11-27] Admin: scoate 2FA de pe un cont (telefon + coduri de rezerva pierdute). → true daca era pornit. */
function adminReset(uid) {
    const had = isEnabled(uid);
    db.totpDisable(uid);
    return had;
}

module.exports = { isEnabled, status, beginSetup, confirmSetup, verifyLogin, disable, adminReset, SETUP_TTL_MS };
