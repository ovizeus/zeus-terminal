'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// OKX — lichidari publice: marimea vine in CONTRACTE, nu in monede
// ═══════════════════════════════════════════════════════════════════════════
//
// [2026-11-14] Canalul `liquidation-orders` da `sz` in contracte, iar valoarea
// unui contract (`ctVal`) difera de la o moneda la alta:
//
//     BTC-USDT-SWAP → 0.01 BTC     ETH → 0.1 ETH     SOL → 1 SOL
//     XRP → 100 XRP                DOGE → 1000 DOGE
//
// Pana azi `_normalizeOkx` socotea `pret × sz`, ca si cum un contract ar fi o
// moneda. Masurat in `liq_events`, pe 24 de ore de BTC:
//
//     bybit  5.355 lichidari   medie 0,153 BTC   10.142 $
//     gate   3.405 lichidari   medie 0,207 BTC   13.777 $
//     okx    1.216 lichidari   medie 25,1 „BTC"  1.664.494 $   ← de 100×
//
// Adica 2,02 miliarde $ din cei „2,14 miliarde $ lichidati in 24h" de pe LIQ
// MAP erau umflatura. Pe ETH era de 10×; pe DOGE invers, de 1000× prea putin.
// Aceeasi clasa de cifra-fantoma pentru care `liqGate.js` arunca evenimentele
// fara multiplicator — doar ca OKX fusese scris inaintea acelei lectii.
//
// Reguli, ca la Gate:
//   - fara `ctVal` cunoscut, evenimentul se ARUNCA. Nu se ghiceste cu 1.
//   - contractele INVERSE (BTC-USD-SWAP) au `ctVal` in dolari (100 $), deci
//     acolo valoarea e `sz × ctVal`, iar cantitatea se scoate din pret.

const INSTRUMENTS_URL = 'https://www.okx.com/api/v5/public/instruments?instType=SWAP';
const REFRESH_MS = 6 * 3600 * 1000;

// instId → { ctVal, inverse }
let _inst = Object.create(null);
let _loadedAt = 0;

/** `BTC-USDT-SWAP` → `BTCUSDT` (si contractele pe USD/USDC ale aceleiasi monede). */
function toSymbol(instId) {
    if (typeof instId !== 'string') return null;
    const parts = instId.trim().toUpperCase().split('-');
    if (parts.length < 2 || !/^[A-Z0-9]+$/.test(parts[0])) return null;
    return parts[0] + 'USDT';
}

/**
 * Normalizeaza un eveniment OKX (deja aplatizat: instId + side/sz/bkPx/ts).
 * Intoarce null pentru orice nu poate fi calculat CORECT.
 */
function normalize(d) {
    try {
        if (!d || typeof d !== 'object') return null;
        const instId = typeof d.instId === 'string' ? d.instId.trim().toUpperCase() : null;
        if (!instId) return null;
        const symbol = toSymbol(instId);
        if (!symbol) return null;
        const meta = _inst[instId];
        if (!meta || !(meta.ctVal > 0)) return null;        // fara ctVal nu inventam
        const rawSide = typeof d.side === 'string' ? d.side.toLowerCase() : null;
        if (rawSide !== 'buy' && rawSide !== 'sell') return null;
        const p = parseFloat(d.bkPx || d.markPx || 0);
        const sz = parseFloat(d.sz || 0);
        if (!Number.isFinite(p) || !Number.isFinite(sz) || p <= 0 || sz <= 0) return null;
        let q, vol;
        if (meta.inverse) { vol = sz * meta.ctVal; q = vol / p; }
        else { q = sz * meta.ctVal; vol = q * p; }
        if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(vol) || vol <= 0) return null;
        const side = rawSide === 'sell' ? 'SELL' : 'BUY';
        const time = Number(d.ts) || Date.now();
        return { exchange: 'okx', symbol, side, isLong: side === 'SELL', p, q, vol, time };
    } catch (_) {
        return null;
    }
}

function instrumentCount() { return Object.keys(_inst).length; }
function loadedAt() { return _loadedAt; }
function needsRefresh() { return !_loadedAt || (Date.now() - _loadedAt) > REFRESH_MS; }

/** Din raspunsul OKX, harta instId → { ctVal, inverse }. Functie pura. */
function parseInstruments(json) {
    const out = Object.create(null);
    const list = json && Array.isArray(json.data) ? json.data : [];
    for (const x of list) {
        const id = x && typeof x.instId === 'string' ? x.instId.trim().toUpperCase() : '';
        const ctVal = Number(x && x.ctVal);
        const mult = x && x.ctMult !== undefined && x.ctMult !== '' ? Number(x.ctMult) : 1;
        if (!id || !Number.isFinite(ctVal) || ctVal <= 0 || !Number.isFinite(mult) || mult <= 0) continue;
        const type = String(x.ctType || '').toLowerCase();
        if (type !== 'linear' && type !== 'inverse') continue;
        out[id] = { ctVal: ctVal * mult, inverse: type === 'inverse' };
    }
    return out;
}

/** Aduce contractele. Nu arunca: daca pica, ramane harta veche si se reincearca. */
async function loadInstruments(fetchImpl) {
    try {
        const f = fetchImpl || globalThis.fetch;
        if (typeof f !== 'function') return 0;
        const r = await f(INSTRUMENTS_URL);
        if (!r || !r.ok) return 0;
        const next = parseInstruments(await r.json());
        if (!Object.keys(next).length) return 0;
        _inst = next;
        _loadedAt = Date.now();
        return Object.keys(_inst).length;
    } catch (_) {
        return 0;
    }
}

/** Valoarea unui contract LINIAR pe USDT pentru un simbol (`BTCUSDT` → 0.01), sau null. */
function linearCtValOf(symbol) {
    const base = String(symbol || '').toUpperCase().replace(/USDT$/, '');
    const m = base ? _inst[base + '-USDT-SWAP'] : null;
    return m && !m.inverse && m.ctVal > 0 ? m.ctVal : null;
}

function _setInstrumentsForTest(map) {
    _inst = Object.create(null);
    for (const k in map) {
        const v = map[k];
        _inst[k.toUpperCase()] = typeof v === 'number' ? { ctVal: v, inverse: false } : { ctVal: v.ctVal, inverse: !!v.inverse };
    }
    _loadedAt = Date.now();
}

module.exports = {
    toSymbol, normalize, parseInstruments, loadInstruments, needsRefresh,
    instrumentCount, loadedAt, linearCtValOf, _setInstrumentsForTest, INSTRUMENTS_URL,
};
