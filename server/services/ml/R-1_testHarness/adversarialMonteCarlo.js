'use strict';

/**
 * OMEGA R-1 Test Harness — adversarialMonteCarlo (canonical §53)
 *
 * §53 ADVERSARIAL SUITE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 1587.
 *
 * "Adversarial suite: defineste scenarii (funding spike, OI cascade,
 *  venue outage), ruleaza Monte-Carlo PnL sub stres."
 *
 * Statistical PnL distribution under specific stress scenarios. Distinct
 * de §44 adversarialSelfTester (binary "safety hold?"). §53 returns
 * quantitative percentile distribution per scenario type.
 *
 * Five scenario types:
 *   - funding_spike       random ±200-1000bps funding hit, skewed adverse
 *   - oi_cascade          liquidation chain, position size 30-70% reduced
 *   - venue_outage        positions stuck 1-30min, random walk no-close
 *   - flash_crash         -8% to -15% drop within 5min, recovery uncertain
 *   - liquidity_evaporation  spread 5-20x, compounding slippage
 */

const { db } = require('../../database');

const SCENARIO_TYPES = Object.freeze([
    'funding_spike',
    'oi_cascade',
    'venue_outage',
    'flash_crash',
    'liquidity_evaporation'
]);
const DEFAULT_NUM_SIMULATIONS = 1000;
const STRESS_PERCENTILES = Object.freeze([5, 50, 95, 99]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`adversarialMonteCarlo: missing ${key}`);
    }
    return params[key];
}

function _percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const idx = Math.min(
        sortedArr.length - 1,
        Math.max(0, Math.floor((p / 100) * sortedArr.length))
    );
    return sortedArr[idx];
}

function _normalRandom() {
    // Box-Muller-ish; sum of 12 uniform − 6 approximates standard normal.
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Math.random();
    return sum - 6;
}

// ── Scenario impact functions ──────────────────────────────────────
// Each returns "stress factor": multiplier on basePnl (1.0 = no change,
// 0.5 = 50% loss, -0.2 = 120% loss / wipeout-and-more).
function _applyFundingSpike(positions, params) {
    // Random funding hit ±200-1000bps, skewed adverse 70% of the time.
    const isAdverse = Math.random() < 0.70;
    const bpsRange = 200 + Math.random() * 800;
    const direction = isAdverse ? -1 : 1;
    const effectBps = direction * bpsRange;
    return 1 + effectBps / 10000;
}

function _applyOiCascade(positions, params) {
    // Position size reduced 30-70% at fire-sale prices (adverse).
    const reductionPct = 0.30 + Math.random() * 0.40;
    const firesaleSlippage = 0.02 + Math.random() * 0.05;  // 2-7% slippage
    return -(reductionPct * (1 + firesaleSlippage));
}

function _applyVenueOutage(positions, params) {
    // Stuck duration leads to random walk; with mean reversion bias toward 0.
    const stuckMinutes = 1 + Math.random() * 29;
    const variance = stuckMinutes / 30;  // longer outage → more variance
    return _normalRandom() * variance * 0.5;  // ±50% drift over max window
}

function _applyFlashCrash(positions, params) {
    // -8% to -15% drop. Recovery: 40% partial, 30% full, 30% sustained.
    const dropPct = 0.08 + Math.random() * 0.07;
    const recoveryRoll = Math.random();
    let recoveryFactor;
    if (recoveryRoll < 0.30) recoveryFactor = 0;        // sustained loss
    else if (recoveryRoll < 0.60) recoveryFactor = 0.5; // partial recovery
    else recoveryFactor = 1.0;                          // full recovery
    return -dropPct * (1 - recoveryFactor);
}

function _applyLiquidityEvaporation(positions, params) {
    // Spread widens 5-20x. Slippage compounds across each exit attempt.
    const spreadMultiplier = 5 + Math.random() * 15;
    const baselineSpreadBps = 5;
    const totalSlippage = (baselineSpreadBps * spreadMultiplier) / 10000;
    return -totalSlippage;
}

const SCENARIO_FNS = {
    funding_spike: _applyFundingSpike,
    oi_cascade: _applyOiCascade,
    venue_outage: _applyVenueOutage,
    flash_crash: _applyFlashCrash,
    liquidity_evaporation: _applyLiquidityEvaporation
};

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertRun: db.prepare(`
        INSERT INTO ml_adversarial_mc_runs
        (user_id, resolved_env, scenario_type, scenario_params_json,
         num_simulations, base_pnl, mc_mean_pnl,
         mc_p5_pnl, mc_p50_pnl, mc_p95_pnl, mc_p99_pnl,
         max_drawdown, max_loss, stress_factor, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    statsForScenario: db.prepare(`
        SELECT COUNT(*) AS samples,
               AVG(mc_mean_pnl) AS avg_mean,
               AVG(mc_p5_pnl) AS avg_p5,
               AVG(max_drawdown) AS avg_max_dd
        FROM ml_adversarial_mc_runs
        WHERE user_id = ? AND resolved_env = ? AND scenario_type = ?
          AND ts >= ?
    `)
};

// ── defineScenario ─────────────────────────────────────────────────
function defineScenario(params) {
    const scenarioType = _required(params, 'scenarioType');
    if (!SCENARIO_TYPES.includes(scenarioType)) {
        throw new Error(`adversarialMonteCarlo: unknown scenarioType "${scenarioType}"`);
    }
    return {
        scenarioType,
        params: (params && params.params) ? params.params : {},
        fn: SCENARIO_FNS[scenarioType]
    };
}

// ── runMonteCarlo ──────────────────────────────────────────────────
function runMonteCarlo(params) {
    const scenarioType = _required(params, 'scenarioType');
    const basePnl = _required(params, 'basePnl');
    const basePositions = (params && params.basePositions) ? params.basePositions : [];
    const numSimulations = (params && typeof params.numSimulations === 'number')
        ? params.numSimulations : DEFAULT_NUM_SIMULATIONS;
    const scenarioParams = (params && params.scenarioParams) ? params.scenarioParams : {};

    if (!SCENARIO_TYPES.includes(scenarioType)) {
        throw new Error(`adversarialMonteCarlo: invalid scenarioType "${scenarioType}"`);
    }
    if (numSimulations < 1) {
        throw new Error('adversarialMonteCarlo: numSimulations must be >= 1');
    }

    const scenarioFn = SCENARIO_FNS[scenarioType];
    const pnlResults = [];
    let maxDd = 0;
    let runningPeak = 0;
    let runningPnl = 0;

    for (let i = 0; i < numSimulations; i++) {
        const stressFactor = scenarioFn(basePositions, scenarioParams);
        const simPnl = basePnl * (1 + stressFactor);
        pnlResults.push(simPnl);

        // Track drawdown across simulations as time-ordered series.
        runningPnl = simPnl;
        if (runningPnl > runningPeak) runningPeak = runningPnl;
        const dd = runningPeak - runningPnl;
        if (dd > maxDd) maxDd = dd;
    }

    pnlResults.sort((a, b) => a - b);

    const mean = pnlResults.reduce((s, x) => s + x, 0) / pnlResults.length;
    const p5 = _percentile(pnlResults, 5);
    const p50 = _percentile(pnlResults, 50);
    const p95 = _percentile(pnlResults, 95);
    const p99 = _percentile(pnlResults, 99);
    const maxLoss = pnlResults[0];
    const avgStressFactor = (mean - basePnl) / Math.abs(basePnl || 1);

    return {
        scenarioType,
        numSimulations,
        basePnl,
        mean,
        p5, p50, p95, p99,
        maxDrawdown: maxDd,
        maxLoss,
        stressFactor: avgStressFactor
    };
}

// ── stressTestPortfolio ────────────────────────────────────────────
function stressTestPortfolio(params) {
    const portfolio = _required(params, 'portfolio');
    const scenarios = _required(params, 'scenarios');
    const numSimulations = (params && params.numSimulations) ? params.numSimulations : 100;

    if (!Array.isArray(scenarios) || scenarios.length === 0) {
        throw new Error('adversarialMonteCarlo: scenarios must be non-empty array');
    }

    const results = [];
    let worstCase = null;

    for (const scenarioType of scenarios) {
        const r = runMonteCarlo({
            scenarioType,
            basePnl: portfolio.basePnl || 0,
            basePositions: portfolio.positions || [],
            numSimulations
        });
        results.push(r);
        if (worstCase === null || r.maxLoss < worstCase.maxLoss) {
            worstCase = r;
        }
    }

    return {
        scenarios: results,
        worstCase: worstCase ? worstCase.scenarioType : null,
        worstCaseLoss: worstCase ? worstCase.maxLoss : null
    };
}

// ── recordAdversarialRun ───────────────────────────────────────────
function recordAdversarialRun(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const scenarioType = _required(params, 'scenarioType');
    const result = _required(params, 'result');
    const scenarioParams = (params && params.scenarioParams) ? params.scenarioParams : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!SCENARIO_TYPES.includes(scenarioType)) {
        throw new Error(`adversarialMonteCarlo: invalid scenarioType "${scenarioType}"`);
    }

    _stmts.insertRun.run(
        userId, env, scenarioType,
        scenarioParams ? JSON.stringify(scenarioParams) : null,
        result.numSimulations,
        result.basePnl,
        result.mean,
        result.p5, result.p50, result.p95, result.p99,
        result.maxDrawdown,
        result.maxLoss,
        result.stressFactor,
        ts
    );

    return { recorded: true };
}

// ── getAdversarialStats ────────────────────────────────────────────
function getAdversarialStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const scenarioType = _required(params, 'scenarioType');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const row = _stmts.statsForScenario.get(userId, env, scenarioType, since);

    return {
        scenarioType,
        samples: row.samples || 0,
        avgMeanPnl: row.avg_mean || 0,
        avgP5Pnl: row.avg_p5 || 0,
        avgMaxDrawdown: row.avg_max_dd || 0
    };
}

module.exports = {
    SCENARIO_TYPES,
    DEFAULT_NUM_SIMULATIONS,
    STRESS_PERCENTILES,
    defineScenario,
    runMonteCarlo,
    stressTestPortfolio,
    recordAdversarialRun,
    getAdversarialStats
};
