'use strict';

/**
 * OMEGA R2 Cognition — optionsContextAnalyzer (canonical §32)
 *
 * §32 OPTIONS / GEX / MAX PAIN.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1313-1321.
 *
 * 5 monitoring requirements (lines 1315-1319):
 *   - GEX (gamma exposure)
 *   - gamma pin (large gamma strikes attract price)
 *   - gamma squeeze risk (short gamma + volatility amplification)
 *   - max pain (strike of minimum option value at expiry)
 *   - expirari saptamanale / lunare
 *
 * Awareness (line 1320):
 *   MM hedging poate crea niveluri magnet si respingeri reale.
 *
 * INVARIANT (line 1321):
 *   "options data nu este obligatoriu semnal primar, dar poate modifica
 *    bias-ul, riscul si probabilitatea de reversion / pinning"
 *   → evaluateBiasModifier caps cumulative options effect at
 *     INVARIANT_MAX_BIAS_MODIFIER = 0.15 (well below decision thresholds).
 */

const { db } = require('../../database');

const OPTIONS_SIGNAL_TYPES = Object.freeze([
    'gex_profile',
    'gamma_pin',
    'gamma_squeeze',
    'max_pain',
    'expiration_proximity'
]);

const EXPIRY_PERIODS = Object.freeze(['weekly', 'monthly']);

// INVARIANT line 1321: options doar modifica, nu da signal singure.
const INVARIANT_MAX_BIAS_MODIFIER = 0.15;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`optionsContextAnalyzer: missing ${key}`);
    }
    return params[key];
}

function _clampUnit(x) {
    return Math.max(0, Math.min(1, x));
}

// ── analyzeGex (pure) ──────────────────────────────────────────────
function analyzeGex(params) {
    const optionsData = (params && params.optionsData) ? params.optionsData : {};
    const gammaByStrike = optionsData.gammaExposureByStrike || {};

    let netGex = 0;
    for (const v of Object.values(gammaByStrike)) {
        if (typeof v === 'number') netGex += v;
    }

    let regime;
    if (netGex === 0) regime = 'NEUTRAL';
    else if (netGex > 0) regime = 'LONG_GAMMA';
    else regime = 'SHORT_GAMMA';

    return {
        netGex,
        gexProfile: gammaByStrike,
        regime
    };
}

// ── findGammaPin (pure) ────────────────────────────────────────────
function findGammaPin(params) {
    const optionsData = (params && params.optionsData) ? params.optionsData : {};
    const currentPrice = _required(params, 'currentPrice');
    const gammaByStrike = optionsData.gammaExposureByStrike || {};

    let maxStrike = null;
    let maxGamma = 0;
    for (const [strikeStr, gamma] of Object.entries(gammaByStrike)) {
        const absGamma = Math.abs(gamma);
        if (absGamma > maxGamma) {
            maxGamma = absGamma;
            maxStrike = Number(strikeStr);
        }
    }

    if (!maxStrike) {
        return { pinLevel: null, pinStrength: 0, attraction: 0 };
    }

    // Attraction inversely proportional to distance
    const distancePct = Math.abs(currentPrice - maxStrike) / maxStrike;
    const attraction = _clampUnit(1 / (1 + distancePct * 50));
    const pinStrength = _clampUnit(maxGamma / 5000000);

    return {
        pinLevel: maxStrike,
        pinStrength,
        attraction,
        distancePct
    };
}

// ── assessGammaSqueezeRisk (pure) ──────────────────────────────────
function assessGammaSqueezeRisk(params) {
    const optionsData = (params && params.optionsData) ? params.optionsData : {};
    const openInterest = (params && typeof params.openInterest === 'number')
        ? params.openInterest : 0;
    const volatility = (params && typeof params.volatility === 'number')
        ? params.volatility : 0.02;
    const gammaByStrike = optionsData.gammaExposureByStrike || {};

    let totalGamma = 0;
    let shortGammaCount = 0;
    for (const v of Object.values(gammaByStrike)) {
        if (typeof v === 'number') {
            totalGamma += v;
            if (v < 0) shortGammaCount++;
        }
    }

    if (totalGamma >= 0) {
        return {
            squeezeRisk: 0.1,
            direction: 'NEUTRAL',
            netGamma: totalGamma
        };
    }

    // Squeeze risk: short gamma magnitude × volatility × OI density
    const gammaMag = Math.abs(totalGamma);
    const sizeFactor = _clampUnit(gammaMag / 10000000);
    const volFactor = _clampUnit(volatility / 0.10);
    const oiFactor = _clampUnit(openInterest / 50000000);
    const squeezeRisk = _clampUnit(sizeFactor * 0.5 + volFactor * 0.3 + oiFactor * 0.2);

    return {
        squeezeRisk,
        direction: shortGammaCount > 1 ? 'UP' : 'NEUTRAL',
        netGamma: totalGamma
    };
}

// ── calculateMaxPain (pure) ────────────────────────────────────────
function calculateMaxPain(params) {
    const strikes = _required(params, 'strikes');
    const optionsData = (params && params.optionsData) ? params.optionsData : {};
    const callOI = optionsData.openInterestCalls || {};
    const putOI = optionsData.openInterestPuts || {};
    const currentPrice = (params && typeof params.currentPrice === 'number')
        ? params.currentPrice : null;

    // For each strike, total option value at expiry = sum of intrinsic values
    let minTotal = Infinity;
    let maxPainPrice = strikes[0];

    for (const strike of strikes) {
        let total = 0;
        // Calls in-the-money if expiry > strike
        for (const [s, oi] of Object.entries(callOI)) {
            const sNum = Number(s);
            if (strike > sNum) total += (strike - sNum) * oi;
        }
        // Puts in-the-money if expiry < strike
        for (const [s, oi] of Object.entries(putOI)) {
            const sNum = Number(s);
            if (strike < sNum) total += (sNum - strike) * oi;
        }
        if (total < minTotal) {
            minTotal = total;
            maxPainPrice = strike;
        }
    }

    const distance = currentPrice !== null ? maxPainPrice - currentPrice : null;

    return {
        maxPainPrice,
        distance,
        totalValueAtMaxPain: minTotal === Infinity ? 0 : minTotal
    };
}

// ── getExpirationContext (pure) ────────────────────────────────────
function getExpirationContext(params) {
    const optionsData = (params && params.optionsData) ? params.optionsData : {};
    const currentDate = _required(params, 'currentDate');
    const expirations = optionsData.expirations || {};

    let dteWeekly = null;
    let dteMonthly = null;

    if (expirations.weekly) {
        const wExpiry = new Date(expirations.weekly).getTime();
        dteWeekly = (wExpiry - currentDate) / 86400000;
    }
    if (expirations.monthly) {
        const mExpiry = new Date(expirations.monthly).getTime();
        dteMonthly = (mExpiry - currentDate) / 86400000;
    }

    return {
        nextExpiry: expirations.weekly || expirations.monthly || null,
        dteWeekly,
        dteMonthly
    };
}

// ── evaluateBiasModifier — INVARIANT line 1321 ─────────────────────
function evaluateBiasModifier(params) {
    const ctx = (params && params.optionsContext) ? params.optionsContext : {};
    const primarySignal = (params && typeof params.primarySignal === 'number')
        ? params.primarySignal : 0;

    let cumulative = 0;
    let components = [];

    if (ctx.gexRegime === 'SHORT_GAMMA') {
        cumulative -= 0.05;  // amplifies adverse moves, slight bearish bias
        components.push({ source: 'gex_short_gamma', delta: -0.05 });
    } else if (ctx.gexRegime === 'LONG_GAMMA') {
        cumulative += 0.03;  // MM hedge stabilizes
        components.push({ source: 'gex_long_gamma', delta: 0.03 });
    }

    if (typeof ctx.gammaPinAttraction === 'number') {
        const delta = ctx.gammaPinAttraction * 0.08;
        cumulative += delta;
        components.push({ source: 'gamma_pin', delta });
    }
    if (typeof ctx.squeezeRisk === 'number') {
        const delta = -ctx.squeezeRisk * 0.10;  // squeeze = risk reducer
        cumulative += delta;
        components.push({ source: 'squeeze_risk', delta });
    }

    // INVARIANT: cap cumulative at MAX_BIAS_MODIFIER
    const capped = Math.abs(cumulative) > INVARIANT_MAX_BIAS_MODIFIER;
    const biasAdjustment = capped
        ? Math.sign(cumulative) * INVARIANT_MAX_BIAS_MODIFIER
        : cumulative;

    const modifiedSignal = _clampUnit(primarySignal + biasAdjustment);

    return {
        biasAdjustment,
        modifiedSignal,
        capped,
        components,
        primarySignal,
        invariantMax: INVARIANT_MAX_BIAS_MODIFIER
    };
}

// ── Prepared statement ─────────────────────────────────────────────
const _stmts = {
    insertObservation: db.prepare(`
        INSERT INTO ml_options_observations
        (user_id, resolved_env, observation_type, payload_json, symbol, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `)
};

// ── recordObservation ──────────────────────────────────────────────
function recordObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const observationType = _required(params, 'observationType');
    const payload = _required(params, 'payload');
    const symbol = (params && params.symbol) ? params.symbol : null;

    if (!OPTIONS_SIGNAL_TYPES.includes(observationType)) {
        throw new Error(`optionsContextAnalyzer: invalid observationType "${observationType}"`);
    }

    _stmts.insertObservation.run(
        userId, env, observationType,
        JSON.stringify(payload), symbol, Date.now()
    );

    return { recorded: true, observationType };
}

module.exports = {
    OPTIONS_SIGNAL_TYPES,
    EXPIRY_PERIODS,
    INVARIANT_MAX_BIAS_MODIFIER,
    analyzeGex,
    findGammaPin,
    assessGammaSqueezeRisk,
    calculateMaxPain,
    getExpirationContext,
    evaluateBiasModifier,
    recordObservation
};
