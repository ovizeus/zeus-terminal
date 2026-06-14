'use strict';

// Zeus Terminal — Support chat route
// One-to-one text chat between each user and the operator (admin).
// Mounted at /api/support after sessionAuth middleware in server.js.
// Realtime delivery via app.locals.wsBroadcastToUser; persistence in DB.

const express = require('express');
const router = express.Router();
const db = require('../services/database');

const MAX_LEN = 2000;

function _requireAuth(req, res, next) {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ ok: false, error: 'Authentication required' });
    }
    next();
}
function _requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'admin only' });
    }
    next();
}
function _cleanMessage(raw) {
    if (typeof raw !== 'string') return null;
    const m = raw.trim();
    if (!m || m.length > MAX_LEN) return null;
    return m;
}
function _push(req, userId, row) {
    const fn = req.app && req.app.locals && req.app.locals.wsBroadcastToUser;
    if (typeof fn === 'function') {
        try { fn(userId, { type: 'support.message', data: row }); } catch (_) { /* never block */ }
    }
}

// ── User: send a message ──
router.post('/send', _requireAuth, (req, res) => {
    const message = _cleanMessage(req.body && req.body.message);
    if (!message) return res.status(400).json({ ok: false, error: 'empty or too long' });
    try {
        const row = db.insertSupportMessage(req.user.id, 'user', message);
        for (const adminId of db.getAdminUserIds()) {
            if (adminId === req.user.id) continue;
            _push(req, adminId, row);
        }
        res.json({ ok: true, msg: row });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

// ── User: read own thread (marks admin replies as read) ──
router.get('/thread', _requireAuth, (req, res) => {
    try {
        const messages = db.getSupportThread(req.user.id);
        db.markSupportThreadReadByUser(req.user.id);
        res.json({ ok: true, messages });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

// ── User: unread admin-reply count ──
router.get('/unread', _requireAuth, (req, res) => {
    try { res.json({ ok: true, unread: db.getSupportUnreadForUser(req.user.id) }); }
    catch (err) { res.status(500).json({ ok: false, error: String(err && err.message || err) }); }
});

// ── Admin: inbox (all conversations + total unread) ──
router.get('/inbox', _requireAuth, _requireAdmin, (req, res) => {
    try {
        res.json({ ok: true, conversations: db.getSupportInbox(), totalUnread: db.getSupportTotalUnreadForAdmin() });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

// ── Admin: read one user's thread (marks their messages as read) ──
router.get('/thread/:userId', _requireAuth, _requireAdmin, (req, res) => {
    const uid = parseInt(req.params.userId, 10);
    if (!Number.isInteger(uid) || uid < 1) return res.status(400).json({ ok: false, error: 'bad user id' });
    try {
        const messages = db.getSupportThread(uid);
        db.markSupportThreadReadByAdmin(uid);
        res.json({ ok: true, messages });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

// ── Admin: reply to a user ──
router.post('/reply/:userId', _requireAuth, _requireAdmin, (req, res) => {
    const uid = parseInt(req.params.userId, 10);
    if (!Number.isInteger(uid) || uid < 1) return res.status(400).json({ ok: false, error: 'bad user id' });
    const message = _cleanMessage(req.body && req.body.message);
    if (!message) return res.status(400).json({ ok: false, error: 'empty or too long' });
    try {
        const row = db.insertSupportMessage(uid, 'admin', message);
        _push(req, uid, row);
        res.json({ ok: true, msg: row });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

module.exports = router;
