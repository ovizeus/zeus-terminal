// server/services/notifyEvents.js
// [2026-11-22] Evenimente IMPORTANTE pentru telefon, alese de fiecare cont din Alerts:
//   price   — miscari mari de pret (±PRICE_MOVE_PCT intr-o ora, pe monedele serverului)
//   atEntry — autotrade a intrat pe o pozitie
//   atExit  — autotrade a iesit (cu P&L)
//   safety  — kill switch, pozitie fara stop loss, inchidere de urgenta esuata
//   support — raspunsuri de la suport (+ la admin: mesaje si conturi de aprobat) — in notifyDevices
//
// „Sa nu fie abundente": evenimentele de ACELASI fel, ale aceluiasi cont, din acelasi sfert de ora
// se ADUNA intr-o singura notificare („Auto-trade: 3 entries"), iar o miscare de pret se anunta
// cel mult o data la PRICE_COOLDOWN_MS pe moneda. Se pastreaza doar pentru conturile care au un
// telefon inregistrat (altfel nu are cine sa le citeasca). Retentie 24 h.
'use strict';

const _db = () => require('./database').db;

const KINDS = ['support', 'price', 'atEntry', 'atExit', 'safety'];
const DEFAULT_PREFS = Object.freeze({ support: true, price: true, atEntry: true, atExit: true, safety: true });
const BUCKET_MS = 15 * 60_000;
const SHOW_FOR_MS = 60 * 60_000;      // un eveniment ramane pe telefon cel mult o ora
const RETAIN_MS = 24 * 3600_000;
const MAX_LINES = 4;
const PRICE_MOVE_PCT = 3;
const PRICE_WINDOW_MS = 60 * 60_000;
const PRICE_COOLDOWN_MS = 3 * 3600_000;

const TITLES = {
    atEntry: (n) => n > 1 ? `Auto-trade: ${n} entries` : 'Auto-trade entry',
    atExit: (n) => n > 1 ? `Auto-trade: ${n} exits` : 'Auto-trade exit',
    safety: (n) => n > 1 ? `Safety: ${n} alerts` : 'Safety alert',
    price: (n) => n > 1 ? `Big price moves (${n})` : 'Big price move',
};

// ── alegerile contului ─────────────────────────────────────────────────────
function getPrefs(userId) {
    try {
        const r = _db().prepare('SELECT prefs FROM notify_prefs WHERE user_id = ?').get(Number(userId));
        const p = r ? JSON.parse(r.prefs) : {};
        const out = {};
        for (const k of KINDS) out[k] = typeof p[k] === 'boolean' ? p[k] : DEFAULT_PREFS[k];
        return out;
    } catch (_) { return { ...DEFAULT_PREFS }; }
}

function setPrefs(userId, patch, now = Date.now()) {
    const cur = getPrefs(userId);
    for (const k of KINDS) if (patch && typeof patch[k] === 'boolean') cur[k] = patch[k];
    _db().prepare(`INSERT INTO notify_prefs (user_id, prefs, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`)
        .run(Number(userId), JSON.stringify(cur), now);
    return cur;
}

// ── cine are telefon (cache 60 s) ──────────────────────────────────────────
let _devCache = { at: 0, set: new Set() };
function hasDevice(userId, now = Date.now()) {
    if (now - _devCache.at > 60_000) {
        try {
            _devCache = { at: now, set: new Set(_db().prepare('SELECT DISTINCT user_id FROM notify_devices WHERE revoked = 0').all().map((r) => r.user_id)) };
        } catch (_) { _devCache = { at: now, set: new Set() }; }
    }
    return _devCache.set.has(Number(userId));
}

// ── scriere ───────────────────────────────────────────────────────────────
let _lastPrune = 0;
/** Adauga o linie la evenimentul de acest fel din sfertul de ora curent (sau il creeaza). */
function push(userId, kind, line, now = Date.now()) {
    if (!KINDS.includes(kind) || kind === 'support') return false;
    if (userId != null && !hasDevice(userId, now)) return false;
    try {
        const db = _db();
        const uid = userId == null ? null : Number(userId);
        const bucket = String(Math.floor(now / BUCKET_MS));
        const cur = db.prepare('SELECT id, body, n FROM notify_events WHERE coalesce(user_id, 0) = coalesce(?, 0) AND kind = ? AND bucket = ?').get(uid, kind, bucket);
        const clean = String(line || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (cur) {
            const n = cur.n + 1;
            const lines = [clean, ...cur.body.split('\n').filter((l) => !/^\+\d+ more$/.test(l))].slice(0, MAX_LINES);
            if (n > MAX_LINES) lines.push(`+${n - MAX_LINES} more`);
            db.prepare('UPDATE notify_events SET body = ?, n = ?, title = ?, updated_at = ? WHERE id = ?')
                .run(lines.join('\n'), n, TITLES[kind](n), now, cur.id);
        } else {
            db.prepare('INSERT INTO notify_events (user_id, kind, bucket, title, body, n, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
                .run(uid, kind, bucket, TITLES[kind](1), clean, now, now);
        }
        if (now - _lastPrune > 3600_000) {
            _lastPrune = now;
            db.prepare('DELETE FROM notify_events WHERE created_at < ?').run(now - RETAIN_MS);
        }
        return true;
    } catch (_) { return false; }
}

// ── citire pentru telefon ──────────────────────────────────────────────────
/** Evenimentele din ultima ora pe care contul le-a lasat pornite. */
function forUser(userId, prefs, now = Date.now()) {
    const p = prefs || getPrefs(userId);
    const kinds = KINDS.filter((k) => k !== 'support' && p[k]);
    if (!kinds.length) return [];
    const rows = _db().prepare(`SELECT id, kind, title, body, n FROM notify_events
        WHERE (user_id = ? OR user_id IS NULL) AND updated_at > ? AND kind IN (${kinds.map(() => '?').join(',')})
        ORDER BY updated_at DESC LIMIT 8`).all(Number(userId), now - SHOW_FOR_MS, ...kinds);
    // id cu `n`: cand se aduna o linie noua, telefonul o vede ca pe o notificare noua (cea veche ramane).
    return rows.map((r) => ({ id: `ev:${r.id}:${r.n}`, kind: r.kind, title: r.title, body: r.body }));
}

// ── miscari mari de pret ───────────────────────────────────────────────────
const _px = new Map();        // symbol → [{t, p}] cate un esantion pe minut
const _lastMove = new Map();  // symbol → ts ultimei miscari anuntate
function _fmt(p) { return p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : p.toFixed(4); }

/** Chemat la fiecare pret; esantioneaza o data pe minut si anunta ±PRICE_MOVE_PCT intr-o ora. */
function onPrice(symbol, price, now = Date.now()) {
    if (!(price > 0) || !symbol) return null;
    const arr = _px.get(symbol) || [];
    if (!arr.length || now - arr[arr.length - 1].t >= 60_000) {
        arr.push({ t: now, p: price });
        while (arr.length && now - arr[0].t > PRICE_WINDOW_MS + 120_000) arr.shift();
        _px.set(symbol, arr);
    } else return null;
    const base = arr.find((x) => now - x.t <= PRICE_WINDOW_MS && now - x.t >= PRICE_WINDOW_MS - 5 * 60_000);
    if (!base) return null;
    const pct = (price - base.p) / base.p * 100;
    if (Math.abs(pct) < PRICE_MOVE_PCT) return null;
    if (now - (_lastMove.get(symbol) || 0) < PRICE_COOLDOWN_MS) return null;
    _lastMove.set(symbol, now);
    const coin = String(symbol).replace(/USDT$/i, '');
    const line = `${coin} ${pct > 0 ? '▲ +' : '▼ '}${pct.toFixed(1)}% in 1h — now $${_fmt(price)}`;
    push(null, 'price', line, now);
    return line;
}

function _resetForTest() { _px.clear(); _lastMove.clear(); _devCache = { at: 0, set: new Set() }; _lastPrune = 0; }

module.exports = { KINDS, DEFAULT_PREFS, PRICE_MOVE_PCT, getPrefs, setPrefs, hasDevice, push, forUser, onPrice, _resetForTest };
