'use strict';

// Estimated round-trip taker fee from notional (used only when a real fill fee
// is not stored). Default Binance USDT-M taker 0.04% x2.
function estimateFee(notional, roundTrips = 2, takerRate = 0.0004) {
  const n = Number(notional);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) * takerRate * roundTrips;
}

// Reliable epoch-ms: legacy values below 1e12 are seconds. Junk -> null.
function _normalizeTs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function _windowStart(window, now) {
  if (window === 'today') return now - 86400000;
  if (window === '7d') return now - 7 * 86400000;
  if (window === '30d') return now - 30 * 86400000;
  return 0; // 'all' / default
}

module.exports = { estimateFee, _normalizeTs, _windowStart };
