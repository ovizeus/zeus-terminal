'use strict';
// [2026-11-21] MARKET NEWS — stirile, reactia masurata, calendarul economic, rezumatul AI si alertele.
// Datele vin din services/newsFeed.js (pornit o data, la server). Autentificat (montat dupa sessionAuth).
const { Router } = require('express');
const news = require('../services/newsFeed');

const router = Router();

router.get('/', (req, res) => {
    const uid = req.user && req.user.id;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...news.snapshot(), prefs: uid != null ? news.getPrefs(uid) : { alerts: 'app' } });
});

router.post('/prefs', (req, res) => {
    const uid = req.user && req.user.id;
    if (uid == null) return res.status(401).json({ ok: false, error: 'auth' });
    const alerts = String((req.body && req.body.alerts) || '');
    if (!news.setPrefs(uid, alerts)) return res.status(400).json({ ok: false, error: 'bad_value' });
    res.json({ ok: true, prefs: news.getPrefs(uid) });
});

module.exports = router;
