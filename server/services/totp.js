'use strict';
/**
 * [2026-11-27] Securitate etapa 2 — 2FA cu aplicatie de autentificare (TOTP, RFC 6238 / RFC 4226).
 *
 * Fara biblioteci externe: speakeasy nu mai e intretinut, iar TOTP e HMAC-SHA1 pe un contor de 30 s —
 * mai putin cod decat o dependinta noua pe un server cu bani. Compatibil cu Google Authenticator,
 * Microsoft Authenticator, Authy, 1Password, Bitwarden (SHA1, 6 cifre, 30 s).
 *
 * Reguli:
 *  - fereastra ±1 pas (ceas decalat pana la 30 s), nu mai mult;
 *  - un cod nu se poate folosi de doua ori: `lastStep` = ultimul pas acceptat, orice pas <= el e refuzat;
 *  - comparatie in timp constant;
 *  - codurile de rezerva se pastreaza doar ca hash SHA-256 si se consuma la folosire.
 */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_S = 30;
const DIGITS = 6;
const ISSUER = 'Zeus Terminal';
// fara 0/O, 1/I/L — ca omul sa nu le confunde cand le copiaza de pe hartie
const RC_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function base32Encode(buf) {
    let bits = 0, value = 0, out = '';
    for (const byte of buf) {
        value = (value << 8) | byte; bits += 8;
        while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(str) {
    const clean = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
    let bits = 0, value = 0;
    const out = [];
    for (const ch of clean) {
        const i = B32.indexOf(ch);
        if (i < 0) throw new Error('invalid base32');
        value = (value << 5) | i; bits += 5;
        if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(out);
}

function generateSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function codeAt(secretB32, step) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
    const off = h[h.length - 1] & 15;
    const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
    return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** → { ok:true, step } sau { ok:false }. Nu arunca. */
function verify(secretB32, code, opts) {
    const o = opts || {};
    const c = typeof code === 'string' ? code.replace(/\s/g, '') : '';
    if (!/^\d{6}$/.test(c)) return { ok: false };
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const cur = Math.floor(now / 1000 / STEP_S);
    const last = Number.isFinite(o.lastStep) ? o.lastStep : -1;
    let hit = null;
    for (const s of [cur - 1, cur, cur + 1]) {
        let exp;
        try { exp = codeAt(secretB32, s); } catch (_) { return { ok: false }; }
        // fara iesire timpurie: toate cele trei comparatii se fac oricum
        if (crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(c)) && s > last && hit === null) hit = s;
    }
    return hit === null ? { ok: false } : { ok: true, step: hit };
}

const _norm = (code) => String(code || '').toUpperCase().replace(/[\s-]/g, '');
const _hash = (code) => crypto.createHash('sha256').update('zeus-rc:' + _norm(code)).digest('hex');

function generateRecoveryCodes(n) {
    const codes = [];
    while (codes.length < (n || 10)) {
        let s = '';
        for (let i = 0; i < 10; i++) s += RC_ALPHABET[crypto.randomInt(RC_ALPHABET.length)];
        const c = s.slice(0, 5) + '-' + s.slice(5);
        if (!codes.includes(c)) codes.push(c);
    }
    return { codes, hashes: codes.map(_hash) };
}

/** → { ok, remaining } — `remaining` fara codul folosit (sau lista neschimbata la esec). */
function useRecoveryCode(hashes, code) {
    const list = Array.isArray(hashes) ? hashes : [];
    if (_norm(code).length !== 10) return { ok: false, remaining: list };
    const h = Buffer.from(_hash(code));
    let idx = -1;
    list.forEach((x, i) => {
        const b = Buffer.from(String(x));
        if (b.length === h.length && crypto.timingSafeEqual(b, h) && idx < 0) idx = i;
    });
    if (idx < 0) return { ok: false, remaining: list };
    return { ok: true, remaining: list.filter((_, i) => i !== idx) };
}

function otpauthUri(secretB32, account) {
    const iss = encodeURIComponent(ISSUER);
    return `otpauth://totp/${iss}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${iss}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;
}

module.exports = { base32Encode, base32Decode, generateSecret, codeAt, verify, generateRecoveryCodes, useRecoveryCode, otpauthUri };
