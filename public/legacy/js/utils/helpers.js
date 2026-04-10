// Zeus v122 — utils/helpers.js
// DOM helpers & safe setters — used everywhere
'use strict';

// [P1] DOM-safe: returns null in headless (server) environment
const el = (typeof document !== 'undefined') ? (id => document.getElementById(id)) : (() => null);
// [FIX v85 B4] Helper pentru setare text sigură — previne erori de referință nulă
function safeSetText(id, val) { const e = el(id); if (e) e.textContent = val; }
function safeSetHTML(id, val) { const e = el(id); if (e) e.innerHTML = val; }

// [v105 FIX Bug6] escHtml — sanitizeaza campuri dinamice injectate in innerHTML
// Previne XSS daca un feed malformat trimite simboluri cu caractere speciale
function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.escHtml = escHtml;

// [PATCH1 B1] Central price validity check — rejects 0, NaN, null, undefined, negative, Infinity
function isValidMarketPrice(p) {
  return Number.isFinite(p) && p > 0;
}
window.isValidMarketPrice = isValidMarketPrice;

// [PATCH1 B5] Safe accessor for last kline — returns null if array empty
function safeLastKline() {
  if (!S || !Array.isArray(S.klines) || !S.klines.length) return null;
  return S.klines[S.klines.length - 1];
}
window.safeLastKline = safeLastKline;
