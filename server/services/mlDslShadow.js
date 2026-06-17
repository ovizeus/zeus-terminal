// server/services/mlDslShadow.js
// SHADOW glue: builds policy features from a live position + holds the latest proposal
// per posId for the read-only API. NEVER mutates the position or its SL.
'use strict';
const _proposals = new Map(); // posId(string) → proposal

function buildFeatures(pos, price, extra) {
  const side = pos.side === 'SHORT' ? 'SHORT' : 'LONG';
  const entry = +pos.price || 0;
  const p = Number.isFinite(price) ? price : entry;
  const mx = Number.isFinite(+pos._maxPrice) ? +pos._maxPrice : p;
  const mn = Number.isFinite(+pos._minPrice) ? +pos._minPrice : p;
  const mfe = side === 'LONG' ? (mx - entry) : (entry - mn);
  const mae = side === 'LONG' ? (entry - mn) : (mx - entry);
  const e = extra || {};
  return {
    side, entry, price: p,
    mfePct: entry > 0 ? Math.max(0, mfe) / entry * 100 : 0,
    maePct: entry > 0 ? Math.max(0, mae) / entry * 100 : 0,
    momentum: Number.isFinite(e.momentum) ? e.momentum : 0,
    atrPct: Number.isFinite(e.atrPct) ? e.atrPct : 1.0,
    regime: e.regime || pos.regime || 'unknown',
    secsInTrade: pos.ts ? Math.round((Date.now() - pos.ts) / 1000) : 0,
    progress: Number.isFinite(e.progress) ? e.progress : 0,
  };
}
function record(posId, proposal) { _proposals.set(String(posId), proposal); }
function remove(posId) { _proposals.delete(String(posId)); }
function snapshot() { const o = {}; for (const [k, v] of _proposals) o[k] = v; return o; }
module.exports = { buildFeatures, record, remove, snapshot };
