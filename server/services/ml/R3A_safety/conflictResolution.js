'use strict';

/**
 * OMEGA R3A Safety — conflictResolution (canonical §14)
 *
 * §14 CONFLICT RESOLUTION SI VETO RULES.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 875-903.
 *
 * 12 veto signals taxonomy. Two-tier severity (BLOCK vs SCORE_PENALTY).
 * 6-level authority hierarchy: safety_veto > reconciliation > macro_red_flag
 * > execution > portfolio_risk > data_health.
 *
 * Decision matrix:
 *   - Any BLOCK signal active        → decision=BLOCK, scoreAdjusted=0
 *   - Only PENALTY signals active    → decision=PENALIZED, score reduced
 *   - No signals active              → decision=PROCEED, score unchanged
 *
 * Winning signal selected by hierarchy order (lower index = higher authority).
 * Audit row inserted into ml_veto_log for every evaluation (per user × env).
 */

const { db } = require('../../database');

// 12 veto signals per canonical PDF §14 lines 881-892
const SIGNAL_KEYS = Object.freeze([
    'macro_red_flag',
    'spread_excessive',
    'slippage_estimate_high',
    'feed_unstable',
    'htf_ltf_contradiction',
    'global_bias_opposite',
    'drawdown_limit_reached',
    'execution_unsafe',
    'reconciliation_failed',
    'drift_significant',
    'venue_anomaly',
    'api_latency_severe'
]);

// Two-tier classification per PDF lines 894-895:
//   "Unele conditii nu scad scorul.  Unele conditii blocheaza complet trade-ul."
// BLOCK = hard veto (no trade); SCORE_PENALTY = score reduction only.
const SEVERITY_MAP = Object.freeze({
    macro_red_flag:           'BLOCK',          // macro hazard absolute
    spread_excessive:         'SCORE_PENALTY',  // execution penalty, not absolute
    slippage_estimate_high:   'SCORE_PENALTY',
    feed_unstable:            'BLOCK',          // data health critical
    htf_ltf_contradiction:    'SCORE_PENALTY',  // confidence penalty
    global_bias_opposite:     'SCORE_PENALTY',
    drawdown_limit_reached:   'BLOCK',          // safety absolute
    execution_unsafe:         'BLOCK',          // safety absolute
    reconciliation_failed:    'BLOCK',          // safety absolute
    drift_significant:        'BLOCK',          // model integrity
    venue_anomaly:            'BLOCK',
    api_latency_severe:       'BLOCK'
});

// 6-level authority hierarchy per PDF lines 897-903 (order matters: lower index = higher authority).
const AUTHORITY_HIERARCHY = Object.freeze([
    'safety_veto',
    'reconciliation',
    'macro_red_flag',
    'execution',
    'portfolio_risk',
    'data_health'
]);

// Signal-to-hierarchy mapping (which authority level governs each signal).
const SIGNAL_TO_HIERARCHY = Object.freeze({
    drawdown_limit_reached:   'safety_veto',
    execution_unsafe:         'safety_veto',
    reconciliation_failed:    'reconciliation',
    macro_red_flag:           'macro_red_flag',
    global_bias_opposite:     'macro_red_flag',
    spread_excessive:         'execution',
    slippage_estimate_high:   'execution',
    api_latency_severe:       'execution',
    venue_anomaly:            'portfolio_risk',
    drift_significant:        'portfolio_risk',
    htf_ltf_contradiction:    'data_health',
    feed_unstable:            'data_health'
});

// Per-PENALTY score reduction (multiplicative; capped at floor 0).
const PENALTY_WEIGHT = 0.15;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`conflictResolution: missing ${key}`);
    }
    return params[key];
}

function _hierarchyRank(signal) {
    const level = SIGNAL_TO_HIERARCHY[signal];
    if (!level) return Number.MAX_SAFE_INTEGER;
    return AUTHORITY_HIERARCHY.indexOf(level);
}

// ── Prepared statement ─────────────────────────────────────────────
const _stmts = {
    insertLog: db.prepare(`
        INSERT INTO ml_veto_log
        (user_id, resolved_env, decision, winning_signal, winning_severity,
         winning_hierarchy, blockers_json, penalties_json,
         score_input, score_adjusted, context_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── evaluateVetoSignals ────────────────────────────────────────────
function evaluateVetoSignals(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const scoreInput = _required(params, 'scoreInput');
    const signals = (params && params.signals) ? params.signals : {};
    const context = (params && params.context) ? params.context : null;

    // Partition active signals by severity
    const blockers = [];
    const penalties = [];
    for (const key of SIGNAL_KEYS) {
        if (!signals[key]) continue;
        if (SEVERITY_MAP[key] === 'BLOCK') {
            blockers.push(key);
        } else if (SEVERITY_MAP[key] === 'SCORE_PENALTY') {
            penalties.push(key);
        }
    }

    let decision;
    let scoreAdjusted;
    let winningSignal = null;
    let winningSeverity = null;
    let winningHierarchy = null;

    if (blockers.length > 0) {
        // BLOCK wins. Sort blockers by hierarchy rank (lower = higher authority).
        const sorted = [...blockers].sort((a, b) => _hierarchyRank(a) - _hierarchyRank(b));
        decision = 'BLOCK';
        winningSignal = sorted[0];
        winningSeverity = 'BLOCK';
        winningHierarchy = SIGNAL_TO_HIERARCHY[winningSignal];
        scoreAdjusted = 0;
    } else if (penalties.length > 0) {
        decision = 'PENALIZED';
        // Compound penalty (multiplicative)
        let adj = scoreInput;
        for (let i = 0; i < penalties.length; i++) {
            adj = adj * (1 - PENALTY_WEIGHT);
        }
        scoreAdjusted = Math.max(0, adj);
        // Winning penalty by hierarchy rank
        const sorted = [...penalties].sort((a, b) => _hierarchyRank(a) - _hierarchyRank(b));
        winningSignal = sorted[0];
        winningSeverity = 'SCORE_PENALTY';
        winningHierarchy = SIGNAL_TO_HIERARCHY[winningSignal];
    } else {
        decision = 'PROCEED';
        scoreAdjusted = scoreInput;
    }

    // Audit log (always insert)
    _stmts.insertLog.run(
        userId, env, decision,
        winningSignal, winningSeverity, winningHierarchy,
        JSON.stringify(blockers), JSON.stringify(penalties),
        scoreInput, scoreAdjusted,
        context ? JSON.stringify(context) : null,
        Date.now()
    );

    return {
        decision,
        blockers,
        penalties,
        winningSignal,
        winningSeverity,
        winningHierarchy,
        scoreInput,
        scoreAdjusted
    };
}

module.exports = {
    SIGNAL_KEYS,
    SEVERITY_MAP,
    AUTHORITY_HIERARCHY,
    SIGNAL_TO_HIERARCHY,
    PENALTY_WEIGHT,
    evaluateVetoSignals
};
