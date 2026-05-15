'use strict';

/**
 * OMEGA Meta — supremePrinciple (canonical §10)
 *
 * §10 PRINCIPIUL SUPREM.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 766-786.
 *
 * Negation (lines 766-767):
 *   "Brain-ul pro nu trebuie sa caute 'multe trade-uri'."
 *
 * 4 SUPREME CRITERIA (lines 769-773):
 *   1. clean              — trade-uri curate
 *   2. with_advantage     — trade-uri cu avantaj
 *   3. confirmed          — trade-uri confirmate
 *   4. coherent_story     — context, lichiditate, participare spun aceeasi poveste
 *
 * 5 SYSTEM BEHAVIORS (lines 775-780):
 *   - frecventa o decide regimul, nu ego-ul
 *   - Sniper = puține, Scalp = mai multe, Observer = zero, Adaptive = redus
 *
 * FREQUENCY GUIDE (lines 782-786):
 *   - Sniper: 2-4 trades/saptamana
 *   - Scalp: 8-15 trades/saptamana
 *   - Observer: 0
 *   - Adaptive: redus
 *
 * Composes cu §37 (frequency modes), §38 (intelligence checker),
 * §39 (executive summary). NO DB state (pure philosophy module).
 */

const SUPREME_CRITERIA = Object.freeze([
    'clean',
    'with_advantage',
    'confirmed',
    'coherent_story'
]);

const FREQUENCY_GUIDE = Object.freeze({
    SNIPER:   { weeklyMin: 2,  weeklyMax: 4,   description: 'Rare, confirmed entries with big RR' },
    SCALP:    { weeklyMin: 8,  weeklyMax: 15,  description: 'Frequent controlled, small repeatable edge' },
    OBSERVER: { weeklyMin: 0,  weeklyMax: 0,   description: 'Zero entries — sit on hands' },
    ADAPTIVE: { weeklyMin: 1,  weeklyMax: 6,   description: 'Reduced frequency + reduced exposure' }
});

const EGO_SEVERITY_MULTIPLIER = 2.0;  // How much over-trading is amplified

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`supremePrinciple: missing ${key}`);
    }
    return params[key];
}

function _clampUnit(x) {
    return Math.max(0, Math.min(1, x));
}

// ── evaluateTradeQuality (pure) ────────────────────────────────────
function evaluateTradeQuality(params) {
    const candidate = (params && params.tradeCandidate) ? params.tradeCandidate : {};
    const ctx = (params && params.contextSignals) ? params.contextSignals : {};

    // 1. CLEAN: slippage clean + no signal conflict
    const clean = !!ctx.slippageEstimateClean && !!ctx.signalConflictResolved;

    // 2. WITH ADVANTAGE: expected edge sufficiently exceeds cost
    const edge = typeof candidate.expectedEdgeBps === 'number' ? candidate.expectedEdgeBps : 0;
    const cost = typeof candidate.costBps === 'number' ? candidate.costBps : 0;
    const with_advantage = edge >= cost * 1.5 && edge >= 15;  // at least 1.5× cost AND minimum 15 bps

    // 3. CONFIRMED: context + signal both confirmed
    const confirmed = !!ctx.contextMatches && !!ctx.signalConflictResolved;

    // 4. COHERENT STORY: context, liquidity, participation aligned
    const coherent_story = !!ctx.contextMatches && !!ctx.liquidityMatches && !!ctx.participationMatches;

    const criteria = { clean, with_advantage, confirmed, coherent_story };
    const satisfiedCount = Object.values(criteria).filter(Boolean).length;
    const overallScore = _clampUnit(satisfiedCount / SUPREME_CRITERIA.length);

    return {
        criteria,
        satisfiedCount,
        overallScore,
        totalCriteria: SUPREME_CRITERIA.length
    };
}

// ── getFrequencyGuide (pure) ───────────────────────────────────────
function getFrequencyGuide(params) {
    const mode = _required(params, 'mode');
    if (!FREQUENCY_GUIDE[mode]) {
        throw new Error(`supremePrinciple: invalid mode "${mode}"`);
    }
    return { ...FREQUENCY_GUIDE[mode] };
}

// ── checkEgoVsRegime (pure) ────────────────────────────────────────
function checkEgoVsRegime(params) {
    const tradesThisWeek = _required(params, 'tradesThisWeek');
    const currentMode = _required(params, 'currentMode');

    if (!FREQUENCY_GUIDE[currentMode]) {
        throw new Error(`supremePrinciple: invalid mode "${currentMode}"`);
    }

    const guide = FREQUENCY_GUIDE[currentMode];
    const withinGuide = tradesThisWeek >= guide.weeklyMin && tradesThisWeek <= guide.weeklyMax;
    const overTrading = tradesThisWeek > guide.weeklyMax;
    const underTrading = tradesThisWeek < guide.weeklyMin && guide.weeklyMin > 0;

    let egoDetected = false;
    let severity = 0;
    let recommendation = null;

    if (overTrading) {
        egoDetected = true;
        const excess = tradesThisWeek - guide.weeklyMax;
        severity = _clampUnit(excess / Math.max(1, guide.weeklyMax) * EGO_SEVERITY_MULTIPLIER);
        recommendation = `Reduce trade frequency to ${guide.weeklyMin}-${guide.weeklyMax}/week per ${currentMode} mode`;
    } else if (currentMode === 'OBSERVER' && tradesThisWeek > 0) {
        egoDetected = true;
        severity = 1.0;
        recommendation = `Observer mode requires ZERO entries — stop entering`;
    }

    return {
        egoDetected,
        withinGuide,
        overTrading,
        underTrading,
        severity,
        recommendation,
        tradesThisWeek,
        expectedRange: { min: guide.weeklyMin, max: guide.weeklyMax }
    };
}

// ── validateAgainstSupremePrinciple (composite) ────────────────────
function validateAgainstSupremePrinciple(params) {
    const tradeCandidate = _required(params, 'tradeCandidate');
    const mode = _required(params, 'mode');
    const tradesThisWeek = _required(params, 'tradesThisWeek');
    const contextSignals = (params && params.contextSignals) ? params.contextSignals : {};

    const reasons = [];

    // 1. Trade quality
    const quality = evaluateTradeQuality({ tradeCandidate, contextSignals });
    if (quality.overallScore < 0.75) {
        for (const [crit, satisfied] of Object.entries(quality.criteria)) {
            if (!satisfied) reasons.push(`criterion_failed_${crit}`);
        }
    }

    // 2. Ego vs regime
    const ego = checkEgoVsRegime({ tradesThisWeek, currentMode: mode });
    if (ego.egoDetected) {
        reasons.push(`ego_${mode.toLowerCase()}_over_trading`);
    }

    // 3. Observer mode hard-rejects ALL entries
    if (mode === 'OBSERVER') {
        reasons.push('observer_mode_zero_entries');
    }

    return {
        valid: reasons.length === 0,
        reasons,
        quality,
        ego,
        mode
    };
}

module.exports = {
    SUPREME_CRITERIA,
    FREQUENCY_GUIDE,
    EGO_SEVERITY_MULTIPLIER,
    evaluateTradeQuality,
    getFrequencyGuide,
    checkEgoVsRegime,
    validateAgainstSupremePrinciple
};
