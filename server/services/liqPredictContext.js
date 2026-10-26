'use strict';
// ══════════════════════════════════════════════════════════════════
// Contextul predicţiei — combustibilul RĂMAS, nu cel ars
// ══════════════════════════════════════════════════════════════════
//
// [LIQ-PREDICT 2026-10-26] Lichidările spun ce s-a ARS. Ca să ştim unde trage
// magnetul avem nevoie şi de ce a RĂMAS: cât levier e deschis şi pe ce parte
// stă mulţimea. Operatorul, întrebat explicit, a cerut să folosim tot.
//
// Două surse, amândouă testate pe viu din acest VPS pe 2026-10-26:
//   /futures/data/openInterestHist         → OI pe ore (BTC: 7,53 miliarde $)
//   /futures/data/globalLongShortAccountRatio → 69% long / 31% short pe BTC
//
// ⚠️ DE CE openInterestHist şi NU inelul din marketRadar: radarul ţine propriul
// inel de 60 de tickuri şi emite numai când |Δ1h| ≥ 10%, deci nu expune
// valoarea continuă, iar inelul are nevoie de încălzire după fiecare repornire.
// Punctul final de istoric dă Δ1h direct şi corect de la prima cerere.
//
// ⚠️ Ritm: 2 simboluri la 5 minute = 24 de cereri/oră, greutate 1. Prin
// binanceGateway, ca tot restul — NU ocolim limitatorul. Pe eroare întoarce
// null şi semnalul se calculează fără context: mai slab, dar viu. O rubrică
// care moare fiindcă Binance a strănutat e mai rea decât una fără OI.

const BASE = 'https://fapi.binance.com';
const TTL_MS = 5 * 60000;
const _cache = new Map();   // symbol -> { at, oi, crowd }

async function _get(url, src) {
    try {
        const res = await require('./binanceGateway').fetch(url, {
            signal: AbortSignal.timeout(8000), __src: src, __weight: 1,
        });
        if (!res || !res.ok) return null;
        return await res.json();
    } catch (_) { return null; }
}

/**
 * Δ1h de Open Interest, în procente, plus valoarea în dolari.
 * Semnul contează: OI care URCĂ în timp ce se arde = levierul se reface.
 */
async function _oi(symbol) {
    const j = await _get(
        `${BASE}/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=1h&limit=2`,
        'liqPredict:oiHist');
    if (!Array.isArray(j) || j.length < 2) return null;
    const prev = Number(j[0].sumOpenInterest), now = Number(j[1].sumOpenInterest);
    const valueUsd = Number(j[1].sumOpenInterestValue);
    if (!Number.isFinite(prev) || !Number.isFinite(now) || prev <= 0) return null;
    return {
        changePct: ((now - prev) / prev) * 100,
        valueUsd: Number.isFinite(valueUsd) ? valueUsd : null,
    };
}

/**
 * Cât din conturi stau long. 0,69 = 69% long.
 *
 * ⚠️ ONESTITATE: e eşantionul de conturi Binance, nu toată piaţa, şi un cont
 * nu e un dolar. Îl folosim ca înclinare a mulţimii, nu ca mărime absolută —
 * de asta intră în scor ca factor de slăbire/întărire, nu ca termen principal.
 */
async function _crowd(symbol) {
    const j = await _get(
        `${BASE}/futures/data/globalLongShortAccountRatio?symbol=${encodeURIComponent(symbol)}&period=1h&limit=1`,
        'liqPredict:lsRatio');
    if (!Array.isArray(j) || !j.length) return null;
    const la = Number(j[j.length - 1].longAccount);
    if (!Number.isFinite(la) || la <= 0 || la >= 1) return null;
    return { longAccount: la };
}

/** Contextul, din cache dacă e proaspăt. Nu aruncă niciodată. */
async function getContext(symbol, now = Date.now()) {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) return { oi: null, crowd: null, at: null };
    const hit = _cache.get(sym);
    if (hit && now - hit.at < TTL_MS) return hit;

    const [oi, crowd] = await Promise.all([_oi(sym), _crowd(sym)]);
    // Dacă amândouă au picat, PĂSTRĂM ce aveam în loc să ştergem: un context de
    // acum 7 minute e mult mai bun decât niciun context, şi e marcat cu ora lui.
    if (!oi && !crowd && hit) return hit;
    const fresh = { at: now, oi, crowd };
    _cache.set(sym, fresh);
    return fresh;
}

function _resetForTest() { _cache.clear(); }

module.exports = { getContext, TTL_MS, _resetForTest };
