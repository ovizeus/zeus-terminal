// Zeus Terminal — Per-User Context Sync (cross-device preferences)
// Stores safe display/preference data per user. Never touches trading/brain/signals.
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../services/database');
const logger = require('../services/logger');

const CTX_DIR = path.join(__dirname, '..', '..', 'data', 'user_ctx');
const MAX_SIZE = 256 * 1024; // 256KB ceiling per user — extended sections included
const MAX_BACKUPS = 5; // rotative backups per user

// Ensure directory exists
if (!fs.existsSync(CTX_DIR)) fs.mkdirSync(CTX_DIR, { recursive: true });

// Whitelist of allowed section keys (must match client _buildAllSections)
const ALLOWED_SECTIONS = new Set([
    // Core 6
    'settings', 'uiContext', 'panels', 'indSettings', 'llvSettings', 'uiScale',
    // Extended 12
    'signalRegistry', 'perfStats', 'dailyPnl', 'postmortem', 'adaptive',
    'notifications', 'scannerSyms', 'midstackOrder', 'aubData', 'ofHud',
    'teacherData', 'ariaNovaHud',
    // ARES
    'aresData',
]);

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
router.post('/user-context', async (req, res) => { // [S11] async to properly await lock
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
    await _withLock(req.user.id, () => { // [S11] await the lock promise
      try {
        // Section-level last-write-wins merge
        let existing = {};
        if (fs.existsSync(fp)) {
            try { existing = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_) { }
        }

        const sections = body.sections || {};
        const merged = existing.sections || {};

        const MAX_SECTION_SIZE = 64 * 1024; // 64KB per section
        let rejected = 0;
        for (const key of Object.keys(sections)) {
            if (!ALLOWED_SECTIONS.has(key)) { rejected++; continue; }
            const incoming = sections[key];
            // [V4.3] Validate section data: must be a non-null object
            if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
                console.warn('[user-ctx] Rejected section', key, 'from user', req.user.id, '— not an object');
                rejected++;
                continue;
            }
            // [V4.3] Per-section size guard
            const sectionSize = JSON.stringify(incoming).length;
            if (sectionSize > MAX_SECTION_SIZE) {
                console.warn('[user-ctx] Rejected section', key, 'from user', req.user.id, '— too large:', sectionSize);
                rejected++;
                continue;
            }
            const current = merged[key];
            // Accept if no existing section or incoming is newer
            if (!current || !current.ts || (incoming && incoming.ts && incoming.ts >= current.ts)) {
                merged[key] = incoming;
            }
        }
        if (rejected > 0) console.warn('[user-ctx] Rejected', rejected, 'section(s) from user', req.user.id);

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

// ─── Prune stale user_ctx files for deleted users (runs daily) ───
const CTX_PRUNE_INTERVAL = 24 * 60 * 60 * 1000;
const CTX_STALE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function _pruneStaleCtxFiles() {
    try {
        const validIds = new Set(db.listUsers().map(u => u.id));
        const files = fs.readdirSync(CTX_DIR);
        let pruned = 0;
        for (const f of files) {
            const m = f.match(/^(\d+)\.json(\.bak\d+)?$/);
            if (!m) continue;
            const uid = parseInt(m[1], 10);
            const filePath = path.join(CTX_DIR, f);
            const stat = fs.statSync(filePath);
            const age = Date.now() - stat.mtimeMs;
            if (!validIds.has(uid) || age > CTX_STALE_AGE_MS) {
                fs.unlinkSync(filePath);
                pruned++;
            }
        }
        if (pruned > 0) logger.info('USER_CTX', `Pruned ${pruned} stale user context file(s)`);
    } catch (e) {
        logger.error('USER_CTX', 'Context file prune failed: ' + e.message);
    }
}

setTimeout(_pruneStaleCtxFiles, 90000); // 90s after startup
setInterval(_pruneStaleCtxFiles, CTX_PRUNE_INTERVAL);

module.exports = router;
