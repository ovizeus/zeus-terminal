'use strict';

/**
 * OMEGA R3A Safety — ergodicityAwareness (canonical §141)
 *
 * §141 ERGODICITY AWARENESS — diferenta dintre medie si traiectorie te
 * poate distruge.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 4707-4708.
 *
 * "Toata gestionarea riscului din spec — Kelly, Monte Carlo, liquidation
 *  surface, DRO — presupune implicit ca piata e ergodica: ca media pe multi
 *  participanti simultan echivaleaza cu media unui singur participant in
 *  timp. Pe futures crypto, nu e adevarat. Piata e profund non-ergodica: o
 *  secventa de pierderi reduce capitalul in moduri care nu se recupereaza
 *  prin mediere statistica. Un bot care pierde 30% nu are nevoie de +30%
 *  pentru recuperare — are nevoie de +43%... Ergodicity awareness inseamna
 *  ca sistemul identifica activ cand conditiile devin non-ergodice —
 *  volatilitate in expansiune brusca, drawdown secvential, leverage relativ
 *  crescut prin erodarea capitalului — si comuta intregul framework de
 *  risc: in loc de optimizare pe expected value, trece pe minimax survival...
 *  Nu e DRO care optimizeaza pentru cel mai rau scenariu distributional.
 *  E recunoasterea ca in sisteme non-ergodice, supravietuirea pe termen
 *  lung cere logica complet diferita fata de performanta pe termen scurt."
 *
 * Distinct from §246 ddRecoveryGraduated (post-incident ladder), §136
 * optionPreservationEngine (per-action cost), adversarialMonteCarlo (R-1
 * stress testing). §141 = SINGULAR non-ergodicity detector + framework
 * switcher în OMEGA.
 */

const { db } = require('../../database');

const REGIMES = Object.freeze([
    'ergodic_normal', 'non_ergodic_survival'
]);
const FRAMEWORK_MODES = Object.freeze([
    'expected_value', 'minimax_survival'
]);
const NON_ERGODICITY_THRESHOLD = 0.60;
const VOL_EXPANSION_THRESHOLD = 0.50;
const SEQUENTIAL_DD_THRESHOLD = 0.15;
const LEVERAGE_INCREASE_THRESHOLD = 0.30;

// Weights per PDF emphasis: "secventa de pierderi reduce capitalul in
// moduri care nu se recupereaza" — sequential_drawdown weighted highest.
const SIGNAL_WEIGHTS = Object.freeze({
    vol_expansion: 0.30,
    sequential_drawdown: 0.45,
    leverage_increase: 0.25
});

const _REGIME_TO_FRAMEWORK = Object.freeze({
    ergodic_normal: 'expected_value',
    non_ergodic_survival: 'minimax_survival'
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`ergodicityAwareness: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAssessment: db.prepare(`
        INSERT INTO ml_ergodicity_assessments
        (user_id, resolved_env, assessment_id,
         vol_expansion_rate, sequential_drawdown,
         relative_leverage_increase, non_ergodicity_score,
         regime, framework_mode, triggered_signals_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertTransition: db.prepare(`
        INSERT INTO ml_ergodicity_regime_transitions
        (user_id, resolved_env, transition_id,
         from_regime, to_regime, trigger_signals_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    latestAssessment: db.prepare(`
        SELECT * FROM ml_ergodicity_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT 1
    `),
    listAssessments: db.prepare(`
        SELECT * FROM ml_ergodicity_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeRecoveryRequired (pure) ─────────────────────────────────
// recovery = loss / (1 − loss). For 30% loss → 30/70 = 42.86%.
// Demonstrates non-ergodic asymmetry directly.
function computeRecoveryRequired(params) {
    const loss = _required(params, 'lossPercent');
    if (loss < 0 || loss > 1) {
        throw new Error(
            'ergodicityAwareness: lossPercent must be in [0,1]'
        );
    }
    if (loss === 1) {
        throw new Error(
            'ergodicityAwareness: cannot recover from total loss (lossPercent=1.0)'
        );
    }
    return { recoveryRequired: loss / (1 - loss) };
}

// ── computeNonErgodicityScore (pure) ───────────────────────────────
// Weighted blend of 3 signals, each normalized vs threshold:
// signal_normalized = min(1, value/threshold)
function computeNonErgodicityScore(params) {
    const vol = _required(params, 'volExpansionRate');
    const dd = _required(params, 'sequentialDrawdown');
    const lev = _required(params, 'relativeLeverageIncrease');

    if (dd < 0) {
        throw new Error(
            'ergodicityAwareness: sequentialDrawdown must be ≥ 0'
        );
    }

    const volN = Math.min(1, Math.max(0, vol) / VOL_EXPANSION_THRESHOLD);
    const ddN = Math.min(1, dd / SEQUENTIAL_DD_THRESHOLD);
    const levN = Math.min(1, Math.max(0, lev) / LEVERAGE_INCREASE_THRESHOLD);

    const score = volN * SIGNAL_WEIGHTS.vol_expansion +
                  ddN * SIGNAL_WEIGHTS.sequential_drawdown +
                  levN * SIGNAL_WEIGHTS.leverage_increase;
    return { nonErgodicityScore: Math.max(0, Math.min(1, score)) };
}

// ── classifyRegime (pure) ──────────────────────────────────────────
function classifyRegime(params) {
    const score = _required(params, 'nonErgodicityScore');
    if (score < 0 || score > 1) {
        throw new Error(
            'ergodicityAwareness: nonErgodicityScore must be in [0,1]'
        );
    }
    return {
        regime: score >= NON_ERGODICITY_THRESHOLD
            ? 'non_ergodic_survival'
            : 'ergodic_normal'
    };
}

// ── selectFrameworkMode (pure) ─────────────────────────────────────
function selectFrameworkMode(params) {
    const regime = _required(params, 'regime');
    if (!REGIMES.includes(regime)) {
        throw new Error(
            `ergodicityAwareness: invalid regime "${regime}"`
        );
    }
    return { frameworkMode: _REGIME_TO_FRAMEWORK[regime] };
}

// ── computeTriggeredSignals (pure) ─────────────────────────────────
function computeTriggeredSignals(params) {
    const vol = _required(params, 'volExpansionRate');
    const dd = _required(params, 'sequentialDrawdown');
    const lev = _required(params, 'relativeLeverageIncrease');
    const triggered = [];
    if (vol >= VOL_EXPANSION_THRESHOLD) triggered.push('vol_expansion');
    if (dd >= SEQUENTIAL_DD_THRESHOLD) triggered.push('sequential_drawdown');
    if (lev >= LEVERAGE_INCREASE_THRESHOLD) triggered.push('leverage_increase');
    return { triggeredSignals: triggered };
}

// ── recordErgodicityAssessment (integration) ───────────────────────
function recordErgodicityAssessment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const assessmentId = _required(params, 'assessmentId');
    const vol = _required(params, 'volExpansionRate');
    const dd = _required(params, 'sequentialDrawdown');
    const lev = _required(params, 'relativeLeverageIncrease');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (dd < 0) {
        throw new Error(
            'ergodicityAwareness: sequentialDrawdown must be ≥ 0'
        );
    }

    const { nonErgodicityScore } = computeNonErgodicityScore({
        volExpansionRate: vol,
        sequentialDrawdown: dd,
        relativeLeverageIncrease: lev
    });
    const { regime } = classifyRegime({ nonErgodicityScore });
    const { frameworkMode } = selectFrameworkMode({ regime });
    const { triggeredSignals } = computeTriggeredSignals({
        volExpansionRate: vol,
        sequentialDrawdown: dd,
        relativeLeverageIncrease: lev
    });

    try {
        _stmts.insertAssessment.run(
            userId, env, assessmentId, vol, dd, lev,
            nonErgodicityScore, regime, frameworkMode,
            JSON.stringify(triggeredSignals), ts
        );
        return {
            recorded: true, assessmentId,
            nonErgodicityScore, regime, frameworkMode,
            triggeredSignals
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `ergodicityAwareness: duplicate assessmentId "${assessmentId}"`
            );
        }
        throw err;
    }
}

// ── recordRegimeTransition ─────────────────────────────────────────
function recordRegimeTransition(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const transitionId = _required(params, 'transitionId');
    const fromRegime = _required(params, 'fromRegime');
    const toRegime = _required(params, 'toRegime');
    const signals = _required(params, 'triggerSignals');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!REGIMES.includes(fromRegime)) {
        throw new Error(
            `ergodicityAwareness: invalid fromRegime "${fromRegime}"`
        );
    }
    if (!REGIMES.includes(toRegime)) {
        throw new Error(
            `ergodicityAwareness: invalid toRegime "${toRegime}"`
        );
    }
    if (!Array.isArray(signals)) {
        throw new Error(
            'ergodicityAwareness: triggerSignals must be array'
        );
    }
    try {
        _stmts.insertTransition.run(
            userId, env, transitionId, fromRegime, toRegime,
            JSON.stringify(signals), ts
        );
        return { recorded: true, transitionId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `ergodicityAwareness: duplicate transitionId "${transitionId}"`
            );
        }
        throw err;
    }
}

function _rowToAssessment(r) {
    return {
        assessmentId: r.assessment_id,
        volExpansionRate: r.vol_expansion_rate,
        sequentialDrawdown: r.sequential_drawdown,
        relativeLeverageIncrease: r.relative_leverage_increase,
        nonErgodicityScore: r.non_ergodicity_score,
        regime: r.regime,
        frameworkMode: r.framework_mode,
        triggeredSignals: JSON.parse(r.triggered_signals_json),
        ts: r.ts
    };
}

// ── getLatestAssessment ────────────────────────────────────────────
function getLatestAssessment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const r = _stmts.latestAssessment.get(userId, env);
    if (!r) return null;
    return _rowToAssessment(r);
}

// ── getRegimeHistory ───────────────────────────────────────────────
function getRegimeHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;
    const rows = _stmts.listAssessments.all(userId, env, limit);
    return rows.map(_rowToAssessment);
}

module.exports = {
    REGIMES,
    FRAMEWORK_MODES,
    NON_ERGODICITY_THRESHOLD,
    VOL_EXPANSION_THRESHOLD,
    SEQUENTIAL_DD_THRESHOLD,
    LEVERAGE_INCREASE_THRESHOLD,
    SIGNAL_WEIGHTS,
    computeRecoveryRequired,
    computeNonErgodicityScore,
    classifyRegime,
    selectFrameworkMode,
    computeTriggeredSignals,
    recordErgodicityAssessment,
    recordRegimeTransition,
    getLatestAssessment,
    getRegimeHistory
};
