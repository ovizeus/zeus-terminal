'use strict';

/**
 * OMEGA R6 ShadowMeta — curiosityEngine (canonical §95)
 *
 * §95 CONTEXTUAL EXPLORATION / BOUNDED CURIOSITY ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2381-2425.
 *
 * "Separare explicita intre exploitation capital si exploration capital...
 *  budget mic, fix si auditat... edge-ul nou trebuie sa treaca prin
 *  explore → observe → validate → graduate... orice pierdere din explorare
 *  trebuie etichetata ca atare... raport separat pentru alpha din explorare
 *  vs alpha din exploatare... Cat capital sunt dispus sa risc pentru a
 *  afla ceva nou?"
 *
 * R6 shadowMeta: decision-level orchestration between known/unknown.
 * Complementary to §33 abTesting (controlled compare) and §48 ensembleVoting.
 */

const { db } = require('../../database');

const CURIOSITY_STAGES = Object.freeze([
    'EXPLORE', 'OBSERVE', 'VALIDATE', 'GRADUATED', 'RETIRED'
]);
const TRADE_SOURCES = Object.freeze(['exploitation', 'exploration']);

const DEFAULT_EXPLORE_BUDGET_RATIO = 0.05;
const STAGE_OBS_THRESHOLDS = Object.freeze({
    EXPLORE_TO_OBSERVE: 5,
    OBSERVE_TO_VALIDATE: 10,
    VALIDATE_TO_GRADUATE: 20
});
const DEFAULT_SHARPE_THRESHOLD = 0.5;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`curiosityEngine: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertSetup: db.prepare(`
        INSERT INTO ml_curiosity_setups
        (user_id, resolved_env, setup_id, hypothesis, stage,
         allocated_capital, max_capital_cap,
         observations_count, pnl_cumulative,
         ts_created, ts_last_updated)
        VALUES (?, ?, ?, ?, 'EXPLORE', ?, ?, 0, 0, ?, ?)
    `),
    getSetup: db.prepare(`
        SELECT * FROM ml_curiosity_setups WHERE setup_id = ?
    `),
    listSetups: db.prepare(`
        SELECT * FROM ml_curiosity_setups
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts_created DESC LIMIT ?
    `),
    updateSetupStage: db.prepare(`
        UPDATE ml_curiosity_setups
        SET stage = ?, ts_last_updated = ?
        WHERE user_id = ? AND resolved_env = ? AND setup_id = ?
    `),
    incrementSetupTrade: db.prepare(`
        UPDATE ml_curiosity_setups
        SET observations_count = observations_count + 1,
            pnl_cumulative = pnl_cumulative + ?,
            ts_last_updated = ?
        WHERE user_id = ? AND resolved_env = ? AND setup_id = ?
    `),
    insertTrade: db.prepare(`
        INSERT INTO ml_curiosity_trades
        (user_id, resolved_env, trade_id, setup_id, source,
         capital_used, pnl, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    aggregateAlpha: db.prepare(`
        SELECT source, COUNT(*) AS trades, SUM(pnl) AS pnl_sum,
               SUM(capital_used) AS capital_sum
        FROM ml_curiosity_trades
        WHERE user_id = ? AND resolved_env = ?
        GROUP BY source
    `)
};

// ── allocateCapital (pure) ─────────────────────────────────────────
function allocateCapital(params) {
    const totalCapital = _required(params, 'totalCapital');
    const requestedAmount = _required(params, 'requestedAmount');
    const setupMaxCap = _required(params, 'setupMaxCap');
    const exploreBudgetRatio = (params && params.exploreBudgetRatio !== undefined)
        ? params.exploreBudgetRatio : DEFAULT_EXPLORE_BUDGET_RATIO;
    const currentExplorationUsed = (params && params.currentExplorationUsed !== undefined)
        ? params.currentExplorationUsed : 0;

    if (totalCapital <= 0) {
        return { allocated: 0, reason: 'no_capital' };
    }
    const exploreBudget = totalCapital * exploreBudgetRatio;
    const budgetRemaining = Math.max(0, exploreBudget - currentExplorationUsed);
    const allocated = Math.min(requestedAmount, setupMaxCap, budgetRemaining);

    let reason;
    if (allocated === 0) reason = 'budget_exhausted';
    else if (allocated < requestedAmount) reason = 'capped';
    else reason = 'full_request';

    return {
        allocated, reason,
        exploreBudget,
        budgetRemaining: budgetRemaining - allocated,
        setupMaxCap
    };
}

// ── registerSetup ──────────────────────────────────────────────────
function registerSetup(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupId = _required(params, 'setupId');
    const hypothesis = _required(params, 'hypothesis');
    const initialCapital = _required(params, 'initialCapital');
    if (initialCapital < 0) {
        throw new Error('curiosityEngine: initialCapital must be >= 0');
    }
    const maxCapitalCap = (params && params.maxCapitalCap !== undefined)
        ? params.maxCapitalCap : initialCapital;
    if (maxCapitalCap < initialCapital) {
        throw new Error('curiosityEngine: maxCapitalCap must be >= initialCapital');
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertSetup.run(
            userId, env, setupId, hypothesis,
            initialCapital, maxCapitalCap, ts, ts
        );
        return { registered: true, setupId, stage: 'EXPLORE' };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`curiosityEngine: duplicate setupId "${setupId}"`);
        }
        throw err;
    }
}

// ── recordExploratoryTrade ─────────────────────────────────────────
function recordExploratoryTrade(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const tradeId = _required(params, 'tradeId');
    const setupId = _required(params, 'setupId');
    const capitalUsed = _required(params, 'capitalUsed');
    const pnl = _required(params, 'pnl');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const setup = _stmts.getSetup.get(setupId);
    if (!setup) {
        throw new Error(`curiosityEngine: setup "${setupId}" not registered`);
    }
    if (setup.user_id !== userId || setup.resolved_env !== env) {
        throw new Error('curiosityEngine: setup not owned by user/env');
    }

    try {
        _stmts.insertTrade.run(
            userId, env, tradeId, setupId, 'exploration',
            capitalUsed, pnl, ts
        );
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`curiosityEngine: duplicate tradeId "${tradeId}"`);
        }
        throw err;
    }

    _stmts.incrementSetupTrade.run(pnl, ts, userId, env, setupId);
    return {
        recorded: true, tradeId, setupId,
        source: 'exploration',
        newObservationsCount: setup.observations_count + 1,
        newPnlCumulative: setup.pnl_cumulative + pnl
    };
}

// ── evaluateGraduation ─────────────────────────────────────────────
function evaluateGraduation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupId = _required(params, 'setupId');
    const sharpeThreshold = (params && params.sharpeThreshold !== undefined)
        ? params.sharpeThreshold : DEFAULT_SHARPE_THRESHOLD;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const setup = _stmts.getSetup.get(setupId);
    if (!setup) {
        throw new Error(`curiosityEngine: setup "${setupId}" not registered`);
    }
    if (setup.user_id !== userId || setup.resolved_env !== env) {
        throw new Error('curiosityEngine: setup not owned by user/env');
    }
    if (setup.stage === 'RETIRED') {
        return { transitioned: false, reason: 'retired', stage: 'RETIRED' };
    }
    if (setup.stage === 'GRADUATED') {
        return { transitioned: false, reason: 'already_graduated', stage: 'GRADUATED' };
    }

    const obs = setup.observations_count;
    const pnl = setup.pnl_cumulative;

    // Auto-retire on persistent negative pnl beyond observe threshold
    if (obs >= STAGE_OBS_THRESHOLDS.EXPLORE_TO_OBSERVE && pnl < 0) {
        const avgPnl = pnl / obs;
        if (avgPnl < -Math.abs(sharpeThreshold)) {
            _stmts.updateSetupStage.run('RETIRED', ts, userId, env, setupId);
            return {
                transitioned: true, fromStage: setup.stage, toStage: 'RETIRED',
                reason: 'auto_retire_negative_pnl', avgPnl
            };
        }
    }

    let nextStage = setup.stage;
    if (setup.stage === 'EXPLORE' && obs >= STAGE_OBS_THRESHOLDS.EXPLORE_TO_OBSERVE) {
        nextStage = 'OBSERVE';
    } else if (setup.stage === 'OBSERVE' && obs >= STAGE_OBS_THRESHOLDS.OBSERVE_TO_VALIDATE) {
        nextStage = 'VALIDATE';
    } else if (setup.stage === 'VALIDATE' && obs >= STAGE_OBS_THRESHOLDS.VALIDATE_TO_GRADUATE && pnl > 0) {
        nextStage = 'GRADUATED';
    }

    if (nextStage !== setup.stage) {
        _stmts.updateSetupStage.run(nextStage, ts, userId, env, setupId);
        return {
            transitioned: true, fromStage: setup.stage, toStage: nextStage,
            observations: obs, pnlCumulative: pnl
        };
    }
    return {
        transitioned: false, stage: setup.stage,
        observations: obs, pnlCumulative: pnl
    };
}

// ── getCuriosityReport ─────────────────────────────────────────────
function getCuriosityReport(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');

    const rows = _stmts.aggregateAlpha.all(userId, env);
    const report = {
        exploitation: { trades: 0, pnlSum: 0, capitalSum: 0 },
        exploration:  { trades: 0, pnlSum: 0, capitalSum: 0 }
    };
    for (const r of rows) {
        report[r.source] = {
            trades: r.trades,
            pnlSum: r.pnl_sum || 0,
            capitalSum: r.capital_sum || 0
        };
    }
    return report;
}

// ── retireSetup ────────────────────────────────────────────────────
function retireSetup(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupId = _required(params, 'setupId');
    const reason = (params && params.reason) ? params.reason : 'manual_retire';
    const ts = (params && params.ts) ? params.ts : Date.now();

    const setup = _stmts.getSetup.get(setupId);
    if (!setup) {
        throw new Error(`curiosityEngine: setup "${setupId}" not registered`);
    }
    if (setup.user_id !== userId || setup.resolved_env !== env) {
        throw new Error('curiosityEngine: setup not owned by user/env');
    }
    _stmts.updateSetupStage.run('RETIRED', ts, userId, env, setupId);
    return { retired: true, setupId, reason, previousStage: setup.stage };
}

module.exports = {
    CURIOSITY_STAGES,
    TRADE_SOURCES,
    DEFAULT_EXPLORE_BUDGET_RATIO,
    STAGE_OBS_THRESHOLDS,
    DEFAULT_SHARPE_THRESHOLD,
    allocateCapital,
    registerSetup,
    recordExploratoryTrade,
    evaluateGraduation,
    getCuriosityReport,
    retireSetup
};
