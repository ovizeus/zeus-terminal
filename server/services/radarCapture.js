'use strict';
// [2026-11-20] RADARUL PE SERVER — inregistrarea (vezi radarAxes.js pentru axe).
//
// Ce face, o data pe secunda:
//   1. calculeaza cele 12 axe pentru monedele radarului TUTUROR utilizatorilor
//      (+ monedele cerute de aplicatii pentru afisaj) si le tine 5 minute (inel);
//   2. citeste pozitiile deschise ale tuturor (serverAT.getAllOpenLite, DOAR CITIRE);
//      o intrare noua pe o moneda a radarului utilizatorului porneste o INREGISTRARE:
//      30 s dinainte (din inel) + cate un cadru pe secunda cat tine tranzactia;
//   3. la iesire inchide inregistrarea si o scrie in `brain_captures` (comprimata).
// Inregistrarile deschise se salveaza la fiecare minut: un restart nu le pierde, iar
// la pornire se reiau din baza.
//
// ⚠️ Monedele care nu sunt in serverState (pornit din SD_SYMBOLS) NU se adauga acolo:
// creierul de tranzactionare isi ia lista din serverState, deci ar incepe sa
// TRANZACTIONEZE moneda. Pentru ele radarul isi tine propriile lumanari, din
// evenimentele marketFeed, cu abonare pe cheia `radar|<uid>` (maturatorul de
// abonari orfane sare cheile care nu au 3 parti).
//
// Doar afisaj si jurnal. Nimic de aici nu e citit de decizie sau de executie.

const zlib = require('zlib');
const logger = require('./logger');
const RA = require('./radarAxes');

const TICK_MS = 1000;
const RING_S = 300;                 // 5 min de axe pe moneda
const PRE_S = 30;                   // cadre dinaintea intrarii
const FLUSH_MS = 60_000;            // salvarea inregistrarilor deschise
const MAX_FRAMES = 3600;            // dupa rarire (o tranzactie lunga)
const KEEP_EDGE = 900;              // cadre pastrate intregi la inceput si la sfarsit
const MAX_SYMBOLS = 24;
const DEMAND_TTL_MS = 60_000;       // o moneda ceruta de o aplicatie ramane calculata 1 min
// [2026-11-20] 3.000, nu 300: cu 300, fiecare inchidere stergea la loc tranzactiile refacute din
// ultimele 30 de zile (contul 1 are 857 pe monedele radarului). ~9 KB / inregistrare.
const KEEP_PER_USER = 3000;         // inregistrari pastrate pe utilizator
const DEFAULT_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const SYM_RE = /^[A-Z0-9]{2,20}USDT$/;
// Portile radarului (ordinea din aplicatie): RISK SPREAD COOL NEWS SESS NOOPP REGIME.
// Serverul nu are SPREAD, NEWS si NO-OPPOSITE → necunoscute (ca in aplicatie la SPREAD).
const GATES_UNKNOWN = [1, 3, 5];
const GATE_OF_REASON = {
    max_pos: 0, drawdown: 0, drawdown_lockout: 0,
    cooldown: 2, close_cooldown: 2,
    hour_filter: 4, session_block: 4, session: 4,
    no_st: 6, adx_low: 6,
};

const _ring = new Map();            // sym -> [{t, rt, b, r, rg, sc}]
const _deltaHist = new Map();       // sym -> [delta5m] (pentru z)
const _prefs = new Map();           // uid -> [coins pe colturi, '' = colt gol]
const _caps = new Map();            // `${uid}:${seq}` -> capture
const _ignored = new Set();         // pozitii vazute, dar nu pe radar
const _demand = new Map();          // sym -> ultima cerere de afisaj
const _extra = new Map();           // sym -> {bars, price, fr, oi, oiPrev, rsi, ind}
const _radarRefs = new Map();       // uid -> Set(sym) abonate de radar
const _decCache = new Map();        // `${uid}:${sym}` -> {at, val}
const _thrCache = new Map();        // uid -> {at, thr, profile}
const _oi = new Map();              // sym -> {oi, oiPrev, at} (serverState nu reimprospateaza OI)
const OI_EVERY_MS = 60_000;
let _timer = null, _flushAt = 0, _subsAt = 0, _logAt = 0, _started = false;
let _stats = { ticks: 0, captures: 0, closed: 0, errors: 0, lastErr: null, tickMsMax: 0, tickMsSum: 0 };

const _db = () => require('./database').db;
const _st = () => require('./serverState');

// ── preferinte ────────────────────────────────────────────────────
function normalizeCoins(x) {
    if (!Array.isArray(x)) return null;
    const out = [];
    for (const s of x) {
        if (out.length >= 3) break;
        const v = String(s || '').toUpperCase().trim();
        out.push(SYM_RE.test(v) && !out.includes(v) ? v : '');
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.some(Boolean) ? out : null;
}
function coinsFor(uid) { return _prefs.get(Number(uid)) || DEFAULT_COINS; }
function getCoins(uid) { const c = _prefs.get(Number(uid)); return c ? c.slice() : null; }
function setCoins(uid, coins) {
    const c = normalizeCoins(coins);
    if (!c) return null;
    _prefs.set(Number(uid), c);
    try {
        _db().prepare('INSERT INTO brain_radar_prefs (user_id, coins, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET coins = excluded.coins, updated_at = excluded.updated_at')
            .run(Number(uid), JSON.stringify(c), Date.now());
    } catch (e) { _stats.lastErr = 'prefs: ' + e.message; }
    _subsAt = 0;                                       // reabonare la urmatorul pas
    return c.slice();
}
function _loadPrefs() {
    try {
        for (const r of _db().prepare('SELECT user_id, coins FROM brain_radar_prefs').all()) {
            let c = null; try { c = normalizeCoins(JSON.parse(r.coins)); } catch (_) { c = null; }
            if (c) _prefs.set(Number(r.user_id), c);
        }
    } catch (e) { _stats.lastErr = 'loadPrefs: ' + e.message; }
}

// ── surse pentru monedele din afara serverState ───────────────────
function _bootSymbols() { try { return new Set(_st().getConfiguredSymbols()); } catch (_) { return new Set(); } }
function _extraState(sym) {
    let x = _extra.get(sym);
    if (!x) { x = { bars: [], price: 0, priceTs: 0, fr: null, oi: null, oiPrev: null, rsi: null, ind: {}, at: 0, book: null, ls: null, polledAt: 0, polling: false }; _extra.set(sym, x); }
    return x;
}
/**
 * [2026-11-20] Cartea (IMBALANCE) si raportul long/short (SENTIMENT) pentru monedele din
 * afara serverState: serverLiquidity si serverSentiment le aduc doar pentru SD_SYMBOLS.
 * La 30 s, prin poarta Binance (gard de ban + limitator): carte 50 niveluri (greutate 2) +
 * L/S global (greutate 1). Doar pentru monedele de pe radarul cuiva.
 */
const EXTRA_POLL_MS = 30_000;
function _pollExtra(sym, now) {
    const x = _extra.get(sym);
    if (!x || x.polling || now - x.polledAt < EXTRA_POLL_MS) return;
    x.polling = true; x.polledAt = now;
    let gw; try { gw = require('./binanceGateway'); } catch (_) { gw = null; }
    if (!gw || typeof gw.fetch !== 'function') { x.polling = false; return; }
    const get = (url, w, src) => Promise.resolve().then(() => gw.fetch(url, { __weight: w, __src: src, signal: AbortSignal.timeout(8000) }))
        .then((r) => (r && r.ok ? r.json() : null)).catch(() => null);
    const q = encodeURIComponent(sym);
    Promise.all([
        get('https://fapi.binance.com/fapi/v1/depth?symbol=' + q + '&limit=50', 2, 'radar:depth'),
        get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=' + q + '&period=5m&limit=1', 1, 'radar:ls'),
    ]).then(([d, ls]) => {
        if (d && Array.isArray(d.bids) && Array.isArray(d.asks)) {
            const m = (rows) => rows.map(([p, qty]) => ({ price: parseFloat(p), qty: parseFloat(qty) })).filter((r) => r.price > 0 && r.qty > 0);
            x.book = { bids: m(d.bids), asks: m(d.asks), ts: Date.now() };
        }
        const r = Array.isArray(ls) && ls.length ? Number(ls[ls.length - 1].longShortRatio) : NaN;
        if (Number.isFinite(r) && r > 0) x.ls = r;
    }).finally(() => { x.polling = false; });
}
function _onKline(d) {
    if (!d || !_extra.has(d.symbol) || d.timeframe !== '5m') return;
    const x = _extra.get(d.symbol);
    if (d.initial && Array.isArray(d.bars)) x.bars = d.bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    else if (d.bar) {
        const b = d.bar, last = x.bars[x.bars.length - 1];
        const row = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
        if (last && last.time === b.time) x.bars[x.bars.length - 1] = row; else { x.bars.push(row); if (x.bars.length > 500) x.bars.splice(0, x.bars.length - 500); }
        if (b.close > 0) { x.price = b.close; x.priceTs = Date.now(); }
    }
}
function _onPrice(d) { const x = d && _extra.get(d.symbol); if (x && d.price > 0) { x.price = d.price; x.priceTs = Date.now(); } }
function _onFunding(d) { const x = d && _extra.get(d.symbol); if (x) x.fr = d.rate; }
function _onOi(d) { const x = d && _extra.get(d.symbol); if (x) { x.oiPrev = x.oi; x.oi = d.value; } }
/** serverState-ul in miniatura pentru o moneda din afara listei de pornire. */
function _extraDeps(sym) {
    const x = _extra.get(sym);
    if (x && Date.now() - x.at > 15_000 && x.bars.length >= 30) {
        try {
            const T = require('../shared/teacher/teacherIndicators');
            x.ind = T.teacherComputeIndicators(x.bars) || {};
            const rsi = T.teacherCalcRSI(x.bars.map((b) => b.close));
            x.rsi = rsi && rsi.length ? rsi[rsi.length - 1] : null;
        } catch (_) { /* indicatori lipsa → axele lor raman null */ }
        x.at = Date.now();
    }
    return {
        getSnapshotForSymbol: () => (x && x.price > 0 ? { symbol: sym, price: x.price, priceTs: x.priceTs, rsi: { '5m': x.rsi }, adx: x.ind.adx,
            atr: x.ind.atr, fr: x.fr, oi: x.oi, oiPrev: x.oiPrev, indicators: x.ind } : null),
        getBarsForSymbol: () => (x ? x.bars : []),
    };
}
function _reconcileSubs() {
    let mf; try { mf = require('./marketFeed'); } catch (_) { return; }
    const boot = _bootSymbols();
    const want = new Map();
    for (const [uid, coins] of _prefs) for (const c of coins) if (c && !boot.has(c)) {
        if (!want.has(uid)) want.set(uid, new Set()); want.get(uid).add(c);
    }
    for (const [uid, had] of _radarRefs) {
        const w = want.get(uid) || new Set();
        if ([...had].some((s) => !w.has(s))) { try { mf.releaseRef('radar|' + uid); } catch (_) {} _radarRefs.set(uid, new Set()); }
    }
    for (const [uid, syms] of want) {
        const had = _radarRefs.get(uid) || new Set();
        for (const s of syms) {
            if (had.has(s)) continue;
            _extraState(s);
            had.add(s);
            mf.subscribeForRef(s, 'radar|' + uid, ['5m']).catch((e) => { _stats.lastErr = 'sub ' + s + ': ' + e.message; });
        }
        _radarRefs.set(uid, had);
    }
}

// ── axe pe moneda ─────────────────────────────────────────────────
function _symbolsToCompute(now) {
    const set = new Set(DEFAULT_COINS);
    for (const coins of _prefs.values()) for (const c of coins) if (c) set.add(c);
    for (const c of _caps.values()) set.add(c.symbol);
    for (const [s, t] of _demand) { if (now - t <= DEMAND_TTL_MS) set.add(s); else _demand.delete(s); }
    return [...set].slice(0, MAX_SYMBOLS);
}
function _zOf(sym, d) {
    const h = _deltaHist.get(sym) || [];
    if (h.length < 20 || !Number.isFinite(d)) return null;
    const m = h.reduce((a, b) => a + b, 0) / h.length;
    const sd = Math.sqrt(h.reduce((a, b) => a + (b - m) * (b - m), 0) / h.length);
    return sd > 0 ? (d - m) / sd : null;
}
function _computeOne(sym, now) {
    const boot = _bootSymbols();
    let flow = null; try { flow = require('./serverOrderflow').getFlow(sym); } catch (_) {}
    const d5 = flow && Number.isFinite(flow.delta5m) ? flow.delta5m : NaN;
    _refreshOi(sym, now);
    const o = _oi.get(sym);
    const deps = { deltaZ: _zOf(sym, d5), oi: o ? o.oi : null, oiPrev: o ? o.oiPrev : null };
    if (!boot.has(sym)) {
        _pollExtra(sym, now);
        const x = _extra.get(sym);
        let L = null; try { L = require('./serverLiquidity'); } catch (_) { L = null; }
        Object.assign(deps, {
            serverState: _extraDeps(sym),
            sentiment: { getSentiment: () => (x && x.ls ? { ls: x.ls } : null) },
            // pivotii din lumanarile proprii (getLiquidity) + cartea adusa aici
            liquidity: { getLiquidity: (s, b, p) => (L ? L.getLiquidity(s, b, p) : null), getOrderBook: () => (x && x.book && Date.now() - x.book.ts < 120_000 ? x.book : null) },
        });
    }
    const ax = RA.computeAxes(sym, deps);
    if (!ax) return null;
    let sc = null;
    try {
        const st = deps.serverState || _st();
        const snap = st.getSnapshotForSymbol(sym);
        sc = snap ? require('./serverBrain')._calcConfluence(snap, snap.indicators || {}).score : null;
    } catch (_) { sc = null; }
    const fr = { t: now, rt: ax.rt, b: ax.bull, r: ax.bear, rg: ax.regime, sc };
    let ring = _ring.get(sym); if (!ring) { ring = []; _ring.set(sym, ring); }
    ring.push(fr); if (ring.length > RING_S) ring.splice(0, ring.length - RING_S);
    if (Number.isFinite(d5) && (!_deltaHist.has(sym) || now % 10_000 < TICK_MS)) {
        const h = _deltaHist.get(sym) || []; h.push(d5); if (h.length > 180) h.shift(); _deltaHist.set(sym, h);
    }
    return fr;
}
/**
 * [2026-11-20] OI proaspat pentru axa OI. serverState citeste OI o singura data, la abonare,
 * deci oiPrev ramane gol pentru totdeauna (bug VECHI, raportat operatorului: atinge si votul
 * OI din confluenta creierului — NU se repara aici, ar schimba tranzactiile). Radarul citeste
 * la minut prin marketFeed.fetchOpenInterest, care ia intai din cache-ul scannerului (fara
 * cerere spre Binance cand moneda e in top 300) si tine propria pereche oi / oiPrev.
 */
function _refreshOi(sym, now) {
    const cur = _oi.get(sym) || { oi: null, oiPrev: null, at: 0, busy: false };
    if (cur.busy || now - cur.at < OI_EVERY_MS) return;
    cur.busy = true; cur.at = now; _oi.set(sym, cur);
    let mf; try { mf = require('./marketFeed'); } catch (_) { mf = null; }
    if (!mf || typeof mf.fetchOpenInterest !== 'function') { cur.busy = false; return; }
    Promise.resolve().then(() => mf.fetchOpenInterest(sym)).then((v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) { if (cur.oi != null && n !== cur.oi) cur.oiPrev = cur.oi; else if (cur.oi == null) cur.oiPrev = null; cur.oi = n; }
    }).catch(() => {}).finally(() => { cur.busy = false; });
}
function latest(sym) { const r = _ring.get(String(sym || '').toUpperCase()); return r && r.length ? r[r.length - 1] : null; }
/** Afisaj: aplicatia cere axele de acum pentru monedele ei. */
function liveFor(symbols, now = Date.now()) {
    const out = {};
    for (const raw of symbols || []) {
        const s = String(raw || '').toUpperCase();
        if (!SYM_RE.test(s)) continue;
        _demand.set(s, now);
        const f = latest(s);
        out[s] = f && now - f.t < 10_000 ? { t: f.t, rt: f.rt, bull: f.b, bear: f.r, regime: f.rg, score: f.sc } : null;
    }
    return out;
}

// ── datele utilizatorului: incredere, prag, porti, profil ─────────
function _thrFor(uid, now) {
    const c = _thrCache.get(uid);
    if (c && now - c.at < 60_000) return c;
    let thr = null, settings = null;
    try { const stc = require('./serverBrain').getSTC(uid); thr = Number(stc.confMin) > 0 ? Number(stc.confMin) : null; } catch (_) {}
    // Profilul (fast/swing/def) e al aplicatiei, salvat in user_settings: brain.<demo|live>.profile.
    try { const r = _db().prepare('SELECT data FROM user_settings WHERE user_id = ?').get(uid); settings = r ? JSON.parse(r.data) : null; } catch (_) { settings = null; }
    const v = { at: now, thr, settings };
    _thrCache.set(uid, v);
    return v;
}
function _decisionFor(uid, sym, now) {
    const k = uid + ':' + sym, c = _decCache.get(k);
    if (c && now - c.at < 15_000) return c.val;
    let val = null;
    try {
        const r = _db().prepare('SELECT ts, data FROM brain_decisions WHERE user_id = ? AND symbol = ? AND ts > ? ORDER BY ts DESC LIMIT 1').get(uid, sym, now - 180_000);
        if (r) { const d = JSON.parse(r.data); val = { reasons: Array.isArray(d.gateReasons) ? d.gateReasons : [], regime: d.regime || null }; }
    } catch (_) { val = null; }
    _decCache.set(k, { at: now, val });
    return val;
}
function profileOf(settings, env) {
    if (!settings || typeof settings !== 'object') return null;
    const mode = env === 'DEMO' ? 'demo' : 'live';
    const p = (settings.brain && settings.brain[mode] && settings.brain[mode].profile) || settings.profile;
    return typeof p === 'string' && p ? p : null;
}
function gatesFrom(reasons) {
    if (!Array.isArray(reasons)) return { failing: [], unknown: [0, 1, 2, 3, 4, 5, 6] };
    const f = new Set();
    for (const r of reasons) {
        const key = String(r || '').split(':')[0];
        if (GATE_OF_REASON[key] != null) f.add(GATE_OF_REASON[key]);
    }
    return { failing: [...f].sort(), unknown: GATES_UNKNOWN.slice() };
}

// ── inregistrarile ────────────────────────────────────────────────
function _userFrame(base, uid, sym, now, pos) {
    const dec = _decisionFor(uid, sym, now);
    const g = dec ? gatesFrom(dec.reasons) : { failing: [], unknown: [0, 1, 2, 3, 4, 5, 6] };
    const f = { t: base.t, rt: base.rt, b: base.b, r: base.r, rg: base.rg, c: base.sc, h: _thrFor(uid, now).thr, f: g.failing, u: g.unknown };
    if (pos) {
        const px = latest(sym) ? _priceOf(sym) : 0;
        const dir = pos.side === 'SHORT' ? -1 : 1, entry = +pos.price, lev = +pos.lev || 1;
        if (px > 0 && entry > 0) {
            const pct = ((px - entry) / entry) * dir * lev * 100;
            f.p = { pct: Math.round(pct * 100) / 100, prog: progressOf(pos.side, entry, px, +pos.sl, +pos.tp), noTp: !(+pos.tp > 0) };
        }
    }
    return f;
}
function _priceOf(sym) {
    try {
        if (_bootSymbols().has(sym)) { const s = _st().getSnapshotForSymbol(sym); return s && s.price > 0 ? s.price : 0; }
        const x = _extra.get(sym); return x && x.price > 0 ? x.price : 0;
    } catch (_) { return 0; }
}
/** Drumul SL ↔ TP, −1..+1 (ca brainDerived.progressOf). Fara SL → null. */
function progressOf(side, entry, mark, sl, tp) {
    if (!(entry > 0) || !(mark > 0) || !(sl > 0)) return null;
    const risk = Math.abs(entry - sl); if (!(risk > 0)) return null;
    const dir = side === 'SHORT' ? -1 : 1;
    const target = tp > 0 ? tp : entry + dir * 2 * risk;
    const reward = Math.abs(target - entry), move = (mark - entry) * dir;
    const p = move >= 0 ? (reward > 0 ? move / reward : 0) : -(-move) / risk;
    return Math.round(Math.max(-1, Math.min(1, p)) * 1000) / 1000;
}
function _envOf(pos) { return pos.env ? String(pos.env).toUpperCase() : pos.mode === 'live' ? 'TESTNET' : 'DEMO'; }
/**
 * Lentilele TIMEFRAME si SLOW din aplicatie (brainDerived.emaStep): EMA pe cadre cu α dat
 * la 60 fps. Pe secunda, 60 de pasi de α = un singur pas de 1 − (1 − α)^60 — deci serverul,
 * cu un cadru pe secunda, ajunge la aceleasi valori ca telefonul.
 */
function lensesOf(frames) {
    const step = (prev, next, a60) => next.map((x, i) => {
        if (x == null || !Number.isFinite(x)) return null;
        const p = prev ? prev[i] : null, a = 1 - Math.pow(1 - a60, 60);
        return p == null ? x : p + (x - p) * a;
    });
    let tf = null, sl = null;
    for (const f of frames || []) { tf = step(tf, f.rt, 0.025); sl = step(sl, tf, 0.007); }
    return { tf, sl };
}
/**
 * Starea de dinainte de intrare, cu regulile din brainDerived.Derived.build (fara pozitie):
 * HESITANT (conf ≥ prag − 8 si o poarta pica) · NERVOUS (lentilele se contrazic > 0,18)
 * · ALERT (conf ≥ prag − 10) · altfel CALM. ML nu exista inca → CONFUSED nu apare.
 */
function preMoodOf(rt, sl, conf, thr, failing) {
    let s = 0, k = 0;
    for (let i = 0; i < (rt || []).length; i++) {
        const a = rt[i], b = sl ? sl[i] : null;
        if (a == null || b == null) continue; s += Math.abs(a - b); k++;
    }
    const div = k ? s / k : 0;
    if (conf != null && thr != null && conf >= thr - 8 && (failing || []).length > 0) return 'HESITANT';
    if (div > 0.18) return 'NERVOUS';
    if (conf != null && thr != null && conf >= thr - 10) return 'ALERT';
    return 'CALM';
}
/** Forma de la intrare: lipsurile devin 0,1 (podeaua desenata), ca entryShapeOf din aplicatie. */
function entryShapeOf(rt) { return (rt || []).map((x) => (x == null || !Number.isFinite(x) ? 0.1 : Math.round(Math.max(0, Math.min(1, x)) * 1000) / 1000)); }

function _startCapture(pos, now) {
    const uid = Number(pos.userId), sym = String(pos.symbol).toUpperCase();
    const ring = _ring.get(sym) || [];
    const late = now - Number(pos.ts || now) > 90_000;      // pornita cand serverul nu era (restart)
    const pre = late ? [] : ring.filter((f) => f.t >= Number(pos.ts || now) - PRE_S * 1000 && f.t <= Number(pos.ts || now) + 2000);
    // Pornita tarziu (restart): forma de ACUM nu e forma de la intrare → fara forma, doar replay.
    const at = late ? null : (pre.length ? pre[pre.length - 1] : ring[ring.length - 1] || null);
    const frames = pre.map((b) => _userFrame(b, uid, sym, now, null));
    const thr = _thrFor(uid, now);
    const dec = _decisionFor(uid, sym, now);
    const g = dec ? gatesFrom(dec.reasons) : { failing: [], unknown: [0, 1, 2, 3, 4, 5, 6] };
    const upTo = at ? ring.filter((f) => f.t <= at.t) : [];
    const lens = lensesOf(upTo);
    const entry = {
        pre: at ? preMoodOf(at.rt, lens.sl, at.sc, thr.thr, g.failing) : null,
        v: 1, seq: pos.seq, symbol: sym, side: pos.side, env: _envOf(pos), entryTs: Number(pos.ts) || now,
        entryPrice: +pos.price || null, sl: +pos.sl || null, tp: +pos.tp || null, size: +pos.size || null, lev: +pos.lev || null,
        entryShape: at ? entryShapeOf(at.rt) : null, rt: at ? at.rt : null,
        conf: at ? at.sc : null, thr: thr.thr, profile: profileOf(thr.settings, _envOf(pos)), regime: dec && dec.regime ? dec.regime : null,
        radarRegime: at ? at.rg : null, bull: at ? at.b : null, bear: at ? at.r : null,
        gatesFailing: g.failing, gatesUnknown: g.unknown,
        radarCoins: coinsFor(uid).filter(Boolean), late, preFrames: frames.length, source: 'server',
    };
    const cap = { uid, seq: pos.seq, symbol: sym, pos, entry, frames, lastFlush: 0 };
    _caps.set(uid + ':' + pos.seq, cap);
    _stats.captures++;
    _persist(cap, 'open');
    return cap;
}
function thinFrames(frames) {
    if (frames.length <= MAX_FRAMES) return frames;
    const head = frames.slice(0, KEEP_EDGE), tail = frames.slice(-KEEP_EDGE);
    const mid = frames.slice(KEEP_EDGE, frames.length - KEEP_EDGE);
    const room = MAX_FRAMES - 2 * KEEP_EDGE;
    const step = mid.length / room;
    const out = [];
    for (let i = 0; i < room; i++) out.push(mid[Math.floor(i * step)]);
    return head.concat(out, tail);
}
function _persist(cap, status, exitTs) {
    try {
        const frames = thinFrames(cap.frames);
        const blob = zlib.deflateSync(Buffer.from(JSON.stringify(frames)));
        _db().prepare(`INSERT INTO brain_captures (user_id, seq, symbol, env, side, entry_ts, exit_ts, status, entry, frames, n_frames, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, seq) DO UPDATE SET exit_ts = excluded.exit_ts, status = excluded.status, entry = excluded.entry,
                frames = excluded.frames, n_frames = excluded.n_frames, updated_at = excluded.updated_at`)
            .run(cap.uid, cap.seq, cap.symbol, cap.entry.env, cap.entry.side, cap.entry.entryTs, exitTs || null, status,
                JSON.stringify(cap.entry), blob, frames.length, Date.now());
        cap.lastFlush = Date.now();
    } catch (e) { _stats.errors++; _stats.lastErr = 'persist: ' + e.message; }
}
function _finish(cap, now) {
    _persist(cap, 'closed', now);
    _caps.delete(cap.uid + ':' + cap.seq);
    _stats.closed++;
    try {
        _db().prepare(`DELETE FROM brain_captures WHERE user_id = ? AND status = 'closed' AND seq NOT IN
            (SELECT seq FROM brain_captures WHERE user_id = ? ORDER BY entry_ts DESC LIMIT ?)`).run(cap.uid, cap.uid, KEEP_PER_USER);
    } catch (_) { /* curatenia nu opreste nimic */ }
}
/** La pornire: inregistrarile ramase deschise se reiau daca pozitia inca exista. */
function _resume(openKeys) {
    try {
        for (const r of _db().prepare("SELECT user_id, seq, entry, frames FROM brain_captures WHERE status = 'open'").all()) {
            const k = r.user_id + ':' + r.seq;
            if (!openKeys.has(k)) {
                // pozitia s-a inchis cat serverul era oprit: inchidem si noi inregistrarea
                _db().prepare("UPDATE brain_captures SET status = 'closed', exit_ts = COALESCE(exit_ts, ?), updated_at = ? WHERE user_id = ? AND seq = ?")
                    .run(Date.now(), Date.now(), r.user_id, r.seq);
                continue;
            }
            let entry = null, frames = [];
            try { entry = JSON.parse(r.entry); } catch (_) { continue; }
            try { frames = r.frames ? JSON.parse(zlib.inflateSync(r.frames).toString()) : []; } catch (_) { frames = []; }
            _caps.set(k, { uid: r.user_id, seq: r.seq, symbol: entry.symbol, pos: null, entry, frames, lastFlush: Date.now() });
        }
    } catch (e) { _stats.lastErr = 'resume: ' + e.message; }
}

function _tick() {
    const t0 = Date.now();
    try { _tickInner(t0); } finally {
        const ms = Date.now() - t0;
        _stats.tickMsSum += ms; if (ms > _stats.tickMsMax) _stats.tickMsMax = ms;
    }
}
function _tickInner(now) {
    _stats.ticks++;
    if (now - _subsAt > 30_000) { _subsAt = now; try { _reconcileSubs(); } catch (e) { _stats.lastErr = 'subs: ' + e.message; } }
    const bases = new Map();
    for (const s of _symbolsToCompute(now)) {
        try { const f = _computeOne(s, now); if (f) bases.set(s, f); } catch (e) { _stats.errors++; _stats.lastErr = 'axes ' + s + ': ' + e.message; }
    }
    let open = [];
    try { open = require('./serverAT').getAllOpenLite(); } catch (_) { open = []; }
    const keys = new Set();
    for (const p of open) {
        if (!p || p.seq == null || !p.symbol) continue;
        const k = p.userId + ':' + p.seq; keys.add(k);
        let cap = _caps.get(k);
        if (!cap) {
            if (_ignored.has(k)) continue;
            const sym = String(p.symbol).toUpperCase();
            if (!coinsFor(p.userId).includes(sym)) { _ignored.add(k); continue; }
            if (!bases.has(sym)) {
                // moneda tocmai intrata pe radar: incepe sa fie calculata de la pasul urmator
                _demand.set(sym, now); continue;
            }
            cap = _startCapture(p, now);
        }
        cap.pos = p;
        const b = bases.get(cap.symbol);
        if (b && (!cap.frames.length || cap.frames[cap.frames.length - 1].t < b.t)) cap.frames.push(_userFrame(b, cap.uid, cap.symbol, now, p));
        if (now - cap.lastFlush > FLUSH_MS) _persist(cap, 'open');
    }
    for (const cap of [..._caps.values()]) if (!keys.has(cap.uid + ':' + cap.seq)) _finish(cap, now);
    for (const k of _ignored) if (!keys.has(k)) _ignored.delete(k);
    if (now - _logAt > 600_000) {
        _logAt = now;
        const miss = [];
        for (const [s, f] of bases) { const n = f.rt.map((v, i) => (v == null ? RA.AXIS_KEYS[i] : null)).filter(Boolean); if (n.length) miss.push(s + ':' + n.join('/')); }
        const avg = _stats.ticks ? Math.round((_stats.tickMsSum / _stats.ticks) * 10) / 10 : 0;
        logger.info('RADAR', `tick avg ${avg}ms max ${_stats.tickMsMax}ms · symbols=${bases.size} open=${_caps.size} captures=${_stats.captures} closed=${_stats.closed} errors=${_stats.errors}` + (miss.length ? ` missing ${miss.join(' ')}` : ' all axes present') + (_stats.lastErr ? ` lastErr=${_stats.lastErr}` : ''));
    }
}

function start() {
    if (_started) return;
    _started = true;
    _loadPrefs();
    try {
        const mf = require('./marketFeed');
        mf.on('kline', _onKline); mf.on('price', _onPrice); mf.on('fundingRate', _onFunding); mf.on('openInterest', _onOi);
    } catch (_) { /* fara flux: monedele din afara raman fara axe */ }
    let open = [];
    try { open = require('./serverAT').getAllOpenLite(); } catch (_) { open = []; }
    _resume(new Set(open.map((p) => p.userId + ':' + p.seq)));
    _timer = setInterval(() => { try { _tick(); } catch (e) { _stats.errors++; _stats.lastErr = 'tick: ' + e.message; } }, TICK_MS);
    if (_timer.unref) _timer.unref();
    logger.info('RADAR', `server radar started — prefs for ${_prefs.size} users, ${_caps.size} open captures resumed`);
}
function stop() {
    if (_timer) clearInterval(_timer);
    _timer = null; _started = false;
    for (const cap of _caps.values()) _persist(cap, 'open');
}

// ── citire pentru rute ────────────────────────────────────────────
function listCaptures(uid, limit = 300) {
    const rows = _db().prepare('SELECT seq, symbol, env, side, entry_ts, exit_ts, status, entry, n_frames FROM brain_captures WHERE user_id = ? ORDER BY entry_ts DESC LIMIT ?')
        .all(Number(uid), Math.max(1, Math.min(1500, Number(limit) || 300)));
    return rows.map((r) => {
        let e = null; try { e = JSON.parse(r.entry); } catch (_) { e = null; }
        // o inregistrare deschisa in memorie are mai multe cadre decat ultima salvare
        const live = _caps.get(Number(uid) + ':' + r.seq);
        return { seq: r.seq, symbol: r.symbol, env: r.env, side: r.side, entryTs: r.entry_ts, exitTs: r.exit_ts, status: r.status,
            nFrames: live ? live.frames.length : r.n_frames, entry: e };
    });
}
function getFrames(uid, seq) {
    const live = _caps.get(Number(uid) + ':' + Number(seq));
    if (live) return { entry: live.entry, frames: thinFrames(live.frames), status: 'open' };
    const r = _db().prepare('SELECT entry, frames, status FROM brain_captures WHERE user_id = ? AND seq = ?').get(Number(uid), Number(seq));
    if (!r) return null;
    let entry = null, frames = [];
    try { entry = JSON.parse(r.entry); } catch (_) {}
    try { frames = r.frames ? JSON.parse(zlib.inflateSync(r.frames).toString()) : []; } catch (_) { frames = []; }
    return { entry, frames, status: r.status };
}
function health() {
    return { started: _started, symbols: [..._ring.keys()], open: _caps.size, prefsUsers: _prefs.size, ..._stats };
}

module.exports = {
    start, stop, liveFor, latest, getCoins, setCoins, coinsFor, listCaptures, getFrames, health,
    // pure, pentru teste
    normalizeCoins, gatesFrom, profileOf, thinFrames, progressOf, entryShapeOf, lensesOf, preMoodOf, DEFAULT_COINS,
    _tickForTest: _tick, _resetForTest: () => { _ring.clear(); _caps.clear(); _ignored.clear(); _prefs.clear(); _demand.clear(); _decCache.clear(); _thrCache.clear(); },
};
