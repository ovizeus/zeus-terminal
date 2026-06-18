// server/services/seqAllocator.js
// Global atomic monotonic sequence allocator for AT position seqs. Replaces the prior
// per-user (++us.seq) + Date.now() seq generators, which collided with the GLOBAL
// at_closed.seq primary key (reuse → UNIQUE archive failure → vanish → orphan). Single
// source of truth: every issued seq is globally unique and strictly increasing. Initialized
// at boot above the global historical max (at_closed + at_positions + open positions).
'use strict';
let _seq = 0;
// Raise the counter to at least `floor` (never lowers). Call at boot with the global max.
function init(floor) { const f = Number(floor); if (Number.isFinite(f) && f > _seq) _seq = f; }
// Issue the next globally-unique seq (strictly increasing).
function next() { return ++_seq; }
function current() { return _seq; }
function _resetForTest(v) { _seq = Number(v) || 0; } // tests only
module.exports = { init, next, current, _resetForTest };
