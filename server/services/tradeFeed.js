'use strict';
// ══════════════════════════════════════════════════════════════════
// BULELE — tranzacţiile executate care călăresc harta de lichiditate
// ══════════════════════════════════════════════════════════════════
//
// [BOOKMAP-BULE 2026-10-30] Operatorul, cu două capturi din Bookmap: „vreau şi
// eu indicatorul ăla cu date reale… exact aşa, cu bule, culori, tot, lichidări,
// nu sări nimic". Culorile le-a lăsat pe ale noastre.
//
// ⚠️ ACEEAŞI PIAŢĂ CA HARTA, şi nu e o preferinţă: harta de lichiditate se
// desenează din carnetul Binance futures. Dacă bulele ar veni de pe Bybit sau
// OKX, ele ar cădea la alte preţuri şi alte volume în aceeaşi secundă — adică
// ar arăta convingător şi ar fi aliniate greşit. Cel mai urât fel de eroare.
//
// ⚠️ PE ACEST VPS fluxul WS de tranzacţii al Binance futures e MUT: măsurat,
// 0 mesaje în 20 s, în timp ce Bybit dădea 161 şi OKX 284 pe aceeaşi maşină.
// E aceeaşi reţea care lasă să treacă `depth20@100ms` şi taie tot restul.
//
// REST-ul însă MERGE, şi e destul: 1000 de tranzacţii acoperă 25,1 secunde, deci
// o cerere la ~20 s nu pierde nimic — cu condiţia să se lege pe `fromId`.

const logger = require('./logger');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const BASE = 'https://fapi.binance.com';
const LIMIT = 1000;
const POLL_MS = 18000;            // sub cele 25,1 s măsurate, cu margine
const POLL_MS_IDLE = 120000;      // nimeni nu se uită: doar cât să nu moară firul
const DEMAND_TTL_MS = 30000;
const WEIGHT_SLOW_AT = 1700;
const POLL_MS_SLOW = 60000;
const RING_MS = 20 * 60000;
const RING_MAX = 4000;            // plafon dur: o rafală nu are voie să umple RAM

const _ring = new Map();          // symbol -> [trade]
const _lastId = new Map();        // symbol -> ultimul id adus
let _timer = null, _stopped = true, _lastDemand = null;
let _usedWeight = 0, _ok = 0, _fail = 0, _got = 0;

/** Un rând brut de la Binance → forma noastră. NULL dacă nu e de încredere. */
function normalizeTrade(r) {
    if (!r || typeof r !== 'object') return null;
    const price = parseFloat(r.p);
    const qty = parseFloat(r.q);
    const ts = Number(r.T);
    const id = Number(r.a);
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(qty) || qty <= 0) return null;
    if (!Number.isFinite(ts) || ts <= 0) return null;
    // ⚠️ `m` e „buyer is maker". Deci m=true înseamnă că CUMPĂRĂTORUL stătea în
    // carte şi agresorul a VÂNDUT. Capcana clasică a API-ului: inversat, toate
    // bulele ies colorate pe dos şi harta minte despre cine a lovit.
    return {
        id: Number.isFinite(id) ? id : 0,
        price, qty, ts,
        usd: price * qty,
        sell: r.m === true,
    };
}

function normalizeTrades(rows) {
    const out = [];
    if (!Array.isArray(rows)) return out;
    for (const r of rows) {
        const t = normalizeTrade(r);
        if (t) out.push(t);
    }
    return out;
}

function lastId(list) {
    if (!Array.isArray(list) || !list.length) return null;
    let m = null;
    for (const t of list) {
        const id = Number(t && t.id);
        if (Number.isFinite(id) && (m === null || id > m)) m = id;
    }
    return m;
}

/**
 * Următoarea cerere porneşte DUPĂ ultimul id — de la el ar dubla o bulă.
 *
 * ⚠️ `Number(null)` e `0`, iar `Number.isFinite(0)` e `true`. Cu verificarea
 * naivă, „n-am niciun id încă" (null) devenea „porneşte de la 1" — adică prima
 * cerere ar fi adus tranzacţii din zorii pieţei în loc de cele recente.
 * A treia oară când capcana asta mă prinde în aceeaşi zi; de asta e scrisă aici.
 */
function nextFromId(id) {
    if (id === null || id === undefined || id === '') return null;
    const n = Number(id);
    return Number.isFinite(n) ? n + 1 : null;
}

/**
 * Adaugă în inel, taie dublurile şi mărgineşte în TIMP şi în NUMĂR.
 * Plafonul de număr nu e paranoia: o rafală de piaţă produce mii de tranzacţii
 * pe secundă, iar fereastra de timp singură n-ar opri-o.
 */
function pushTrades(ring, list, maxN, windowMs) {
    if (!Array.isArray(ring) || !Array.isArray(list) || !list.length) return ring;
    const seen = new Set(ring.map((t) => t.id));
    for (const t of list) {
        if (t.id && seen.has(t.id)) continue;
        seen.add(t.id);
        ring.push(t);
    }
    ring.sort((a, b) => a.ts - b.ts);
    const win = Number(windowMs);
    if (Number.isFinite(win) && win > 0 && ring.length) {
        const cutoff = ring[ring.length - 1].ts - win;
        while (ring.length && ring[0].ts < cutoff) ring.shift();
    }
    const cap = Number(maxN);
    if (Number.isFinite(cap) && cap > 0) {
        while (ring.length > cap) ring.shift();
    }
    return ring;
}

async function _fetchSince(symbol) {
    const from = nextFromId(_lastId.get(symbol));
    const q = from === null
        ? `symbol=${encodeURIComponent(symbol)}&limit=${LIMIT}`
        : `symbol=${encodeURIComponent(symbol)}&fromId=${from}&limit=${LIMIT}`;
    try {
        const res = await require('./binanceGateway').fetch(`${BASE}/fapi/v1/aggTrades?${q}`, {
            signal: AbortSignal.timeout(9000), __src: 'bookmap:trades', __weight: 20,
        });
        if (!res || !res.ok) { _fail++; return null; }
        try {
            const w = Number(res.headers && res.headers.get && res.headers.get('x-mbx-used-weight-1m'));
            if (Number.isFinite(w) && w > 0) _usedWeight = w;
        } catch (_) {}
        const rows = await res.json();
        _ok++;
        return normalizeTrades(rows);
    } catch (_) { _fail++; return null; }
}

function _intervalFor(now, lastDemand, usedWeight) {
    if (Number(usedWeight) >= WEIGHT_SLOW_AT) return POLL_MS_SLOW;
    const d = Number(lastDemand);
    if (!Number.isFinite(d) || now - d > DEMAND_TTL_MS) return POLL_MS_IDLE;
    return POLL_MS;
}

function noteDemand(now) {
    const t = Number(now);
    _lastDemand = Number.isFinite(t) ? t : Date.now();
}

async function _tick() {
    for (const sym of SYMBOLS) {
        const list = await _fetchSince(sym);
        if (!list || !list.length) continue;
        _got += list.length;
        let ring = _ring.get(sym);
        if (!ring) { ring = []; _ring.set(sym, ring); }
        pushTrades(ring, list, RING_MAX, RING_MS);
        const id = lastId(list);
        if (id !== null) _lastId.set(sym, id);
    }
    if (!_stopped) {
        _timer = setTimeout(() => { _tick().catch(() => {}); },
            _intervalFor(Date.now(), _lastDemand, _usedWeight));
        if (_timer.unref) _timer.unref();
    }
}

function trades(symbol) { return (_ring.get(String(symbol || '').toUpperCase()) || []).slice(); }

function health() {
    const per = {};
    for (const s of SYMBOLS) per[s] = (_ring.get(s) || []).length;
    return {
        running: !_stopped, usedWeight1m: _usedWeight || null,
        ok: _ok, fail: _fail, trades: _got,
        intervalMs: _intervalFor(Date.now(), _lastDemand, _usedWeight),
        watchedRecently: !!(_lastDemand && Date.now() - _lastDemand <= DEMAND_TTL_MS),
        symbols: per,
    };
}

function start() {
    if (!_stopped) return;
    _stopped = false;
    const t0 = setTimeout(() => { _tick().catch(() => {}); }, 6000);
    if (t0.unref) t0.unref();
    logger.info('BOOKMAP', `trades started — ${SYMBOLS.join(', ')}, ${LIMIT}/req`);
}

function stop() {
    _stopped = true;
    _lastDemand = null;
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _ring.clear(); _lastId.clear();
}

module.exports = {
    start, stop, trades, noteDemand, health,
    normalizeTrade, normalizeTrades, lastId, nextFromId, pushTrades, _intervalFor,
    SYMBOLS, LIMIT, POLL_MS, POLL_MS_IDLE, POLL_MS_SLOW, RING_MS, RING_MAX, DEMAND_TTL_MS,
};
