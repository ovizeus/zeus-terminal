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
// [2026-10-25] 30 -> 90 de zile, ales de operator dupa ce i-am aratat cat
// acopera pretul pe fiecare fereastra: la 30 de zile BTC a atins doar
// +8,3% / -1,7%, deci scara ramanea ingusta. Costul masurat la ritmul actual e
// sub 1 GB pe an din 72 GB liberi — iar cu Gate in flux ritmul creste, deci
// cifra se reverifica peste cateva zile, nu se presupune.
const DEFAULT_DAYS = 90;
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
            'SELECT side, price, usd, ts FROM liq_events WHERE symbol = ? AND ts >= ?'),
        // Lotizat, ca retenţia de la G-5: better-sqlite3 e SINCRON, iar un
        // DELETE nelimitat pe o tabelă mare îngheaţă bucla de evenimente.
        topSymbols: db.db.prepare(
            'SELECT symbol, COUNT(*) AS n, SUM(usd) AS usd FROM liq_events'
            + ' WHERE ts >= ? GROUP BY symbol ORDER BY n DESC LIMIT ?'),
        stats: db.db.prepare(
            'SELECT exchange, COUNT(*) AS n, SUM(usd) AS usd, MIN(ts) AS oldest, MAX(ts) AS newest'
            + ' FROM liq_events WHERE symbol = ? AND ts >= ? GROUP BY exchange'),
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
    // `since` = de unde INCEPE acoperirea serverului pe simbolul asta, 0 daca
    // n-are nimic. Fara el, clientul nu poate sti ce parte din istoricul lui
    // local e deja acoperita — si exact asta a costat o regresie livrata:
    // serverul trimitea asOf=acum cu zero randuri, clientul arunca TOT
    // istoricul lui de 24h ca „deja la server", si scara ramanea goala.
    const out = { buckets: [], events: 0, coverage: { upPct: 0, downPct: 0 }, days: DEFAULT_DAYS, asOf: Date.now(), since: 0 };
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
        // Cel mai vechi rand CHIAR existent pentru simbol — nu cutoff-ul teoretic.
        let oldest = 0;
        for (const r of rows) { if (!oldest || r.ts < oldest) oldest = r.ts; }
        out.since = rows.length ? oldest : 0;
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

/**
 * [LIQ-PANEL 2026-10-25] Grila timp × preţ pentru vederea HEATMAP.
 *
 * Aici e diferenţa faţă de Coinglass, şi merită spusă o dată în plus: harta
 * lor colorată **prezice** unde ar fi lichidările, presupunând că lumea intră
 * la 10x/25x/50x/100x. Grila asta nu prezice nimic — fiecare celulă e suma
 * dolarilor lichidaţi **chiar acolo, chiar atunci**.
 */
function heatmap({ symbol, ref, days, cols } = {}) {
    const out = { cells: [], cols: 0, events: 0, maxUsd: 0, days: DEFAULT_DAYS, tMin: 0, tMax: 0 };
    try {
        const sym = typeof symbol === 'string' ? symbol.trim() : '';
        const p = Number(ref);
        const d = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.min(Number(days), 365) : DEFAULT_DAYS;
        // Mărginit: o cerere cu un milion de coloane ar construi un tablou
        // uriaş şi ar îngheţa răspunsul. 240 e deja mai fin decât poate desena
        // un telefon.
        let c = Math.floor(Number(cols));
        if (!Number.isFinite(c) || c <= 0) c = 90;
        c = Math.max(12, Math.min(c, 240));
        out.cols = c;
        out.days = d;
        if (!sym || !Number.isFinite(p) || p <= 0) return out;

        const tMax = Date.now();
        const cutoff = tMax - d * DAY_MS;
        const rows = _s().range.all(sym, cutoff);

        // [2026-10-25] Axa de timp se întinde pe DATELE care există, nu pe
        // fereastra cerută.
        //
        // Măsurat pe viu: cu 1,3 ore de istoric într-o fereastră de 90 de zile,
        // toate cele 5 celule cădeau în coloana 89 din 90 — harta era 89/90
        // goală, cu o dungă subţire la margine. Avea date şi părea stricată.
        //
        // Aceeaşi lecţie ca la scară: dacă desenezi intervalul cerut în loc de
        // intervalul care există, ascunzi exact ce ai.
        let oldest = 0;
        for (const r of rows) { if (!oldest || r.ts < oldest) oldest = r.ts; }
        const tMin = oldest ? Math.max(cutoff, oldest) : cutoff;
        out.tMin = tMin; out.tMax = tMax;
        const span = Math.max(1, tMax - tMin);
        const acc = new Map();
        for (const r of rows) {
            const pct = ((r.price - p) / p) * 100;
            const a = Math.abs(pct);
            if (a < MIN_PCT || a > MAX_PCT) continue;
            const key = Math.round(pct * BUCKET) / BUCKET;
            let col = Math.floor(((r.ts - tMin) / span) * c);
            if (col < 0) col = 0; if (col >= c) col = c - 1;
            const k = col + '|' + key;
            let cell = acc.get(k);
            if (!cell) { cell = { t: col, pct: key, longUsd: 0, shortUsd: 0, n: 0 }; acc.set(k, cell); }
            if (r.side === 'SELL') cell.longUsd += r.usd; else cell.shortUsd += r.usd;
            cell.n++;
            out.events++;
        }
        for (const cell of acc.values()) {
            const tot = cell.longUsd + cell.shortUsd;
            if (tot > out.maxUsd) out.maxUsd = tot;
        }
        out.cells = [...acc.values()];
    } catch (_) { /* o grilă goală e onestă */ }
    return out;
}

/**
 * Banda de onestitate: ce ştim, de când, şi de la cine.
 *
 * Fără ea, o scară goală arată identic cu una stricată — confuzia care a
 * pornit toată discuţia despre lichidări şi care a costat o regresie azi.
 * Raportarea PE BURSĂ face vizibil şi ce lipseşte: Binance nu apare, fiindcă
 * Binance chiar nu livrează nimic către serverul ăsta.
 */
function stats({ symbol, days } = {}) {
    const out = { events: 0, totalUsd: 0, since: 0, exchanges: [], days: DEFAULT_DAYS };
    try {
        const sym = typeof symbol === 'string' ? symbol.trim() : '';
        const d = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.min(Number(days), 365) : DEFAULT_DAYS;
        out.days = d;
        if (!sym) return out;
        const rows = _s().stats.all(sym, Date.now() - d * DAY_MS);
        for (const r of rows) {
            out.events += r.n;
            out.totalUsd += r.usd;
            if (!out.since || r.oldest < out.since) out.since = r.oldest;
            out.exchanges.push({ exchange: r.exchange, n: r.n, usd: r.usd, last: r.newest });
        }
        out.exchanges.sort((a, b) => b.usd - a.usd);
    } catch (_) { /* zero e onest */ }
    return out;
}

/**
 * Simbolurile cu cele mai multe lichidări în fereastră.
 *
 * Operatorul: „vreau liquidation map să se vadă". Panoul urmează simbolul
 * activ — iar dacă pe ĂLA nu s-a lichidat nimeni, scara e goală. Corect, dar
 * inutil. Banda asta arată unde CHIAR sunt date, ca să poată sări acolo
 * dintr-o atingere, în loc să se întrebe dacă s-a stricat ceva.
 */
function symbols({ days, limit } = {}) {
    try {
        const d = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.min(Number(days), 365) : DEFAULT_DAYS;
        let l = Math.floor(Number(limit));
        if (!Number.isFinite(l) || l <= 0) l = 12;
        l = Math.max(1, Math.min(l, 50));
        const rows = _s().topSymbols.all(Date.now() - d * DAY_MS, l);
        return rows.map((r) => ({ symbol: r.symbol, n: r.n, usd: r.usd }));
    } catch (_) {
        return [];
    }
}

module.exports = { record, map, heatmap, stats, symbols, prune, DEFAULT_DAYS };
