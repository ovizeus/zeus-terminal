// [2026-11-21] Share pentru cardul din jurnalul creierului (cerut de operator: „unde dau share…
// WhatsApp, Telegram, Facebook, Discord, X, more").
// Pe web o imagine nu se poate trimite direct in WhatsApp / Telegram / X printr-un link; se trimite
// un LINK. Deci: aplicatia urca imaginea cardului (POST /api/brain/share, autentificat), serverul o
// pastreaza si da un link public /s/<id> — o pagina cu og:image, ca WhatsApp, Telegram, Facebook,
// X si Discord sa arate IMAGINEA in conversatie. „More" din aplicatie trimite fisierul insusi.
// Siguranta: PNG / JPEG / WebP verificate dupa primii octeti, max 700 KB, 30 / ora / cont,
// id aleator de 12 caractere, fisierele mai vechi de 30 de zile se sterg.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Router } = require('express');

const DIR = path.join(__dirname, '..', '..', 'data', 'shares');
// sub limita globala express.json (1 MB, cu base64 cu tot): aplicatia trimite WebP comprimat
const MAX_BYTES = 700 * 1024;
const PER_HOUR = 30;
const KEEP_MS = 30 * 864e5;
const ID_RE = /^[A-Za-z0-9_-]{12}$/;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

const _rate = new Map();   // uid -> [ts]

function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch (_) { /* exista */ } }

/** Tipul real dupa primii octeti (nu dupa ce declara clientul). PURA. */
function sniff(buf) {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    return null;
}

function allow(uid, now = Date.now()) {
    const arr = (_rate.get(uid) || []).filter((t) => now - t < 3600_000);
    if (arr.length >= PER_HOUR) { _rate.set(uid, arr); return false; }
    arr.push(now); _rate.set(uid, arr);
    return true;
}

function cleanup(now = Date.now()) {
    let n = 0;
    try {
        for (const f of fs.readdirSync(DIR)) {
            const p = path.join(DIR, f);
            try { if (now - fs.statSync(p).mtimeMs > KEEP_MS) { fs.unlinkSync(p); n++; } } catch (_) { /* */ }
        }
    } catch (_) { /* fara dosar */ }
    return n;
}

function findFile(id) {
    if (!ID_RE.test(id)) return null;
    for (const ext of Object.keys(TYPES)) {
        const p = path.join(DIR, id + '.' + ext);
        if (fs.existsSync(p)) return { p, ext };
    }
    return null;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function originOf(req) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'zeus-terminal.com').split(',')[0].trim();
    return (proto === 'http' || proto === 'https' ? proto : 'https') + '://' + host.replace(/[^A-Za-z0-9.:-]/g, '');
}

// ── public: pagina si imaginea (inainte de autentificare) ──
const publicRouter = Router();
publicRouter.get('/s/:file', (req, res) => {
    const m = String(req.params.file).match(/^([A-Za-z0-9_-]{12})(?:\.(png|jpg|webp))?$/);
    if (!m) return res.status(404).send('Not found');
    const f = findFile(m[1]);
    if (!f) return res.status(404).send('Not found');
    if (m[2]) {                                                   // imaginea
        res.setHeader('Content-Type', TYPES[f.ext]);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.sendFile(f.p);
    }
    const img = originOf(req) + '/s/' + m[1] + '.' + f.ext, page = originOf(req) + '/s/' + m[1];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zeus Terminal — trade card</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="Zeus Terminal">
<meta property="og:title" content="Zeus Terminal — trade card"><meta property="og:description" content="AI trading analytics · brain at entry, result and mood">
<meta property="og:url" content="${esc(page)}"><meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="720"><meta property="og:image:height" content="900">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(img)}">
</head><body style="margin:0;background:#040913;color:#9fb3c8;font-family:monospace;display:flex;flex-direction:column;align-items:center;gap:14px;padding:16px">
<img src="/s/${esc(m[1])}.${esc(f.ext)}" alt="Zeus Terminal trade card" style="width:100%;max-width:520px;border-radius:12px">
<a href="/" style="color:#c08bff">zeus-terminal.com</a></body></html>`);
});

// ── autentificat: urcarea ──
const apiRouter = Router();
apiRouter.post('/', (req, res) => {
    const uid = req.user && req.user.id;
    if (uid == null) return res.status(401).json({ ok: false, error: 'auth' });
    const data = String((req.body && req.body.image) || '');
    const m = data.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ ok: false, error: 'bad_image' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > MAX_BYTES) return res.status(413).json({ ok: false, error: 'too_large' });
    const ext = sniff(buf);
    if (!ext) return res.status(400).json({ ok: false, error: 'bad_image' });
    if (!allow(uid)) return res.status(429).json({ ok: false, error: 'rate_limited' });
    ensureDir();
    const id = crypto.randomBytes(9).toString('base64url');
    try { fs.writeFileSync(path.join(DIR, id + '.' + ext), buf, { mode: 0o644 }); }
    catch (e) { return res.status(500).json({ ok: false, error: 'store_failed' }); }
    res.json({ ok: true, id, url: originOf(req) + '/s/' + id, image: originOf(req) + '/s/' + id + '.' + ext });
});

function startCleanup() {
    ensureDir(); cleanup();
    const t = setInterval(() => cleanup(), 24 * 3600_000);
    if (t.unref) t.unref();
}

module.exports = { publicRouter, apiRouter, startCleanup, sniff, allow, cleanup, findFile, _dir: DIR };
