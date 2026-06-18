// server/services/priceTrace.js
// Per-position price-path recorder for ML-DSL counterfactual replay. In-memory,
// throttled, capped. No I/O, never mutates positions.
'use strict';
const THROTTLE_MS = 250;   // one sample per quarter-second max
const CAP = 2000;          // ring-buffer cap per position
const _traces = new Map(); // posId(string) → { samples:[{p,ts}], lastTs }

function record(posId, price, ts) {
  if (!Number.isFinite(price) || !Number.isFinite(ts)) return;
  const id = String(posId);
  let t = _traces.get(id);
  if (!t) { t = { samples: [], lastTs: -Infinity }; _traces.set(id, t); }
  if (ts - t.lastTs < THROTTLE_MS) return;
  t.lastTs = ts;
  t.samples.push({ p: price, ts });
  if (t.samples.length > CAP) t.samples.shift();
}
function get(posId) { const t = _traces.get(String(posId)); return t ? t.samples.slice() : []; }
function clear(posId) { _traces.delete(String(posId)); }
module.exports = { record, get, clear, THROTTLE_MS, CAP };
