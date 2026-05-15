'use strict';

/**
 * OMEGA Meta — executiveSummary (canonical §39)
 *
 * §39 REZUMAT EXECUTIV FINAL.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1475-1516.
 *
 * "BRAIN FUTURES PRO trebuie sa fie simultan:"
 *
 * 7 ROLES (lines 1477-1508):
 *   1. ANALIST          — structure, liquidity, microstructure, derivatives,
 *                         macro, correlations
 *   2. STATISTICIAN     — calibrated probabilities, uncertainty
 *   3. RISK_MANAGER     — risk/exposure/ruin limits
 *   4. EXECUTION_ENGINE — real costs, slippage, impact, venue diffs
 *   5. OPERATOR_ROBUST  — reconcile, latency, rate limits, degradation, recovery
 *   6. CERCETATOR       — regimes, drift, A/B, shadow, edge measurement
 *   7. SISTEM_DISCIPLINAT — state machine, veto, governance, audit, explainability
 *
 * FINAL PRINCIPLE (lines 1510-1516):
 *   "Pe futures nu castiga cel care 'vede' cel mai mult.
 *    Castiga cel care:
 *      - vede clar,
 *      - executa curat,
 *      - se opreste la timp,
 *      - si nu se minte singur."
 *
 * Cross-cutting introspective module. NO DB state — PURE summary view.
 * Maps OMEGA modules to roles for traceability and INVARIANT enforcement.
 */

const BRAIN_ROLES = Object.freeze([
    'ANALIST',
    'STATISTICIAN',
    'RISK_MANAGER',
    'EXECUTION_ENGINE',
    'OPERATOR_ROBUST',
    'CERCETATOR',
    'SISTEM_DISCIPLINAT'
]);

const FINAL_PRINCIPLES = Object.freeze([
    'vede_clar',
    'executa_curat',
    'se_opreste_la_timp',
    'nu_se_minte_singur'
]);

// Role → OMEGA modules that fulfill it. Each role must have ≥1 module.
const ROLE_TO_MODULES = Object.freeze({
    ANALIST: Object.freeze([
        'R2:§15 confidenceDecay (post-entry thesis tracking)',
        'R2:§24 detectorRegistry (order_flow, regime_classifier, etc.)',
        'R2:§27 temporalPatterns (session/regime context)'
    ]),
    STATISTICIAN: Object.freeze([
        'R5A:§20 calibration (probability calibration, ECE/Brier)',
        'R5A:§17 regimeMetrics (per-regime probability stats)',
        'R5A:§16 attributionEngine (outcome causal attribution)'
    ]),
    RISK_MANAGER: Object.freeze([
        'R3A:§30 portfolioGovernance (exposure caps, ruin probability)',
        'R3A:§246* ddRecoveryGraduated (DD ladder)',
        'R3A:§248* blackSwanAbstention (extreme regime detection)',
        'R3A:§29 circuitBreaker (L0-L5 escalation)'
    ]),
    EXECUTION_ENGINE: Object.freeze([
        'R4:§23 transactionCostAnalyzer (TCA + market impact + INVARIANT)',
        'R4:§12 positionStateMachine (FSM lifecycle)',
        'R3A:§14 conflictResolution (entry-time veto)'
    ]),
    OPERATOR_ROBUST: Object.freeze([
        'R3A:§28 positionReconciliation (recon + latency + rate limit)',
        'R3A:§13 dataFreshness (feed validation + 5-action ladder)',
        '_operator:§253* operatorUnavailability (escalation ladder)',
        '_operator:§34 humanInTheLoop (override + kill switch)'
    ]),
    CERCETATOR: Object.freeze([
        'R5A:§21 driftDetection (PSI, KS test)',
        'R5A:§242 counterfactualPortfolio (alternative simulations)',
        'R5B:§18 shadowMode (6-stage deployment ladder)',
        'R5B:§247* preRegistration (anti-p-hacking)',
        'R5A:§22 dataHygiene (leakage prevention)',
        'R6:§33 abTesting (experimental control)'
    ]),
    SISTEM_DISCIPLINAT: Object.freeze([
        'R4:§12 positionStateMachine (state machine FSM)',
        'R3A:§14 conflictResolution (veto rules)',
        'R5B:§19 versionRegistry (governance + versioning)',
        'R5B:§252* tieredPromotion (auto-MINOR/MAJOR/CRITICAL)',
        'R5B:§254* autoQuarantine (failed feature isolation)',
        'R5B:§255* autoResumeDD (graduated re-entry)',
        '_crosscutting:§25 explainability (SHAP, decisive factor)',
        '_crosscutting:§35 monitoring (full audit trail + KPI)'
    ])
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`executiveSummary: missing ${key}`);
    }
    return params[key];
}

function _clampUnit(x) {
    return Math.max(0, Math.min(1, x));
}

function _avg(values) {
    if (!values || values.length === 0) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
}

// ── getRoleCoverage (pure) ─────────────────────────────────────────
function getRoleCoverage(params) {
    const filter = params || {};
    if (filter.role && !BRAIN_ROLES.includes(filter.role)) {
        throw new Error(`executiveSummary: invalid role "${filter.role}"`);
    }

    const coverage = {};
    const rolesToReport = filter.role ? [filter.role] : BRAIN_ROLES;
    for (const role of rolesToReport) {
        coverage[role] = {
            modules: ROLE_TO_MODULES[role],
            moduleCount: ROLE_TO_MODULES[role].length,
            isCovered: ROLE_TO_MODULES[role].length > 0
        };
    }
    return { coverage };
}

// ── validateAllRolesCovered — INVARIANT ────────────────────────────
function validateAllRolesCovered() {
    const uncoveredRoles = [];
    let coveredRoles = 0;
    for (const role of BRAIN_ROLES) {
        const modules = ROLE_TO_MODULES[role];
        if (!modules || modules.length === 0) {
            uncoveredRoles.push(role);
        } else {
            coveredRoles++;
        }
    }
    return {
        covered: uncoveredRoles.length === 0,
        uncoveredRoles,
        totalRoles: BRAIN_ROLES.length,
        coveredRoles
    };
}

// ── getFinalPrinciples (pure) ──────────────────────────────────────
function getFinalPrinciples() {
    return FINAL_PRINCIPLES;
}

// ── evaluateClarityScore (vede_clar) ───────────────────────────────
function evaluateClarityScore(indicators) {
    const ind = indicators || {};
    const components = [];

    if (ind.regimeKnown !== undefined) components.push(ind.regimeKnown ? 1 : 0);
    if (ind.contextKnown !== undefined) components.push(ind.contextKnown ? 1 : 0);
    if (ind.signalConflictResolved !== undefined) components.push(ind.signalConflictResolved ? 1 : 0);
    if (ind.dataFresh !== undefined) components.push(ind.dataFresh ? 1 : 0);

    const score = components.length > 0 ? _avg(components) : 0;
    return {
        score: _clampUnit(score),
        components: components.length,
        principle: 'vede_clar',
        meaning: 'see clearly — regime, context, signal coherence, fresh data'
    };
}

// ── evaluateExecutionCleanScore (executa_curat) ────────────────────
function evaluateExecutionCleanScore(data) {
    const d = data || {};
    const components = [];

    if (typeof d.avgSlippageVsEstimate === 'number') {
        // 0 bps drift = 1.0, 30+ bps drift = 0
        const slippageScore = _clampUnit(1 - d.avgSlippageVsEstimate / 30);
        components.push(slippageScore);
    }
    if (typeof d.fillRate === 'number') {
        components.push(_clampUnit(d.fillRate));
    }
    if (typeof d.avgLatencyMs === 'number') {
        // 0ms = 1.0, 1000ms = 0
        const latencyScore = _clampUnit(1 - d.avgLatencyMs / 1000);
        components.push(latencyScore);
    }

    const score = components.length > 0 ? _avg(components) : 0;
    return {
        score: _clampUnit(score),
        components: components.length,
        principle: 'executa_curat',
        meaning: 'execute cleanly — minimize slippage, maximize fill, low latency'
    };
}

// ── evaluateStopOnTimeScore (se_opreste_la_timp) ───────────────────
function evaluateStopOnTimeScore(indicators) {
    const ind = indicators || {};

    if (!ind.breakerLevel || typeof ind.currentDD !== 'number') {
        return {
            score: 0,
            components: 0,
            principle: 'se_opreste_la_timp',
            meaning: 'stop on time — circuit breaker activation when DD warrants'
        };
    }

    const maxDD = ind.maxDDThreshold || 0.05;
    const ddRatio = ind.currentDD / maxDD;
    const breakerLevel = ind.breakerLevel;

    // Expected breaker level by DD severity
    let expectedLevel;
    if (ddRatio < 0.5) expectedLevel = 'L0';
    else if (ddRatio < 0.8) expectedLevel = 'L1';
    else if (ddRatio < 1.0) expectedLevel = 'L2';
    else if (ddRatio < 1.5) expectedLevel = 'L4';
    else expectedLevel = 'L5';

    const levels = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
    const actualIdx = levels.indexOf(breakerLevel);
    const expectedIdx = levels.indexOf(expectedLevel);

    // Score = 1 if actual >= expected (breaker timely or earlier);
    // penalize if actual < expected (too slow)
    if (actualIdx >= expectedIdx) {
        return {
            score: 1.0,
            components: 1,
            principle: 'se_opreste_la_timp',
            meaning: 'stop on time — breaker timely',
            breakerLevel,
            expectedLevel,
            ddRatio
        };
    }

    const gap = expectedIdx - actualIdx;
    const score = _clampUnit(1 - gap / 5);
    return {
        score,
        components: 1,
        principle: 'se_opreste_la_timp',
        meaning: 'stop on time — breaker delayed',
        breakerLevel,
        expectedLevel,
        ddRatio,
        gap
    };
}

// ── evaluateNoSelfDeceptionScore (nu_se_minte_singur) ──────────────
function evaluateNoSelfDeceptionScore(indicators) {
    const ind = indicators || {};
    const components = [];

    if (ind.attributionActive !== undefined) components.push(ind.attributionActive ? 1 : 0);
    if (typeof ind.intelligenceScore === 'number') components.push(_clampUnit(ind.intelligenceScore));
    if (typeof ind.badFeaturesDetected === 'number') {
        // 0 bad features = 1.0, 5+ = 0
        components.push(_clampUnit(1 - ind.badFeaturesDetected / 5));
    }
    if (ind.calibrationGood !== undefined) components.push(ind.calibrationGood ? 1 : 0);

    const score = components.length > 0 ? _avg(components) : 0;
    return {
        score: _clampUnit(score),
        components: components.length,
        principle: 'nu_se_minte_singur',
        meaning: 'no self-deception — honest attribution, calibration, bad-feature removal'
    };
}

// ── getOmegaSummaryReport (composite) ──────────────────────────────
function getOmegaSummaryReport(params) {
    const p = params || {};

    const clarity = evaluateClarityScore(p.clarityIndicators || {});
    const execution = evaluateExecutionCleanScore(p.executionData || {});
    const stopOnTime = evaluateStopOnTimeScore(p.stopOnTimeIndicators || {});
    const noSelfDeception = evaluateNoSelfDeceptionScore(p.noSelfDeceptionIndicators || {});

    const principles = [clarity, execution, stopOnTime, noSelfDeception];
    const overallScore = _avg(principles.map(pr => pr.score));

    const roleCoverage = validateAllRolesCovered();

    return {
        principles,
        overallScore,
        roleCoverage,
        timestamp: Date.now(),
        spec: '§39 REZUMAT EXECUTIV FINAL (canonical PDF lines 1475-1516)'
    };
}

module.exports = {
    BRAIN_ROLES,
    FINAL_PRINCIPLES,
    ROLE_TO_MODULES,
    getRoleCoverage,
    validateAllRolesCovered,
    getFinalPrinciples,
    evaluateClarityScore,
    evaluateExecutionCleanScore,
    evaluateStopOnTimeScore,
    evaluateNoSelfDeceptionScore,
    getOmegaSummaryReport
};
