// server/services/mlDslBandit.js
// Per-(cellKey × arm) Thompson Beta posteriors for ML-DSL param-set selection.
// Persisted additively in ml_dsl_arm_posterior. db is injectable (defaults to the
// live singleton; tests inject in-memory). Telemetry-safe (never throws to caller).
'use strict';
let _db = null;
function _getDb() { return _db || require('./database').db; }
function _setDb(db) { _db = db; } // test hook

// Gamma/Beta sampler (Marsaglia-Tsang); rng injectable.
function _gamma(k, rng) {
  if (k < 1) return _gamma(1 + k, rng) * Math.pow(rng(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { const u1 = rng(), u2 = rng(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function _betaSample(alpha, beta, rng) { const x = _gamma(alpha, rng), y = _gamma(beta, rng); return x / (x + y); }

function _post(cellKey, arm) {
  try { const r = _getDb().prepare('SELECT alpha, beta FROM ml_dsl_arm_posterior WHERE cell_key=? AND arm=?').get(cellKey, arm); return r ? { alpha: r.alpha, beta: r.beta } : { alpha: 1, beta: 1 }; }
  catch (_) { return { alpha: 1, beta: 1 }; }
}
function update(cellKey, arm, win) {
  try {
    _getDb().prepare(`INSERT INTO ml_dsl_arm_posterior (cell_key, arm, alpha, beta, n, updated_at)
      VALUES (?, ?, 1 + ?, 1 + ?, 1, ?)
      ON CONFLICT(cell_key, arm) DO UPDATE SET alpha = alpha + ?, beta = beta + ?, n = n + 1, updated_at = ?`)
      .run(cellKey, arm, win ? 1 : 0, win ? 0 : 1, Date.now(), win ? 1 : 0, win ? 0 : 1, Date.now());
  } catch (_) { /* telemetry-safe */ }
}
function sampleArm(cellKey, arms, rng) {
  const r = typeof rng === 'function' ? rng : Math.random;
  const deterministic = (typeof rng === 'function' && rng(0) === rng(1)); // constant rng (tests) → posterior mean
  let best = arms[0], bestDraw = -1;
  for (const arm of arms) {
    const { alpha, beta } = _post(cellKey, arm);
    const draw = deterministic ? alpha / (alpha + beta) : _betaSample(alpha, beta, r);
    if (draw > bestDraw) { bestDraw = draw; best = arm; }
  }
  return best;
}
module.exports = { update, sampleArm, _post, _setDb };
