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
// [2026-11-04] CARE cohorte au voie sa antreneze bandit-ul. Lista e explicita si
// mica, si implicitul e „nu antrenez" — fail-closed.
//
// Bugul pe care il repara: pe ACEEASI pozitie se scriu doua randuri —
//   'shadow'      → outcome = PnL REALIZAT, baseline = sim(presetul care a rulat)
//   'shadow_geom' → outcome = sim(preset),  baseline = PnL REALIZAT
// Pentru presetul care a rulat, cele doua sunt EXACT oglinzi (masurat pe date
// vii: -0,15 vs +0,15 pe acelasi pos_id), si amandoua chemau `bandit.update` sub
// ACELASI nume de brat. `fast` primea 422 randuri negative + 144 pozitive si
// ajungea la 0,355, in timp ce `atr`/`swing`/`tp` primeau numai fluxul
// shadow_geom si stateau la ~0,92. Clasamentul bratelor era un ARTEFACT.
//
// 'shadow' nu masoara calitatea unei geometrii: compara realitatea cu
// RE-SIMULAREA ACELUIASI preset, adica optimismul simulatorului. Randul se scrie
// in continuare (masuratoarea e utila), doar nu mai antreneaza.
// 'lossside' trimitea deja `arm: null` exact din acest motiv.
// 'ml' = cohorta in care BANDIT-UL isi alege singur bratul (vezi
// `_resolveDslParams` pe ramura `feat/ml-dsl-v2-control`). Pe main nu se scrie
// inca, dar cand bucla se inchide alea sunt exact randurile care TREBUIE sa
// antreneze — altfel bandit-ul n-ar invata din propriile lui alegeri. Un test
// vechi (tests/unit/mlDslLearner.test.js, scris odata cu bandit-ul) a prins
// lipsa ei: testul avea dreptate, lista mea era incompleta.
const TRAINING_COHORTS = Object.freeze(['shadow_geom', 'mlctl', 'ml']);

function trainsBandit(cohort) {
  return TRAINING_COHORTS.indexOf(cohort) !== -1;
}

function learn(rec) {
  try {
    const ck = cellKey(rec);
    const { advantage, win } = reward(rec.outcome, rec.baseline);
    const _trains = !!rec.arm && trainsBandit(rec.cohort);
    // [2026-11-04] Recompensa pe care o primeste BANDIT-UL, cand exista un
    // clasament relativ pe urma asta (`relWin` de la dslGeomShadow): `win` e
    // `advantage > 0`, iar fata de baza comuna pe care toate presetele o bat,
    // `win` iese 1 pentru TOATE — saturare. `relWin` spune care brat a fost cel
    // mai bun PE ACEEASI urma, deci clasifica geometrii.
    //
    // Coloana `win` din tabel RAMANE `advantage > 0`: altfel cele 2.299 de
    // randuri vechi n-ar mai fi comparabile cu cele noi si nicio masuratoare pe
    // istoric n-ar mai sta. Doar antrenarea se schimba.
    const _rel = rec.relWin;
    const _banditWin = (_rel === 0 || _rel === 1) ? _rel === 1 : win;
    if (_trains) bandit.update(ck, rec.arm, _banditWin);
    _getDb().prepare(`INSERT INTO ml_dsl_outcome (pos_id,user_id,env,symbol,regime,arm,cohort,ml_pnl_pct,baseline_pnl_pct,advantage,win,ts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      String(rec.posId), rec.userId, rec.env || null, rec.symbol || null, rec.regime || null,
      rec.arm || null, rec.cohort || null,
      Number(rec.outcome && rec.outcome.pnlPct) || 0, Number(rec.baseline && rec.baseline.pnlPct) || 0,
      advantage, win ? 1 : 0, rec.ts || Date.now());
    return { recorded: true, advantage, win, trained: _trains };
  } catch (_) { return { recorded: false, trained: false }; }
}
module.exports = { cellKey, reward, learn, trainsBandit, TRAINING_COHORTS, _setDb };
