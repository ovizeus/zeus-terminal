'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// NIVELUL DE ACCES AL UNUI CONT — 'viewer' sau 'full'
// ═══════════════════════════════════════════════════════════════════════════
// [BETA-GATE 2026-11-13] Pana la lansare, conturile noi vad doar chartul,
// datele de piata si lichidarile. Tot ce inseamna ACTIVITATE (autotrade,
// manual, ARES, DSL, brain) si OMEGA ramane pentru conturile ridicate de admin.
//
// Reguli, in ordinea in care conteaza:
//   1. Adminul e mereu 'full'.
//   2. Un cont e 'full' DOAR daca are scris exact 'full' in `users.access_level`.
//      Orice altceva — lipsa, NULL, o valoare necunoscuta, cont inexistent,
//      eroare la citire — e 'viewer'. Poarta cade INCHISA.
//   3. `VIEWER_GATE_ENABLED=false` in mediu stinge poarta: toti sunt 'full',
//      ca inainte de 13 nov. E maneta de urgenta, nu un mod de lucru.
//
// Raspunsul e tinut cateva secunde in memorie: `levelOf` e chemat la fiecare
// cerere si in bucla brain-ului, iar o citire din baza la fiecare apel ar fi
// risipa. Schimbarea facuta de admin goleste intrarea pe loc (`invalidate`).

const TTL_MS = 10_000;
const _cache = new Map();   // userId -> { level, at }

function gateEnabled() {
    return String(process.env.VIEWER_GATE_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

/** Nivelul dintr-un rand `users`. Functie pura. */
function levelOfUser(u) {
    if (!u || typeof u !== 'object') return 'viewer';
    if (u.role === 'admin') return 'full';
    return u.access_level === 'full' ? 'full' : 'viewer';
}

function _lookup(userId) {
    try {
        const db = require('./database');
        return levelOfUser(db.findUserById(userId));
    } catch (_) {
        return 'viewer';   // nu stim cine e → nu primeste nimic in plus
    }
}

function levelOf(userId, now) {
    if (!gateEnabled()) return 'full';
    const id = Number(userId);
    if (!Number.isFinite(id) || id <= 0) return 'viewer';
    const t = Number.isFinite(now) ? now : Date.now();
    const hit = _cache.get(id);
    if (hit && t - hit.at < TTL_MS) return hit.level;
    const level = _lookup(id);
    _cache.set(id, { level, at: t });
    return level;
}

function isViewer(userId, now) { return levelOf(userId, now) !== 'full'; }

function invalidate(userId) {
    if (userId === undefined || userId === null) _cache.clear();
    else _cache.delete(Number(userId));
}

module.exports = { levelOfUser, levelOf, isViewer, invalidate, gateEnabled, TTL_MS };
