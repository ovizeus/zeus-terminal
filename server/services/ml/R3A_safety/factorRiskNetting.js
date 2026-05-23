'use strict';

/**
 * OMEGA R3A Safety — factorRiskNetting (canonical §58)
 *
 * §58 PORTFOLIO FACTOR RISK DECOMPOSITION + NETTING ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1645-1664.
 *
 * "Corelatia = fotografie. Factor decomposition = anatomie.
 *  Te ajuta sa vezi riscul ascuns pe care correlation matrix
 *  singura il poate rata."
 *
 * Decomposes each position into 6 risk factors. Detects when "3 different"
 * positions are actually same bet under different names (cosine similarity
 * of factor vectors > threshold). Recommends NET / HEDGE / REDUCE / REPLACE.
 *
 * Distinct from §30 portfolioGovernance (correlation matrix + caps).
 * §58 = factor anatomy beneath correlation surface.
 */

const { db } = require('../../database');

const FACTORS = Object.freeze([
    'btc_beta', 'market_beta', 'vol_factor',
    'liquidity_factor', 'funding_factor', 'macro_factor'
]);
const NETTING_DECISIONS = Object.freeze(['NET', 'HEDGE', 'REDUCE', 'REPLACE', 'HOLD']);
const STACKED_RISK_OVERLAP_THRESHOLD = 0.70;
const MIN_POSITIONS_FOR_STACK_DETECTION = 2;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`factorRiskNetting: missing ${key}`);
    }
    return params[key];
}

function _factorVector(factors) {
    return FACTORS.map(f => factors[f] || 0);
}

function _cosineSimilarity(v1, v2) {
    let dot = 0, n1 = 0, n2 = 0;
    for (let i = 0; i < v1.length; i++) {
        dot += v1[i] * v2[i];
        n1 += v1[i] * v1[i];
        n2 += v2[i] * v2[i];
    }
    if (n1 === 0 || n2 === 0) return 0;
    return dot / (Math.sqrt(n1) * Math.sqrt(n2));
}

function _dominantFactor(factors) {
    let max = 0, dom = FACTORS[0];
    for (const f of FACTORS) {
        const abs = Math.abs(factors[f] || 0);
        if (abs > max) {
            max = abs;
            dom = f;
        }
    }
    return dom;
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertExposure: db.prepare(`
        INSERT INTO ml_factor_exposures
        (user_id, resolved_env, position_id,
         btc_beta, market_beta, vol_factor,
         liquidity_factor, funding_factor, macro_factor,
         gross_exposure, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertDecision: db.prepare(`
        INSERT INTO ml_netting_decisions
        (user_id, resolved_env, decision_type, positions_json,
         dominant_factor, factor_overlap_score, recommended_action, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    factorTrend: db.prepare(`
        SELECT AVG(btc_beta) AS avg_btc, AVG(market_beta) AS avg_market,
               AVG(vol_factor) AS avg_vol, AVG(liquidity_factor) AS avg_liq,
               AVG(funding_factor) AS avg_funding, AVG(macro_factor) AS avg_macro,
               COUNT(*) AS samples
        FROM ml_factor_exposures
        WHERE user_id = ? AND resolved_env = ?
          AND ts >= ?
    `)
};

// ── decomposePosition ──────────────────────────────────────────────
// Computes factor exposures based on position properties + market context.
// Heuristics (production would use rolling regression vs factor returns).
function decomposePosition(params) {
    const position = _required(params, 'position');
    const marketContext = (params && params.marketContext) ? params.marketContext : {};

    const symbol = position.symbol || '';
    const size = position.size || 0;
    const leverage = position.leverage || 1;
    const isBtc = symbol.startsWith('BTC');
    const isAlt = symbol.endsWith('USDT') && !isBtc && !symbol.startsWith('ETH');

    // BTC beta: 1.0 for BTC, ~0.85 for ETH, ~0.65-0.95 for alts
    const btcBeta = isBtc ? 1.0 : (symbol.startsWith('ETH') ? 0.85 : 0.75);

    // Market beta: aggregate crypto market exposure
    const marketBeta = isBtc ? 0.95 : (isAlt ? 0.85 : 0.90);

    // Volatility factor: scales with leverage + symbol volatility
    const volContext = marketContext.symbolVol || (isBtc ? 0.6 : 0.9);
    const volFactor = volContext * Math.sqrt(leverage);

    // Liquidity factor: small altcoins higher liquidity risk
    const liquidityFactor = isBtc ? 0.1 : (isAlt ? 0.7 : 0.3);

    // Funding factor: long positions on high-funding pairs exposed
    const funding = marketContext.fundingRate || 0;
    const fundingFactor = position.side === 'LONG'
        ? Math.max(0, funding)
        : Math.max(0, -funding);

    // Macro factor: DXY/equity correlation; abs value indicates sensitivity
    const macroContext = marketContext.macroSensitivity || 0.4;
    const macroFactor = macroContext * (isBtc ? 0.8 : 0.5);

    // Sign by side: LONG positive, SHORT negative
    const sign = position.side === 'SHORT' ? -1 : 1;

    return {
        btc_beta: sign * btcBeta,
        market_beta: sign * marketBeta,
        vol_factor: volFactor,  // unsigned (risk always positive)
        liquidity_factor: liquidityFactor,
        funding_factor: fundingFactor,
        macro_factor: sign * macroFactor,
        grossExposure: Math.abs(size) * leverage
    };
}

// ── recordExposure ─────────────────────────────────────────────────
function recordExposure(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const positionId = _required(params, 'positionId');
    const factors = _required(params, 'factors');
    const grossExposure = _required(params, 'grossExposure');
    const ts = (params && params.ts) ? params.ts : Date.now();

    _stmts.insertExposure.run(
        userId, env, positionId,
        factors.btc_beta || 0,
        factors.market_beta || 0,
        factors.vol_factor || 0,
        factors.liquidity_factor || 0,
        factors.funding_factor || 0,
        factors.macro_factor || 0,
        grossExposure, ts
    );

    return { recorded: true };
}

// ── detectStackedRisk ──────────────────────────────────────────────
// Returns pairs of positions with cosine similarity > threshold —
// "different positions same bet" under different names.
function detectStackedRisk(params) {
    const positions = _required(params, 'positions');
    const threshold = (params && typeof params.threshold === 'number')
        ? params.threshold : STACKED_RISK_OVERLAP_THRESHOLD;

    if (!Array.isArray(positions) || positions.length < MIN_POSITIONS_FOR_STACK_DETECTION) {
        return { stackedPairs: [], anyStacked: false };
    }

    const vectors = positions.map(p => ({
        id: p.id,
        vec: _factorVector(p.factors)
    }));

    const stackedPairs = [];
    for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
            const sim = _cosineSimilarity(vectors[i].vec, vectors[j].vec);
            if (sim >= threshold) {
                stackedPairs.push({
                    posA: vectors[i].id,
                    posB: vectors[j].id,
                    similarity: sim
                });
            }
        }
    }

    return {
        stackedPairs,
        anyStacked: stackedPairs.length > 0
    };
}

// ── recommendNetting ───────────────────────────────────────────────
function recommendNetting(params) {
    const positions = _required(params, 'positions');

    if (!Array.isArray(positions) || positions.length < MIN_POSITIONS_FOR_STACK_DETECTION) {
        return {
            decision: 'HOLD',
            dominantFactor: 'none',
            factorOverlapScore: 0,
            reasoning: 'insufficient_positions'
        };
    }

    // Cosine similarity over all pairs
    const stack = detectStackedRisk({ positions });

    if (!stack.anyStacked) {
        return {
            decision: 'HOLD',
            dominantFactor: 'none',
            factorOverlapScore: 0,
            reasoning: 'no_stacked_risk_detected'
        };
    }

    // Max overlap pair drives decision
    const topPair = stack.stackedPairs.reduce(
        (m, p) => (p.similarity > m.similarity ? p : m),
        stack.stackedPairs[0]
    );

    const posA = positions.find(p => p.id === topPair.posA);
    const posB = positions.find(p => p.id === topPair.posB);
    const dominant = _dominantFactor(posA.factors);

    // Decision logic:
    //   - Same-side high overlap (both LONG or both SHORT same factor) → NET (combine into 1)
    //   - Opposite-side high overlap (one LONG, one SHORT same factor) → already hedged, HOLD or REPLACE
    //   - Cap concern → REDUCE
    //   - Different-factor partial overlap → HEDGE
    const sameSide = (posA.factors.btc_beta * posB.factors.btc_beta) > 0;
    const overlap = topPair.similarity;

    let decision, reasoning;
    if (overlap >= 0.90 && sameSide) {
        decision = 'NET';
        reasoning = `cosine ${overlap.toFixed(3)} same-side dominant=${dominant} — combine positions`;
    } else if (overlap >= 0.80 && !sameSide) {
        decision = 'HEDGE';
        reasoning = `cosine ${overlap.toFixed(3)} opposite-side — already hedged, monitor`;
    } else if (overlap >= 0.75) {
        decision = 'REDUCE';
        reasoning = `cosine ${overlap.toFixed(3)} — reduce smaller leg`;
    } else {
        decision = 'REPLACE';
        reasoning = `cosine ${overlap.toFixed(3)} — consider replacing one leg`;
    }

    return {
        decision,
        dominantFactor: dominant,
        factorOverlapScore: overlap,
        reasoning,
        topPair
    };
}

// ── recordNettingDecision ──────────────────────────────────────────
function recordNettingDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionType = _required(params, 'decisionType');
    const positions = _required(params, 'positions');
    const dominantFactor = _required(params, 'dominantFactor');
    const factorOverlapScore = _required(params, 'factorOverlapScore');
    const recommendedAction = (params && params.recommendedAction) ? params.recommendedAction : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!NETTING_DECISIONS.includes(decisionType)) {
        throw new Error(`factorRiskNetting: invalid decisionType "${decisionType}"`);
    }

    _stmts.insertDecision.run(
        userId, env, decisionType,
        JSON.stringify(positions),
        dominantFactor, factorOverlapScore,
        recommendedAction, ts
    );

    return { recorded: true };
}

// ── getFactorTrend ─────────────────────────────────────────────────
function getFactorTrend(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const row = _stmts.factorTrend.get(userId, env, since);

    return {
        samples: row.samples || 0,
        btcBeta: row.avg_btc || 0,
        marketBeta: row.avg_market || 0,
        volFactor: row.avg_vol || 0,
        liquidityFactor: row.avg_liq || 0,
        fundingFactor: row.avg_funding || 0,
        macroFactor: row.avg_macro || 0
    };
}

module.exports = {
    FACTORS,
    NETTING_DECISIONS,
    STACKED_RISK_OVERLAP_THRESHOLD,
    MIN_POSITIONS_FOR_STACK_DETECTION,
    decomposePosition,
    recordExposure,
    detectStackedRisk,
    recommendNetting,
    recordNettingDecision,
    getFactorTrend
};
