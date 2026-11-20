'use strict';
// [2026-11-20] RADARUL PE SERVER — cele 12 axe ale creierului v7, calculate pe server.
//
// De ce: radarul se calcula DOAR in aplicatie (engine/brain.ts → MarketCoreReactor),
// deci tot ce era legat de el (poza de la intrare, replay, deja vu, sablon) exista
// doar pentru tranzactiile deschise cu telefonul aprins — 2 din 159 la operator.
// Cerut: „sa fie tot pe server… nu conteaza de unde ia datele radarul".
//
// FORMULELE SUNT CELE DIN APLICATIE (client/src/engine/brain.ts ~2104-2300), portate
// una cate una; doar SURSELE sunt ale serverului:
//   TREND/MOMENTUM/VOLUME/VOLATILITY/STRUCTURE ← lumanarile 5m + indicatorii serverState
//   DELTA/FLOW ← serverOrderflow (tranzactiile)    OI/FUNDING ← snapshot-ul serverului
//   IMBALANCE ← cartea (serverLiquidity)            SENTIMENT ← raportul L/S (serverSentiment)
//   LIQ ← nivelurile de lichiditate (serverLiquidity: pivoti + pereti)
// O axa fara sursa e NULL (radarul o deseneaza „—"), niciodata o valoare inventata.
// Doar afisaj si jurnal: nimic de aici nu e citit de decizie.

const AXIS_KEYS = ['trend', 'delta', 'flow', 'oi', 'volume', 'funding', 'volatility', 'imbalance', 'momentum', 'sentiment', 'structure', 'liquidity'];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r01 = (v) => (v == null || !Number.isFinite(+v) ? null : clamp(+v, 0, 1));

function ema(data, p) {
    const k = 2 / (p + 1); let e = data[0];
    return data.map((v) => { e = v * k + e * (1 - k); return e; });
}
/** Panta EMA20 pe ultimele 10 bare, % (ca regimeEnhanced.ts). */
function slope20(bars) {
    if (!bars || bars.length < 30) return 0;
    const closes = bars.slice(-60).map((b) => +b.close);
    const e = ema(closes, 20);
    const a = e[e.length - 10], b = e[e.length - 1];
    return a > 0 ? ((b - a) / a) * 100 : 0;
}
/** 0..100: cat din lumanare e fitil (ca regime.ts _wickChaos). */
function wickChaos(bars, n) {
    if (!bars || bars.length < n) return 0;
    let tot = 0, c = 0;
    for (const k of bars.slice(-n)) {
        const range = k.high - k.low; if (range <= 0) continue;
        tot += 1 - Math.abs(k.close - k.open) / range; c++;
    }
    return c ? Math.round((tot / c) * 100) : 0;
}
/** ATR% pe ultimele 20 de bare. */
function atrPct(bars) {
    if (!bars || bars.length < 3) return 0;
    const last = bars.slice(-21);
    const trs = last.slice(1).map((k, i) => Math.max(k.high - k.low, Math.abs(k.high - last[i].close), Math.abs(k.low - last[i].close)));
    const avg = trs.reduce((a, b) => a + b, 0) / trs.length;
    const px = +last[last.length - 1].close;
    return px > 0 ? (avg / px) * 100 : 0;
}

/**
 * FUNCTIE PURA: intrarile deja adunate → cele 12 axe (0..1 sau null) + numaratoarea
 * bull/bear + regimul in vocabularul radarului. Testata direct.
 */
function axesFrom(inp) {
    const i = inp || {};
    const bars = Array.isArray(i.bars) ? i.bars : [];
    const price = +i.price || (bars.length ? +bars[bars.length - 1].close : 0);
    const bull = Number(i.bull) || 0, bear = Number(i.bear) || 0;
    const dir = bull >= bear ? 'bull' : 'bear';
    const slope = slope20(bars);
    const chaos = wickChaos(bars, 10);

    // TREND: ADX/50·0,6 + |panta|/2·0,3 + SuperTrend in directie 0,1
    const adx = Number(i.adx);
    const trend = Number.isFinite(adx)
        ? clamp(adx / 50, 0, 1) * 0.6 + clamp(Math.abs(slope) / 2, 0, 1) * 0.3 + (i.stDir === dir ? 0.1 : 0)
        : null;

    // FLOW + DELTA din tranzactii (cumparare/vanzare agresiva pe 5 min)
    let flow = null, delta = null;
    const bv = Number(i.buyVol), sv = Number(i.sellVol);
    if (Number.isFinite(bv) && Number.isFinite(sv) && bv + sv > 0) {
        const buyPct = (bv / (bv + sv)) * 100;
        const scaled = Math.pow(Math.abs(buyPct - 50) / 50, 0.6);
        const z = Number.isFinite(+i.deltaZ) ? clamp(Math.abs(+i.deltaZ) / 2, 0, 1) : 0;
        flow = clamp(0.45 * scaled + 0.40 * z + (i.absorbing ? 0.15 * 0.15 : 0), 0, 1);
        // deltaPct = delta / volum total, % (aplicatia: |deltaPct|/50)
        delta = r01(Math.abs(((bv - sv) / (bv + sv)) * 100) / 50);
    }

    // VOLUME: ultimele 5 bare fata de cele 20 dinainte, smoothstep
    let volume = null;
    if (bars.length >= 25) {
        const rec = bars.slice(-5).reduce((a, k) => a + (+k.volume || 0), 0) / 5;
        const base = bars.slice(-25, -5).reduce((a, k) => a + (+k.volume || 0), 0) / 20;
        const n = clamp(((base > 0 ? rec / base : 1) - 0.5) / 1.5, 0, 1);
        volume = n * n * (3 - 2 * n);
    }

    // VOLATILITY: ATR%/3·0,5 + fitiluri/80·0,3 + 0,2 cand volatilitatea e in expansiune
    const volatility = bars.length >= 10
        ? clamp(clamp(atrPct(bars) / 3, 0, 1) * 0.5 + clamp(chaos / 80, 0, 1) * 0.3 + (i.volExpansion ? 0.2 : 0), 0, 1)
        : null;

    // MOMENTUM: distanta RSI + raportul semnalelor + panta
    const rsi = Number(i.rsi);
    const tot = bull + bear || 1;
    const momentum = Number.isFinite(rsi)
        ? clamp(Math.abs(rsi - 50) / 50, 0, 1) * 0.4 + clamp(Math.abs(bull - bear) / tot, 0, 1) * 0.3 + clamp(Math.abs(slope) / 2, 0, 1) * 0.3
        : null;

    // LIQ + magnetul pentru STRUCTURE: cel mai apropiat nivel de lichiditate (sus/jos)
    let liquidity = null, magnet = 0.5;
    const up = Number(i.liqAbove), dn = Number(i.liqBelow);
    if (price > 0 && up > 0 && dn > 0) {
        const near = Math.min(Math.abs(up - price), Math.abs(price - dn)) / price;
        magnet = 1 - clamp(near / 0.02, 0, 1);
        liquidity = magnet;
    }
    // STRUCTURE: 0,35 magnet + 0,35 ordine (putine fitile) + 0,30 latimea intervalului
    let structure = null;
    if (bars.length >= 20 && price > 0) {
        const r20 = bars.slice(-20);
        const hh = Math.max(...r20.map((k) => +k.high)), ll = Math.min(...r20.map((k) => +k.low));
        const range = clamp(((hh - ll) / price) / 0.04, 0, 1);
        structure = clamp(0.35 * magnet + 0.35 * (1 - clamp(chaos / 100, 0, 1)) + 0.30 * range, 0, 1);
    }

    // OI: variatia fata de valoarea anterioara, %/2
    const oi = Number(i.oi), oiPrev = Number(i.oiPrev);
    const oiAx = Number.isFinite(oi) && Number.isFinite(oiPrev) && oiPrev > 0 ? r01((Math.abs(oi - oiPrev) / oiPrev) * 100 / 2) : null;
    // FUNDING: |fr| / 0,05%
    const fr = Number(i.fr);
    const funding = i.fr != null && Number.isFinite(fr) ? r01(Math.abs(fr) / 0.0005) : null;
    // IMBALANCE: partea de cumparare din carte, departarea de 50%
    const bb = Number(i.bookBid), ba = Number(i.bookAsk);
    const imbalance = bb > 0 && ba > 0 ? r01(Math.abs((bb / (bb + ba)) * 100 - 50) / 50) : null;
    // SENTIMENT: raportul long/short → departarea de 50/50
    const ls = Number(i.lsRatio);
    const sentiment = ls > 0 ? r01(Math.abs(ls / (1 + ls) - 0.5) / 0.5) : null;

    const v = { trend: r01(trend), delta, flow, oi: oiAx, volume: r01(volume), funding, volatility: r01(volatility),
        imbalance, momentum: r01(momentum), sentiment, structure: r01(structure), liquidity: r01(liquidity) };
    return {
        rt: AXIS_KEYS.map((k) => (v[k] == null ? null : Math.round(v[k] * 1000) / 1000)),
        bull, bear,
        regime: radarRegime(i.regime),
    };
}

/** Regimul serverului (TREND/BREAKOUT/RANGE/VOLATILE/SQUEEZE) → vocabularul radarului. */
function radarRegime(r) {
    const s = String(r || '').toUpperCase();
    if (s === 'TREND' || s.startsWith('TREND')) return 'trend';
    if (s === 'BREAKOUT') return 'breakout';
    if (s === 'VOLATILE' || s === 'PANIC' || s === 'LIQUIDATION_EVENT') return 'panic';
    if (s === 'SQUEEZE') return 'squeeze';
    return s ? 'range' : 'unknown';
}

/** Aduna intrarile reale pentru o moneda si intoarce axele. null = nu avem date de pret. */
function computeAxes(symbol, deps) {
    const D = deps || {};
    const sym = String(symbol || '').toUpperCase();
    const st = D.serverState || require('./serverState');
    const snap = st.getSnapshotForSymbol(sym);
    if (!snap || !(snap.price > 0)) return null;
    const bars = st.getBarsForSymbol(sym, '5m') || [];
    const ind = snap.indicators || {};
    let conf = null;
    try { conf = (D.confluence || require('./serverBrain')._calcConfluence)(snap, ind); } catch (_) { conf = null; }
    let flow = null, sent = null, liq = null, book = null;
    try { flow = (D.orderflow || require('./serverOrderflow')).getFlow(sym); } catch (_) {}
    try { sent = (D.sentiment || require('./serverSentiment')).getSentiment(sym); } catch (_) {}
    const L = D.liquidity || (() => { try { return require('./serverLiquidity'); } catch (_) { return null; } })();
    try { liq = L ? L.getLiquidity(sym, bars, snap.price) : null; } catch (_) {}
    try { book = L ? L.getOrderBook(sym) : null; } catch (_) {}
    let bookBid = null, bookAsk = null;
    if (book && Array.isArray(book.bids) && Array.isArray(book.asks)) {
        const band = snap.price * 0.005;   // ±0,5% in jurul pretului
        // randurile serverLiquidity sunt {price, qty}
        const sum = (rows) => rows.reduce((a, r) => { const p = +(r && r.price), q = +(r && r.qty); return p > 0 && q > 0 && Math.abs(p - snap.price) <= band ? a + p * q : a; }, 0);
        bookBid = sum(book.bids); bookAsk = sum(book.asks);
    }
    const nearPx = (x) => (x && Number(x.price) > 0 ? Number(x.price) : null);
    return axesFrom({
        bars, price: snap.price, adx: snap.adx != null ? snap.adx : ind.adx, stDir: ind.stDir,
        rsi: snap.rsi && snap.rsi['5m'], bull: conf ? conf.bullDirs : 0, bear: conf ? conf.bearDirs : 0,
        buyVol: flow ? flow.buyVol : null, sellVol: flow ? flow.sellVol : null, deltaZ: D.deltaZ != null ? D.deltaZ : null,
        absorbing: flow ? flow.absorptionScore > 0.5 : false,
        volExpansion: String(ind.volMode || '').toLowerCase() === 'expansion',
        // OI: serverState il citeste O SINGURA DATA la abonare (oiPrev ramane gol); radarCapture
        // tine o pereche proaspata, din cache-ul scannerului, si o da aici.
        // Perechea vine dintr-o SINGURA sursa: amestecate, oi de acum fata de oiPrev de la boot
        // ar desena un salt de OI care n-a existat.
        oi: D.oi != null ? D.oi : snap.oi, oiPrev: D.oi != null ? D.oiPrev : snap.oiPrev, fr: snap.fr,
        bookBid, bookAsk, lsRatio: sent ? sent.ls : null,
        liqAbove: liq ? nearPx(liq.nearestAbove) : null, liqBelow: liq ? nearPx(liq.nearestBelow) : null,
        regime: ind.regime || null,
    });
}

module.exports = { AXIS_KEYS, axesFrom, computeAxes, radarRegime, slope20, wickChaos, atrPct };
