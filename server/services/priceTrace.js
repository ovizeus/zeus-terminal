// server/services/priceTrace.js
// Per-position price-path recorder for ML-DSL counterfactual replay. In-memory,
// throttled, capped. No I/O, never mutates positions.
//
// [ML-DSL real measurement] Each price sample also carries the ML policy's latest
// proposal (plPct/prPct/ivPct/action) via recordMl(), so the close-time learner can
// replay serverDSL.simulateMlPath() over the real (price, ml) path — the faithful
// counterfactual of the ML actually driving the DSL pivots in real-time. Samples
// recorded before any recordMl() carry ml:null (backward compatible).
'use strict';
const THROTTLE_MS = 250;   // one sample per quarter-second max
const CAP = 2000;          // ring-buffer cap per position
const _traces = new Map(); // posId(string) → { samples:[{p,ts,ml}], lastTs, currentMl }

// Validate an ML proposal into a plain {plPct,prPct,ivPct,action} record (or null).
function _sanitizeMl(ml) {
  if (!ml || typeof ml !== 'object') return null;
  const pl = +ml.plPct, pr = +ml.prPct, iv = +ml.ivPct;
  if (!Number.isFinite(pl) || !Number.isFinite(pr) || !Number.isFinite(iv)) return null;
  return { plPct: pl, prPct: pr, ivPct: iv, action: ml.action ? String(ml.action).toUpperCase() : 'HOLD' };
}

function _ensure(id) {
  let t = _traces.get(id);
  if (!t) { t = { samples: [], lastTs: -Infinity, currentMl: null }; _traces.set(id, t); }
  return t;
}

function record(posId, price, ts) {
  if (!Number.isFinite(price) || !Number.isFinite(ts)) return;
  const t = _ensure(String(posId));
  if (ts - t.lastTs < THROTTLE_MS) return;
  t.lastTs = ts;
  // Stamp a fresh copy of the latest ML proposal so later mutations can't alias it.
  const ml = t.currentMl ? { ...t.currentMl } : null;
  t.samples.push({ p: price, ts, ml });
  if (t.samples.length > CAP) t.samples.shift();
}

// Set the position's current ML proposal; subsequent record() samples carry it.
function recordMl(posId, ml) {
  const clean = _sanitizeMl(ml);
  if (!clean) return;
  _ensure(String(posId)).currentMl = clean;
}

function get(posId) { const t = _traces.get(String(posId)); return t ? t.samples.slice() : []; }
function clear(posId) { _traces.delete(String(posId)); }
module.exports = { record, recordMl, get, clear, THROTTLE_MS, CAP };
