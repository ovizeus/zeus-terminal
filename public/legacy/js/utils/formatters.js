// Zeus v122 — utils/formatters.js
// Number & date formatting — used for UI display
'use strict';

const fmt = n => { if (!Number.isFinite(+n)) return '—'; n = +n; return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0); };
const fP = n => { if (!Number.isFinite(+n)) return '—'; n = +n; if (n >= 10000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); if (n >= 100) return n.toFixed(2); if (n >= 1) return n.toFixed(4); if (n >= 0.01) return n.toFixed(5); return n.toPrecision(4); };
const _TZ = 'Europe/Bucharest';
const _dtfTime = new Intl.DateTimeFormat('ro-RO', { timeZone: _TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const _dtfTimeSec = new Intl.DateTimeFormat('ro-RO', { timeZone: _TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const _dtfDate = new Intl.DateTimeFormat('ro-RO', { timeZone: _TZ, day: '2-digit', month: 'short', year: '2-digit' });
const _dtfFull = new Intl.DateTimeFormat('ro-RO', { timeZone: _TZ, day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
