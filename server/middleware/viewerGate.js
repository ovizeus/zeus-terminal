'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// POARTA PENTRU CONTURILE 'viewer' — interzis daca nu e pe lista
// ═══════════════════════════════════════════════════════════════════════════
// [BETA-GATE 2026-11-13] Un viewer poate chema DOAR rutele de mai jos. Orice
// alta ruta de sub /api e refuzata cu 403 `beta_locked`.
//
// ⚠️ Lista e EXACTA (metoda + cale), nu pe prefix. Cu un prefix („tot ce e sub
// /api/market"), o ruta noua adaugata acolo ar deveni vizibila viewerilor fara
// ca cineva sa hotarasca asta. Un test numara rutele serverului si pica daca
// multimea celor permise se schimba fara sa fie schimbata si aici.
//
// Blocarea din aplicatie (lacatele) e doar politete. Asta e poarta.

const accessLevel = require('../services/accessLevel');

// `:x` = un singur segment de cale.
const VIEWER_ALLOW = [
    // ── chart si date de piata ──
    'GET /api/market/klines', 'GET /api/market/ticker24hr', 'GET /api/market/topLongShort',
    'GET /api/market/spot/klines', 'GET /api/market/funding', 'GET /api/market/oi',
    'GET /api/market/top', 'GET /api/market/symbol/:symbol', 'GET /api/market/ticker',
    'GET /api/market/markprice', 'GET /api/market/ticker/all', 'GET /api/market/depth',
    'GET /api/market/sentiment', 'GET /api/market/time',
    'GET /api/sd/symbols', 'GET /api/fng',
    // ── lichidari: harta, heatmap, live, predict, book ──
    'GET /api/market/liq-panel', 'GET /api/market/liq-map', 'GET /api/market/liq-predict',
    'GET /api/market/bookmap', 'GET /api/liq/recent',
    // ── indicatori pe chart ──
    'POST /api/indicators/active', 'GET /api/indicators/usage',
    'GET /api/byoi/config', 'GET /api/byoi/indicators',
    // ── contul lui: profil, setari de afisare, suport ──
    'GET /api/profile', 'POST /api/profile',
    'GET /api/sync/state', 'POST /api/sync/state',
    'GET /api/sync/user-context', 'POST /api/sync/user-context',
    'GET /api/user/settings', 'POST /api/user/settings',
    'POST /api/support/send', 'GET /api/support/thread', 'GET /api/support/unread',
    'GET /api/referral',
    // ── aplicatia insasi ──
    'GET /api/version', 'POST /api/app/version', 'POST /api/client-error', 'GET /api/ws/health',
];

// Ce functie i se spune utilizatorului ca e inchisa. Primul prefix potrivit.
const FEATURES = [
    ['/api/at/', 'autotrade'], ['/api/panic', 'autotrade'], ['/api/tc/', 'autotrade'],
    ['/api/order/', 'trading'], ['/api/positions', 'trading'], ['/api/balance', 'trading'],
    ['/api/openOrders', 'trading'], ['/api/leverage', 'trading'], ['/api/manual/', 'trading'],
    ['/api/addon', 'trading'], ['/api/risk/', 'trading'], ['/api/exchange', 'trading'],
    ['/api/config', 'trading'], ['/api/srv-pos', 'trading'],
    ['/api/ares/', 'ares'], ['/api/user/ares', 'ares'],
    ['/api/dsl/', 'dsl'], ['/api/dsldrive', 'dsl'],
    ['/api/brain/', 'brain'],
    ['/api/omega', 'omega'], ['/api/ring5', 'omega'],
    ['/api/journal', 'journal'], ['/api/performance', 'journal'], ['/api/session-review', 'journal'],
    ['/api/compare', 'journal'], ['/api/missed-trades', 'journal'], ['/api/regime-history', 'journal'],
    ['/api/exposure', 'journal'], ['/api/dashboard', 'journal'], ['/api/audit', 'journal'],
    ['/api/user/telegram', 'alerts'],
    ['/api/leaderboard', 'leaderboard'], ['/api/profile/', 'leaderboard'],
    ['/api/byoi', 'byoi'],
];

const MESSAGE = 'Zeus Terminal is in beta. This feature opens at public launch — for now it is available to the Zeus team only.';

function _compile(entry) {
    const sp = entry.indexOf(' ');
    const method = entry.slice(0, sp);
    const segs = entry.slice(sp + 1).split('/').filter(Boolean);
    return { method, segs };
}
const _ALLOW = VIEWER_ALLOW.map(_compile);

function _clean(path) {
    let p = String(path || '').split('?')[0];
    if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
    return p;
}

function featureOf(path) {
    const p = _clean(path);
    for (const [prefix, name] of FEATURES) {
        if (p === prefix || p === prefix.replace(/\/$/, '') || p.startsWith(prefix)) return name;
    }
    return 'beta';
}

/** Functie pura: are voie un viewer la (metoda, cale)? */
function classify(method, path) {
    const m = String(method || '').toUpperCase();
    const p = _clean(path);
    if (!p.startsWith('/api/')) return { gated: false, allowed: true, feature: null };
    // `..`, `//` sau segmente codate nu au ce cauta intr-o cale de API cinstita.
    if (p.includes('..') || p.includes('//') || p.includes('%')) return { gated: true, allowed: false, feature: featureOf(p) };
    const segs = p.split('/').filter(Boolean);
    // HEAD se poarta ca GET.
    const mm = m === 'HEAD' ? 'GET' : m;
    for (const a of _ALLOW) {
        if (a.method !== mm || a.segs.length !== segs.length) continue;
        let ok = true;
        for (let i = 0; i < segs.length; i++) {
            if (a.segs[i].startsWith(':')) { if (!segs[i]) { ok = false; break; } continue; }
            if (a.segs[i] !== segs[i]) { ok = false; break; }
        }
        if (ok) return { gated: true, allowed: true, feature: null };
    }
    return { gated: true, allowed: false, feature: featureOf(p) };
}

function createViewerGate(opts) {
    const levelOf = (opts && opts.levelOf) || accessLevel.levelOf;
    return function viewerGate(req, res, next) {
        // Fara utilizator = ruta publica sau deja refuzata de sessionAuth.
        if (!req.user || !req.user.id) return next();
        // Calea COMPLETA: intr-un router montat `req.path` e relativa.
        const full = (req.baseUrl || '') + (req.path || '');
        const c = classify(req.method, full);
        if (!c.gated) return next();
        let level;
        try { level = levelOf(req.user.id); } catch (_) { level = 'viewer'; }
        // Nivelul merge mai departe, pentru rutele care raspund diferit.
        req.accessLevel = level;
        if (level === 'full' || c.allowed) return next();
        return res.status(403).json({ error: 'beta_locked', feature: c.feature, message: MESSAGE });
    };
}

module.exports = { createViewerGate, classify, featureOf, VIEWER_ALLOW, FEATURES, MESSAGE };
