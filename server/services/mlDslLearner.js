// server/services/mlDslLearner.js
// ML-DSL learner: on each closed trade, reward = advantage of the ML-driven DSL over
// the baseline preset (counterfactual). Updates the per-arm Thompson bandit and
// persists the outcome. db injectable (defaults to live singleton). Telemetry-safe.
'use strict';
const bandit = require('./mlDslBandit');
let _db = null;
function _getDb() { return _db || require('./database').db; }
function _setDb(db) { _db = db; bandit._setDb(db); } // test hook — wires the bandit too

function cellKey(ctx) {
  return `${ctx.userId}:${ctx.env || 'TESTNET'}:${ctx.symbol || '?'}:${ctx.regime || 'unknown'}`;
}
function reward(outcome, baseline) {
  const a = (Number(outcome && outcome.pnlPct) || 0) - (Number(baseline && baseline.pnlPct) || 0);
  return { advantage: a, win: a > 0 };
}
function learn(rec) {
  try {
    const ck = cellKey(rec);
    const { advantage, win } = reward(rec.outcome, rec.baseline);
    if (rec.arm) bandit.update(ck, rec.arm, win);
    _getDb().prepare(`INSERT INTO ml_dsl_outcome (pos_id,user_id,env,symbol,regime,arm,cohort,ml_pnl_pct,baseline_pnl_pct,advantage,win,ts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      String(rec.posId), rec.userId, rec.env || null, rec.symbol || null, rec.regime || null,
      rec.arm || null, rec.cohort || null,
      Number(rec.outcome && rec.outcome.pnlPct) || 0, Number(rec.baseline && rec.baseline.pnlPct) || 0,
      advantage, win ? 1 : 0, rec.ts || Date.now());
    return { recorded: true, advantage, win };
  } catch (_) { return { recorded: false }; }
}
module.exports = { cellKey, reward, learn, _setDb };
