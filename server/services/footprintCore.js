'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// ICHNOS — footprint (volumul pe niveluri de pret, in fiecare lumanare)
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-16] Cerut de operator cu capturi „Orderflow Trader Lab": in fiecare
// lumanare, pe fiecare nivel de pret, cat s-a VANDUT agresiv x cat s-a CUMPARAT
// agresiv, cu Σ volum, Δ delta, POC si dezechilibre.
//
// Functii PURE (fara retea, fara baza): agregarea pe minut si unirea pe interval.
// Sursa tranzactiilor e Bybit (vezi footprintService.js de ce).
//
// Unitatea: NOTIONAL in dolari (pret × cantitate). Pe mai multe monede o
// cantitate in monede nu se compara (1 BTC ≠ 1 SOL), iar pe ecran se afiseaza in
// mii de dolari, intregi — ca „179x104" din capturi.
//
// Conventia: „bid" = vandut agresiv (a lovit cumparatorii din carte), „ask" =
// cumparat agresiv. Bybit `S` e partea AGRESORULUI (Buy = a cumparat la piata).

const MIN_MS = 60000;

// Pasul de pret al unui nivel, pe minut. Ales ca o lumanare de 1m obisnuita sa
// aiba ~10-30 de niveluri.
const BASE_BIN = Object.freeze({ BTCUSDT: 5, ETHUSDT: 0.5, SOLUSDT: 0.02, BNBUSDT: 0.1 });

// Pe intervale mai mari lumanarea e mai inalta: nivelurile se unesc.
const TF_MIN = Object.freeze({ '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240 });
const TF_BIN_MULT = Object.freeze({ '1m': 1, '3m': 2, '5m': 2, '15m': 4, '30m': 6, '1h': 10, '2h': 15, '4h': 20 });

function decimalsOf(step) {
    const s = String(step);
    return s.includes('.') ? s.split('.')[1].length : 0;
}

/** Nivelul (pretul de jos al cutiei) in care cade un pret. Rotunjit, ca sa nu apara 64005.000000001. */
function binOf(price, step) {
    const d = decimalsOf(step);
    return +(Math.floor(price / step + 1e-9) * step).toFixed(d);
}

/** O tranzactie normalizata de bybitFeed → {symbol, side:'BUY'|'SELL', price, qty, ts}. Adauga in candela minutului. */
function addTrade(store, t) {
    if (!t || !store) return false;
    const step = BASE_BIN[t.symbol];
    if (!step) return false;
    const price = Number(t.price), qty = Number(t.qty), ts = Number(t.ts);
    if (!(price > 0) || !(qty > 0) || !(ts > 0)) return false;
    if (t.side !== 'BUY' && t.side !== 'SELL') return false;
    const m = Math.floor(ts / MIN_MS) * MIN_MS;
    let bySym = store.get(t.symbol);
    if (!bySym) { bySym = new Map(); store.set(t.symbol, bySym); }
    let c = bySym.get(m);
    if (!c) { c = { t: m, o: price, h: price, l: price, c: price, lastTs: ts, firstTs: ts, lv: new Map() }; bySym.set(m, c); }
    if (ts < c.firstTs) { c.firstTs = ts; c.o = price; }
    if (ts >= c.lastTs) { c.lastTs = ts; c.c = price; }
    if (price > c.h) c.h = price;
    if (price < c.l) c.l = price;
    const b = binOf(price, step);
    let cell = c.lv.get(b);
    if (!cell) { cell = [0, 0]; c.lv.set(b, cell); }
    const usd = price * qty;
    if (t.side === 'SELL') cell[0] += usd; else cell[1] += usd;
    return true;
}

/** Candela de minut → forma salvata/trimisa: {t,o,h,l,c,lv:[[pret,bid,ask],...]} (USD rotunjit). */
function serialize1m(c) {
    const lv = [];
    for (const [p, v] of c.lv) lv.push([p, Math.round(v[0]), Math.round(v[1])]);
    lv.sort((a, b) => b[0] - a[0]);
    return { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, lv };
}

/**
 * Uneste candelele de 1m in intervalul cerut, cu nivelurile unite pe pasul intervalului.
 * Intrare: candele serializate (orice ordine). Iesire: crescator dupa timp.
 * O candela de interval contine doar minutele care AU tranzactii; fara niciun minut nu exista.
 */
function mergeTf(candles1m, symbol, tf) {
    const tfMin = TF_MIN[tf];
    const base = BASE_BIN[symbol];
    if (!tfMin || !base) return { bin: null, candles: [] };
    const step = +(base * (TF_BIN_MULT[tf] || 1)).toFixed(decimalsOf(base) + 2);
    const span = tfMin * MIN_MS;
    const groups = new Map();
    const sorted = (candles1m || []).slice().sort((a, b) => a.t - b.t);
    for (const m of sorted) {
        const k = Math.floor(m.t / span) * span;
        let g = groups.get(k);
        if (!g) { g = { t: k, o: m.o, h: m.h, l: m.l, c: m.c, lv: new Map() }; groups.set(k, g); }
        if (m.h > g.h) g.h = m.h;
        if (m.l < g.l) g.l = m.l;
        g.c = m.c;
        for (const [p, bid, ask] of m.lv) {
            const b = binOf(p + 1e-12, step);
            let cell = g.lv.get(b);
            if (!cell) { cell = [0, 0]; g.lv.set(b, cell); }
            cell[0] += bid; cell[1] += ask;
        }
    }
    const out = [];
    for (const g of [...groups.values()].sort((a, b) => a.t - b.t)) {
        const lv = [...g.lv.entries()].map(([p, v]) => [p, Math.round(v[0]), Math.round(v[1])]).sort((a, b) => b[0] - a[0]);
        out.push({ t: g.t, o: g.o, h: g.h, l: g.l, c: g.c, lv });
    }
    return { bin: step, candles: out };
}

module.exports = { MIN_MS, BASE_BIN, TF_MIN, TF_BIN_MULT, binOf, addTrade, serialize1m, mergeTf };
