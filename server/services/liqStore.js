'use strict';
// ══════════════════════════════════════════════════════════════════
// Istoricul lichidărilor — memoria hărţii din Quantitative Monitor
// ══════════════════════════════════════════════════════════════════
//
// [LIQ-HISTORY 2026-10-25] Operatorul: „nivele de lichidări sunt puţine, vreau
// să văd lichidări până sus şi până jos, dar cu date reale".
//
// Rândurile goale nu erau un bug. Harta arată NUMAI lichidări care chiar s-au
// întâmplat — modelul sintetic care umplea scara a fost scos deliberat la
// BUG5.5 fiindcă producea „clustere fantomă de miliarde". Fereastra era 24h,
// iar BTC s-a mişcat +0,6% / -0,6% în 24h: nu lipseau date, n-aveau ce exista
// acolo.
//
// Deci singura cale onestă de a umple scara e o fereastră mai lungă de
// evenimente REALE. Măsurat pe preţul real: 30 de zile acoperă +8,3% / -1,7%.
//
// Până acum nimeni nu ţinea minte: liqFeedAggregator avea un inel de 1000 de
// evenimente în RAM, iar clientul 24h în localStorage, pe un singur telefon.
// Modulul ăsta e memoria.
//
// ⚠️ ACOPERIRE, spus răspicat: Binance futures NU livrează nimic către acest
// server. Abonarea e confirmată (`{"result":null,"id":1}`) şi apoi tăcere, în
// timp ce Binance SPOT curge normal de pe aceeaşi maşină — deci nu e reţeaua
// şi nu e piaţa. Istoricul se construieşte din Bybit + OKX. Limitare de reţea,
// nu a modulului; vezi nota din liqFeedAggregator.js.

const db = require('./database');

const DAY_MS = 86400000;
const DEFAULT_DAYS = 30;
const MAX_PCT = 35;        // dincolo de asta e zgomot, ca în liqMap.ts
const MIN_PCT = 0.05;      // sub asta e tremurat la preţ
const BUCKET = 4;          // sfert de procent: Math.round(pct * 4) / 4

let _stmts = null;
function _s() {
    if (_stmts) return _stmts;
    _stmts = {
        insert: db.db.prepare(
            'INSERT INTO liq_events (exchange, symbol, side, price, qty, usd, ts) VALUES (?, ?, ?, ?, ?, ?, ?)'),
        range: db.db.prepare(
            'SELECT side, price, usd FROM liq_events WHERE symbol = ? AND ts >= ?'),
        // Lotizat, ca retenţia de la G-5: better-sqlite3 e SINCRON, iar un
        // DELETE nelimitat pe o tabelă mare îngheaţă bucla de evenimente.
        pruneBatch: db.db.prepare(
            'DELETE FROM liq_events WHERE rowid IN (SELECT rowid FROM liq_events WHERE ts < ? LIMIT ?)'),
    };
    return _stmts;
}

/**
 * Scrie un eveniment de lichidare, în forma normalizată de liqFeedAggregator:
 * { exchange, symbol, side, p, q, vol, time }. `side === 'SELL'` = LONG lichidat.
 *
 * Nu aruncă NICIODATĂ. Fluxul de lichidări nu are voie să moară fiindcă baza
 * de date a avut o toană — e telemetrie, nu calea banilor.
 */
function record(liq) {
    try {
        if (!liq || typeof liq !== 'object') return false;
        const symbol = typeof liq.symbol === 'string' ? liq.symbol.trim() : '';
        const side = liq.side === 'BUY' ? 'BUY' : liq.side === 'SELL' ? 'SELL' : '';
        const price = Number(liq.p);
        const qty = Number(liq.q);
        const usd = Number(liq.vol);
        const ts = Number(liq.time) || Date.now();
        if (!symbol || !side) return false;
        if (!Number.isFinite(price) || price <= 0) return false;
        if (!Number.isFinite(qty) || qty <= 0) return false;
        if (!Number.isFinite(usd) || usd <= 0) return false;
        _s().insert.run(String(liq.exchange || 'unknown'), symbol, side, price, qty, usd, ts);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Harta cerută de client: evenimentele reale grupate pe procent faţă de `ref`.
 *
 * Întoarce ŞI acoperirea — cât de sus şi cât de jos ajung datele — fiindcă
 * fără ea o scară goală în jos arată identic cu una care n-are date deloc, iar
 * aia e exact confuzia care a pornit toată discuţia.
 */
function map({ symbol, ref, days } = {}) {
    // `asOf` pleaca spre client ca sa NU se numere de doua ori aceleasi
    // lichidari: serverul are tot istoricul, clientul primeste aceleasi
    // evenimente si in direct. Clientul foloseste istoricul ca baza si adauga
    // local DOAR ce e mai nou decat reperul asta.
    const out = { buckets: [], events: 0, coverage: { upPct: 0, downPct: 0 }, days: DEFAULT_DAYS, asOf: Date.now() };
    try {
        const sym = typeof symbol === 'string' ? symbol.trim() : '';
        const p = Number(ref);
        const d = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.min(Number(days), 365) : DEFAULT_DAYS;
        out.days = d;
        if (!sym || !Number.isFinite(p) || p <= 0) return out;

        const rows = _s().range.all(sym, Date.now() - d * DAY_MS);
        const acc = new Map();
        let up = 0, down = 0;
        for (const r of rows) {
            const pct = ((r.price - p) / p) * 100;
            const a = Math.abs(pct);
            if (a < MIN_PCT || a > MAX_PCT) continue;
            if (pct > up) up = pct;
            if (pct < down) down = pct;
            const key = Math.round(pct * BUCKET) / BUCKET;
            let b = acc.get(key);
            if (!b) { b = { pct: key, price: r.price, longUsd: 0, shortUsd: 0, n: 0 }; acc.set(key, b); }
            // 'SELL' = long lichidat, aceeaşi convenţie ca în liqMap.ts
            if (r.side === 'SELL') b.longUsd += r.usd; else b.shortUsd += r.usd;
            b.n++;
            b.price = r.price;
            out.events++;
        }
        out.buckets = [...acc.values()].sort((a, b) => a.pct - b.pct);
        out.coverage.upPct = Math.round(up * 10) / 10;
        out.coverage.downPct = Math.round(down * 10) / 10;
    } catch (_) { /* o hartă goală e onestă; o excepţie nu ajută pe nimeni */ }
    return out;
}

/**
 * Retenţie — lotizată şi cu pauză, exact tiparul de la G-5. Întoarce câte
 * rânduri au plecat, ca jurnalul să spună ce s-a întâmplat, nu să presupună.
 */
async function prune(now = Date.now(), days = DEFAULT_DAYS, batchLimit = 2000, maxBatches = 200, yieldMs = 50) {
    const cutoff = now - days * DAY_MS;
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
        let n = 0;
        try { n = _s().pruneBatch.run(cutoff, batchLimit).changes; }
        catch (e) { try { console.warn('[LIQ-STORE] prune batch failed:', e.message); } catch (_) {} break; }
        total += n;
        if (n < batchLimit) break;
        await new Promise(r => setTimeout(r, yieldMs));
    }
    return total;
}

module.exports = { record, map, prune, DEFAULT_DAYS };
