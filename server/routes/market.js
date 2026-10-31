'use strict';

/**
 * Market data routes — surfaces the marketRadar snapshot to the client.
 *
 * Day 32A: GET /api/market/top?kind=gainers|losers|volume&limit=N
 *   Returns the latest top-N USDT-perp tickers from the radar cache,
 *   sorted by gainers (24h % desc), losers (24h % asc) or volume.
 *
 * Auth: standard sessionAuth (applied at app.use('/api') level in server.js).
 */

const express = require('express');
const router = express.Router();
const marketRadar = require('../services/marketRadar');

const ALLOWED_KINDS = new Set(['gainers', 'losers', 'volume']);

// [LIQ-HISTORY 2026-10-25] Harta de lichidari REALE, din istoricul de pe
// server. Clientul tinea 24h in localStorage, pe un singur telefon; asta e
// aceeasi harta dar pe 30 de zile si la fel pe orice dispozitiv.
//
// `ref` vine de la client (pretul lui curent) ca gruparea pe procente sa fie
// facuta dupa o SINGURA regula, aceeasi ca in liqMap.ts — nu doua care se
// contrazic la primul caz ambiguu (R-C-23).
// [LIQ-PANEL 2026-10-25] Tot ce-i trebuie panoului, intr-O SINGURA cerere:
// scara pe niveluri, grila timp x pret, si banda de onestitate. Trei cereri ar
// fi insemnat trei momente diferite, deci trei „acum" diferite in acelasi
// ecran — iar o fereastra de timp care nu e aceeasi peste tot e exact felul in
// care se nasc cifre care nu se potrivesc intre ele.
router.get('/liq-panel', (req, res) => {
    try {
        const liqStore = require('../services/liqStore');
        const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
        const ref = Number(req.query.ref);
        const days = Number(req.query.days) || liqStore.DEFAULT_DAYS;
        const cols = Number(req.query.cols) || 90;
        res.json({
            map: liqStore.map({ symbol, ref, days }),
            heat: liqStore.heatmap({ symbol, ref, days, cols }),
            stats: liqStore.stats({ symbol, days }),
            // Unde CHIAR sunt date — ca o scara goala sa nu para o defectiune.
            top: liqStore.symbols({ days, limit: 12 }),
            symbol, ref, days,
        });
    } catch (err) {
        // Un panou gol e onest; un 500 il lasa pe operator sa creada ca
        // s-a stricat altceva.
        res.status(200).json({ map: null, heat: null, stats: null, error: 'unavailable' });
    }
});

// [LIQ-PREDICT 2026-10-26] Rubrica de predictie. Operatorul: „prediction long
// short pe btc si eth… sa socoteasca din lichidarile reale unde e magnetul…
// date reale, nu fake".
//
// O SINGURA cerere pentru amandoua simbolurile, din acelasi motiv ca la
// liq-panel: doua cereri ar insemna doua „acum" in acelasi ecran.
//
// Raspunsul cuprinde DELIBERAT si ce NU stim: `horizons[].calibrating` si
// `need` — clientul nu are voie sa inventeze un procent cand serverul spune ca
// nu are destule cazuri masurate.
router.get('/liq-predict', async (req, res) => {
    try {
        const svc = require('../services/liqPredictService');
        const want = String(req.query.symbols || svc.SYMBOLS.join(','))
            .toUpperCase().split(',').map(x => x.trim()).filter(Boolean).slice(0, 4);
        const syms = want.filter(x => svc.SYMBOLS.includes(x));
        const list = syms.length ? syms : svc.SYMBOLS;

        const out = [];
        for (const sym of list) {
            // Rezultatul calculat de tick, daca exista: ruta NU declanseaza
            // cereri catre Binance la fiecare deschidere de panou.
            const cached = svc.lastFor(sym);
            out.push(cached || await svc.computeFor(sym));
        }
        res.json({ symbols: out, at: Date.now() });
    } catch (err) {
        // Panou gol, nu 500: un 500 il lasa sa creada ca s-a stricat altceva.
        res.status(200).json({ symbols: [], at: Date.now(), error: 'unavailable' });
    }
});

// [BOOKMAP 2026-10-26] Cartea de ordine: unde stau banii ACUM, peste unde au
// explodat inainte. Operatorul: „sa fie full, sa se citeasca usor, sa arate
// chartul, pretul, sa avem zoom, totul functional".
//
// O SINGURA cerere pentru tot ecranul, ca la liq-panel: grila timp x pret,
// scara pe niveluri, pereţii, si banda de sus. Trei cereri ar insemna trei
// „acum" diferite in acelasi ecran.
//
// ⚠️ ZOOM-UL E MARGINIT AICI, nu in client: `cols` si `rows` ajung in bucle si
// in alocari, deci o cerere cu rows=1e9 ar fi o cale de a inghetat serverul.
// `band` accepta 'auto' — si auto chiar inseamna banda care EXISTA (lectia
// b326/b327), nu una presupusa.
router.get('/bookmap', (req, res) => {
    try {
        const BM = require('../services/bookMap');
        const feed = require('../services/bookFeed');

        const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
        const sym = feed.SYMBOLS.includes(symbol) ? symbol : feed.SYMBOLS[0];

        const bandRaw = String(req.query.band || 'auto');
        const band = bandRaw === 'auto'
            ? 'auto'
            : Math.max(0.005, Math.min(1, Number(bandRaw) || BM.DEFAULT_BAND_PCT));

        const windowMs = Math.max(30000, Math.min(BM.DEFAULT_WINDOW_MS * 2,
            (Number(req.query.window) || 600) * 1000));
        const cols = Math.max(10, Math.min(240, Number(req.query.cols) || 90));
        const rows = Math.max(8, Math.min(BM.MAX_ROWS, Number(req.query.rows) || 48));

        // Cineva se uita CHIAR ACUM: fluxul trece pe ritm rapid. Fara asta,
        // interogarea adanca ar merge continuu din boot pentru un ecran la care
        // nu se uita nimeni — masurat: 57% din plafonul Binance.
        feed.noteDemand(Date.now());
        try { require('../services/tradeFeed').noteDemand(Date.now()); } catch (_) { /* */ }

        const deep = feed.deepFrames(sym);
        const now = Date.now();
        // Grila pe PRET ABSOLUT: bulele si lichidarile au preturi reale, deci
        // au nevoie de o axa de pret adevarata. Vezi nota din bookMap.heatAbs.
        const heat = BM.heatAbs({ frames: deep, cols, rows, windowMs, now });
        const ladder = BM.aggregate({ frames: deep, bandPct: band, rows, windowMs, now });

        // Banda de sus vine din cadrele RAPIDE (WS) si NU din medii — vezi nota
        // din bookFeed despre de ce cele doua surse nu se amesteca.
        const top = feed.topFrames(sym);
        const last = top.length ? top[top.length - 1] : null;

        res.json({
            symbol: sym,
            heat,
            ladder: { cells: ladder.cells, mid: ladder.mid, bandPct: ladder.bandPct,
                rowPct: ladder.rowPct, maxUsd: ladder.maxUsd, frames: ladder.frames,
                excludedLevels: ladder.excludedLevels },
            walls: BM.walls(ladder, 8),
            // BULELE: tranzacţii executate, din ACEEAŞI piaţă ca harta.
            // Numai cele din fereastra desenată — altfel clientul ar primi 20
            // de minute de tranzacţii ca să deseneze 10.
            trades: (() => {
                try {
                    const from = heat.tMin || (now - windowMs);
                    const to = heat.tMax || now;
                    return require('../services/tradeFeed').trades(sym)
                        .filter((t) => t.ts >= from && t.ts <= to);
                } catch (_) { return []; }
            })(),
            // LICHIDĂRILE, cerute explicit: „tot, lichidari, nu sari nimic".
            // Vin din memoria care colectează de pe Bybit + OKX + Gate, deci
            // sunt ale PIEŢEI, nu doar ale Binance — şi asta se spune în panou.
            liqs: (() => {
                try {
                    const from = heat.tMin || (now - windowMs);
                    return require('../services/liqStore').events(sym, from)
                        .filter((e) => Number(e.ts) <= (heat.tMax || now))
                        .map((e) => ({ ts: Number(e.ts), price: Number(e.price),
                            usd: Number(e.usd), sell: e.side === 'SELL' }));
                } catch (_) { return []; }
            })(),
            top: last ? {
                bestBid: last.bestBid, bestAsk: last.bestAsk, spread: last.spread,
                mid: last.mid, ts: last.ts,
                bidTopUsd: last.bids.reduce((x, [pp, q]) => x + pp * q, 0),
                askTopUsd: last.asks.reduce((x, [pp, q]) => x + pp * q, 0),
            } : null,
            // Spus pe faţa: de unde vin cifrele si cat de adanc vedem. Fara
            // asta o harta ingusta arata identic cu una stricata.
            source: {
                deepLevels: deep.length ? (deep[deep.length - 1].levels || null) : null,
                deepFrames: deep.length, topFrames: top.length,
                health: feed.health(),
            },
            asked: { band: bandRaw, windowMs, cols, rows },
            at: now,
        });
    } catch (err) {
        // Aceleasi chei ca pe calea de succes. Testul de contract a prins
        // exact asta in clipa in care am adaugat `trades` si `liqs`: fara ele
        // aici, panoul ar citi `undefined` exact cand serverul are o problema.
        res.status(200).json({ symbol: null, heat: null, ladder: null, walls: [],
            trades: [], liqs: [], top: null, source: null,
            error: 'unavailable', at: Date.now() });
    }
});

router.get('/liq-map', (req, res) => {
    try {
        const liqStore = require('../services/liqStore');
        const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
        const ref = Number(req.query.ref);
        const days = Number(req.query.days) || liqStore.DEFAULT_DAYS;
        const m = liqStore.map({ symbol, ref, days });
        // `coverage` pleaca spre client dinadins: fara el o scara goala in jos
        // arata identic cu una care n-are date deloc.
        res.json(m);
    } catch (err) {
        res.status(200).json({ buckets: [], events: 0, coverage: { upPct: 0, downPct: 0 }, error: 'unavailable' });
    }
});

router.get('/top', (req, res) => {
    const kindRaw = String(req.query.kind || 'volume').toLowerCase();
    const kind = ALLOWED_KINDS.has(kindRaw) ? kindRaw : 'volume';
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 10;
    const snap = marketRadar.getTopSnapshot({ kind, limit });
    if (!snap) return res.json({ ok: false, error: 'radar_warming_up', symbols: [] });
    res.json({ ok: true, ...snap });
});

router.get('/symbol/:symbol', (req, res) => {
    const entry = marketRadar.getSymbolFromSnapshot(req.params.symbol);
    if (!entry) return res.status(404).json({ ok: false, error: 'symbol_not_in_top300' });
    res.json({ ok: true, ts: Date.now(), ...entry });
});

// ═══════════════════════════════════════════════════════════════════
// [T3 Gateway] Proxy endpoints — client reads from marketCache, NOT Binance
// ═══════════════════════════════════════════════════════════════════
const mc = require('../services/marketCache');

router.get('/ticker', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    const data = mc.get('ticker', exch + ':' + sym);
    res.json({ ok: true, data: data || null, cached: !!data });
});

// [2026-06-20] Live Binance markPrice for open-position symbols (fstream is Hetzner-blocked, so we
// poll premiumIndex server-side ~1s and cache it). Returns { SYM: markPrice }. ?symbols=BTC,ETH.
router.get('/markprice', (req, res) => {
    try {
        const symbols = req.query.symbols ? String(req.query.symbols).split(',').filter(Boolean) : null;
        res.json(require('../services/markPriceCache').get(symbols));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ticker/all', (req, res) => {
    const exch = req.query.exchange || 'binance';
    const all = mc.getAll('ticker');
    const filtered = {};
    for (const [k, v] of Object.entries(all)) {
        if (k.startsWith(exch + ':')) filtered[k.split(':')[1]] = v;
    }
    res.json({ ok: true, data: filtered, count: Object.keys(filtered).length });
});

router.get('/funding', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: mc.get('funding', exch + ':' + sym) || null });
});

router.get('/oi', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: mc.get('oi', exch + ':' + sym) || null });
});

router.get('/depth', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: mc.get('depth', exch + ':' + sym) || null });
});

router.get('/sentiment', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: mc.get('sentiment', exch + ':' + sym) || null });
});

router.get('/time', (req, res) => {
    res.json({ ok: true, serverTime: Date.now() });
});

router.get('/klines', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const tf = req.query.tf || '5m';
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    try {
        const serverState = require('../services/serverState');
        const bars = serverState.getBarsForSymbol(sym, tf);
        res.json({ ok: true, data: (bars || []).slice(-limit) });
    } catch (_) { res.json({ ok: true, data: [] }); }
});

router.get('/cache/stats', (req, res) => {
    res.json({ ok: true, ...mc.getStats() });
});

router.get('/cache/health', (req, res) => {
    res.json({ ok: true, ...mc.health() });
});

module.exports = router;
