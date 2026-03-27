// Zeus Terminal — Per-User Context Sync (cross-device preferences)
// Stores safe display/preference data per user. Never touches trading/brain/signals.
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CTX_DIR = path.join(__dirname, '..', '..', 'data', 'user_ctx');
const MAX_SIZE = 256 * 1024; // 256KB ceiling per user — extended sections included
const MAX_BACKUPS = 5; // rotative backups per user

// Ensure directory exists
if (!fs.existsSync(CTX_DIR)) fs.mkdirSync(CTX_DIR, { recursive: true });

// [BE-02] Per-user write lock — prevents concurrent POST from overwriting each other
const _writeLocks = new Map(); // userId → Promise chain
function _withLock(userId, fn) {
    const key = String(userId);
    const prev = _writeLocks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn); // always run, even if prev rejected
    _writeLocks.set(key, next);
    return next;
}

// ── Helpers ──────────────────────────────────────────────────────
function _userFile(userId) {
    // Guard: userId must be a positive integer (from JWT via sessionAuth)
    const id = parseInt(userId, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    return path.join(CTX_DIR, id + '.json');
}

function _atomicWrite(filePath, data) {
    // Backup rotation before overwrite
    if (fs.existsSync(filePath)) {
        try {
            for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
                const src = filePath + '.bak' + i;
                const dst = filePath + '.bak' + (i + 1);
                if (fs.existsSync(src)) fs.renameSync(src, dst);
            }
            fs.copyFileSync(filePath, filePath + '.bak1');
            // Remove oldest if over limit
            const oldest = filePath + '.bak' + (MAX_BACKUPS + 1);
            if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
        } catch (_) { /* backup is best-effort */ }
    }
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, filePath);
}

// ── GET /api/sync/user-context — pull user preferences ──────────
router.get('/user-context', (req, res) => {
    try {
        if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'unauthorized' });
        const fp = _userFile(req.user.id);
        if (!fp) return res.status(400).json({ ok: false, error: 'bad user id' });
        if (!fs.existsSync(fp)) return res.json({ ok: true, data: null });
        const raw = fs.readFileSync(fp, 'utf8');
        const data = JSON.parse(raw);
        return res.json({ ok: true, data });
    } catch (e) {
        console.error('[user-ctx] GET error:', e.message);
        return res.status(500).json({ ok: false, error: 'read failed' });
    }
});

// ── POST /api/sync/user-context — push user preferences ─────────
router.post('/user-context', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const fp = _userFile(req.user.id);
    if (!fp) return res.status(400).json({ ok: false, error: 'bad user id' });

    const body = req.body;
    if (!body || typeof body !== 'object' || !body.ts) {
        return res.status(400).json({ ok: false, error: 'missing payload or ts' });
    }

    // Size guard
    const raw = JSON.stringify(body);
    if (raw.length > MAX_SIZE) {
        return res.status(413).json({ ok: false, error: 'payload too large' });
    }

    // [BE-02] Serialize writes per-user to prevent read-merge-write race
    _withLock(req.user.id, () => {
      try {
        // Section-level last-write-wins merge
        let existing = {};
        if (fs.existsSync(fp)) {
            try { existing = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_) { }
        }

        const sections = body.sections || {};
        const merged = existing.sections || {};

        for (const key of Object.keys(sections)) {
            const incoming = sections[key];
            const current = merged[key];
            // Accept if no existing section or incoming is newer
            if (!current || !current.ts || (incoming && incoming.ts && incoming.ts >= current.ts)) {
                merged[key] = incoming;
            }
        }

        const final = { userId: req.user.id, ts: body.ts, sections: merged };
        _atomicWrite(fp, final);

        console.log('[user-ctx] POST user', req.user.id, '— sections:', Object.keys(merged).join(','));
        // Broadcast to other devices via WebSocket for instant sync
        if (req.app.locals.wsBroadcast) req.app.locals.wsBroadcast(req.user.id, null);
        // [C3] Echo stored settings section for client-side validation
        var storedSettings = merged.settings || null;
        return res.json({ ok: true, ts: body.ts, storedSettings: storedSettings });
      } catch (e) {
        console.error('[user-ctx] POST error:', e.message);
        return res.status(500).json({ ok: false, error: 'write failed' });
      }
    }); // [BE-02] end _withLock
});

module.exports = router;
