'use strict';
/**
 * [2026-11-27] Securitate etapa 2 — /api/2fa: pornirea si oprirea 2FA cu aplicatie de autentificare.
 * Montat dupa sessionAuth (req.user = sesiune valida, cont activ, rol din baza).
 *
 *   GET  /status            → { enabled, recoveryLeft }
 *   POST /setup   {password} → { secret, uri }      — PAROLA ceruta: o sesiune furata nu poate porni
 *                                                    2FA cu telefonul altcuiva si bloca proprietarul
 *   POST /confirm {code}     → { recoveryCodes }    — 2FA porneste abia acum; codurile se arata O DATA
 *   POST /disable {password, code}                  — parola SI cod (din aplicatie sau de rezerva)
 * Fiecare pornire/oprire: audit + email pe adresa contului. Max 5 incercari de cod / 10 min / cont.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../services/database');
const twoFactor = require('../services/twoFactor');
const authGuard = require('../services/authGuard');
const logger = require('../services/logger');

const router = express.Router();
const CODE_MAX = 5;
const CODE_WINDOW_MS = 10 * 60000;

function _user(req, res) {
    if (!req.user || !req.user.id) { res.status(401).json({ ok: false, error: 'Authentication required' }); return null; }
    const u = db.findUserById(req.user.id);
    if (!u || u.status !== 'active') { res.status(401).json({ ok: false, error: 'Authentication required' }); return null; }
    return u;
}

async function _passwordOk(u, password) {
    if (typeof password !== 'string' || !password || !u.password_hash) return false;
    try { return await bcrypt.compare(password, u.password_hash); } catch (_) { return false; }
}

function _codeBudget(req, res, uid) {
    if (authGuard.hit(db, 'totp_code', uid, CODE_MAX, CODE_WINDOW_MS)) return true;
    res.status(429).json({ ok: false, error: 'Too many attempts. Wait 10 minutes and try again.' });
    return false;
}

function _mail(kind, email) {
    try { void require('../services/accountEmails').sendAccountEmail(kind, email); } catch (_) { /* emailul nu opreste schimbarea */ }
}

router.get('/status', (req, res) => {
    const u = _user(req, res); if (!u) return;
    res.json({ ok: true, ...twoFactor.status(u.id) });
});

router.post('/setup', async (req, res) => {
    const u = _user(req, res); if (!u) return;
    if (!(await _passwordOk(u, req.body && req.body.password))) {
        db.auditLog(u.id, 'TWO_FACTOR_SETUP_BAD_PASSWORD', {}, req.ip);
        return res.status(403).json({ ok: false, error: 'Wrong password.' });
    }
    const s = twoFactor.beginSetup(u.id, u.email);
    if (!s.ok) return res.status(409).json({ ok: false, error: 'Two-factor authentication is already on.' });
    res.json({ ok: true, secret: s.secret, uri: s.uri });
});

router.post('/confirm', (req, res) => {
    const u = _user(req, res); if (!u) return;
    if (!_codeBudget(req, res, u.id)) return;
    const r = twoFactor.confirmSetup(u.id, req.body && req.body.code);
    if (!r.ok) {
        const msg = r.error === 'setup_expired' ? 'Setup expired — start again.' : r.error === 'no_setup' ? 'Start the setup first.' : 'Wrong code — check the time on your phone and try again.';
        return res.status(400).json({ ok: false, error: msg });
    }
    db.auditLog(u.id, 'TWO_FACTOR_ENABLED', {}, req.ip);
    logger.info('AUTH', `2FA enabled uid=${u.id}`);
    _mail('two_factor_enabled', u.email);
    res.json({ ok: true, recoveryCodes: r.recoveryCodes });
});

router.post('/disable', async (req, res) => {
    const u = _user(req, res); if (!u) return;
    if (!_codeBudget(req, res, u.id)) return;
    if (!(await _passwordOk(u, req.body && req.body.password))) {
        db.auditLog(u.id, 'TWO_FACTOR_DISABLE_BAD_PASSWORD', {}, req.ip);
        return res.status(403).json({ ok: false, error: 'Wrong password.' });
    }
    const r = twoFactor.disable(u.id, req.body && req.body.code);
    if (!r.ok) return res.status(400).json({ ok: false, error: 'Wrong code.' });
    db.auditLog(u.id, 'TWO_FACTOR_DISABLED', {}, req.ip);
    logger.info('AUTH', `2FA disabled uid=${u.id}`);
    _mail('two_factor_disabled', u.email);
    res.json({ ok: true });
});

module.exports = router;
