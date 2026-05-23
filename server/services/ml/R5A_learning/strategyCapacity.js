'use strict';

/**
 * OMEGA R5A Learning — strategyCapacity (canonical §86)
 *
 * §86 STRATEGY CAPACITY / EDGE CAPACITY CEILING.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2196-2236.
 *
 * "Edge-ul NU scaleaza liniar. Cat capital poate absorbi acest edge
 *  inainte sa se strice?"
 *
 * R5A learning. Capacity estimation per strategy × regime × asset.
 * Fits diminishing returns curve: pnl(capital) = a*c / (1 + b*c).
 * Marginal alpha decreases as deployed capital grows.
 *
 * Distinct from:
 *   - §41 strategyCrowdingDetector (edge decay from market participants)
 *   - §56 queueFillModel (per-order fill probability)
 * §86 = OWN capital deployed vs edge degradation.
 *
 * Per spec rules (lines 2231-2235):
 *   - Capacity revalidated periodically
 *   - Capital increase WITHOUT revalidation = FORBIDDEN
 *   - Capacity measured per regime (not just global)
 */

const { db } = require('../../database');

const CAPACITY_STATUSES = Object.freeze(['VALID', 'STALE', 'EXCEEDED']);
const STALE_THRESHOLD_DAYS = 30;
const SOFT_CAP_MULTIPLIER = 0.70;
const MIN_OBSERVATIONS_FOR_CEILING = 10;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`strategyCapacity: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertObs: db.prepare(`
        INSERT INTO ml_capacity_observations
        (user_id, resolved_env, strategy_id, regime, asset,
         deployed_capital, observed_pnl, observed_slippage_bps,
         observed_impact_bps, marginal_alpha, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    observationsForKey: db.prepare(`
        SELECT * FROM ml_capacity_observations
        WHERE user_id = ? AND resolved_env = ?
          AND strategy_id = ? AND regime = ? AND asset = ?
          AND ts >= ?
        ORDER BY deployed_capital
    `),
    upsertCeiling: db.prepare(`
        INSERT INTO ml_capacity_ceilings
        (user_id, resolved_env, strategy_id, regime, asset,
         soft_cap_capital, hard_cap_capital,
         diminishing_returns_inflection, last_validated, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALID')
        ON CONFLICT(user_id, resolved_env, strategy_id, regime, asset) DO UPDATE SET
            soft_cap_capital = excluded.soft_cap_capital,
            hard_cap_capital = excluded.hard_cap_capital,
            diminishing_returns_inflection = excluded.diminishing_returns_inflection,
            last_validated = excluded.last_validated,
            status = 'VALID'
    `),
    getCeiling: db.prepare(`
        SELECT * FROM ml_capacity_ceilings
        WHERE user_id = ? AND resolved_env = ?
          AND strategy_id = ? AND regime = ? AND asset = ?
    `),
    historyForUser: db.prepare(`
        SELECT * FROM ml_capacity_observations
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR strategy_id = ?)
          AND (? = '' OR regime = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `),
    markStale: db.prepare(`
        UPDATE ml_capacity_ceilings
        SET status = 'STALE'
        WHERE user_id = ? AND resolved_env = ?
          AND last_validated < ?
          AND status = 'VALID'
    `)
};

// ── recordCapacityObservation ──────────────────────────────────────
function recordCapacityObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const strategyId = _required(params, 'strategyId');
    const regime = _required(params, 'regime');
    const asset = _required(params, 'asset');
    const deployedCapital = _required(params, 'deployedCapital');
    const observedPnl = _required(params, 'observedPnl');
    const observedSlippage = _required(params, 'observedSlippage');
    const observedImpact = _required(params, 'observedImpact');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (deployedCapital <= 0) {
        throw new Error('strategyCapacity: deployedCapital must be > 0');
    }

    const marginalAlpha = observedPnl / deployedCapital;

    _stmts.insertObs.run(
        userId, env, strategyId, regime, asset,
        deployedCapital, observedPnl, observedSlippage, observedImpact,
        marginalAlpha, ts
    );

    return { recorded: true, marginalAlpha };
}

// ── computeCapacityCeiling ─────────────────────────────────────────
function computeCapacityCeiling(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const strategyId = _required(params, 'strategyId');
    const regime = _required(params, 'regime');
    const asset = _required(params, 'asset');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 90;

    const since = Date.now() - lookbackDays * 86400000;
    const obs = _stmts.observationsForKey.all(
        userId, env, strategyId, regime, asset, since
    );

    if (obs.length < MIN_OBSERVATIONS_FOR_CEILING) {
        return {
            sufficient: false,
            samples: obs.length,
            reason: 'insufficient_observations'
        };
    }

    // Fit diminishing returns: marginal_alpha typically decreases with capital
    // Find inflection where marginal_alpha drops below 50% of max
    const sorted = obs.slice().sort((a, b) => a.deployed_capital - b.deployed_capital);
    const maxMargAlpha = Math.max(...sorted.map(o => o.marginal_alpha));

    let inflection = sorted[sorted.length - 1].deployed_capital;
    for (const o of sorted) {
        if (o.marginal_alpha < maxMargAlpha * 0.50) {
            inflection = o.deployed_capital;
            break;
        }
    }

    // Hard cap: where marginal_alpha approaches 0 (use threshold 10% of max)
    let hardCap = inflection * 1.5;
    for (const o of sorted) {
        if (o.marginal_alpha < maxMargAlpha * 0.10) {
            hardCap = o.deployed_capital;
            break;
        }
    }

    const softCap = hardCap * SOFT_CAP_MULTIPLIER;

    return {
        sufficient: true,
        samples: obs.length,
        softCapCapital: softCap,
        hardCapCapital: hardCap,
        diminishingReturnsInflection: inflection,
        maxMarginalAlpha: maxMargAlpha
    };
}

// ── recordCeiling ──────────────────────────────────────────────────
function recordCeiling(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const strategyId = _required(params, 'strategyId');
    const regime = _required(params, 'regime');
    const asset = _required(params, 'asset');
    const softCap = _required(params, 'softCap');
    const hardCap = _required(params, 'hardCap');
    const inflection = _required(params, 'inflection');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (softCap > hardCap) {
        throw new Error('strategyCapacity: softCap must be <= hardCap');
    }

    _stmts.upsertCeiling.run(
        userId, env, strategyId, regime, asset,
        softCap, hardCap, inflection, ts
    );
    return { recorded: true };
}

// ── evaluateCapacityHealth ─────────────────────────────────────────
function evaluateCapacityHealth(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const strategyId = _required(params, 'strategyId');
    const regime = _required(params, 'regime');
    const asset = _required(params, 'asset');
    const proposedCapital = _required(params, 'proposedCapital');

    const ceiling = _stmts.getCeiling.get(userId, env, strategyId, regime, asset);
    if (!ceiling) {
        return {
            withinSoftCap: false,
            withinHardCap: false,
            hasCeiling: false,
            recommendation: 'no_ceiling_configured'
        };
    }

    if (ceiling.status === 'STALE') {
        return {
            withinSoftCap: false,
            withinHardCap: false,
            hasCeiling: true,
            ceilingStatus: 'STALE',
            recommendation: 'revalidate_capacity_before_scaling'
        };
    }

    const withinSoft = proposedCapital <= ceiling.soft_cap_capital;
    const withinHard = proposedCapital <= ceiling.hard_cap_capital;

    let recommendation;
    if (!withinHard) recommendation = 'REJECT_OVER_HARD_CAP';
    else if (!withinSoft) recommendation = 'WARN_OVER_SOFT_CAP';
    else recommendation = 'APPROVED';

    return {
        withinSoftCap: withinSoft,
        withinHardCap: withinHard,
        hasCeiling: true,
        ceilingStatus: ceiling.status,
        softCap: ceiling.soft_cap_capital,
        hardCap: ceiling.hard_cap_capital,
        proposedCapital,
        recommendation
    };
}

// ── getCeiling ─────────────────────────────────────────────────────
function getCeiling(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const strategyId = _required(params, 'strategyId');
    const regime = _required(params, 'regime');
    const asset = _required(params, 'asset');
    const row = _stmts.getCeiling.get(userId, env, strategyId, regime, asset);
    if (!row) return null;
    return {
        strategyId: row.strategy_id,
        regime: row.regime,
        asset: row.asset,
        softCapCapital: row.soft_cap_capital,
        hardCapCapital: row.hard_cap_capital,
        diminishingReturnsInflection: row.diminishing_returns_inflection,
        lastValidated: row.last_validated,
        status: row.status
    };
}

// ── getCapacityHistory ─────────────────────────────────────────────
function getCapacityHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const strategyId = (params && params.strategyId) ? params.strategyId : '';
    const regime = (params && params.regime) ? params.regime : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.historyForUser.all(
        userId, env,
        strategyId, strategyId,
        regime, regime,
        since > 0 ? 1 : 0, since,
        limit
    );
}

// ── markStaleIfOlderThan ───────────────────────────────────────────
function markStaleIfOlderThan(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const daysThreshold = (params && params.daysThreshold)
        ? params.daysThreshold : STALE_THRESHOLD_DAYS;

    const cutoffTs = Date.now() - daysThreshold * 86400000;
    const result = _stmts.markStale.run(userId, env, cutoffTs);
    return { stalenessMarked: result.changes };
}

module.exports = {
    CAPACITY_STATUSES,
    STALE_THRESHOLD_DAYS,
    SOFT_CAP_MULTIPLIER,
    MIN_OBSERVATIONS_FOR_CEILING,
    recordCapacityObservation,
    computeCapacityCeiling,
    recordCeiling,
    evaluateCapacityHealth,
    getCeiling,
    getCapacityHistory,
    markStaleIfOlderThan
};
