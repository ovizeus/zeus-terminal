'use strict';

/**
 * OMEGA R5A Learning — counterfactualMarketBaseline (canonical §76)
 *
 * §76 COUNTERFACTUAL MARKET BASELINE — separa alpha real de miscarea pietei.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1982-1983.
 *
 * "Daca BTC urca 3% si trade-ul tau long a castigat 2.8% — performanta
 *  sau ai pierdut fata de hold? Fara baseline: bull market face orice
 *  bot sa para geniu. Singura masura care conteaza cu adevarat: alpha
 *  real fata de beta de piata."
 *
 * R5A. Shadow HODL portfolio ("nicio actiune") tracked continuously.
 * alpha_real = bot_pnl - baseline_hodl_pnl (absolute)
 * alpha_pct  = alpha_real / baseline_initial_value × 100
 *
 * Distinct from:
 *   - §16 attributionEngine (per-trade win/loss + cause)
 *   - §42 counterfactualEngine (alternative entry/SL/size per trade)
 *   - §242 counterfactualPortfolio ("what if we did NOT take THIS trade")
 * §76 = continuous portfolio-level shadow baseline.
 */

const { db } = require('../../database');

const MARKET_REGIMES = Object.freeze([
    'bull', 'bear', 'range', 'high_vol', 'low_vol'
]);
const ALPHA_POSITIVE_THRESHOLD = 0.0;
const ALPHA_SIGNIFICANT_THRESHOLD_PCT = 5.0;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`counterfactualMarketBaseline: missing ${key}`);
    }
    return params[key];
}

function _percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const idx = Math.min(
        sortedArr.length - 1,
        Math.max(0, Math.floor(p * sortedArr.length))
    );
    return sortedArr[idx];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    upsertBaseline: db.prepare(`
        INSERT INTO ml_inactivity_baseline_snapshots
        (user_id, resolved_env, asset, hodl_quantity, mark_price,
         hodl_value, initial_value, ts, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, asset) DO UPDATE SET
            mark_price = excluded.mark_price,
            hodl_value = excluded.hodl_value,
            last_updated = excluded.last_updated
    `),
    getBaseline: db.prepare(`
        SELECT * FROM ml_inactivity_baseline_snapshots
        WHERE user_id = ? AND resolved_env = ? AND asset = ?
    `),
    insertAlphaObs: db.prepare(`
        INSERT INTO ml_alpha_observations
        (user_id, resolved_env, period_id, asset,
         bot_pnl, baseline_pnl, alpha_real, alpha_pct,
         market_regime, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    alphaHistory: db.prepare(`
        SELECT * FROM ml_alpha_observations
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR asset = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `),
    alphaSummary: db.prepare(`
        SELECT alpha_real, alpha_pct FROM ml_alpha_observations
        WHERE user_id = ? AND resolved_env = ?
          AND ts >= ?
    `)
};

// ── initializeBaseline ─────────────────────────────────────────────
function initializeBaseline(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const asset = _required(params, 'asset');
    const initialQuantity = _required(params, 'initialQuantity');
    const initialPrice = _required(params, 'initialPrice');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (initialQuantity <= 0 || initialPrice <= 0) {
        throw new Error('counterfactualMarketBaseline: quantity and price must be positive');
    }

    const initialValue = initialQuantity * initialPrice;

    _stmts.upsertBaseline.run(
        userId, env, asset,
        initialQuantity, initialPrice,
        initialValue, initialValue,
        ts, ts
    );

    return { initialized: true, initialValue };
}

// ── recordBaselineSnapshot ─────────────────────────────────────────
function recordBaselineSnapshot(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const asset = _required(params, 'asset');
    const markPrice = _required(params, 'markPrice');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (markPrice <= 0) {
        throw new Error('counterfactualMarketBaseline: markPrice must be positive');
    }

    const current = _stmts.getBaseline.get(userId, env, asset);
    if (!current) {
        throw new Error(`counterfactualMarketBaseline: baseline not initialized for ${asset}`);
    }

    const newValue = current.hodl_quantity * markPrice;
    _stmts.upsertBaseline.run(
        userId, env, asset,
        current.hodl_quantity, markPrice,
        newValue, current.initial_value,
        current.ts, ts
    );

    return { updated: true, newValue, baselinePnl: newValue - current.initial_value };
}

// ── computeAlphaVsBaseline ─────────────────────────────────────────
function computeAlphaVsBaseline(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const asset = _required(params, 'asset');
    const currentBotPnl = _required(params, 'currentBotPnl');

    const baseline = _stmts.getBaseline.get(userId, env, asset);
    if (!baseline) {
        return { sufficient: false, reason: 'baseline_not_initialized' };
    }

    const baselinePnl = baseline.hodl_value - baseline.initial_value;
    const alphaReal = currentBotPnl - baselinePnl;
    const alphaPct = baseline.initial_value > 0
        ? (alphaReal / baseline.initial_value) * 100
        : 0;

    return {
        sufficient: true,
        botPnl: currentBotPnl,
        baselinePnl,
        alphaReal,
        alphaPct,
        baselineInitialValue: baseline.initial_value,
        baselineCurrentValue: baseline.hodl_value,
        positiveAlpha: alphaReal > ALPHA_POSITIVE_THRESHOLD,
        significantAlpha: Math.abs(alphaPct) >= ALPHA_SIGNIFICANT_THRESHOLD_PCT
    };
}

// ── recordAlphaObservation ─────────────────────────────────────────
function recordAlphaObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const periodId = _required(params, 'periodId');
    const asset = _required(params, 'asset');
    const botPnl = _required(params, 'botPnl');
    const baselinePnl = _required(params, 'baselinePnl');
    const marketRegime = _required(params, 'marketRegime');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!MARKET_REGIMES.includes(marketRegime)) {
        throw new Error(`counterfactualMarketBaseline: invalid marketRegime "${marketRegime}"`);
    }

    const baseline = _stmts.getBaseline.get(userId, env, asset);
    const initialValue = baseline ? baseline.initial_value : 1;
    const alphaReal = botPnl - baselinePnl;
    const alphaPct = initialValue > 0 ? (alphaReal / initialValue) * 100 : 0;

    _stmts.insertAlphaObs.run(
        userId, env, periodId, asset,
        botPnl, baselinePnl, alphaReal, alphaPct,
        marketRegime, ts
    );

    return { recorded: true, alphaReal, alphaPct };
}

// ── getCurrentBaselineValue ────────────────────────────────────────
function getCurrentBaselineValue(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const asset = _required(params, 'asset');
    const row = _stmts.getBaseline.get(userId, env, asset);
    if (!row) return { exists: false };
    return {
        exists: true,
        asset: row.asset,
        hodlQuantity: row.hodl_quantity,
        markPrice: row.mark_price,
        hodlValue: row.hodl_value,
        initialValue: row.initial_value,
        baselinePnl: row.hodl_value - row.initial_value
    };
}

// ── getAlphaHistory ────────────────────────────────────────────────
function getAlphaHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const asset = (params && params.asset) ? params.asset : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.alphaHistory.all(
        userId, env,
        asset, asset,
        since > 0 ? 1 : 0, since,
        limit
    );
}

// ── getAlphaSummary ────────────────────────────────────────────────
function getAlphaSummary(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.alphaSummary.all(userId, env, since);
    if (rows.length === 0) {
        return { samples: 0, avgAlphaPct: 0 };
    }

    const sortedAlpha = rows.map(r => r.alpha_pct).sort((a, b) => a - b);
    const avg = sortedAlpha.reduce((s, x) => s + x, 0) / sortedAlpha.length;

    return {
        samples: rows.length,
        avgAlphaPct: avg,
        p25AlphaPct: _percentile(sortedAlpha, 0.25),
        p50AlphaPct: _percentile(sortedAlpha, 0.50),
        p75AlphaPct: _percentile(sortedAlpha, 0.75)
    };
}

module.exports = {
    MARKET_REGIMES,
    ALPHA_POSITIVE_THRESHOLD,
    ALPHA_SIGNIFICANT_THRESHOLD_PCT,
    initializeBaseline,
    recordBaselineSnapshot,
    computeAlphaVsBaseline,
    recordAlphaObservation,
    getCurrentBaselineValue,
    getAlphaHistory,
    getAlphaSummary
};
