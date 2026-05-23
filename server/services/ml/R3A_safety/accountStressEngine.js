'use strict';

/**
 * OMEGA R3A Safety — accountStressEngine (canonical §88)
 *
 * §88 ACCOUNT LIQUIDATION SURFACE / PATH-DEPENDENT MARGIN STRESS.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2290-2333.
 *
 * "In cross-margin, riscul real NU este suma liniara a trade-urilor.
 *  Ordinea in care se misca activele conteaza.
 *  Nu doar daca pot pierde, ci prin ce secventa devine vulnerabil."
 *
 * R3A safety. Path-dependent stress simulation across 6 trajectory
 * scenarios. Distinct from §53 adversarialMonteCarlo (random shocks)
 * — §88 = explicit ordered path simulation with margin tracking.
 *
 * Per spec rules:
 *   - Stress evaluated continuously
 *   - Apropierea de liquidation surface → reduce size + agresivitate
 *   - Cross-margin = sistem dinamic, NU static
 */

const { db } = require('../../database');

const PATH_TYPES = Object.freeze([
    'trend_adverse', 'whipsaw', 'spike_retrace',
    'funding_shock', 'volatility_expansion', 'correlation_breakdown'
]);
const RECOMMENDED_ACTIONS = Object.freeze([
    'CONTINUE', 'REDUCE_SIZE', 'DEFENSIVE', 'CLOSE_PARTIAL', 'EMERGENCY_EXIT'
]);
const WARNING_SEVERITIES = Object.freeze(['info', 'warn', 'critical']);

const DEFAULT_TRAJECTORY_STEPS = 20;
const LIQUIDATION_DANGER_PCT = 0.80;
const WARNING_DANGER_PCT = 0.60;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`accountStressEngine: missing ${key}`);
    }
    return params[key];
}

// ── Path generators ────────────────────────────────────────────────
function _generatePath(pathType, steps, severity) {
    const sev = (typeof severity === 'number') ? severity : 1.0;
    const path = [];

    if (pathType === 'trend_adverse') {
        // Monotonic adverse move: -0.10 × sev over `steps` total
        for (let i = 0; i < steps; i++) {
            path.push(-0.10 * sev * (i + 1) / steps);
        }
    } else if (pathType === 'whipsaw') {
        // Oscillating: -5, +3, -7, +2, ...
        let cum = 0;
        for (let i = 0; i < steps; i++) {
            const move = (i % 2 === 0) ? -0.05 * sev : 0.03 * sev;
            cum += move;
            path.push(cum);
        }
    } else if (pathType === 'spike_retrace') {
        // Spike to -15%, then retrace to -7.5%
        const halfway = Math.floor(steps / 2);
        for (let i = 0; i < steps; i++) {
            if (i < halfway) {
                path.push(-0.15 * sev * (i + 1) / halfway);
            } else {
                const recovery = (i - halfway) / (steps - halfway);
                path.push(-0.15 * sev + (0.075 * sev * recovery));
            }
        }
    } else if (pathType === 'funding_shock') {
        // Funding 5× normal accumulates over time
        for (let i = 0; i < steps; i++) {
            path.push(-0.005 * sev * (i + 1));   // 50bps/step × multiplier
        }
    } else if (pathType === 'volatility_expansion') {
        // Random adverse moves: -2% per step on average
        for (let i = 0; i < steps; i++) {
            path.push(-0.02 * sev * (i + 1));
        }
    } else if (pathType === 'correlation_breakdown') {
        // Hedged positions un-hedge: progressive divergence
        for (let i = 0; i < steps; i++) {
            path.push(-0.03 * sev * Math.sqrt(i + 1));   // sublinear adverse
        }
    }

    return path;
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertSimulation: db.prepare(`
        INSERT INTO ml_account_stress_simulations
        (user_id, resolved_env, simulation_id, portfolio_snapshot_json,
         path_type, trajectory_steps_json, distance_to_liquidation,
         peak_margin_used_pct, liquidation_triggered, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertWarning: db.prepare(`
        INSERT INTO ml_liquidation_warnings
        (user_id, resolved_env, warning_id, portfolio_snapshot_json,
         closest_path, distance, recommended_action, severity, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    stressHistory: db.prepare(`
        SELECT * FROM ml_account_stress_simulations
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `),
    warningHistory: db.prepare(`
        SELECT * FROM ml_liquidation_warnings
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR severity = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── simulatePath (pure) ────────────────────────────────────────────
function simulatePath(params) {
    const portfolio = _required(params, 'portfolio');
    const pathType = _required(params, 'pathType');
    const steps = (params && params.steps) ? params.steps : DEFAULT_TRAJECTORY_STEPS;
    const severity = (params && typeof params.severity === 'number') ? params.severity : 1.0;

    if (!PATH_TYPES.includes(pathType)) {
        throw new Error(`accountStressEngine: invalid pathType "${pathType}"`);
    }

    const initialEquity = portfolio.equity || 0;
    const positionNotional = portfolio.positionNotional || 0;
    const maintenanceMarginPct = portfolio.maintenanceMarginPct || 0.05;

    if (initialEquity <= 0 || positionNotional <= 0) {
        return {
            trajectorySteps: [],
            peakMarginUsedPct: 0,
            distanceToLiquidation: Infinity,
            liquidationTriggered: false
        };
    }

    const priceMoves = _generatePath(pathType, steps, severity);
    let liquidationTriggered = false;
    let peakMarginUsedPct = 0;
    const trajectory = [];

    for (let i = 0; i < priceMoves.length; i++) {
        const move = priceMoves[i];
        const pnl = positionNotional * move;
        const currentEquity = initialEquity + pnl;
        const requiredMargin = positionNotional * maintenanceMarginPct;
        const marginUsedPct = currentEquity > 0 ? requiredMargin / currentEquity : 1.0;

        if (marginUsedPct > peakMarginUsedPct) peakMarginUsedPct = marginUsedPct;
        if (currentEquity <= requiredMargin) liquidationTriggered = true;

        trajectory.push({
            step: i, priceMove: move, equity: currentEquity,
            marginUsedPct, liquidated: liquidationTriggered
        });

        if (liquidationTriggered) break;
    }

    const distanceToLiquidation = liquidationTriggered ? 0 : 1 - peakMarginUsedPct;

    return {
        trajectorySteps: trajectory,
        peakMarginUsedPct,
        distanceToLiquidation,
        liquidationTriggered
    };
}

// ── computeLiquidationDistance (pure) ──────────────────────────────
function computeLiquidationDistance(params) {
    const portfolio = _required(params, 'portfolio');
    const currentEquity = _required(params, 'currentEquity');
    const maintenanceMarginPct = (params && typeof params.maintenanceMarginPct === 'number')
        ? params.maintenanceMarginPct : 0.05;

    const positionNotional = portfolio.positionNotional || 0;
    if (positionNotional <= 0) return { distancePct: 1.0, marginUsedPct: 0 };

    const requiredMargin = positionNotional * maintenanceMarginPct;
    const marginUsedPct = currentEquity > 0 ? requiredMargin / currentEquity : 1.0;
    const distancePct = Math.max(0, 1 - marginUsedPct);

    return { distancePct, marginUsedPct };
}

// ── runStressSurface ───────────────────────────────────────────────
function runStressSurface(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const simulationId = _required(params, 'simulationId');
    const portfolio = _required(params, 'portfolio');
    const paths = (params && params.paths) ? params.paths : PATH_TYPES;
    const severity = (params && typeof params.severity === 'number') ? params.severity : 1.0;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const results = [];
    let worstCase = null;
    let worstDistance = Infinity;

    for (const pathType of paths) {
        if (!PATH_TYPES.includes(pathType)) continue;
        const sim = simulatePath({ portfolio, pathType, severity });
        results.push({
            pathType,
            peakMarginUsedPct: sim.peakMarginUsedPct,
            distanceToLiquidation: sim.distanceToLiquidation,
            liquidationTriggered: sim.liquidationTriggered
        });

        if (sim.distanceToLiquidation < worstDistance) {
            worstDistance = sim.distanceToLiquidation;
            worstCase = { pathType, sim };
        }
    }

    if (!worstCase) {
        return { runs: 0, results: [], worstPath: null };
    }

    // Persist worst-case as the canonical sim row
    try {
        _stmts.insertSimulation.run(
            userId, env, simulationId,
            JSON.stringify(portfolio),
            worstCase.pathType,
            JSON.stringify(worstCase.sim.trajectorySteps),
            worstCase.sim.distanceToLiquidation,
            worstCase.sim.peakMarginUsedPct,
            worstCase.sim.liquidationTriggered ? 1 : 0,
            ts
        );
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`accountStressEngine: duplicate simulationId "${simulationId}"`);
        }
        throw err;
    }

    return {
        runs: results.length,
        results,
        worstPath: worstCase.pathType,
        worstDistance: worstCase.sim.distanceToLiquidation,
        worstLiquidationTriggered: worstCase.sim.liquidationTriggered
    };
}

// ── recordWarning ──────────────────────────────────────────────────
function recordWarning(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const warningId = _required(params, 'warningId');
    const portfolio = _required(params, 'portfolio');
    const closestPath = _required(params, 'closestPath');
    const distance = _required(params, 'distance');
    const recommendedAction = _required(params, 'recommendedAction');
    const severity = _required(params, 'severity');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!RECOMMENDED_ACTIONS.includes(recommendedAction)) {
        throw new Error(`accountStressEngine: invalid recommendedAction "${recommendedAction}"`);
    }
    if (!WARNING_SEVERITIES.includes(severity)) {
        throw new Error(`accountStressEngine: invalid severity "${severity}"`);
    }

    try {
        _stmts.insertWarning.run(
            userId, env, warningId,
            JSON.stringify(portfolio), closestPath, distance,
            recommendedAction, severity, ts
        );
        return { recorded: true };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`accountStressEngine: duplicate warningId "${warningId}"`);
        }
        throw err;
    }
}

// ── evaluateStressHealth ───────────────────────────────────────────
function evaluateStressHealth(params) {
    const portfolio = _required(params, 'portfolio');
    const currentEquity = _required(params, 'currentEquity');

    const dist = computeLiquidationDistance({ portfolio, currentEquity });
    let severity, action;

    if (dist.marginUsedPct >= LIQUIDATION_DANGER_PCT) {
        severity = 'critical';
        action = 'EMERGENCY_EXIT';
    } else if (dist.marginUsedPct >= WARNING_DANGER_PCT) {
        severity = 'warn';
        action = 'REDUCE_SIZE';
    } else if (dist.marginUsedPct >= 0.40) {
        severity = 'warn';
        action = 'DEFENSIVE';
    } else {
        severity = 'info';
        action = 'CONTINUE';
    }

    return {
        healthy: dist.marginUsedPct < WARNING_DANGER_PCT,
        marginUsedPct: dist.marginUsedPct,
        distanceToLiquidation: dist.distancePct,
        severity,
        recommendedAction: action
    };
}

// ── getStressHistory ───────────────────────────────────────────────
function getStressHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.stressHistory.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );
}

// ── getWarningHistory ──────────────────────────────────────────────
function getWarningHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const severity = (params && params.severity) ? params.severity : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.warningHistory.all(
        userId, env,
        severity, severity,
        since > 0 ? 1 : 0, since,
        limit
    );
}

module.exports = {
    PATH_TYPES,
    RECOMMENDED_ACTIONS,
    WARNING_SEVERITIES,
    DEFAULT_TRAJECTORY_STEPS,
    LIQUIDATION_DANGER_PCT,
    WARNING_DANGER_PCT,
    simulatePath,
    computeLiquidationDistance,
    runStressSurface,
    recordWarning,
    evaluateStressHealth,
    getStressHistory,
    getWarningHistory
};
