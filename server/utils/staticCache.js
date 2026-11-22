'use strict';
// [2026-11-22] „Ies din aplicatie si cand intru iar nu se incarca ~10 s."
// Toate fisierele .js/.css plecau cu `no-cache, no-store`, iar service worker-ul le cerea
// intai din retea: la FIECARE intrare telefonul descarca din nou ~2,7 MB de JS + CSS.
// Pachetele Vite din /app/assets/ au in nume un cod din CONTINUT (index-BcSSfbih.js):
// alt continut = alt nume, deci pot fi tinute in cache un an fara risc. index.html ramane
// mereu proaspat, asa ca o versiune noua ajunge imediat (cere numele noi).
const HASHED_ASSET_RE = /[\\/]app[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/;

function cacheControlFor(filePath) {
    const p = String(filePath || '');
    if (HASHED_ASSET_RE.test(p)) return 'public, max-age=31536000, immutable';
    if (p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.html')) return 'no-cache, no-store, must-revalidate';
    return null;
}

module.exports = { cacheControlFor, HASHED_ASSET_RE };
