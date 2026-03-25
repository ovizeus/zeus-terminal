// Zeus Terminal — State Sync API
// Enables PC <-> Phone sync via server-stored JSON
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const logger = require('../services/logger');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SYNC_DIR = path.join(DATA_DIR, 'sync_user');
const MAX_SIZE = 500 * 1024; // 500KB max per file

// Per-user write lock to prevent concurrent read-merge-write races
const _userLocks = new Map();
function _acquireLock(userId, cb) {
    if (!_userLocks.has(userId)) { _userLocks.set(userId, { locked: false, queue: [] }); }
    const lock = _userLocks.get(userId);
    if (!lock.locked) { lock.locked = true; cb(); }
    else { lock.queue.push(cb); }
}
function _releaseLock(userId) {
    const lock = _userLocks.get(userId);
    if (!lock) return;
    if (lock.queue.length > 0) { const next = lock.queue.shift(); next(); }
    else { lock.locked = false; _userLocks.delete(userId); }
}

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });

// ── Per-user file paths (JWT auth via sessionAuth populates req.user) ──
function _stateFile(userId) {
    const id = parseInt(userId, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    return path.join(SYNC_DIR, id + '_state.json');
}
function _journalFile(userId) {
    const id = parseInt(userId, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    return path.join(SYNC_DIR, id + '_journal.json');
}

// Auth guard — require JWT user (already set by sessionAuth middleware)
router.use((req, res, next) => {
    if (!req.user || !req.user.id) {
        logger.warn('SYNC', 'Auth rejected — no session', { ip: req.ip || '?' });
        return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    next();
});

// ─── GET /api/sync/state — fetch latest synced state (per-user) ───
router.get('/state', (req, res) => {
    try {
        const sf = _stateFile(req.user.id);
        if (!sf) return res.status(400).json({ ok: false, error: 'bad user id' });
        if (!fs.existsSync(sf)) {
            return res.json({ ok: true, data: null });
        }
        const raw = fs.readFileSync(sf, 'utf8');
        const data = JSON.parse(raw);
        res.json({ ok: true, data });
    } catch (e) {
        logger.warn('SYNC', 'Read state failed', { error: e.message });
        res.json({ ok: false, error: 'read failed' });
    }
});

// ─── POST /api/sync/state — smart merge: keeps positions from both devices (per-user) ───
router.post('/state', (req, res) => {
    // BUG-04 FIX: Serialize writes with lock to prevent race conditions
    const uid = req.user.id;
    _acquireLock(uid, () => {
        try {
            const sf = _stateFile(uid);
            if (!sf) { _releaseLock(uid); return res.status(400).json({ ok: false, error: 'bad user id' }); }
            const body = req.body;
            if (!body || typeof body !== 'object' || !body.ts) {
                logger.warn('SYNC', 'POST /state rejected — invalid payload', { userId: uid });
                _releaseLock(uid);
                return res.status(400).json({ ok: false, error: 'invalid payload' });
            }
            const json = JSON.stringify(body);
            if (json.length > MAX_SIZE) {
                _releaseLock(uid);
                return res.status(413).json({ ok: false, error: 'payload too large' });
            }
            // Read existing state for merge
            let existing = null;
            if (fs.existsSync(sf)) {
                try { existing = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch (_) { }
            }
            // Merge: combine positions from server + incoming (union by id)
            const incomingPositions = Array.isArray(body.positions) ? body.positions : [];
            const serverPositions = (existing && Array.isArray(existing.positions)) ? existing.positions : [];

            // [FIX] Resurrection guard: ALWAYS merge closedIds and filter positions, even with 0 server positions
            const clientClosed = Array.isArray(body.closedIds) ? body.closedIds.map(String) : [];
            const serverClosed = (existing && Array.isArray(existing.closedIds)) ? existing.closedIds.map(String) : [];
            const closedIds = new Set([...clientClosed, ...serverClosed]);

            if (serverPositions.length > 0) {
                const incomingIds = new Set(incomingPositions.map(p => String(p.id)));
                // Add server positions not present in incoming AND not closed
                serverPositions.forEach(sp => {
                    if (!sp.closed && !incomingIds.has(String(sp.id)) && !closedIds.has(String(sp.id))) {
                        body.positions = body.positions || [];
                        body.positions.push(sp);
                    }
                });
            }

            // Persist merged closedIds (keep last 300 to avoid unbounded growth)
            body.closedIds = Array.from(closedIds).slice(-300);
            // Filter ALL positions against full closedIds set (resurrection guard)
            body.positions = (body.positions || []).filter(p => !closedIds.has(String(p.id)));
            // Balance logic: if incoming has NO positions AND no closedIds (device has no knowledge of trades),
            // keep server balance. But if closedIds exist, user intentionally closed everything — trust incoming.
            const clientClosed2 = Array.isArray(body.closedIds) ? body.closedIds : [];
            if (incomingPositions.length === 0 && serverPositions.length > 0 && existing && clientClosed2.length === 0) {
                body.demoBalance = existing.demoBalance;
                body.demoPnL = existing.demoPnL;
                body.demoWins = existing.demoWins;
                body.demoLosses = existing.demoLosses;
            }
            const finalPositions = Array.isArray(body.positions) ? body.positions : [];
            const tmpFile = sf + '.tmp';
            fs.writeFileSync(tmpFile, JSON.stringify(body), 'utf8');
            fs.renameSync(tmpFile, sf);
            _releaseLock(uid);
            // Notify other devices via WebSocket
            if (req.app.locals.wsBroadcast) req.app.locals.wsBroadcast(uid, null);
            res.json({ ok: true, ts: body.ts });
        } catch (e) {
            _releaseLock(uid);
            logger.warn('SYNC', 'Write state failed', { error: e.message });
            res.status(500).json({ ok: false, error: 'write failed' });
        }
    });
});

// ─── GET /api/sync/journal — fetch synced journal (per-user) ───
router.get('/journal', (req, res) => {
    try {
        const jf = _journalFile(req.user.id);
        if (!jf) return res.status(400).json({ ok: false, error: 'bad user id' });
        if (!fs.existsSync(jf)) return res.json({ ok: true, data: null });
        const raw = fs.readFileSync(jf, 'utf8');
        const data = JSON.parse(raw);
        res.json({ ok: true, data });
    } catch (e) {
        logger.warn('SYNC', 'Read journal failed', { error: e.message });
        res.json({ ok: false, error: 'read failed' });
    }
});

// ─── POST /api/sync/journal — merge journal entries (union by id, per-user) ───
router.post('/journal', (req, res) => {
    const uid = req.user.id;
    _acquireLock(uid, () => {
        try {
            const jf = _journalFile(uid);
            if (!jf) { _releaseLock(uid); return res.status(400).json({ ok: false, error: 'bad user id' }); }
            const body = req.body;
            if (!Array.isArray(body)) {
                _releaseLock(uid);
                return res.status(400).json({ ok: false, error: 'expected array' });
            }
            // Load existing journal and merge
            let existing = [];
            if (fs.existsSync(jf)) {
                try { existing = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch (_) { }
            }
            // Union by id
            const idSet = new Set(body.map(j => String(j.id)).filter(Boolean));
            (existing || []).forEach(j => {
                if (j.id && !idSet.has(String(j.id))) body.push(j);
            });
            // Sort by id desc (newest first), cap at 100
            body.sort((a, b) => (b.id || 0) - (a.id || 0));
            const limited = body.slice(0, 100);
            const json = JSON.stringify(limited);
            if (json.length > MAX_SIZE) {
                _releaseLock(uid);
                return res.status(413).json({ ok: false, error: 'payload too large' });
            }
            const tmpFile = jf + '.tmp';
            fs.writeFileSync(tmpFile, json, 'utf8');
            fs.renameSync(tmpFile, jf);
            _releaseLock(uid);
            res.json({ ok: true, count: limited.length });
        } catch (e) {
            _releaseLock(uid);
            logger.warn('SYNC', 'Write journal failed', { error: e.message });
            res.status(500).json({ ok: false, error: 'write failed' });
        }
    });
});

// ─── GET /api/sync/debug — quick check what's on server (per-user) ───
router.get('/debug', (req, res) => {
    try {
        const sf = _stateFile(req.user.id);
        let stateInfo = { exists: false };
        if (sf && fs.existsSync(sf)) {
            const data = JSON.parse(fs.readFileSync(sf, 'utf8'));
            stateInfo = { exists: true, ts: data.ts, positions: (data.positions || []).length, bal: data.demoBalance };
        }
        res.json({ ok: true, userId: req.user.id, state: stateInfo, serverTime: Date.now() });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

module.exports = router;
