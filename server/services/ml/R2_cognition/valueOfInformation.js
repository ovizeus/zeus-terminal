'use strict';

/**
 * OMEGA R2 Cognition — valueOfInformation (canonical §80)
 *
 * §80 VALUE OF INFORMATION (VOI) — cat valoreaza sa mai astepti inainte sa decizi.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2141-2142.
 *
 * "Fara VOI: WAIT = decizie emotionala mascata in prudenta.
 *  Cu VOI: WAIT = decizie matematica."
 *
 * R2 cognition. PROSPECTIVE calculus: benefit of waiting for confirmation
 * signal MINUS cost of delay (funding + opportunity + slippage).
 *
 * VOI = expectedConfirmationValue - totalWaitCost
 *   VOI > 0 → WAIT (waiting is mathematically valuable)
 *   VOI ≤ 0 → ACT_NOW (acting now is more valuable than uncertainty later)
 *
 * Distinct from:
 *   - §15 confidenceDecay (post-entry temporal decay)
 *   - §70 evidenceSufficiency (retrospective historical support)
 * §80 = PROSPECTIVE "information that does not exist yet."
 */

const { db } = require('../../database');

const RECOMMENDATIONS = Object.freeze(['WAIT', 'ACT_NOW']);
const VOI_POSITIVE_THRESHOLD = 0.0;
const VOI_SIGNIFICANT_THRESHOLD = 5.0;  // bps

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`valueOfInformation: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertEval: db.prepare(`
        INSERT INTO ml_voi_evaluations
        (user_id, resolved_env, decision_id,
         expected_confirmation_value, funding_cost_bps,
         opportunity_cost, slippage_cost_bps,
         total_cost, voi, recommendation, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    historyForUser: db.prepare(`
        SELECT * FROM ml_voi_evaluations
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR recommendation = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `),
    statsForUser: db.prepare(`
        SELECT recommendation, COUNT(*) AS count,
               AVG(voi) AS avg_voi
        FROM ml_voi_evaluations
        WHERE user_id = ? AND resolved_env = ?
          AND ts >= ?
        GROUP BY recommendation
    `)
};

// ── computeWaitCosts (pure) ────────────────────────────────────────
function computeWaitCosts(params) {
    const fundingRateBps = (params && typeof params.fundingRateBps === 'number')
        ? params.fundingRateBps : 0;
    const timeUntilSignalMs = (params && typeof params.timeUntilSignalMs === 'number')
        ? params.timeUntilSignalMs : 0;
    const opportunityProbabilityLeaves = (params && typeof params.opportunityProbabilityLeaves === 'number')
        ? params.opportunityProbabilityLeaves : 0;
    const expectedPriceMoveBps = (params && typeof params.expectedPriceMoveBps === 'number')
        ? params.expectedPriceMoveBps : 0;
    const slippageDeltaBps = (params && typeof params.slippageDeltaBps === 'number')
        ? params.slippageDeltaBps : 0;

    // Funding accrues over time-to-signal in bps; pro-rate
    const fundingCostBps = fundingRateBps * (timeUntilSignalMs / 3600000);  // per hour normalized

    // Opportunity cost: prob of price leaves × move
    const opportunityCost = opportunityProbabilityLeaves * Math.abs(expectedPriceMoveBps);

    // Total = funding + opportunity + slippage delta
    const totalCost = fundingCostBps + opportunityCost + slippageDeltaBps;

    return {
        fundingCostBps,
        opportunityCost,
        slippageCostBps: slippageDeltaBps,
        totalCost
    };
}

// ── computeExpectedConfirmationValue (pure) ────────────────────────
function computeExpectedConfirmationValue(params) {
    const signalProbability = _required(params, 'signalProbability');
    const currentConfidence = _required(params, 'currentConfidence');
    const valueIfConfirmed = _required(params, 'valueIfConfirmed');

    if (signalProbability < 0 || signalProbability > 1) {
        throw new Error('valueOfInformation: signalProbability must be in [0,1]');
    }
    if (currentConfidence < 0 || currentConfidence > 1) {
        throw new Error('valueOfInformation: currentConfidence must be in [0,1]');
    }

    // Expected uplift = P(signal) × (full value - current value already captured)
    const expectedValue = signalProbability *
        valueIfConfirmed * (1 - currentConfidence);

    return { expectedConfirmationValue: expectedValue };
}

// ── evaluateVOI (pure) ─────────────────────────────────────────────
function evaluateVOI(params) {
    const expectedConfirmationValue = _required(params, 'expectedConfirmationValue');
    const totalWaitCost = _required(params, 'totalWaitCost');

    const voi = expectedConfirmationValue - totalWaitCost;
    const recommendation = voi > VOI_POSITIVE_THRESHOLD ? 'WAIT' : 'ACT_NOW';
    const significant = Math.abs(voi) >= VOI_SIGNIFICANT_THRESHOLD;

    return {
        voi,
        recommendation,
        significant,
        expectedConfirmationValue,
        totalWaitCost
    };
}

// ── recordVOIEvaluation ────────────────────────────────────────────
function recordVOIEvaluation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const expectedConfirmationValue = _required(params, 'expectedConfirmationValue');
    const fundingCostBps = _required(params, 'fundingCostBps');
    const opportunityCost = _required(params, 'opportunityCost');
    const slippageCostBps = _required(params, 'slippageCostBps');
    const totalCost = _required(params, 'totalCost');
    const voi = _required(params, 'voi');
    const recommendation = _required(params, 'recommendation');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!RECOMMENDATIONS.includes(recommendation)) {
        throw new Error(`valueOfInformation: invalid recommendation "${recommendation}"`);
    }

    try {
        _stmts.insertEval.run(
            userId, env, decisionId,
            expectedConfirmationValue, fundingCostBps,
            opportunityCost, slippageCostBps,
            totalCost, voi, recommendation, ts
        );
        return { recorded: true };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`valueOfInformation: duplicate decisionId "${decisionId}"`);
        }
        throw err;
    }
}

// ── getVOIHistory ──────────────────────────────────────────────────
function getVOIHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const recommendation = (params && params.recommendation) ? params.recommendation : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.historyForUser.all(
        userId, env,
        recommendation, recommendation,
        since > 0 ? 1 : 0, since,
        limit
    );
}

// ── getVOIStats ────────────────────────────────────────────────────
function getVOIStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.statsForUser.all(userId, env, since);
    return {
        byRecommendation: rows.map(r => ({
            recommendation: r.recommendation,
            count: r.count,
            avgVoi: r.avg_voi
        })),
        total: rows.reduce((s, r) => s + r.count, 0)
    };
}

module.exports = {
    RECOMMENDATIONS,
    VOI_POSITIVE_THRESHOLD,
    VOI_SIGNIFICANT_THRESHOLD,
    computeWaitCosts,
    computeExpectedConfirmationValue,
    evaluateVOI,
    recordVOIEvaluation,
    getVOIHistory,
    getVOIStats
};
