'use strict';

/**
 * OMEGA R5A Learning — conformalPrediction (canonical §67)
 *
 * §67 CONFORMAL PREDICTION / ABSTENTION BOUNDS.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1747-1781.
 *
 * "Calibrarea probabilistica spune cat de bine corespunde confidence-ul
 *  cu realitatea. Dar nu spune formal, pentru fiecare decizie individuala,
 *  cat de incert este cazul curent."
 *
 * R5A. Per-decision formal coverage check. Complement §20 calibration
 * (aggregate fit). §67 = per-case in-coverage-zone gate + NO_TRADE
 * fallback when ambiguous.
 *
 * Distinct per trading mode (scalp/intraday/swing/news_risk) and per
 * regime type. Calibration set built incrementally from historical
 * non-conformity scores.
 *
 * Coverage target default 90%: threshold = (1 - 0.90) quantile of
 * sorted nonconformity scores. New case in-coverage if its score
 * <= threshold.
 */

const { db } = require('../../database');

const TRADING_MODES = Object.freeze(['scalp', 'intraday', 'swing', 'news_risk']);
const DECISION_ACTIONS = Object.freeze(['TRADE', 'NO_TRADE', 'WAIT']);

const DEFAULT_COVERAGE_TARGET = 0.90;
const MIN_CALIBRATION_SAMPLES = 30;
const PREDICTION_SET_MAX_FOR_TRADE = 1;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`conformalPrediction: missing ${key}`);
    }
    return params[key];
}

function _quantile(sortedArr, q) {
    if (sortedArr.length === 0) return 0;
    const idx = Math.min(
        sortedArr.length - 1,
        Math.max(0, Math.floor(q * sortedArr.length))
    );
    return sortedArr[idx];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getCalibration: db.prepare(`
        SELECT * FROM ml_conformal_calibration
        WHERE user_id = ? AND resolved_env = ?
          AND trading_mode = ? AND regime_type = ?
    `),
    upsertCalibration: db.prepare(`
        INSERT INTO ml_conformal_calibration
        (user_id, resolved_env, trading_mode, regime_type,
         coverage_target, calibration_scores_json,
         n_calibration_samples, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, trading_mode, regime_type) DO UPDATE SET
            coverage_target = excluded.coverage_target,
            calibration_scores_json = excluded.calibration_scores_json,
            n_calibration_samples = excluded.n_calibration_samples,
            last_updated = excluded.last_updated
    `),
    insertDecision: db.prepare(`
        INSERT INTO ml_conformal_decisions
        (user_id, resolved_env, decision_id, trading_mode, regime_type,
         prediction_set_size, conformal_score, coverage_target,
         in_coverage_zone, decision_action, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    coverageStats: db.prepare(`
        SELECT regime_type,
               COUNT(*) AS total,
               SUM(in_coverage_zone) AS covered
        FROM ml_conformal_decisions
        WHERE user_id = ? AND resolved_env = ?
          AND trading_mode = ?
          AND ts >= ?
        GROUP BY regime_type
    `),
    decisionHistory: db.prepare(`
        SELECT * FROM ml_conformal_decisions
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR trading_mode = ?)
          AND (? = '' OR decision_action = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── updateCalibrationSet ───────────────────────────────────────────
function updateCalibrationSet(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const tradingMode = _required(params, 'tradingMode');
    const regimeType = _required(params, 'regimeType');
    const newScore = _required(params, 'newScore');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!TRADING_MODES.includes(tradingMode)) {
        throw new Error(`conformalPrediction: invalid tradingMode "${tradingMode}"`);
    }
    if (typeof newScore !== 'number' || newScore < 0) {
        throw new Error('conformalPrediction: newScore must be non-negative number');
    }

    const current = _stmts.getCalibration.get(userId, env, tradingMode, regimeType);
    let scores;
    let coverageTarget;

    if (current) {
        scores = JSON.parse(current.calibration_scores_json);
        coverageTarget = current.coverage_target;
    } else {
        scores = [];
        coverageTarget = DEFAULT_COVERAGE_TARGET;
    }

    scores.push(newScore);
    scores.sort((a, b) => a - b);

    _stmts.upsertCalibration.run(
        userId, env, tradingMode, regimeType,
        coverageTarget, JSON.stringify(scores),
        scores.length, ts
    );

    return { updated: true, samples: scores.length };
}

// ── evaluateConformalCoverage ──────────────────────────────────────
function evaluateConformalCoverage(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const tradingMode = _required(params, 'tradingMode');
    const regimeType = _required(params, 'regimeType');
    const predictionScore = _required(params, 'predictionScore');
    const predictionSetSize = _required(params, 'predictionSetSize');

    const current = _stmts.getCalibration.get(userId, env, tradingMode, regimeType);

    if (!current || current.n_calibration_samples < MIN_CALIBRATION_SAMPLES) {
        return {
            inCoverageZone: false,
            conformalScore: predictionScore,
            threshold: null,
            coverageTarget: current ? current.coverage_target : DEFAULT_COVERAGE_TARGET,
            action: 'NO_TRADE',
            reason: 'insufficient_calibration_samples',
            samples: current ? current.n_calibration_samples : 0
        };
    }

    const scores = JSON.parse(current.calibration_scores_json);
    // Threshold = upper-(1 - coverage) quantile.
    const quantileQ = current.coverage_target;
    const threshold = _quantile(scores, quantileQ);
    const inCoverageZone = predictionScore <= threshold;

    let action;
    if (!inCoverageZone) {
        action = 'NO_TRADE';
    } else if (predictionSetSize > PREDICTION_SET_MAX_FOR_TRADE) {
        action = predictionSetSize <= 2 ? 'WAIT' : 'NO_TRADE';
    } else {
        action = 'TRADE';
    }

    return {
        inCoverageZone,
        conformalScore: predictionScore,
        threshold,
        coverageTarget: current.coverage_target,
        action,
        samples: current.n_calibration_samples
    };
}

// ── setCoverageTarget ──────────────────────────────────────────────
function setCoverageTarget(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const tradingMode = _required(params, 'tradingMode');
    const regimeType = _required(params, 'regimeType');
    const target = _required(params, 'target');

    if (target <= 0 || target >= 1) {
        throw new Error('conformalPrediction: target must be in (0, 1)');
    }

    const current = _stmts.getCalibration.get(userId, env, tradingMode, regimeType);
    const scores = current ? JSON.parse(current.calibration_scores_json) : [];

    _stmts.upsertCalibration.run(
        userId, env, tradingMode, regimeType,
        target, JSON.stringify(scores),
        scores.length, Date.now()
    );

    return { configured: true, coverageTarget: target };
}

// ── recordConformalDecision ────────────────────────────────────────
function recordConformalDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const tradingMode = _required(params, 'tradingMode');
    const regimeType = _required(params, 'regimeType');
    const predictionSetSize = _required(params, 'predictionSetSize');
    const conformalScore = _required(params, 'conformalScore');
    const coverageTarget = _required(params, 'coverageTarget');
    const inCoverageZone = !!params.inCoverageZone;
    const decisionAction = _required(params, 'decisionAction');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!DECISION_ACTIONS.includes(decisionAction)) {
        throw new Error(`conformalPrediction: invalid decisionAction "${decisionAction}"`);
    }
    if (!TRADING_MODES.includes(tradingMode)) {
        throw new Error(`conformalPrediction: invalid tradingMode "${tradingMode}"`);
    }

    _stmts.insertDecision.run(
        userId, env, decisionId, tradingMode, regimeType,
        predictionSetSize, conformalScore, coverageTarget,
        inCoverageZone ? 1 : 0, decisionAction, ts
    );

    return { recorded: true };
}

// ── getCoverageStatsByRegime ───────────────────────────────────────
function getCoverageStatsByRegime(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const tradingMode = _required(params, 'tradingMode');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.coverageStats.all(userId, env, tradingMode, since);

    return rows.map(r => ({
        regimeType: r.regime_type,
        total: r.total,
        covered: r.covered,
        actualCoveragePct: r.total > 0 ? r.covered / r.total : 0
    }));
}

// ── getCalibrationState ────────────────────────────────────────────
function getCalibrationState(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const tradingMode = _required(params, 'tradingMode');
    const regimeType = _required(params, 'regimeType');
    const row = _stmts.getCalibration.get(userId, env, tradingMode, regimeType);
    if (!row) return { exists: false };
    return {
        exists: true,
        tradingMode: row.trading_mode,
        regimeType: row.regime_type,
        coverageTarget: row.coverage_target,
        samples: row.n_calibration_samples,
        lastUpdated: row.last_updated
    };
}

// ── getDecisionHistory ─────────────────────────────────────────────
function getDecisionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const tradingMode = (params && params.tradingMode) ? params.tradingMode : '';
    const action = (params && params.action) ? params.action : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.decisionHistory.all(
        userId, env,
        tradingMode, tradingMode,
        action, action,
        since > 0 ? 1 : 0, since,
        limit
    );
}

module.exports = {
    TRADING_MODES,
    DECISION_ACTIONS,
    DEFAULT_COVERAGE_TARGET,
    MIN_CALIBRATION_SAMPLES,
    PREDICTION_SET_MAX_FOR_TRADE,
    updateCalibrationSet,
    evaluateConformalCoverage,
    setCoverageTarget,
    recordConformalDecision,
    getCoverageStatsByRegime,
    getCalibrationState,
    getDecisionHistory
};
