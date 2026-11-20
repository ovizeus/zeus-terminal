// [2026-11-20] Radarul creierului pe server — monedele radarului si inregistrarile.
// Montat la /api/brain/radar (sub /api/brain/: conturile viewer nu ajung aici, ca si
// la jurnal). Axele LIVE pentru afisaj sunt in /api/market/radar (permise si viewerilor).
'use strict';

const { Router } = require('express');
const RC = require('../services/radarCapture');
const router = Router();

const uidOf = (req) => (req.user && req.user.id != null ? Number(req.user.id) : null);

// GET /api/brain/radar/coins → { coins: [...] | null }  (null = utilizatorul n-a ales inca)
router.get('/coins', (req, res) => {
    const uid = uidOf(req); if (uid == null) return res.status(401).json({ error: 'auth' });
    res.json({ ok: true, coins: RC.getCoins(uid), defaults: RC.DEFAULT_COINS });
});

// PUT /api/brain/radar/coins { coins: ['BTCUSDT','','SOLUSDT'] } — pozitia = coltul
router.put('/coins', (req, res) => {
    const uid = uidOf(req); if (uid == null) return res.status(401).json({ error: 'auth' });
    const c = RC.setCoins(uid, req.body && req.body.coins);
    if (!c) return res.status(400).json({ ok: false, error: 'invalid_coins' });
    res.json({ ok: true, coins: c });
});

// GET /api/brain/radar/captures?limit=300 → lista (fara cadre)
router.get('/captures', (req, res) => {
    const uid = uidOf(req); if (uid == null) return res.status(401).json({ error: 'auth' });
    try { res.json({ ok: true, captures: RC.listCaptures(uid, req.query.limit) }); }
    catch (e) { res.status(200).json({ ok: false, error: 'unavailable', captures: [] }); }
});

// GET /api/brain/radar/captures/:seq → { entry, frames, status }
router.get('/captures/:seq', (req, res) => {
    const uid = uidOf(req); if (uid == null) return res.status(401).json({ error: 'auth' });
    const seq = Number(req.params.seq);
    if (!Number.isFinite(seq)) return res.status(400).json({ ok: false, error: 'bad_seq' });
    try {
        const r = RC.getFrames(uid, seq);
        if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
        res.json({ ok: true, ...r });
    } catch (e) { res.status(200).json({ ok: false, error: 'unavailable' }); }
});

module.exports = router;
