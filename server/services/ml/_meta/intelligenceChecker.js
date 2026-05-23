'use strict';

/**
 * OMEGA Meta — intelligenceChecker (canonical §38)
 *
 * §38 DEFINITIA INTELIGENTEI REALE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1451-1469.
 *
 * Two-part definition:
 *
 * ANTI-PATTERNS (lines 1451-1455) — what intelligence is NOT:
 *   - intra mult, pare curajos, scoruri mari, "ghicește spectaculos"
 *
 * 12 INTELLIGENCE CRITERIA (lines 1457-1469) — what intelligence IS:
 *   1. stie regimul          → §17 regimeMetrics
 *   2. stie contextul        → §27 temporalPatterns
 *   3. stie cand nu are edge → §23 evaluateEdgeVsCost
 *   4. stie cand semnalele se bat → §14 conflictResolution
 *   5. stie cand executia compromisa → §28 reconciliation/latency
 *   6. stie cand datele degradate → §13 dataFreshness
 *   7. stie cand modelul drift → §21 driftDetection
 *   8. stie cand portofoliul incarcat → §30 portfolioGovernance
 *   9. stie cand sa reduca → §29 circuitBreaker L1
 *  10. stie cand sa se opreasca → §29 circuitBreaker L4
 *  11. stie sa explice → §25 explainability
 *  12. stie sa invete fara auto-amagire → §16 attribution + §22 dataHygiene
 *
 * Self-assessment dashboard. Closes meta-layer reflection loop.
 */

const { db } = require('../../database');

const INTELLIGENCE_CRITERIA = Object.freeze([
    'knows_regime',
    'knows_context',
    'knows_no_edge',
    'knows_signal_conflict',
    'knows_execution_compromised',
    'knows_data_degraded',
    'knows_model_drift',
    'knows_portfolio_overloaded',
    'knows_when_to_reduce',
    'knows_when_to_stop',
    'knows_how_to_explain',
    'knows_how_to_learn_honestly'
]);

const ANTI_PATTERNS = Object.freeze([
    'enters_too_much',
    'pretends_brave',
    'high_scores_show',
    'spectacular_guesses'
]);

// Each criterion mapped to providing OMEGA ring/module.
const CRITERION_TO_RING = Object.freeze({
    knows_regime:                'R5A:§17 regimeMetrics',
    knows_context:               'R2:§27 temporalPatterns',
    knows_no_edge:               'R4:§23 evaluateEdgeVsCost',
    knows_signal_conflict:       'R3A:§14 conflictResolution',
    knows_execution_compromised: 'R3A:§28 positionReconciliation',
    knows_data_degraded:         'R3A:§13 dataFreshness',
    knows_model_drift:           'R5A:§21 driftDetection',
    knows_portfolio_overloaded:  'R3A:§30 portfolioGovernance',
    knows_when_to_reduce:        'R3A:§29 circuitBreaker L1',
    knows_when_to_stop:          'R3A:§29 circuitBreaker L4',
    knows_how_to_explain:        'cross-cutting:§25 explainability',
    knows_how_to_learn_honestly: 'R5A:§16 attribution + §22 dataHygiene'
});

// Signal name → criterion mapping for evaluateAllCriteria
const SIGNAL_TO_CRITERION = Object.freeze({
    regime_known:                  'knows_regime',
    context_known:                 'knows_context',
    edge_assessable:               'knows_no_edge',
    signal_conflict_detected:      'knows_signal_conflict',     // inverted
    execution_clean:               'knows_execution_compromised', // means: yes I know it's clean
    data_fresh:                    'knows_data_degraded',
    model_drift_detected:          'knows_model_drift',         // inverted (knowing IS the criterion)
    portfolio_loaded:              'knows_portfolio_overloaded', // boolean awareness
    breaker_active:                'knows_when_to_reduce',
    circuit_breaker_active:        'knows_when_to_stop',
    explainability_available:      'knows_how_to_explain',
    attribution_active:            'knows_how_to_learn_honestly'
});

// Anti-pattern detection thresholds.
const ANTI_PATTERN_THRESHOLDS = Object.freeze({
    max_trades_per_day:        20,
    suspicious_confidence:     0.90,
    poor_hit_rate_warning:     0.45,
    excessive_bravery:         0.70
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`intelligenceChecker: missing ${key}`);
    }
    return params[key];
}

function _validateCriterion(criterion) {
    if (!INTELLIGENCE_CRITERIA.includes(criterion)) {
        throw new Error(`intelligenceChecker: invalid criterion "${criterion}"`);
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertCheck: db.prepare(`
        INSERT INTO ml_intelligence_checks
        (user_id, resolved_env, criterion, satisfied, score, evidence_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getLatestByCriterion: db.prepare(`
        SELECT * FROM ml_intelligence_checks
        WHERE user_id = ? AND resolved_env = ? AND criterion = ?
          AND created_at >= ?
        ORDER BY created_at DESC, id DESC LIMIT 1
    `),
    countAllChecks: db.prepare(`
        SELECT COUNT(*) AS count FROM ml_intelligence_checks
        WHERE user_id = ? AND resolved_env = ? AND created_at >= ?
    `)
};

// ── recordCriterionCheck ───────────────────────────────────────────
function recordCriterionCheck(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const criterion = _required(params, 'criterion');
    const satisfied = _required(params, 'satisfied');
    const score = (params && typeof params.score === 'number') ? params.score : null;
    const evidence = (params && params.evidence) ? params.evidence : null;

    _validateCriterion(criterion);

    _stmts.insertCheck.run(
        userId, env, criterion,
        satisfied ? 1 : 0,
        score,
        evidence ? JSON.stringify(evidence) : null,
        Date.now()
    );

    return { recorded: true, criterion, satisfied };
}

// ── evaluateAllCriteria ────────────────────────────────────────────
function evaluateAllCriteria(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const contextSignals = (params && params.contextSignals) ? params.contextSignals : {};

    const results = [];
    let satisfiedCount = 0;
    let totalScore = 0;

    for (const criterion of INTELLIGENCE_CRITERIA) {
        const satisfied = _criterionFromSignals(criterion, contextSignals);
        const score = satisfied ? 1.0 : 0;

        recordCriterionCheck({
            userId, resolvedEnv: env,
            criterion, satisfied, score,
            evidence: { source: 'evaluateAllCriteria', contextSignals }
        });

        results.push({ criterion, satisfied, score });
        if (satisfied) satisfiedCount++;
        totalScore += score;
    }

    const overallScore = INTELLIGENCE_CRITERIA.length > 0
        ? totalScore / INTELLIGENCE_CRITERIA.length : 0;

    return {
        results,
        satisfiedCount,
        totalCriteria: INTELLIGENCE_CRITERIA.length,
        overallScore
    };
}

function _criterionFromSignals(criterion, signals) {
    // Inversed semantics: criterion means "knows X" so for negative signals we check absence/awareness.
    switch (criterion) {
        case 'knows_regime':                return !!signals.regime_known;
        case 'knows_context':               return !!signals.context_known;
        case 'knows_no_edge':               return !!signals.edge_assessable;
        case 'knows_signal_conflict':       return signals.signal_conflict_detected !== undefined; // awareness
        case 'knows_execution_compromised': return !!signals.execution_clean || signals.execution_clean === false; // awareness either way
        case 'knows_data_degraded':         return !!signals.data_fresh || signals.data_fresh === false;
        case 'knows_model_drift':           return signals.model_drift_detected !== undefined;
        case 'knows_portfolio_overloaded':  return signals.portfolio_loaded !== undefined;
        case 'knows_when_to_reduce':        return signals.breaker_active !== undefined;
        case 'knows_when_to_stop':          return signals.circuit_breaker_active !== undefined;
        case 'knows_how_to_explain':        return !!signals.explainability_available;
        case 'knows_how_to_learn_honestly': return !!signals.attribution_active;
        default: return false;
    }
}

// ── getIntelligenceScore ───────────────────────────────────────────
function getIntelligenceScore(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const window = (params && params.window) ? params.window : 86400000; // 24h default
    const since = (params && params.since) ? params.since : Date.now() - window;

    const totalCount = _stmts.countAllChecks.get(userId, env, since);
    if (!totalCount || totalCount.count === 0) {
        return { score: 0, checkCount: 0, criteriaSummary: {} };
    }

    const summary = {};
    let satisfiedSum = 0;
    let evaluatedCriteria = 0;

    for (const criterion of INTELLIGENCE_CRITERIA) {
        const latest = _stmts.getLatestByCriterion.get(userId, env, criterion, since);
        if (latest) {
            summary[criterion] = {
                latest_satisfied: latest.satisfied === 1,
                latest_score: latest.score,
                last_checked_at: latest.created_at
            };
            if (latest.satisfied === 1) satisfiedSum++;
            evaluatedCriteria++;
        }
    }

    const score = evaluatedCriteria > 0 ? satisfiedSum / evaluatedCriteria : 0;

    return {
        score,
        checkCount: totalCount.count,
        evaluatedCriteria,
        criteriaSummary: summary
    };
}

// ── detectAntiPatterns (pure) ──────────────────────────────────────
function detectAntiPatterns(params) {
    const tradeStats = (params && params.tradeStats) ? params.tradeStats : {};
    const decisionStats = (params && params.decisionStats) ? params.decisionStats : {};
    const thresholds = (params && params.thresholds) ? params.thresholds : ANTI_PATTERN_THRESHOLDS;

    const detected = [];

    if (tradeStats.tradesPerDay > thresholds.max_trades_per_day) {
        detected.push('enters_too_much');
    }
    if (decisionStats.avgBraveryFlag > thresholds.excessive_bravery) {
        detected.push('pretends_brave');
    }
    if (tradeStats.avgConfidence > thresholds.suspicious_confidence
        && tradeStats.hitRate < thresholds.poor_hit_rate_warning) {
        detected.push('high_scores_show');
    }
    if (tradeStats.spectacularGuessFlag === true) {
        detected.push('spectacular_guesses');
    }

    return {
        detected,
        antiPatternCount: detected.length,
        clean: detected.length === 0
    };
}

module.exports = {
    INTELLIGENCE_CRITERIA,
    ANTI_PATTERNS,
    CRITERION_TO_RING,
    SIGNAL_TO_CRITERION,
    ANTI_PATTERN_THRESHOLDS,
    recordCriterionCheck,
    evaluateAllCriteria,
    getIntelligenceScore,
    detectAntiPatterns
};
