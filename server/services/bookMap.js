'use strict';
// ══════════════════════════════════════════════════════════════════
// BOOKMAP — unde stau banii ACUM, nu unde au explodat
// ══════════════════════════════════════════════════════════════════
//
// [BOOKMAP 2026-10-26] Operatorul: „lângă predict poţi să faci bookmap, tot aşa
// date reale ce se poate lua din piaţă, să fie full, să se citească uşor, să
// arate chartul, preţul, să avem zoom, totul funcţional".
//
// Harta de lichidări arată unde au EXPLODAT banii. Asta arată unde STAU.
//
// ⚠️ TREI MĂSURĂTORI FĂCUTE ÎNAINTE DE PRIMA LINIE DE COD, fiecare schimbând
// designul — fiindcă cele trei capcane le notasem în carte la amânare:
//
// 1. CARTEA CARE EXISTĂ E LATĂ DE 253 DE DOLARI. Pe BTC la 80 322, cea mai mare
//    adâncime disponibilă (Binance REST limit=1000, 80,5 M$) acoperă
//    −0,155% … +0,160%. OKX cu 400 de niveluri acoperă ±0,07%. NU EXISTĂ pereţi
//    la 1% distanţă — nu-s ascunşi, nu-s inaccesibili, nu există. Deci harta e o
//    bandă strânsă, iar „zoom" înseamnă mai ADÂNC în bandă şi mai mult pe TIMP,
//    nu mai departe de preţ.
//
// 2. OKX DĂ MĂRIMEA ÎN CONTRACTE (ctVal = 0,01 BTC; 0,1 ETH). Fără
//    multiplicator, notionalul iese de 100× — am văzut 3 016 M$ pe o bandă de
//    ±0,07%, ceea ce e imposibil, şi aşa l-am prins. Aceeaşi capcană ca Gate la
//    lichidări, acelaşi răspuns: **multiplicator necunoscut ⇒ ARUNCĂ CADRUL**.
//    Bybit şi Binance dau în BTC (verificat: qtyStep 0.001, baseAsset BTC).
//
// 3. RAPORTUL max/median PE NIVEL E 427× (median 3 459 $, max 1 478 544 $).
//    Deci intensitatea culorii TREBUIE logaritmică — liniar, un nivel median
//    lângă unul mare ar fi negru, adică ar minţi că nu e nimic acolo.
//
// Şi o CORECŢIE la o afirmaţie pe care o repetasem de mai multe ori: spuneam
// „WS-ul de futures Binance e mort către acest VPS". PREA LARG. Testat serial,
// câte unul singur pe conexiune: `markPrice@1s`, `aggTrade`, `kline_1m`,
// `forceOrder`, `!forceOrder@arr` — toate MUTE; **`depth20@100ms` CURGE** (135
// de cadre în 15 s). Deci mut e aproape tot, dar nu carnetul.

const DEFAULT_BAND_PCT = 0.1;     // ±0,1% acoperă 62% din bani pe BTC
const DEFAULT_ROWS = 48;
const DEFAULT_WINDOW_MS = 10 * 60000;
const MAX_ROWS = 200;
// Un nivel care apare în mai puţin de atât din cadre nu e perete, e licărire.
const WALL_MIN_FIRMNESS = 0.25;

/**
 * Normalizează un cadru de carnet. Întoarce NULL dacă nu e de încredere.
 *
 * `mult` e OBLIGATORIU şi explicit. Nu există implicit 1: pe OKX ar însemna
 * notional de 100×, iar o hartă cu cifre de 100× e mai rea decât o hartă goală.
 */
function normalize({ exchange, symbol, ts, bids, asks, mult }) {
    const m = Number(mult);
    if (!Number.isFinite(m) || m <= 0) return null;
    if (!Array.isArray(bids) || !Array.isArray(asks)) return null;

    const clean = (rows) => {
        const out = [];
        for (const r of (rows || [])) {
            const p = parseFloat(r && r[0]), q = parseFloat(r && r[1]);
            if (!Number.isFinite(p) || p <= 0) continue;
            if (!Number.isFinite(q) || q < 0) continue;
            out.push([p, q * m]);
        }
        return out;
    };
    const b = clean(bids), a = clean(asks);

    const bestBid = Math.max(...b.map(x => x[0]));
    const bestAsk = Math.min(...a.map(x => x[0]));
    const mid = (bestBid + bestAsk) / 2;
    // Garda UNICĂ pentru „n-am mijloc". Aici ajunge şi cadrul pe jumătate:
    // `Math.max()` pe listă goală dă -Infinity, deci mijlocul nu e finit.
    // Aveam mai sus şi un `if (!b.length || !a.length)`; o mutaţie l-a scos şi
    // nimic n-a căzut — era redundant, iar două gărzi pentru acelaşi caz
    // înseamnă că una minte despre ce apără.
    if (!Number.isFinite(mid) || mid <= 0) return null;

    return {
        exchange: String(exchange || ''), symbol: String(symbol || '').toUpperCase(),
        ts: Number(ts) || 0, bids: b, asks: a, mid, bestBid, bestAsk,
        spread: bestAsk - bestBid,
    };
}

function _band(frames, bandPct) {
    if (bandPct !== 'auto') {
        const v = Number(bandPct);
        return Number.isFinite(v) && v > 0 ? v : DEFAULT_BAND_PCT;
    }
    // AUTO: banda care chiar există. Lecţia b326/b327 — dacă desenezi
    // intervalul CERUT în loc de cel care EXISTĂ, ascunzi exact ce ai.
    let worst = 0;
    for (const f of frames) {
        for (const [p] of f.bids) worst = Math.max(worst, Math.abs(100 * (p - f.mid) / f.mid));
        for (const [p] of f.asks) worst = Math.max(worst, Math.abs(100 * (p - f.mid) / f.mid));
    }
    return worst > 0 ? worst * 1.02 : DEFAULT_BAND_PCT;
}

/**
 * Grila preţ × lichiditate, mediată pe fereastra de timp.
 *
 * ⚠️ VALOAREA CELULEI E MEDIA PONDERATĂ CU CADRELE, NU MAXIMUL — şi asta e
 * singurul răspuns onest la spoofing. Un perete fulgerat într-un cadru din 100
 * contribuie 1% şi nu mai domină harta, fără să pretindem că citim intenţii.
 * Maximul se păstrează SEPARAT (`bidPeakUsd`), ca să se vadă şi vârful, dar nu
 * ca şi cum ar fi fost acolo tot timpul.
 */
function aggregate({ frames, bandPct, rows, windowMs, now }) {
    const all = Array.isArray(frames) ? frames.filter(Boolean) : [];
    const win = Number(windowMs);
    const t = Number(now) || (all.length ? Math.max(...all.map(f => f.ts)) : 0);
    const used = Number.isFinite(win) && win > 0 ? all.filter(f => f.ts >= t - win) : all;

    const R = Math.max(4, Math.min(MAX_ROWS, Number(rows) || DEFAULT_ROWS));
    const empty = {
        cells: [], frames: 0, mid: null, bandPct: _band([], bandPct), rowPct: 0,
        excludedLevels: 0, maxUsd: 0, spread: null, exchanges: [],
    };
    if (!used.length) return empty;

    const band = _band(used, bandPct);
    const rowPct = (2 * band) / R;
    const mid = used.reduce((s, f) => s + f.mid, 0) / used.length;

    // index palier -> acumulator
    const acc = new Map();
    let excluded = 0;
    const exch = new Set();

    for (const f of used) {
        exch.add(f.exchange);
        // ⚠️ FERMITATEA NUMARA CADRE, NU NIVELURI.
        //
        // [2026-10-26] Randand harta cu date reale, pereţii afişau fermitate
        // **2450%**. Numărasem nivelurile care contribuie: cu 500 de niveluri
        // pe parte, zeci cad în acelaşi palier, deci contorul depăşea numărul
        // de cadre de 24 de ori. Testul vechi trecea fiindcă folosea UN nivel
        // pe cadru — exact cazul în care bugul nu se vede.
        //
        // Seturile de aici marchează o singură dată per cadru ce palier a avut
        // ceva pe fiecare parte.
        const bidRows = new Set(), askRows = new Set();
        const put = (side, p, q) => {
            const pct = 100 * (p - f.mid) / f.mid;
            if (Math.abs(pct) > band) { excluded++; return; }
            // Palierul se calculează din pct, nu din preţul absolut: preţul se
            // mişcă între cadre, procentul rămâne comparabil.
            let i = Math.floor((pct + band) / rowPct);
            if (i < 0) i = 0; if (i >= R) i = R - 1;
            let c = acc.get(i);
            if (!c) { c = { bidSum: 0, askSum: 0, bidPeak: 0, askPeak: 0, bidN: 0, askN: 0 }; acc.set(i, c); }
            const usd = p * q;
            if (side === 'B') {
                c.bidSum += usd; c.bidPeak = Math.max(c.bidPeak, usd);
                if (usd > 0) bidRows.add(i);
            } else {
                c.askSum += usd; c.askPeak = Math.max(c.askPeak, usd);
                if (usd > 0) askRows.add(i);
            }
        };
        for (const [p, q] of f.bids) put('B', p, q);
        for (const [p, q] of f.asks) put('A', p, q);
        for (const i of bidRows) acc.get(i).bidN++;
        for (const i of askRows) acc.get(i).askN++;
    }

    const n = used.length;
    const cells = [];
    let maxUsd = 0;
    for (const [i, c] of acc) {
        const pct = -band + (i + 0.5) * rowPct;
        const bidUsd = c.bidSum / n;       // media pe fereastră, nu maximul
        const askUsd = c.askSum / n;
        maxUsd = Math.max(maxUsd, bidUsd, askUsd);
        cells.push({
            row: i, pct, price: mid * (1 + pct / 100),
            bidUsd, askUsd,
            bidPeakUsd: c.bidPeak, askPeakUsd: c.askPeak,
            bidFirmness: Math.min(1, c.bidN / n), askFirmness: Math.min(1, c.askN / n),
        });
    }
    cells.sort((x, y) => y.pct - x.pct);

    return {
        cells, frames: n, mid, bandPct: band, rowPct, excludedLevels: excluded,
        maxUsd, spread: used[used.length - 1].spread, exchanges: [...exch].sort(),
        from: used[0].ts, to: used[used.length - 1].ts,
    };
}

/**
 * Cei mai groşi pereţi, cu distanţa în dolari faţă de preţ.
 *
 * Un nivel care a fost acolo în mai puţin de WALL_MIN_FIRMNESS din cadre NU
 * intră: a treia capcană notată în carte era exact asta — „un perete care
 * dispare când preţul se apropie nu e perete".
 */
function walls(agg, limit = 6) {
    if (!agg || !Array.isArray(agg.cells) || !agg.cells.length || !agg.mid) return [];
    const out = [];
    for (const c of agg.cells) {
        if (c.bidUsd > 0 && c.bidFirmness >= WALL_MIN_FIRMNESS) {
            out.push({ side: 'BID', price: c.price, pct: c.pct, usd: c.bidUsd,
                peakUsd: c.bidPeakUsd, firmness: c.bidFirmness, distUsd: c.price - agg.mid });
        }
        if (c.askUsd > 0 && c.askFirmness >= WALL_MIN_FIRMNESS) {
            out.push({ side: 'ASK', price: c.price, pct: c.pct, usd: c.askUsd,
                peakUsd: c.askPeakUsd, firmness: c.askFirmness, distUsd: c.price - agg.mid });
        }
    }
    out.sort((a, b) => b.usd - a.usd);
    return out.slice(0, Math.max(1, Number(limit) || 6));
}

/**
 * Grila TIMP × PREŢ — „chartul" cerut de operator, plus linia preţului.
 *
 * Două lucruri învăţate pe panourile dinainte, aplicate aici dinadins:
 *
 * 1. AXA DE TIMP SE ÎNTINDE PE DATELE CARE EXISTĂ, nu pe fereastra cerută.
 *    Bugul de la b327: cu 1,3 ore de istoric într-o fereastră de 90 de zile,
 *    toate celulele cădeau în coloana 89 din 90 — harta avea date şi părea
 *    stricată. Aici ar fi aceeaşi poveste cu 2 minute într-o fereastră de 30.
 *
 * 2. RÂNDURILE SUNT ANCORATE PE MIJLOCUL FIECĂREI COLOANE, nu pe un preţ fix.
 *    Banda e de ±0,1%, iar preţul se mişcă mai mult decât atât într-un minut;
 *    cu ancoră fixă, tot carnetul ar ieşi din grilă şi harta s-ar goli.
 *
 * `mids[col]` e NULL pentru coloanele fără cadre. Nu zero — ar desena linia la
 * zero; şi nu interpolat — ar inventa un preţ care n-a existat.
 */
/** Intervalul TIPIC intre instantanee — mediana, ca o pauza sa nu-l traga. */
function _medianGap(sorted) {
    if (!sorted || sorted.length < 2) return Infinity;
    const g = [];
    for (let i = 1; i < sorted.length; i++) g.push(sorted[i].ts - sorted[i - 1].ts);
    g.sort((a, b) => a - b);
    return g[Math.floor(g.length / 2)] || Infinity;
}

function heat({ frames, cols, rows, bandPct, windowMs, now }) {
    const asked = Math.max(2, Math.min(600, Number(cols) || 90));
    const R = Math.max(4, Math.min(MAX_ROWS, Number(rows) || DEFAULT_ROWS));
    const all = Array.isArray(frames) ? frames.filter(Boolean) : [];
    const win = Number(windowMs);
    const t = Number(now) || (all.length ? Math.max(...all.map(f => f.ts)) : 0);
    const used = (Number.isFinite(win) && win > 0 ? all.filter(f => f.ts >= t - win) : all)
        .slice().sort((a, b) => a.ts - b.ts);

    if (!used.length) {
        return { cells: [], mids: new Array(asked).fill(null), cols: asked, colsAsked: asked,
            rows: R, bandPct: _band([], bandPct), tMin: null, tMax: null, maxUsd: 0, loUsd: 0,
            heldCols: 0, frames: 0, exchanges: [], spread: null };
    }

    // ⚠️ COLOANELE NU POT FI MAI MULTE DECÂT CADRELE.
    //
    // Verificat aritmetic pe starea reală a serverului: la ritm lent se strâng
    // ~20 de cadre în fereastra de 10 minute, iar clientul cere 110 coloane ⇒
    // 20 de coloane cu date şi 90 GOALE (82%). Harta ar fi ieşit un pieptene de
    // dungi subţiri cu găuri — exact ce ar fi văzut el la PRIMA deschidere.
    //
    // Aceeaşi clasă cu bugul de la b327: dacă desenezi grila CERUTĂ în loc de
    // cea care încape în date, ascunzi exact ce ai. Pe măsură ce se adună
    // cadre, coloanele cresc până la cât s-a cerut.
    const C = Math.max(2, Math.min(asked, used.length));

    const band = _band(used, bandPct);
    const rowPct = (2 * band) / R;
    // Fereastra DESENATĂ e cea care există.
    const tMin = used[0].ts;
    const tMax = used[used.length - 1].ts;
    const span = Math.max(1, tMax - tMin);

    const byCol = new Map();     // col -> { frames:[], }
    for (const f of used) {
        let c = Math.floor(((f.ts - tMin) / span) * C);
        if (c < 0) c = 0; if (c >= C) c = C - 1;
        if (!byCol.has(c)) byCol.set(c, []);
        byCol.get(c).push(f);
    }

    const mids = new Array(C).fill(null);
    const cells = [];
    const exch = new Set();
    let maxUsd = 0;

    for (const [col, list] of byCol) {
        // Mijlocul coloanei: ancora rândurilor PENTRU coloana asta.
        const mid = list.reduce((x, f) => x + f.mid, 0) / list.length;
        mids[col] = mid;
        const acc = new Map();
        for (const f of list) {
            exch.add(f.exchange);
            const put = (side, p, q) => {
                const pct = 100 * (p - f.mid) / f.mid;
                if (Math.abs(pct) > band) return;
                let i = Math.floor((pct + band) / rowPct);
                if (i < 0) i = 0; if (i >= R) i = R - 1;
                let a = acc.get(i);
                if (!a) { a = { b: 0, a: 0 }; acc.set(i, a); }
                if (side === 'B') a.b += p * q; else a.a += p * q;
            };
            for (const [p, q] of f.bids) put('B', p, q);
            for (const [p, q] of f.asks) put('A', p, q);
        }
        const n = list.length;
        for (const [i, a] of acc) {
            const bidUsd = a.b / n, askUsd = a.a / n;
            if (bidUsd <= 0 && askUsd <= 0) continue;
            maxUsd = Math.max(maxUsd, bidUsd, askUsd);
            cells.push({ col, row: i, pct: -band + (i + 0.5) * rowPct, bidUsd, askUsd });
        }
    }

    // ⚠️ REFERINTA DE JOS, si de ce nu lipseste.
    //
    // [2026-10-26] Masurasem raportul max/median **PE NIVEL**: 745×. Si am
    // aplicat o scara logaritmica potrivita pentru asta. Dar o CELULA de grila
    // aduna ~19 niveluri, deci pe celula raportul real e **3,0×** (26 randuri)
    // sau 6,2× (48). Cu scara pentru 745×, toate celulele ies intre 0,79 si
    // 1,00 — adica harta uniform aprinsa, care nu discrimineaza nimic.
    //
    // Am vazut-o RANDAND harta in ASCII cu date reale; nicio aritmetica nu
    // putea prinde asta, fiindca cifra pe care o calculasem era corecta — doar
    // despre alt obiect.
    //
    // Deci grila spune si o referinta de jos: percentila 5 a celulelor
    // nenule. NU minimul absolut — ar fi o celula norocoasa si scara ar
    // tremura de la o aducere la alta.
    const vals = cells.map(c => Math.max(c.bidUsd, c.askUsd)).filter(v => v > 0).sort((a, b) => a - b);
    const loUsd = vals.length ? vals[Math.floor(0.05 * (vals.length - 1))] : 0;

    // ⚠️ TINEREA INTRE INSTANTANEE — reparatia pieptenelui din captura lui.
    //
    // [2026-10-26] Harta avea benzi de culoare cu GOLURI NEGRE intre ele, si
    // linia pretului rupta. La b334 marginisem coloanele la numarul de cadre,
    // dar asta repara doar jumatate: cadrele nu vin la intervale egale (31 s
    // cand nu se uita nimeni, 5 s cat timp se uita), deci mai multe cad in
    // aceeasi coloana si altele rameane goale. Masurat: 29 de cadre ⇒ 19
    // coloane cu date, 10 goale (34%).
    //
    // Reparatia e un ADEVAR FIZIC, nu o cosmetizare: cartea de ordine NU dispare
    // intre instantanee — doar n-am privit. Deci fiecare instantaneu TINE pana
    // la urmatorul, iar celulele tinute sunt MARCATE (`held`), ca sa nu se dea
    // drept observatii noi.
    //
    // DAR NU LA NESFARSIT: o pana reala de flux nu are voie sa fie pictata ca
    // date. Tinerea se opreste dupa HOLD_MAX_COLS coloane, deci un gol adevarat
    // rameane gol.
    const colMs = span / C;
    const maxHold = Math.max(1, Math.ceil((2.5 * _medianGap(used)) / Math.max(1, colMs)));
    let heldCols = 0;
    let lastCol = -1;
    // Celulele MASURATE se indexeaza o data, inainte de umplere. Prima varianta
    // impingea in `cells` chiar in timp ce itera peste el — se termina doar
    // fiindca sarea peste cele marcate `held`, adica se baza pe noroc si era
    // patratica. Un index e si corect, si ieftin.
    const srcByCol = new Map();
    for (const c of cells) {
        if (!srcByCol.has(c.col)) srcByCol.set(c.col, []);
        srcByCol.get(c.col).push(c);
    }
    const adaugate = [];
    for (let i = 0; i < C; i++) {
        if (byCol.has(i)) { lastCol = i; continue; }
        if (lastCol < 0 || i - lastCol > maxHold) continue;   // inainte de primul, sau pana reala
        mids[i] = mids[lastCol];
        for (const c of (srcByCol.get(lastCol) || [])) adaugate.push({ ...c, col: i, held: true });
        heldCols++;
    }
    for (const c of adaugate) cells.push(c);

    return { cells, mids, cols: C, colsAsked: asked, rows: R, bandPct: band, rowPct, tMin, tMax,
        maxUsd, loUsd, heldCols, frames: used.length, exchanges: [...exch].sort(),
        spread: used[used.length - 1].spread };
}

module.exports = {
    normalize, aggregate, walls, heat,
    DEFAULT_BAND_PCT, DEFAULT_ROWS, DEFAULT_WINDOW_MS, WALL_MIN_FIRMNESS, MAX_ROWS,
};
