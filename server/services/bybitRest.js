'use strict';

// ═══════════════════════════════════════════════════════════════════
// bybitRest — Bybit V5 public-market REST helpers (Phase B / Task B3b).
//
// Used as a FALLBACK source when Binance REST is IP-blocked from this host.
// Bybit does NOT block our datacenter IP (its WS feeds already flow), so its
// public REST works here. We normalize responses to the Binance shape the
// client already consumes, so no client changes are needed.
//
// Routes through binanceGateway (which recognizes bybit → bybit pool) for
// rate-limit + circuit-breaker hygiene. Public market data only — no signing.
// ═══════════════════════════════════════════════════════════════════

const gateway = require('./binanceGateway');

const BYBIT_REST = 'https://api.bybit.com';

// Binance interval string → Bybit V5 interval string.
const _BINANCE_TO_BYBIT_INTERVAL = Object.freeze({
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
    '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
    '1d': 'D', '1w': 'W', '1M': 'M',
});

function _toBybitInterval(binanceInterval) {
    if (!binanceInterval) return null;
    return _BINANCE_TO_BYBIT_INTERVAL[binanceInterval] || null;
}

// Bybit result.list rows: [startMs, open, high, low, close, volume, turnover] (strings),
// NEWEST-FIRST. Binance klines: [openTime(number), open, high, low, close, volume,
// closeTime, quoteVolume, ...], OLDEST-FIRST. Client reads indices 0..5.
function _normalizeKlines(bybitList) {
    if (!Array.isArray(bybitList)) return [];
    const out = [];
    for (const k of bybitList) {
        if (!Array.isArray(k) || k.length < 6) continue;
        const openTime = Number(k[0]);
        if (!Number.isFinite(openTime)) continue;
        // Binance-compatible 12-tuple; only 0..5 are consumed by the chart, the rest
        // are filled with sane values so any index access stays defined.
        out.push([
            openTime,           // 0 openTime
            k[1],               // 1 open
            k[2],               // 2 high
            k[3],               // 3 low
            k[4],               // 4 close
            k[5],               // 5 volume
            openTime,           // 6 closeTime (approx; client ignores)
            k[6] != null ? k[6] : '0', // 7 quoteVolume (Bybit turnover)
            0, '0', '0', '0',   // 8..11 trades/taker fields (unused)
        ]);
    }
    out.reverse(); // oldest-first to match Binance ordering
    return out;
}

// Fetch klines from Bybit REST, normalized to Binance array shape.
// Returns the array on success, or null on any failure (caller falls back further).
// Ultimul esec al rezervei, cu motiv. `fetchKlines` intorcea `null` din cinci
// locuri fara sa spuna din care: pe 11 nov 2026 graficul a ramas gol si logul
// nu avea nimic. Un succes sterge motivul.
let _lastKlineFailure = null;
function _failK(reason, detail) {
    _lastKlineFailure = { reason, at: Date.now(), detail: detail == null ? undefined : String(detail).slice(0, 160) };
    return null;
}
function lastKlineFailure() { return _lastKlineFailure; }

async function fetchKlines(symbol, binanceInterval, limit) {
    const bi = _toBybitInterval(binanceInterval);
    if (!symbol) return _failK('no_symbol');
    if (!bi) return _failK('unsupported_interval', binanceInterval);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000); // Bybit max 1000
    const url = `${BYBIT_REST}/v5/market/kline?category=linear`
        + `&symbol=${encodeURIComponent(symbol)}&interval=${bi}&limit=${lim}`;
    let res;
    try {
        res = await gateway.fetch(url, { __weight: 1, __src: 'bybit-kline-fallback' });
    } catch (e) { return _failK('network', e && e.message); }
    if (!res) return _failK('no_response');
    if (!res.ok) return _failK(res._reason ? String(res._reason) : 'http_' + (res.status || 0));
    let data;
    try { data = await res.json(); } catch (e) { return _failK('bad_json', e && e.message); }
    if (!data || data.retCode !== 0) return _failK('retCode_' + (data ? data.retCode : 'none'), data && data.retMsg);
    if (!data.result || !Array.isArray(data.result.list)) return _failK('bad_shape');
    const norm = _normalizeKlines(data.result.list);
    if (norm.length === 0) return _failK('empty');
    _lastKlineFailure = null;
    return norm;
}

// [Phase B / Task B5] Bybit tickers → Binance /ticker/24hr field shape so marketRadar's
// existing parser (reads .symbol/.lastPrice/.quoteVolume/.priceChangePercent) consumes it
// unchanged. Bybit price24hPcnt is a FRACTION (0.001797 = 0.18%); turnover24h = USD volume.
function _normalizeTickers(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const t of list) {
        if (!t || typeof t.symbol !== 'string') continue;
        const pctNum = parseFloat(t.price24hPcnt);
        out.push({
            symbol: t.symbol,
            lastPrice: t.lastPrice,
            quoteVolume: t.turnover24h,                       // USD traded → Binance quoteVolume
            priceChangePercent: Number.isFinite(pctNum) ? String(pctNum * 100) : '0',
            openInterest: t.openInterest,                     // base qty (radar enrichment)
            fundingRate: t.fundingRate,
        });
    }
    return out;
}

// Fetch the full linear-perp ticker universe from Bybit REST, normalized to the
// Binance /ticker/24hr field shape. Returns the array on success, null on failure.
async function fetchTickers() {
    const url = `${BYBIT_REST}/v5/market/tickers?category=linear`;
    let res;
    try {
        res = await gateway.fetch(url, { __weight: 1, __src: 'bybit-tickers-fallback' });
    } catch (_) { return null; }
    if (!res || !res.ok) return null;
    let data;
    try { data = await res.json(); } catch (_) { return null; }
    if (!data || data.retCode !== 0 || !data.result || !Array.isArray(data.result.list)) return null;
    const norm = _normalizeTickers(data.result.list);
    return norm.length > 0 ? norm : null;
}

module.exports = {
    fetchKlines,
    lastKlineFailure,
    fetchTickers,
    _test: { toBybitInterval: _toBybitInterval, normalizeKlines: _normalizeKlines, normalizeTickers: _normalizeTickers },
};
