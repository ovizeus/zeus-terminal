// server/routes/notify.js
// [2026-11-22] Notificari pe telefon (vezi services/notifyDevices.js).
//   POST /api/notify/register  — cu sesiune: cheie noua pentru telefonul acesta
//   GET  /api/notify/pending   — FARA sesiune, cu antetul X-Zeus-Notify-Token (sarcina din fundal)
//   POST /api/notify/revoke    — telefonul renunta la cheie (la deconectare)
'use strict';
const express = require('express');
const router = express.Router();
const ND = require('../services/notifyDevices');

const TOKEN_HEADER = 'x-zeus-notify-token';

router.post('/register', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
    try { res.json({ ok: true, token: ND.register(req.user.id) }); }
    catch (_) { res.status(500).json({ ok: false, error: 'unavailable' }); }
});

router.get('/pending', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const who = ND.userForToken(req.get(TOKEN_HEADER));
    if (!who) return res.status(401).json({ ok: false, error: 'bad_token' });
    try { res.json({ ok: true, ...ND.pending(who.userId, who.isAdmin) }); }
    catch (_) { res.status(200).json({ ok: false, badge: 0, items: [] }); }
});

// [2026-11-22] Alegerile din Alerts › Phone notifications (contul propriu).
router.get('/prefs', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
    try { res.json({ ok: true, prefs: require('../services/notifyEvents').getPrefs(req.user.id) }); }
    catch (_) { res.status(500).json({ ok: false, error: 'unavailable' }); }
});
router.post('/prefs', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
    try { res.json({ ok: true, prefs: require('../services/notifyEvents').setPrefs(req.user.id, req.body || {}) }); }
    catch (_) { res.status(500).json({ ok: false, error: 'unavailable' }); }
});

router.post('/revoke', (req, res) => {
    try { ND.revoke(req.get(TOKEN_HEADER)); } catch (_) { /* */ }
    res.json({ ok: true });
});

module.exports = router;
module.exports.TOKEN_HEADER = TOKEN_HEADER;
