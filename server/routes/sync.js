// Zeus Terminal — State Sync API
// Enables PC <-> Phone sync via server-stored JSON
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'sync_state.json');
const JOURNAL_FILE = path.join(DATA_DIR, 'sync_journal.json');
const MAX_SIZE = 500 * 1024; // 500KB max per file

// BUG-03 FIX: Shared secret for sync authentication
const SYNC_TOKEN = process.env.SYNC_TOKEN || 'zeus-sync-2024';

// BUG-04 FIX: Write lock to prevent concurrent read-merge-write races
let _writeLock = false;
const _writeQueue = [];
function _acquireLock(cb) {
    if (!_writeLock) { _writeLock = true; cb(); }
    else { _writeQueue.push(cb); }
}
function _releaseLock() {
    if (_writeQueue.length > 0) { const next = _writeQueue.shift(); next(); }
    else { _writeLock = false; }
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// BUG-03 FIX: Auth middleware for all sync routes
router.use((req, res, next) => {
    const token = req.headers['x-sync-token'] || req.query.token;
    if (token !== SYNC_TOKEN) {
        console.warn('[sync] AUTH REJECTED from', req.ip || '?', '— bad/missing token');
        return res.status(403).json({ ok: false, error: 'unauthorized' });
    }
    next();
});

// ─── GET /api/sync/state — fetch latest synced state ───
router.get('/state', (req, res) => {
    try {
        const ip = req.ip || req.connection?.remoteAddress || '?';
        if (!fs.existsSync(STATE_FILE)) {
            console.log('[sync] GET /state from', ip, '→ no file');
            return res.json({ ok: true, data: null });
        }
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const data = JSON.parse(raw);
        console.log('[sync] GET /state from', ip, '→ pos:', (data.positions || []).length, 'bal:', data.demoBalance);
        res.json({ ok: true, data });
    } catch (e) {
        console.warn('[sync] read state failed:', e.message);
        res.json({ ok: false, error: 'read failed' });
    }
});

// ─── POST /api/sync/state — smart merge: keeps positions from both devices ───
router.post('/state', (req, res) => {
    // BUG-04 FIX: Serialize writes with lock to prevent race conditions
    _acquireLock(() => {
        try {
            const ip = req.ip || req.connection?.remoteAddress || '?';
            const body = req.body;
            if (!body || typeof body !== 'object' || !body.ts) {
                console.warn('[sync] POST /state from', ip, '→ REJECTED (invalid payload)');
                _releaseLock();
                return res.status(400).json({ ok: false, error: 'invalid payload' });
            }
            const json = JSON.stringify(body);
            if (json.length > MAX_SIZE) {
                _releaseLock();
                return res.status(413).json({ ok: false, error: 'payload too large' });
            }
            // Read existing state for merge
            let existing = null;
            if (fs.existsSync(STATE_FILE)) {
                try { existing = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { }
            }
            // Merge: combine positions from server + incoming (union by id)
            const incomingPositions = Array.isArray(body.positions) ? body.positions : [];
            const serverPositions = (existing && Array.isArray(existing.positions)) ? existing.positions : [];

            if (serverPositions.length > 0) {
                const incomingIds = new Set(incomingPositions.map(p => String(p.id)));
                // Add server positions not present in incoming
                serverPositions.forEach(sp => {
                    if (!sp.closed && !incomingIds.has(String(sp.id))) {
                        body.positions = body.positions || [];
                        body.positions.push(sp);
                    }
                });
            }
            // Balance logic: if incoming has NO positions but server does,
            // keep server balance (incoming device likely has no trades).
            // If incoming HAS positions, trust incoming balance.
            if (incomingPositions.length === 0 && serverPositions.length > 0 && existing) {
                body.demoBalance = existing.demoBalance;
                body.demoPnL = existing.demoPnL;
                body.demoWins = existing.demoWins;
                body.demoLosses = existing.demoLosses;
            }
            const finalPositions = Array.isArray(body.positions) ? body.positions : [];
            console.log('[sync] POST /state from', ip, '→ incoming:', incomingPositions.length, 'server:', serverPositions.length, 'final:', finalPositions.length, 'bal:', body.demoBalance);
            // BUG-04 FIX: Write to temp file then rename for atomicity
            const tmpFile = STATE_FILE + '.tmp';
            fs.writeFileSync(tmpFile, JSON.stringify(body), 'utf8');
            fs.renameSync(tmpFile, STATE_FILE);
            _releaseLock();
            res.json({ ok: true, ts: body.ts });
        } catch (e) {
            _releaseLock();
            console.warn('[sync] write state failed:', e.message);
            res.status(500).json({ ok: false, error: 'write failed' });
        }
    });
});

// ─── GET /api/sync/journal — fetch synced journal ───
router.get('/journal', (req, res) => {
    try {
        if (!fs.existsSync(JOURNAL_FILE)) return res.json({ ok: true, data: null });
        const raw = fs.readFileSync(JOURNAL_FILE, 'utf8');
        const data = JSON.parse(raw);
        res.json({ ok: true, data });
    } catch (e) {
        console.warn('[sync] read journal failed:', e.message);
        res.json({ ok: false, error: 'read failed' });
    }
});

// ─── POST /api/sync/journal — merge journal entries (union by id) ───
router.post('/journal', (req, res) => {
    _acquireLock(() => {
        try {
            const body = req.body;
            if (!Array.isArray(body)) {
                _releaseLock();
                return res.status(400).json({ ok: false, error: 'expected array' });
            }
            // Load existing journal and merge
            let existing = [];
            if (fs.existsSync(JOURNAL_FILE)) {
                try { existing = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8')); } catch (_) { }
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
                _releaseLock();
                return res.status(413).json({ ok: false, error: 'payload too large' });
            }
            const tmpFile = JOURNAL_FILE + '.tmp';
            fs.writeFileSync(tmpFile, json, 'utf8');
            fs.renameSync(tmpFile, JOURNAL_FILE);
            _releaseLock();
            res.json({ ok: true, count: limited.length });
        } catch (e) {
            _releaseLock();
            console.warn('[sync] write journal failed:', e.message);
            res.status(500).json({ ok: false, error: 'write failed' });
        }
    });
});

// ─── GET /api/sync/debug — quick check what's on server ───
router.get('/debug', (req, res) => {
    try {
        let stateInfo = { exists: false };
        if (fs.existsSync(STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            stateInfo = { exists: true, ts: data.ts, positions: (data.positions || []).length, bal: data.demoBalance };
        }
        res.json({ ok: true, state: stateInfo, serverTime: Date.now() });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

module.exports = router;
