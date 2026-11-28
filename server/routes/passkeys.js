'use strict';
/**
 * [2026-11-28] /api/passkeys — passkey-urile contului (Settings › Security). Montat dupa sessionAuth.
 *
 *   GET  /                                   → { enabled, needsCode, passkeys:[{id,name,createdAt,lastUsedAt,synced}] }
 *   POST /register/options {password, code?} → { options }   — PAROLA (+ codul 2FA daca e pornit)
 *   POST /register/verify  {response, name}  → { id }        — passkey salvat; audit + email
 *   POST /remove           {id, password}    → { ok }        — audit + email
 * Cu PASSKEY_ENABLED oprit: GET spune enabled:false, restul 404.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../services/database');
const twoFactor = require('../services/twoFactor');
const authGuard = require('../services/authGuard');
const passkeys = require('../services/passkeys');
const logger = require('../services/logger');

const router = express.Router();
const PW_MAX = 5;
const PW_WINDOW_MS = 10 * 60000;
const svc = () => passkeys.live();

function _user(req, res) {
    if (!req.user || !req.user.id) { res.status(401).json({ ok: false, error: 'Authentication required' }); return null; }
    const u = db.findUserById(req.user.id);
    if (!u || u.status !== 'active') { res.status(401).json({ ok: false, error: 'Authentication required' }); return null; }
    return u;
}
const _on = () => svc().config().enabled;
function _off(res) { res.status(404).json({ ok: false, error: 'Passkeys are not available.' }); }

async function _passwordOk(u, password) {
    if (typeof password !== 'string' || !password || !u.password_hash) return false;
    try { return await bcrypt.compare(password, u.password_hash); } catch (_) { return false; }
}
function _budget(res, uid) {
    if (authGuard.hit(db, 'passkey_pw', uid, PW_MAX, PW_WINDOW_MS)) return true;
    res.status(429).json({ ok: false, error: 'Too many attempts. Wait 10 minutes and try again.' });
    return false;
}
function _mail(kind, email, data) {
    try { void require('../services/accountEmails').sendAccountEmail(kind, email, { data }); } catch (_) { /* emailul nu opreste schimbarea */ }
}

router.get('/', (req, res) => {
    const u = _user(req, res); if (!u) return;
    if (!_on()) return res.json({ ok: true, enabled: false, needsCode: false, passkeys: [] });
    res.json({ ok: true, enabled: true, needsCode: twoFactor.isEnabled(u.id), passkeys: svc().list(u.id) });
});

router.post('/register/options', async (req, res) => {
    const u = _user(req, res); if (!u) return;
    if (!_on()) return _off(res);
    if (!_budget(res, u.id)) return;
    const b = req.body || {};
    if (!(await _passwordOk(u, b.password))) {
        db.auditLog(u.id, 'PASSKEY_ADD_BAD_PASSWORD', {}, req.ip);
        return res.status(403).json({ ok: false, error: 'Wrong password.' });
    }
    // cu 2FA pornit, o sesiune furata + parola nu ajung: passkey-ul ar ocoli 2FA la urmatoarele intrari
    if (twoFactor.isEnabled(u.id)) {
        const c = twoFactor.verifyLogin(u.id, b.code);
        if (!c.ok) {
            db.auditLog(u.id, 'PASSKEY_ADD_BAD_CODE', {}, req.ip);
            return res.status(403).json({ ok: false, error: 'Wrong two-factor code.', code: 'TOTP_INVALID' });
        }
        if (c.method === 'recovery') db.auditLog(u.id, 'LOGIN_RECOVERY_CODE_USED', { left: c.recoveryLeft, for: 'passkey_add' }, req.ip);
    }
    try {
        const r = await svc().registrationOptions(u.id, u.email);
        if (!r.ok) {
            const msg = r.error === 'too_many' ? `You already have ${passkeys.MAX_PER_USER} passkeys. Remove one first.` : 'Busy — try again in a minute.';
            return res.status(r.error === 'too_many' ? 409 : 503).json({ ok: false, error: msg });
        }
        res.json({ ok: true, options: r.options });
    } catch (e) {
        logger.warn('PASSKEY', 'register/options failed: ' + e.message);
        res.status(500).json({ ok: false, error: 'Could not start — try again.' });
    }
});

router.post('/register/verify', async (req, res) => {
    const u = _user(req, res); if (!u) return;
    if (!_on()) return _off(res);
    const b = req.body || {};
    const r = await svc().registrationVerify(u.id, b.response, b.name);
    if (!r.ok) {
        const msg = r.error === 'expired' ? 'Took too long — start again.'
            : r.error === 'exists' ? 'This passkey is already saved.'
                : r.error === 'too_many' ? `You already have ${passkeys.MAX_PER_USER} passkeys.` : 'The passkey could not be verified — try again.';
        return res.status(400).json({ ok: false, error: msg });
    }
    const name = (svc().list(u.id).find((p) => p.id === r.id) || {}).name;
    db.auditLog(u.id, 'PASSKEY_ADDED', { id: r.id, name }, req.ip);
    logger.info('AUTH', `passkey added uid=${u.id}`);
    _mail('passkey_added', u.email, { name });
    res.json({ ok: true, id: r.id });
});

router.post('/remove', async (req, res) => {
    const u = _user(req, res); if (!u) return;
    if (!_on()) return _off(res);
    if (!_budget(res, u.id)) return;
    const b = req.body || {};
    if (!(await _passwordOk(u, b.password))) {
        db.auditLog(u.id, 'PASSKEY_REMOVE_BAD_PASSWORD', {}, req.ip);
        return res.status(403).json({ ok: false, error: 'Wrong password.' });
    }
    const name = (svc().list(u.id).find((p) => p.id === Number(b.id)) || {}).name;
    if (!svc().remove(u.id, b.id)) return res.status(404).json({ ok: false, error: 'Passkey not found.' });
    db.auditLog(u.id, 'PASSKEY_REMOVED', { id: Number(b.id), name }, req.ip);
    logger.info('AUTH', `passkey removed uid=${u.id}`);
    _mail('passkey_removed', u.email, { name });
    res.json({ ok: true });
});

module.exports = router;
