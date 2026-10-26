'use strict';
// ══════════════════════════════════════════════════════════════════
// BOOKMAP — fluxul: de unde vine cartea de ordine şi la ce cost
// ══════════════════════════════════════════════════════════════════
//
// [BOOKMAP 2026-10-26] Două surse, şi sunt ţinute SEPARAT dinadins.
//
// ⚠️ DE CE NU SE AMESTECĂ, fiindcă ar fi o minciună subtilă şi greu de prins:
//
//   WS  `depth20@100ms` → 40 de niveluri, bandă ±0,005%, un cadru la 100 ms
//   REST `depth?limit=1000` → 2000 de niveluri, bandă ±0,155%, 92 M$
//
// Dacă le-aş pune în aceeaşi medie, rândurile de LÂNGĂ preţ ar primi contribuţii
// din amândouă, iar cele depărtate numai din REST. Densitatea desenată ar depinde
// de PROPORŢIA cadrelor, nu de piaţă — adică harta ar arăta un gât îngroşat la
// mijloc care nu există. Deci:
//
//   • HARTA (timp × preţ) se desenează NUMAI din cadrele REST — bandă completă,
//     cadru consistent, un singur „acum" pe toată lăţimea.
//   • WS alimentează banda de sus: spread, cea mai bună cerere/ofertă, tempo.
//     Acolo e util tocmai fiindcă e rapid, şi nu intră în medii.
//
// ⚠️ MULTIPLICATOR: Binance dă cantitatea în BTC/ETH (verificat: baseAsset BTC,
// qtyStep 0,001) ⇒ mult = 1, trecut EXPLICIT. Nu există implicit — pe OKX ar
// însemna de 100× (ctVal 0,01), şi bookMap.normalize aruncă un cadru fără
// multiplicator cunoscut. Aceeaşi lecţie ca Gate la lichidări.
//
// ⚠️ COSTUL DE RATĂ, măsurat înainte: Binance raporta 748 din 2400 greutate/min
// cu Zeus în funcţiune (31%). `limit=1000` are greutate 20; la 5 s pe două
// simboluri = 480/min (20%), deci total ~51%. Am loc, dar nu nelimitat — de asta
// ritmul se ÎNCETINEŞTE singur când greutatea raportată de Binance urcă.
//
// ⚠️ OKX şi Bybit NU sunt aici, şi e o alegere: amândouă trimit instantaneu
// apoi DIFERENŢE, deci ar cere o carte locală reconstruită cu verificare de
// secvenţă şi resincronizare pe gaură. O carte reconstruită greşit e o hartă
// care minte. Prefer o sursă corectă decât trei aproximative. Etapa 2.

const logger = require('./logger');
const BM = require('./bookMap');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const BINANCE_WS = 'wss://fstream.binance.com/stream?streams=';
const BINANCE_REST = 'https://fapi.binance.com';

const DEEP_LIMIT = 1000;          // greutate 20, bandă ±0,155%
const DEEP_MS = 5000;             // pe simbol
const DEEP_MS_SLOW = 20000;       // când greutatea raportată urcă
const WEIGHT_SLOW_AT = 1700;      // din 2400
const WS_SAMPLE_MS = 1000;        // 10 cadre/s → 1, restul se aruncă
const RING_MS = 12 * 60000;
const RING_MAX = 400;             // plafon dur de memorie, per simbol
const TOP_MAX = 120;

const _deep = new Map();          // symbol -> [frame]
const _top = new Map();           // symbol -> [frame] (WS, doar banda de sus)
const _lastWs = new Map();        // symbol -> ts ultimul cadru păstrat
let _ws = null, _wsTimer = null, _deepTimer = null, _stopped = true;
let _usedWeight = 0, _wsFrames = 0, _wsKept = 0, _deepOk = 0, _deepFail = 0;

function _push(map, symbol, frame, maxN) {
    if (!frame) return;
    let arr = map.get(symbol);
    if (!arr) { arr = []; map.set(symbol, arr); }
    arr.push(frame);
    const cutoff = frame.ts - RING_MS;
    while (arr.length && (arr[0].ts < cutoff || arr.length > maxN)) arr.shift();
}

// ── WS: banda de sus, rapidă ──────────────────────────────────────
function _connectWs() {
    if (_stopped) return;
    let WebSocket;
    try { WebSocket = require('ws'); } catch (e) {
        logger.warn('BOOKMAP', 'ws module missing: ' + e.message);
        return;
    }
    const streams = SYMBOLS.map(s => s.toLowerCase() + '@depth20@100ms').join('/');
    try { _ws = new WebSocket(BINANCE_WS + streams); }
    catch (e) { logger.warn('BOOKMAP', 'ws connect failed: ' + e.message); return _retryWs(); }

    _ws.on('open', () => logger.info('BOOKMAP', 'ws open — ' + streams));
    _ws.on('message', (raw) => {
        _wsFrames++;
        let j; try { j = JSON.parse(raw.toString()); } catch (_) { return; }
        const d = j && j.data ? j.data : j;
        if (!d || !d.s) return;
        const sym = String(d.s).toUpperCase();
        if (!SYMBOLS.includes(sym)) return;
        const now = Date.now();
        // Subeşantionare: 10 cadre/s × 2 simboluri ar fi 1200 pe minut în RAM
        // pentru nimic — banda de sus se citeşte cu ochiul, nu la 100 ms.
        if (now - (_lastWs.get(sym) || 0) < WS_SAMPLE_MS) return;
        _lastWs.set(sym, now);
        const f = BM.normalize({
            exchange: 'binance', symbol: sym, ts: now,
            bids: d.b, asks: d.a, mult: 1,     // Binance: cantitate în BTC/ETH
        });
        if (f) { f.src = 'ws'; _push(_top, sym, f, TOP_MAX); _wsKept++; }
    });
    _ws.on('error', (e) => logger.warn('BOOKMAP', 'ws error: ' + e.message));
    _ws.on('close', () => { if (!_stopped) _retryWs(); });
}

function _retryWs() {
    if (_stopped || _wsTimer) return;
    _wsTimer = setTimeout(() => { _wsTimer = null; _connectWs(); }, 15000);
    if (_wsTimer.unref) _wsTimer.unref();
}

// ── REST: harta, adâncă şi consistentă ────────────────────────────
async function _fetchDeep(symbol) {
    const url = `${BINANCE_REST}/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${DEEP_LIMIT}`;
    try {
        const res = await require('./binanceGateway').fetch(url, {
            signal: AbortSignal.timeout(9000), __src: 'bookmap:depth', __weight: 20,
        });
        if (!res || !res.ok) { _deepFail++; return null; }
        // Greutatea raportată de BINANCE, nu estimată de mine.
        try {
            const w = Number(res.headers && res.headers.get && res.headers.get('x-mbx-used-weight-1m'));
            if (Number.isFinite(w) && w > 0) _usedWeight = w;
        } catch (_) {}
        const j = await res.json();
        const f = BM.normalize({
            exchange: 'binance', symbol, ts: Date.now(),
            bids: j.bids, asks: j.asks, mult: 1,
        });
        if (f) { f.src = 'rest'; f.levels = (j.bids || []).length + (j.asks || []).length; _deepOk++; }
        return f;
    } catch (_) { _deepFail++; return null; }
}

async function _deepTick() {
    for (const sym of SYMBOLS) {
        const f = await _fetchDeep(sym);
        if (f) _push(_deep, sym, f, RING_MAX);
    }
    // Ritm adaptiv: dacă Binance spune că greutatea e sus, ne dăm la o parte.
    // Mai bine o hartă cu coloane mai rare decât un ban pe tot Zeus.
    const next = _usedWeight >= WEIGHT_SLOW_AT ? DEEP_MS_SLOW : DEEP_MS;
    if (!_stopped) {
        _deepTimer = setTimeout(() => { _deepTick().catch(() => {}); }, next);
        if (_deepTimer.unref) _deepTimer.unref();
    }
}

/** Cadrele ADÂNCI (REST) — singurele din care se desenează harta. */
function deepFrames(symbol) { return (_deep.get(String(symbol || '').toUpperCase()) || []).slice(); }

/** Cadrele RAPIDE (WS) — numai pentru banda de sus. NU intră în medii. */
function topFrames(symbol) { return (_top.get(String(symbol || '').toUpperCase()) || []).slice(); }

function health() {
    const per = {};
    for (const s of SYMBOLS) {
        per[s] = { deep: (_deep.get(s) || []).length, top: (_top.get(s) || []).length };
    }
    return {
        running: !_stopped, usedWeight1m: _usedWeight || null,
        wsFrames: _wsFrames, wsKept: _wsKept, deepOk: _deepOk, deepFail: _deepFail,
        deepIntervalMs: _usedWeight >= WEIGHT_SLOW_AT ? DEEP_MS_SLOW : DEEP_MS,
        symbols: per,
    };
}

function start() {
    if (!_stopped) return;
    _stopped = false;
    _connectWs();
    const t0 = setTimeout(() => { _deepTick().catch(() => {}); }, 4000);
    if (t0.unref) t0.unref();
    logger.info('BOOKMAP', `started — deep ${DEEP_LIMIT} levels every ${DEEP_MS / 1000}s, ws top sampled ${WS_SAMPLE_MS}ms`);
}

function stop() {
    _stopped = true;
    if (_wsTimer) { clearTimeout(_wsTimer); _wsTimer = null; }
    if (_deepTimer) { clearTimeout(_deepTimer); _deepTimer = null; }
    if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
    _deep.clear(); _top.clear(); _lastWs.clear();
}

module.exports = {
    start, stop, health, deepFrames, topFrames, SYMBOLS,
    DEEP_LIMIT, DEEP_MS, DEEP_MS_SLOW, WEIGHT_SLOW_AT, WS_SAMPLE_MS, RING_MS, RING_MAX, TOP_MAX,
};
