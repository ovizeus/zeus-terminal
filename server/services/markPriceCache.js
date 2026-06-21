'use strict';
// Live markPrice cache. Binance's per-symbol markPrice@1s WebSocket (fstream) is BLOCKED at the
// Hetzner IP (frames=0), so we cannot receive the push stream. Instead we poll the REST
// /fapi/v1/premiumIndex endpoint — WITHOUT a symbol param it returns EVERY symbol's markPrice in a
// SINGLE call (weight 10) — at ~1s and cache it. Clients read it via GET /api/market/markprice to
// price open positions off the exchange's markPrice (matching Binance) instead of a slow lastPrice
// poll. Telemetry-only; never touches brain/trading execution.

const _cache = {}; // SYM -> { price, ts }
let _timer = null;

// Pure: parse a Binance premiumIndex array → { SYM: markPrice }, dropping invalid/non-positive.
function _parsePremiumIndex(arr) {
  const out = {};
  if (!Array.isArray(arr)) return out;
  for (const it of arr) {
    if (!it || !it.symbol) continue;
    const p = parseFloat(it.markPrice);
    if (Number.isFinite(p) && p > 0) out[String(it.symbol).toUpperCase()] = p;
  }
  return out;
}

async function _poll() {
  try {
    const res = await require('./binanceGateway').fetch(
      'https://fapi.binance.com/fapi/v1/premiumIndex',
      { signal: AbortSignal.timeout(4000), __weight: 10, __src: 'markprice-cache' }
    );
    if (!res || !res.ok) return;
    const arr = await res.json();
    const map = _parsePremiumIndex(arr);
    const now = Date.now();
    for (const sym of Object.keys(map)) _cache[sym] = { price: map[sym], ts: now };
  } catch (_) { /* best-effort; the gateway ban-gate prevents hammering a banned IP */ }
}

// Start the ~1s poller (idempotent).
function start(intervalMs = 1000) {
  if (_timer) return;
  _poll();
  _timer = setInterval(_poll, intervalMs);
  try { require('./logger').info('MARKPRICE', `markPrice cache poller started — premiumIndex every ${intervalMs}ms`); } catch (_) {}
}

function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

// Return { SYM: price } for the requested symbols (or all cached), excluding entries older than 15s.
function get(symbols) {
  const now = Date.now();
  const out = {};
  const syms = (Array.isArray(symbols) && symbols.length) ? symbols.map((s) => String(s).toUpperCase()) : Object.keys(_cache);
  for (const s of syms) { const e = _cache[s]; if (e && (now - e.ts) < 15000) out[s] = e.price; }
  return out;
}

module.exports = { start, stop, get, _parsePremiumIndex };
