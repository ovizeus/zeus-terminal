#!/usr/bin/env node
// Offline estimate: would the v1 looser/adaptive trail beat the baseline DSL on
// realised payoff? Excursion-based (uses at_closed _min/_maxPrice). READ-ONLY.
'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '..', 'data', 'zeus.db'), { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT data FROM at_closed WHERE data IS NOT NULL").all(); db.close();
const since = Date.now() - 21 * 86400000;
const T = [];
for (const r of rows) {
  let o; try { o = JSON.parse(r.data); } catch (_) { continue; }
  const pnl = Number(o.closePnl); if (!Number.isFinite(pnl)) continue;
  const ts = Number(o.closeTs || o.ts) || 0; if (ts && ts < since) continue;
  if (!o.autoTrade || !(o.mode === 'live' && String(o.env).toUpperCase() === 'TESTNET')) continue;
  if (String(o.closeReason || '').startsWith('ENTRY_FAILED')) continue;
  const entry = +(o.originalEntry || o.price || o.entry), qty = +o.qty, side = (o.side || '').toUpperCase();
  const mx = +o._maxPrice, mn = +o._minPrice;
  if (!(entry > 0) || !(qty > 0) || !(mx > 0) || !(mn > 0)) continue;
  const mfeUsd = Math.max(0, side === 'LONG' ? (mx - entry) : (entry - mn)) * qty;
  T.push({ pnl, mfeUsd, win: pnl > 0 });
}
const f = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const base = T.reduce((a, t) => a + t.pnl, 0);
const winsMfe = T.filter(t => t.win).reduce((a, t) => a + t.mfeUsd, 0);
const winsReal = T.filter(t => t.win).reduce((a, t) => a + t.pnl, 0);
console.log(`DSL replay (excursion est., ${T.length} trades): baseline P&L=${f(base)}`);
for (const cap of [0.4, 0.5, 0.6, 0.7]) {
  const added = (winsMfe - winsReal) * cap;
  console.log(`  if looser trail captures ${cap * 100}% of winners' MFE gap → est. P&L ${f(base + added)}`);
}
console.log('NB: excursion-ceiling estimate (optimistic; ignores winners that flip to losses). Real Δ measured by testnet A/B via scripts/pnl-testnet-track.js.');
