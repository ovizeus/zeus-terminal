'use strict';
// [2026-11-16] NEREUS — banda LATA (±2.5K pe BTC), cerut de operator:
// „book sa arate mai multa distanta… vreo 2,5k sus cu 2,5 jos… tot date reale…
// fa o combinatie din ele sa dea totalul".
//
// ⚠️ MASURAT INAINTE DE COD (BTC la 64.900): cat de departe ajunge cartea reala
//   Binance REST limit=1000 ........ ±250 $   (harta de pana acum)
//   Bybit linear 500 ................ ±100 $
//   OKX books-full sz=5000 .......... ±860 $  (BTC-USDT-SWAP, marime in CONTRACTE)
//   Gate futures interval=50 ........ ±2.475 $ (singura care ajunge la ±2.5K)
// ⇒ TOTALUL se face pe trepte de pret (50 $ la BTC): fiecare bursa isi pune
//   ordinele in treapta lor. DAR o bursa contribuie doar pana unde ajunge cartea
//   ei, deci dincolo de ±250 $ Binance lipseste si harta ar parea „mai subtire"
//   doar din cauza asta. Nu se ascunde: fiecare cadru poarta `coverage` (unde se
//   termina fiecare bursa) si panoul o DESENEAZA. O harta care tace despre asta
//   ar minti exact cum a mintit gatul din b332.
//
// Marimea: OKX si Gate dau CONTRACTE. Multiplicatorul (ctVal / quanto_multiplier)
// se citeste de la bursa; NECUNOSCUT ⇒ bursa se SARE (lectia OKX din b386), nu se
// ghiceste cu 1.
//
// Ritm: porneste abia la PRIMA cerere a benzii late (nimic din boot). Rapid 5 s
// cat timp cineva se uita, apoi 60 s, ca prima redeschidere sa aiba istoric.

const feed = require('./bookFeed');

const CFG = {
    BTCUSDT: { okx: 'BTC-USDT-SWAP', gate: 'BTC_USDT', gateInterval: '50', step: 50, half: 2500 },
    ETHUSDT: { okx: 'ETH-USDT-SWAP', gate: 'ETH_USDT', gateInterval: '1', step: 1, half: 50 },
};
const FAST_MS = 5000, IDLE_MS = 60000, DEMAND_TTL_MS = 30000;
const RING_MS = 12 * 60000, RING_MAX = 400;
const BINANCE_FRESH_MS = 40000;   // cadrul Binance trebuie sa fie de acum, nu de acum 5 minute
const META_TTL_MS = 6 * 3600 * 1000;

const _ring = new Map();          // symbol -> [frame]
const _meta = { okx: new Map(), gate: new Map(), at: 0 };
let _timer = null, _running = false, _lastDemand = 0;
let _stats = { ok: 0, fail: 0, lastErr: null };

async function _json(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { 'User-Agent': 'zeus-terminal' } });
    if (!r.ok) throw new Error('http_' + r.status);
    return r.json();
}

async function _loadMeta(now) {
    if (now - _meta.at < META_TTL_MS && _meta.okx.size && _meta.gate.size) return;
    for (const c of Object.values(CFG)) {
        try {
            const j = await _json('https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=' + c.okx);
            const v = Number(j && j.data && j.data[0] && j.data[0].ctVal);
            if (v > 0) _meta.okx.set(c.okx, v);
        } catch (_) { /* fara ctVal: OKX se sare pana la urmatoarea incercare */ }
        try {
            const j = await _json('https://api.gateio.ws/api/v4/futures/usdt/contracts/' + c.gate);
            const v = Number(j && j.quanto_multiplier);
            if (v > 0) _meta.gate.set(c.gate, v);
        } catch (_) { /* idem */ }
    }
    _meta.at = now;
}

/**
 * Pune nivelurile unei burse pe treptele de pret. Functie PURA (testata).
 * `levels` = [[pret, cantitate in moneda de baza]]. Intoarce Map treapta → cantitate.
 */
function bucketize(levels, step, into) {
    const out = into || new Map();
    for (const [p, q] of levels || []) {
        if (!(p > 0) || !(q > 0)) continue;
        const k = Math.floor(p / step) * step + step / 2;   // centrul treptei
        out.set(k, (out.get(k) || 0) + q);
    }
    return out;
}

/**
 * Cadrul combinat. PUR: primeste cartile deja normalizate ([[pret, cantitate baza]]).
 * `books` = [{ ex, bids, asks }]. Mijlocul vine din PRIMA carte (Binance cand exista:
 * e cea mai fina, deci cel mai bun mijloc).
 */
function combine({ symbol, ts, books, step }) {
    const usable = (books || []).filter((b) => b && b.bids && b.bids.length && b.asks && b.asks.length);
    if (!usable.length) return null;
    const first = usable[0];
    const bestBid = Math.max(...first.bids.map((x) => x[0]));
    const bestAsk = Math.min(...first.asks.map((x) => x[0]));
    const mid = (bestBid + bestAsk) / 2;
    if (!(mid > 0)) return null;
    const B = new Map(), A = new Map(), coverage = [];
    for (const b of usable) {
        // un ordin de cumparare peste mijloc (sau de vanzare sub) e o carte decalata — afara
        const bids = b.bids.filter((x) => x[0] <= mid), asks = b.asks.filter((x) => x[0] >= mid);
        if (!bids.length || !asks.length) continue;
        bucketize(bids, step, B); bucketize(asks, step, A);
        coverage.push({ ex: b.ex, lo: Math.min(...bids.map((x) => x[0])), hi: Math.max(...asks.map((x) => x[0])) });
    }
    const sort = (m, desc) => [...m.entries()].sort((x, y) => (desc ? y[0] - x[0] : x[0] - y[0]));
    return {
        exchange: coverage.map((c) => c.ex).join('+'), symbol, ts, src: 'wide',
        bids: sort(B, true), asks: sort(A, false), mid, bestBid, bestAsk, spread: bestAsk - bestBid,
        coverage, step,
    };
}

function _binanceBook(sym, now) {
    const fr = feed.deepFrames(sym);
    const f = fr.length ? fr[fr.length - 1] : null;
    if (!f || now - f.ts > BINANCE_FRESH_MS) return null;
    return { ex: 'binance', bids: f.bids, asks: f.asks };
}

async function _okxBook(c) {
    const ct = _meta.okx.get(c.okx); if (!(ct > 0)) return null;
    const j = await _json('https://www.okx.com/api/v5/market/books-full?instId=' + c.okx + '&sz=5000');
    const d = j && j.data && j.data[0]; if (!d) return null;
    const m = (rows) => (rows || []).map((r) => [Number(r[0]), Number(r[1]) * ct]).filter((x) => x[0] > 0 && x[1] > 0);
    return { ex: 'okx', bids: m(d.bids), asks: m(d.asks) };
}

async function _gateBook(c) {
    const qm = _meta.gate.get(c.gate); if (!(qm > 0)) return null;
    const j = await _json('https://api.gateio.ws/api/v4/futures/usdt/order_book?contract=' + c.gate + '&limit=50&interval=' + c.gateInterval);
    const m = (rows) => (rows || []).map((r) => [Number(r.p), Number(r.s) * qm]).filter((x) => x[0] > 0 && x[1] > 0);
    return { ex: 'gate', bids: m(j && j.bids), asks: m(j && j.asks) };
}

async function _tick() {
    const now = Date.now();
    try { await _loadMeta(now); } catch (_) { /* */ }
    for (const [sym, c] of Object.entries(CFG)) {
        const books = [_binanceBook(sym, now)];
        for (const get of [_okxBook, _gateBook]) {
            try { books.push(await get(c)); } catch (e) { _stats.fail++; _stats.lastErr = String(e && e.message || e).slice(0, 80); }
        }
        const f = combine({ symbol: sym, ts: Date.now(), books: books.filter(Boolean), step: c.step });
        if (!f) continue;
        _stats.ok++;
        let arr = _ring.get(sym); if (!arr) { arr = []; _ring.set(sym, arr); }
        arr.push(f);
        const cut = Date.now() - RING_MS;
        while (arr.length && (arr[0].ts < cut || arr.length > RING_MAX)) arr.shift();
    }
    const next = Date.now() - _lastDemand <= DEMAND_TTL_MS ? FAST_MS : IDLE_MS;
    _timer = setTimeout(() => { _tick().catch(() => {}); }, next);
    if (_timer.unref) _timer.unref();
}

/** Cineva se uita la banda lata. Prima chemare porneste bucla. */
function noteDemand(now) {
    _lastDemand = Number(now) || Date.now();
    if (_running) return;
    _running = true;
    _tick().catch(() => {});
}

function frames(symbol) { return (_ring.get(String(symbol || '').toUpperCase()) || []).slice(); }
function config(symbol) { return CFG[String(symbol || '').toUpperCase()] || null; }
function health() { return { running: _running, ..._stats, okxCt: [..._meta.okx], gateQm: [..._meta.gate] }; }
function stop() { if (_timer) clearTimeout(_timer); _timer = null; _running = false; }

module.exports = { noteDemand, frames, config, health, stop, combine, bucketize, CFG };
