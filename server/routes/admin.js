'use strict';

// Zeus Terminal — Admin operations route
// Operator-only endpoints for emergency control: global halt toggle, status read.
// Mounted at /api/admin after sessionAuth middleware in server.js.

const express = require('express');
const router = express.Router();

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

// POST /api/admin/halt — arm or disarm global halt
// Body: { active: boolean, reason?: string }
router.post('/halt', _requireAuth, _requireAdmin, (req, res) => {
    if (typeof req.body.active !== 'boolean') {
        return res.status(400).json({ ok: false, error: 'active (boolean) required' });
    }
    const reason = String(req.body.reason || 'admin_api').slice(0, 200);
    try {
        const serverAT = require('../services/serverAT');
        const result = serverAT.setGlobalHalt(req.body.active, req.user.id, reason);
        return res.json({ ok: true, halt: result });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/halt — current state
router.get('/halt', _requireAuth, _requireAdmin, (req, res) => {
    try {
        const serverAT = require('../services/serverAT');
        const state = serverAT.getGlobalHaltState
            ? serverAT.getGlobalHaltState()
            : { active: false, by: null, ts: null, reason: null };
        return res.json(state);
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/binance-telemetry — live request-telemetry snapshot
// (per-source counts, quota pressure, scheduler lane stats). [2026-06-05]
// Built to attribute the recurring testnet weight saturations (6000+/min
// bursts at 12:45/13:30/17:30) — the ring is in-memory, so when the next
// BINANCE_RATE warn fires, hit this endpoint to see WHO spent the weight.
router.get('/binance-telemetry', _requireAuth, _requireAdmin, (req, res) => {
    try {
        const snap = require('../services/binanceTelemetry').getSnapshot();
        return res.json({ ok: true, snapshot: snap });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/user-stats/:id — per-user live stats for the admin drawer
// [P2 2026-06-06] On-demand only (fetched when the drawer opens, no polling →
// at most one exchange balance call per open). Exchange balance is fail-soft:
// a Binance hiccup returns balance:null + balanceError, never a 500 — the
// drawer still renders mode/positions/demo balance.
router.get('/user-stats/:id', _requireAuth, _requireAdmin, async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId) || targetId <= 0) {
        return res.status(400).json({ ok: false, error: 'numeric user id required' });
    }
    try {
        const serverAT = require('../services/serverAT');
        const credentialStore = require('../services/credentialStore');

        const mode = serverAT.getMode(targetId);
        const stats = serverAT.getStats(targetId);
        const demo = serverAT.getDemoBalance(targetId);
        const positions = (serverAT.getOpenPositions(targetId) || []).map(p => ({
            seq: p.seq, symbol: p.symbol, side: p.side, mode: p.mode,
            size: p.size, lev: p.lev, entryPrice: p.price, sl: p.sl, tp: p.tp,
            openedAt: p.ts, liveStatus: p.live ? p.live.status : null,
        }));

        const creds = credentialStore.getExchangeCreds(targetId);
        const exchange = { connected: !!creds };
        if (creds) {
            exchange.exchange = creds.exchange;
            exchange.mode = creds.mode;
            try {
                const bal = await require('../services/exchangeOps').getBalance(targetId);
                // Canonical ops shape (binanceOps/bybitOps) is walletBalance;
                // accept legacy `balance` defensively.
                exchange.balance = bal ? parseFloat(bal.walletBalance != null ? bal.walletBalance : (bal.balance || 0)) : null;
                exchange.availableBalance = bal ? parseFloat(bal.availableBalance || 0) : null;
            } catch (balErr) {
                exchange.balance = null;
                exchange.availableBalance = null;
                exchange.balanceError = balErr.message;
            }
        }

        return res.json({
            ok: true,
            stats: {
                mode,
                openCount: stats.openCount,
                dailyPnLLive: stats.dailyPnLLive,
                dailyPnLDemo: stats.dailyPnLDemo,
                killActive: stats.killActive,
                killPct: stats.killPct,
                demo,
                exchange,
                positions,
            },
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/leaderboard?env=REAL|TESTNET|DEMO&window=today|7d|30d|all
// Read-only aggregated ranking of all users. ~10s server cache per (env,window).
router.get('/leaderboard', _requireAuth, _requireAdmin, async (req, res) => {
    const env = ['REAL', 'TESTNET', 'DEMO'].includes(String(req.query.env)) ? String(req.query.env) : 'TESTNET';
    const window = ['today', '7d', '30d', 'all'].includes(String(req.query.window)) ? String(req.query.window) : 'all';
    try {
        const data = await require('../services/leaderboard').gatherLeaderboardData({ env, window });
        return res.json(data);
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/book — "Book of All" personal monitor (markdown).
// Lives under /api/admin (NOT /auth/) so it is NOT subject to the nginx login
// brute-force rate-limit (zone=zeus_auth 10r/m) that returns 503 on bursts.
router.get('/book', _requireAuth, _requireAdmin, (req, res) => {
    try {
        const fs = require('fs');
        const bookPath = require('path').join(__dirname, '..', '..', 'docs', 'BOOK_OF_ALL.md');
        if (!fs.existsSync(bookPath)) {
            return res.json({ ok: true, markdown: '# Book of All\n\n_(carte goală — încă nimic de monitorizat)_', updatedAt: null });
        }
        const markdown = fs.readFileSync(bookPath, 'utf8');
        const updatedAt = fs.statSync(bookPath).mtime.toISOString();
        return res.json({ ok: true, markdown, updatedAt });
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'Could not read book' });
    }
});

// ─── Uploads ("Book" attachments) — operator uploads screenshots + docs, the
// assistant reads them off disk to fix things, the operator deletes them after.
// Admin-only, under /api/admin (NOT /auth, which is rate-limited). Stored on disk
// as <epochMs>__<safeName> so the upload time + ordering come from the filename.
const _UPLOAD_DIR = require('path').join(__dirname, '..', '..', 'data', 'book_uploads');
const _ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'txt', 'csv', 'log', 'md', 'json']);
const _IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const _MAX_UPLOAD = 200 * 1024 * 1024; // 200MB (operator deletes after review)
const _ID_RE = /^[0-9]{10,16}__[A-Za-z0-9._-]+$/;

function _ensureUploadDir() {
    const fs = require('fs');
    if (!fs.existsSync(_UPLOAD_DIR)) fs.mkdirSync(_UPLOAD_DIR, { recursive: true });
}
function _safeName(name) {
    return String(name || 'file').replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').slice(-60) || 'file';
}
function _extOf(name) { return require('path').extname(String(name || '')).toLowerCase().slice(1); }
// Resolve a request :id to a real path inside the upload dir, or null (traversal-safe).
function _resolveUpload(id) {
    if (!_ID_RE.test(String(id || ''))) return null;
    const path = require('path');
    const full = path.join(_UPLOAD_DIR, id);
    if (path.dirname(full) !== _UPLOAD_DIR) return null;
    return full;
}
function _contentType(ext) {
    return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
        pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
        log: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', json: 'application/json' })[ext] || 'application/octet-stream';
}

// POST /api/admin/uploads — multipart, one or more files
router.post('/uploads', _requireAuth, _requireAdmin, (req, res) => {
    try {
        _ensureUploadDir();
        const fs = require('fs');
        const { IncomingForm } = require('formidable');
        const form = new IncomingForm({ maxFileSize: _MAX_UPLOAD, multiples: true, uploadDir: _UPLOAD_DIR, keepExtensions: true });
        form.parse(req, (err, fields, files) => {
            if (err) return res.status(400).json({ ok: false, error: err.message || 'upload failed' });
            const list = [];
            for (const key of Object.keys(files || {})) {
                const arr = Array.isArray(files[key]) ? files[key] : [files[key]];
                for (const f of arr) {
                    if (!f || !f.filepath) continue;
                    const ext = _extOf(f.originalFilename);
                    if (!_ALLOWED_EXT.has(ext)) { try { fs.unlinkSync(f.filepath); } catch (_) { /* */ } continue; }
                    const stored = `${Date.now()}__${_safeName(f.originalFilename)}`;
                    const dest = require('path').join(_UPLOAD_DIR, stored);
                    try { fs.renameSync(f.filepath, dest); list.push(stored); }
                    catch (_) { try { fs.unlinkSync(f.filepath); } catch (_) { /* */ } }
                }
            }
            if (!list.length) return res.status(400).json({ ok: false, error: 'No valid files (allowed: images, pdf, txt, csv, log, md, json; max 200MB)' });
            return res.json({ ok: true, uploaded: list.length });
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'upload error' });
    }
});

// GET /api/admin/uploads — list, newest first
router.get('/uploads', _requireAuth, _requireAdmin, (req, res) => {
    try {
        _ensureUploadDir();
        const fs = require('fs');
        const items = fs.readdirSync(_UPLOAD_DIR)
            .filter((n) => _ID_RE.test(n))
            .map((n) => {
                const at = parseInt(n.split('__')[0], 10);
                const name = n.split('__').slice(1).join('__');
                let size = 0; try { size = fs.statSync(require('path').join(_UPLOAD_DIR, n)).size; } catch (_) { /* */ }
                return { id: n, name, uploadedAt: at, size, kind: _IMG_EXT.has(_extOf(name)) ? 'image' : 'doc', ext: _extOf(name) };
            })
            .sort((a, b) => b.uploadedAt - a.uploadedAt);
        return res.json({ ok: true, items });
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'list error' });
    }
});

// GET /api/admin/uploads/:id/raw — serve the file inline (cookie auth on img/iframe)
router.get('/uploads/:id/raw', _requireAuth, _requireAdmin, (req, res) => {
    const full = _resolveUpload(req.params.id);
    const fs = require('fs');
    if (!full || !fs.existsSync(full)) return res.status(404).end();
    res.setHeader('Content-Type', _contentType(_extOf(req.params.id)));
    res.setHeader('Cache-Control', 'private, max-age=60');
    return fs.createReadStream(full).pipe(res);
});

// DELETE /api/admin/uploads/:id — operator removes after the fix
router.delete('/uploads/:id', _requireAuth, _requireAdmin, (req, res) => {
    const full = _resolveUpload(req.params.id);
    const fs = require('fs');
    if (!full || !fs.existsSync(full)) return res.status(404).json({ ok: false, error: 'not found' });
    try { fs.unlinkSync(full); return res.json({ ok: true }); }
    catch (e) { return res.status(500).json({ ok: false, error: 'delete failed' }); }
});

// ─── Zero-knowledge Vault ────────────────────────────────────────────────────
// All admin-gated. The server only ever stores ciphertext + the wrapped private
// key; the vault password never reaches the server, so a session/server breach
// cannot read items. Encrypted file blobs live on disk (data/vault).
const _VAULT_DIR = require('path').join(__dirname, '..', '..', 'data', 'vault');
const _VAULT_MAX = 200 * 1024 * 1024; // 200MB per encrypted file blob
function _ensureVaultDir() { const fs = require('fs'); if (!fs.existsSync(_VAULT_DIR)) fs.mkdirSync(_VAULT_DIR, { recursive: true }); }
function _vaultId(id) { return /^[0-9]{1,18}$/.test(String(id || '')) ? parseInt(id, 10) : null; }

// POST /api/admin/vault/setup — one-time: store public key + wrapped private key.
// Refuses if a vault already exists (re-key would orphan existing items).
router.post('/vault/setup', _requireAuth, _requireAdmin, (req, res) => {
    const db = require('../services/database');
    if (db.getVaultKeys(req.user.id)) return res.status(409).json({ ok: false, error: 'VAULT_EXISTS', detail: 'A vault already exists for this account.' });
    const b = req.body || {};
    if (!b.publicKey || !b.wrappedPriv || !b.salt || !b.iv) return res.status(400).json({ ok: false, error: 'missing key material' });
    try {
        db.saveVaultKeys(req.user.id, { publicKey: b.publicKey, wrappedPriv: b.wrappedPriv, salt: b.salt, iv: b.iv, kdfIters: b.kdfIters });
        return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ ok: false, error: 'setup failed' }); }
});

// GET /api/admin/vault/meta — does a vault exist + its public key (safe to expose).
router.get('/vault/meta', _requireAuth, _requireAdmin, (req, res) => {
    const k = require('../services/database').getVaultKeys(req.user.id);
    return res.json({ ok: true, hasVault: !!k, publicKey: k ? k.public_key : null });
});

// GET /api/admin/vault/key — the WRAPPED private key + KDF params, for the operator
// to unlock client-side. Ciphertext; useless without the vault password.
router.get('/vault/key', _requireAuth, _requireAdmin, (req, res) => {
    const k = require('../services/database').getVaultKeys(req.user.id);
    if (!k) return res.status(404).json({ ok: false, error: 'no vault' });
    return res.json({ ok: true, wrappedPriv: k.wrapped_priv, salt: k.salt, iv: k.iv, kdfIters: k.kdf_iters });
});

// GET /api/admin/vault/items — metadata + encrypted parts (client decrypts to render).
router.get('/vault/items', _requireAuth, _requireAdmin, (req, res) => {
    try { return res.json({ ok: true, items: require('../services/database').listVaultItems(req.user.id) }); }
    catch (e) { return res.status(500).json({ ok: false, error: 'list failed' }); }
});

// POST /api/admin/vault/items — add an item. Multipart (formidable): fields carry
// the client-encrypted parts; an optional 'file' field is the already-encrypted blob.
router.post('/vault/items', _requireAuth, _requireAdmin, (req, res) => {
    const db = require('../services/database');
    if (!db.getVaultKeys(req.user.id)) return res.status(409).json({ ok: false, error: 'no vault — set one up first' });
    try {
        _ensureVaultDir();
        const fs = require('fs');
        const { IncomingForm } = require('formidable');
        const form = new IncomingForm({ maxFileSize: _VAULT_MAX, multiples: false, uploadDir: _VAULT_DIR, keepExtensions: false });
        form.parse(req, (err, fields, files) => {
            if (err) return res.status(400).json({ ok: false, error: err.message || 'upload failed' });
            const f = (n) => Array.isArray(fields[n]) ? fields[n][0] : fields[n];
            const type = String(f('type') || 'note');
            if (!f('encKey') || !f('metaIv') || !f('metaCt')) return res.status(400).json({ ok: false, error: 'missing encrypted metadata' });
            let filePath = null, fileIv = null, size = 0;
            const up = files && (Array.isArray(files.file) ? files.file[0] : files.file);
            if (type === 'file') {
                if (!up || !up.filepath) return res.status(400).json({ ok: false, error: 'file blob required for type=file' });
                if (!f('fileIv')) { try { fs.unlinkSync(up.filepath); } catch (_) { /* */ } return res.status(400).json({ ok: false, error: 'fileIv required' }); }
                const stored = `${Date.now()}_${Math.floor(parseInt(req.user.id, 10))}.enc`;
                const dest = require('path').join(_VAULT_DIR, stored);
                fs.renameSync(up.filepath, dest);
                filePath = dest; fileIv = String(f('fileIv')); size = up.size || 0;
            } else if (up && up.filepath) { try { fs.unlinkSync(up.filepath); } catch (_) { /* */ } }
            const id = db.insertVaultItem(req.user.id, {
                category: f('category') || 'Other', type,
                encKey: f('encKey'), metaIv: f('metaIv'), metaCt: f('metaCt'),
                fileIv, filePath, size, addedBy: 'operator',
            });
            return res.json({ ok: true, id: Number(id) });
        });
    } catch (e) { return res.status(500).json({ ok: false, error: 'add failed' }); }
});

// GET /api/admin/vault/items/:id/file — stream the encrypted file blob (client decrypts).
router.get('/vault/items/:id/file', _requireAuth, _requireAdmin, (req, res) => {
    const id = _vaultId(req.params.id); if (id === null) return res.status(400).end();
    const it = require('../services/database').getVaultItem(id, req.user.id);
    const fs = require('fs');
    if (!it || it.type !== 'file' || !it.file_path || !fs.existsSync(it.file_path)) return res.status(404).end();
    res.setHeader('Content-Type', 'application/octet-stream');
    return fs.createReadStream(it.file_path).pipe(res);
});

// DELETE /api/admin/vault/items/:id — operator removes (UI confirms). Drops the blob too.
router.delete('/vault/items/:id', _requireAuth, _requireAdmin, (req, res) => {
    const id = _vaultId(req.params.id); if (id === null) return res.status(400).json({ ok: false, error: 'bad id' });
    const db = require('../services/database');
    const it = db.getVaultItem(id, req.user.id);
    if (!it) return res.status(404).json({ ok: false, error: 'not found' });
    if (it.file_path) { try { require('fs').unlinkSync(it.file_path); } catch (_) { /* */ } }
    db.deleteVaultItem(id, req.user.id);
    return res.json({ ok: true });
});

module.exports = router;
