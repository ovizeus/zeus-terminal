'use strict';
// ══════════════════════════════════════════════════════════════════
// Rubrica de predicţie — firul care leagă tot, şi care umple verdictele
// ══════════════════════════════════════════════════════════════════
//
// [LIQ-PREDICT 2026-10-26] Operatorul: „o rubrică de prediction long/short pe
// BTC şi ETH… să socotească din lichidările reale unde e magnetul… dar date
// reale, nu fake".
//
// Serviciul face trei lucruri, la fiecare tick:
//   1. calculează semnalul din lichidările măsurate + contextul Binance
//   2. îl SALVEAZĂ dacă afirmă o direcţie (ca procentul să poată fi numărat)
//   3. pune verdictul pe semnalele cărora le-a trecut orizontul, din klines reale
//
// ⚠️ DOUĂ SIMBOLURI, şi asta e decizia operatorului: BTC şi ETH. Nu e o
// limitare tehnică — pe simboluri mici lichidările sunt prea rare ca o rată să
// însemne ceva, şi un procent calculat pe 3 cazuri ar fi exact „fake"-ul pe
// care l-a interzis.

const logger = require('./logger');
const liqStore = require('./liqStore');
const store = require('./liqPredictStore');
const ctx = require('./liqPredictContext');
const LP = require('./liqPredict');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
// Fereastra din care se citesc lichidările. Efectul de combustibil ars e de
// ordinul orelor; cu timpul de înjumătăţire de 4h, peste 24h greutatea e sub
// 2% — deci mai mult n-ar schimba nimic şi doar ar citi rânduri degeaba.
const WINDOW_MS = 24 * 3600000;
// Linia de baza se ia pe o fereastra MULT mai lunga decat semnalul. Daca ar fi
// aceeasi, ar urmari exact semnalul pe care trebuie sa-l judece si diferenţa ar
// tinde spre zero. 7 zile: destul ca „normalul" sa fie normal, nu atat incat sa
// descrie o alta piata.
const BASELINE_WINDOW_MS = 7 * 86400000;
const TICK_MS = 2 * 60000;
const RESOLVE_INTERVAL = '5m';
const RESOLVE_BARS = 300;       // 300 × 5m = 25h, acoperă şi orizontul de 24h

let _timer = null;
let _last = new Map();          // symbol -> ultimul rezultat calculat

function _price(symbol) {
    try {
        const t = require('./marketCache').get('ticker', 'binance:' + symbol);
        const p = Number(t && t.price);
        if (Number.isFinite(p) && p > 0) return p;
    } catch (_) {}
    return null;
}

/**
 * Semnalul pentru un simbol, plus ratele MĂSURATE pe fiecare orizont.
 * Nu scrie nimic — poate fi chemat şi de rută, fără efecte.
 */
async function computeFor(symbol, now = Date.now()) {
    const price = _price(symbol);
    // O singura citire, pentru amandoua ferestrele: fereastra de semnal e un
    // subset al celei de baza, deci a doua interogare ar fi degeaba.
    const wide = liqStore.events(symbol, now - BASELINE_WINDOW_MS);
    const events = wide.filter(e => Number(e.ts) >= now - WINDOW_MS);
    const oldestWide = wide.length ? Math.min(...wide.map(e => Number(e.ts))) : null;
    const baseline = LP.buildBaseline(wide, now, oldestWide ? (now - oldestWide) / 3600000 : 0);
    const c = await ctx.getContext(symbol, now);

    const signal = LP.score({
        symbol, price: price || 0, now, events, baseline,
        crowd: c.crowd, oi: c.oi,
    });

    const horizons = store.HORIZONS_MS.map(h => {
        const s = store.stats(symbol, h);
        return { horizonMs: h, ...s };
    });

    return {
        symbol, price, at: now,
        signal,
        // Spus pe faţă în răspuns, nu doar în cod: de când avem date. Operatorul
        // a cerut „azi, ieri, acum 3 zile"; la 13 ore de istoric, „acum 3 zile"
        // nu există, şi panoul trebuie să poată spune asta.
        windowMs: WINDOW_MS,
        eventsInWindow: events.length,
        oldestEventTs: oldestWide,
        // Linia de baza pleaca spre client: fara ea, „burn split is normal for
        // this market" ar fi o afirmatie neverificabila din panou.
        baseline: baseline ? {
            imbalance: baseline.imbalance, n: baseline.n, hours: baseline.hours,
            longUsd: baseline.longUsd, shortUsd: baseline.shortUsd,
            minEvents: LP.BASELINE_MIN_EVENTS, minHours: LP.BASELINE_MIN_HOURS,
            established: baseline.n >= LP.BASELINE_MIN_EVENTS && baseline.hours >= LP.BASELINE_MIN_HOURS,
        } : null,
        context: {
            oiChangePct: c.oi ? c.oi.changePct : null,
            oiValueUsd: c.oi ? c.oi.valueUsd : null,
            crowdLongPct: c.crowd ? c.crowd.longAccount * 100 : null,
            at: c.at || null,
        },
        horizons,
        minSamples: LP.MIN_SAMPLES,
    };
}

/** Ultimul rezultat calculat, fără a reface munca (pentru rută). */
function lastFor(symbol) { return _last.get(symbol) || null; }

/** Pune verdictul pe semnalele scadente, din klines reale. */
async function _resolveDue(now = Date.now()) {
    const rows = store.due(now, 60);
    if (!rows.length) return 0;
    const bySym = new Map();
    for (const r of rows) {
        if (!bySym.has(r.symbol)) bySym.set(r.symbol, []);
        bySym.get(r.symbol).push(r);
    }
    let n = 0;
    for (const [sym, list] of bySym) {
        let bars = null;
        try { bars = await require('./marketFeed').fetchKlines(sym, RESOLVE_INTERVAL, RESOLVE_BARS); }
        catch (_) { bars = null; }
        // Fără bare NU închidem rândurile. Rămân scadente şi se reîncearcă la
        // următorul tick — un MISS inventat ar strica exact cifra pentru care
        // există tot mecanismul.
        if (!Array.isArray(bars) || !bars.length) continue;
        for (const row of list) {
            try { if (store.resolveWith(row, bars, now)) n++; } catch (_) {}
        }
    }
    return n;
}

async function tick(now = Date.now()) {
    let recorded = 0;
    for (const sym of SYMBOLS) {
        try {
            const res = await computeFor(sym, now);
            _last.set(sym, res);
            if (res.price) recorded += store.record({ ...res.signal, price: res.price }, now);
        } catch (e) {
            logger.error('LIQPRED', `tick ${sym} failed: ${e.message}`);
        }
    }
    let resolved = 0;
    try { resolved = await _resolveDue(now); }
    catch (e) { logger.error('LIQPRED', 'resolve failed: ' + e.message); }
    if (recorded || resolved) {
        logger.info('LIQPRED', `snapshots +${recorded}, resolved ${resolved}`);
    }
    return { recorded, resolved };
}

function start() {
    if (_timer) return;
    _timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
    if (_timer.unref) _timer.unref();
    // Primul tick după 20 s, ca să nu se bată cu încărcarea de la boot.
    const t0 = setTimeout(() => { tick().catch(() => {}); }, 20000);
    if (t0.unref) t0.unref();
    logger.info('LIQPRED', `started — ${SYMBOLS.join(', ')} every ${TICK_MS / 60000}m`);
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _last.clear();
}

module.exports = { computeFor, lastFor, tick, start, stop, SYMBOLS, WINDOW_MS, BASELINE_WINDOW_MS, TICK_MS, _resolveDue };
