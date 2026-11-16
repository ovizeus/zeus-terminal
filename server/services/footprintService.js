'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// ICHNOS — serviciul de footprint
// ═══════════════════════════════════════════════════════════════════════════
// De ce Bybit: pe acest VPS fluxul WS de tranzactii al Binance futures e MUT (0
// mesaje in 20 s, vezi tradeFeed.js), iar REST-ul Binance costa greutate de API
// pe un sistem cu istoric de banuri. Bybit trimite deja, gratuit si in timp real,
// FIECARE tranzactie pe BTC/ETH/SOL/BNB (bybitFeed.js, `publicTrade`).
// ⚠️ Preturile Bybit difera de Binance cu cativa dolari; footprint-ul e corect in
// sine (volumul pe niveluri), dar desenat pe un chart Binance poate fi decalat cu
// un nivel. Clientul scrie sursa.
//
// Bybit nu da istoric de tranzactii: footprint-ul se strange de la pornire.
// Minutele inchise se salveaza in `footprint_1m` (48h), deci o repornire pierde
// doar minutele cat serverul a fost oprit.

const logger = require('./logger');
const F = require('./footprintCore');

const KEEP_MS = 48 * 3600 * 1000;
const PERSIST_MS = 30000;
const PRUNE_MS = 3600 * 1000;
const HOLDER = 'ichnos:footprint';

const _store = new Map();          // symbol -> Map(minuteMs -> candela vie)
const _saved = new Map();          // symbol -> Set(minuteMs) deja scrise
let _timers = [], _started = false, _startedAt = 0, _trades = 0;

function _db() { return require('./database').db; }

function _onTrade(t) {
    if (F.addTrade(_store, t)) _trades++;
}

function _load() {
    const since = Date.now() - KEEP_MS;
    const rows = _db().prepare('SELECT symbol, t, data FROM footprint_1m WHERE t >= ? ORDER BY t').all(since);
    for (const r of rows) {
        let d; try { d = JSON.parse(r.data); } catch (_) { continue; }
        let bySym = _store.get(r.symbol);
        if (!bySym) { bySym = new Map(); _store.set(r.symbol, bySym); }
        const lv = new Map();
        for (const [p, bid, ask] of d.lv || []) lv.set(p, [bid, ask]);
        bySym.set(r.t, { t: r.t, o: d.o, h: d.h, l: d.l, c: d.c, firstTs: r.t, lastTs: r.t + 59999, lv });
        if (!_saved.has(r.symbol)) _saved.set(r.symbol, new Set());
        _saved.get(r.symbol).add(r.t);
    }
    return rows.length;
}

/** Scrie minutele INCHISE inca nescrise. Un singur INSERT intr-o tranzactie. */
function persist(now = Date.now()) {
    const cur = Math.floor(now / F.MIN_MS) * F.MIN_MS;
    const ins = _db().prepare('INSERT OR REPLACE INTO footprint_1m (symbol, t, data) VALUES (?, ?, ?)');
    let n = 0;
    const tx = _db().transaction(() => {
        for (const [sym, bySym] of _store) {
            let saved = _saved.get(sym);
            if (!saved) { saved = new Set(); _saved.set(sym, saved); }
            for (const [t, c] of bySym) {
                if (t >= cur || saved.has(t)) continue;
                const s = F.serialize1m(c);
                ins.run(sym, t, JSON.stringify({ o: s.o, h: s.h, l: s.l, c: s.c, lv: s.lv }));
                saved.add(t); n++;
            }
        }
    });
    tx();
    return n;
}

/** Retentie: memorie si baza, peste 48h. DELETE lotizat (better-sqlite3 e sincron). */
function prune(now = Date.now()) {
    const cut = now - KEEP_MS;
    for (const [sym, bySym] of _store) {
        for (const t of [...bySym.keys()]) if (t < cut) { bySym.delete(t); const s = _saved.get(sym); if (s) s.delete(t); }
    }
    const del = _db().prepare('DELETE FROM footprint_1m WHERE rowid IN (SELECT rowid FROM footprint_1m WHERE t < ? LIMIT 2000)');
    let total = 0, r;
    do { r = del.run(cut); total += r.changes; } while (r.changes === 2000 && total < 200000);
    return total;
}

/** Footprint-ul pe interval: ultimele `limit` candele (crescator), cu nivelurile unite. */
function get(symbol, tf, limit = 150) {
    const sym = String(symbol || '').toUpperCase();
    const bySym = _store.get(sym);
    const tfMin = F.TF_MIN[tf];
    if (!F.BASE_BIN[sym] || !tfMin) return { ok: false, error: 'unsupported', symbol: sym, tf, supported: Object.keys(F.BASE_BIN), tfs: Object.keys(F.TF_MIN) };
    const lim = Math.max(1, Math.min(500, Number(limit) || 150));
    const from = Date.now() - lim * tfMin * F.MIN_MS - tfMin * F.MIN_MS;
    const ones = [];
    if (bySym) for (const [t, c] of bySym) if (t >= from) ones.push(F.serialize1m(c));
    const m = F.mergeTf(ones, sym, tf);
    return { ok: true, symbol: sym, tf, bin: m.bin, unit: 'usd', source: 'bybit', since: _startedAt, candles: m.candles.slice(-lim) };
}

function start() {
    if (_started) return;
    _started = true;
    _startedAt = Date.now();
    try { const n = _load(); logger.info('ICHNOS', `footprint: ${n} minute incarcate din baza`); } catch (e) { logger.warn('ICHNOS', 'load failed: ' + e.message); }
    try { require('./bybitFeed').on('trade', _onTrade); } catch (e) { logger.warn('ICHNOS', 'bybit trade hook failed: ' + e.message); }
    // Tine fluxul Bybit pornit si cand niciun cont nu tranzactioneaza pe Bybit.
    try { require('./feedManager').activateForUser(HOLDER, 'bybit'); } catch (e) { logger.warn('ICHNOS', 'feed hold failed: ' + e.message); }
    const t1 = setInterval(() => { try { persist(); } catch (e) { logger.warn('ICHNOS', 'persist: ' + e.message); } }, PERSIST_MS);
    const t2 = setInterval(() => { try { prune(); } catch (e) { logger.warn('ICHNOS', 'prune: ' + e.message); } }, PRUNE_MS);
    for (const t of [t1, t2]) { if (t.unref) t.unref(); _timers.push(t); }
}

function stop() {
    for (const t of _timers) clearInterval(t);
    _timers = []; _started = false;
}

function health() {
    const per = {};
    for (const [s, m] of _store) per[s] = m.size;
    return { started: _started, since: _startedAt, trades: _trades, minutes: per };
}

function _resetForTest() { _store.clear(); _saved.clear(); _trades = 0 }

module.exports = { start, stop, get, persist, prune, health, _store, _onTrade, _resetForTest, KEEP_MS };
