'use strict';

/**
 * OMEGA R5A Learning — policyRegret (canonical §109)
 *
 * §109 POLICY REGRET / FEASIBLE HINDSIGHT ORACLE GAP.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2818-2867.
 *
 * "Compari decizia lui cu cea mai buna actiune fezabila care ar fi putut fi
 *  luata cu aceeasi informatie si aceleasi constrangeri... regret decomposition:
 *  signal / timing / sizing / execution / abstention regret... 'cat de departe
 *  am fost de cea mai buna decizie pe care chiar aveam voie sa o iau atunci?'...
 *  hindsight oracle NU folosește info indisponibila."
 *
 * Distinct from §16 attributionEngine (decompose actual pnl factors),
 * §242 counterfactualEngine (replay history what-if), §49 overridePerformanceTracker
 * (human override only). §109 = constrained-oracle absolute gap.
 */

const { db } = require('../../database');

const REGRET_KINDS = Object.freeze([
    'signal', 'timing', 'sizing', 'execution', 'abstention'
]);

const DEFAULT_LOOKBACK_DAYS = 30;
const DECOMPOSITION_TOLERANCE = 0.01;
const MIN_RECORDS_FOR_AGG = 1;
const DAY_MS = 86400000;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`policyRegret: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertOracle: db.prepare(`
        INSERT INTO ml_oracle_decisions
        (user_id, resolved_env, oracle_id, decision_id,
         actual_action_json, optimal_feasible_action_json,
         total_regret, feasibility_constraints_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listOracle: db.prepare(`
        SELECT * FROM ml_oracle_decisions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    insertComponent: db.prepare(`
        INSERT INTO ml_regret_components
        (user_id, resolved_env, component_id, oracle_id,
         regret_kind, component_value, notes, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    aggregateByKind: db.prepare(`
        SELECT regret_kind,
               COALESCE(SUM(component_value), 0) AS total
        FROM ml_regret_components
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY regret_kind
    `),
    aggregateOneKind: db.prepare(`
        SELECT COALESCE(SUM(component_value), 0) AS total,
               COUNT(*) AS samples
        FROM ml_regret_components
        WHERE user_id = ? AND resolved_env = ?
          AND regret_kind = ? AND ts >= ?
    `)
};

// ── computeRegretFromPnl (pure) ────────────────────────────────────
// regret = max(0, optimal_pnl − actual_pnl). Clamps non-negative —
// hindsight oracle is by definition >= actual; if actual exceeds
// claimed optimal, oracle was misidentified or constraints wrong.
function computeRegretFromPnl(params) {
    const actualPnl = _required(params, 'actualPnl');
    const optimalPnl = _required(params, 'optimalPnl');
    const raw = optimalPnl - actualPnl;
    return { regret: Math.max(0, raw), raw };
}

// ── validateOracleFeasibility (pure) ───────────────────────────────
// Enforces canonical rule: "hindsight oracle NU are voie sa foloseasca
// informatie indisponibila la momentul deciziei". Audits 5 constraint dims.
function validateOracleFeasibility(params) {
    const oracleAction = _required(params, 'oracleAction');
    const constraints = _required(params, 'constraints');

    // 1) info_available_keys: oracle MUST NOT use forbidden info
    const usedKeys = oracleAction.used_info_keys || [];
    const allowedKeys = new Set(constraints.info_available_keys || []);
    for (const key of usedKeys) {
        if (!allowedKeys.has(key)) {
            throw new Error(
                `policyRegret: oracle used forbidden info key "${key}" — ` +
                'hindsight oracle cannot use info unavailable at decision time'
            );
        }
    }

    // 2) latency budget
    if (oracleAction.latency_ms !== undefined &&
        constraints.latency_budget_ms !== undefined &&
        oracleAction.latency_ms > constraints.latency_budget_ms) {
        throw new Error(
            `policyRegret: oracle exceeded latency budget ` +
            `${oracleAction.latency_ms}ms > ${constraints.latency_budget_ms}ms`
        );
    }

    // 3) capital cap
    if (oracleAction.capital_used !== undefined &&
        constraints.capital_cap !== undefined &&
        oracleAction.capital_used > constraints.capital_cap) {
        throw new Error(
            `policyRegret: oracle exceeded capital cap ` +
            `${oracleAction.capital_used} > ${constraints.capital_cap}`
        );
    }

    // 4) API budget
    if (oracleAction.api_units !== undefined &&
        constraints.api_budget !== undefined &&
        oracleAction.api_units > constraints.api_budget) {
        throw new Error(
            `policyRegret: oracle exceeded API budget ` +
            `${oracleAction.api_units} > ${constraints.api_budget}`
        );
    }

    // 5) venue availability
    if (oracleAction.venue !== undefined) {
        const allowedVenues = new Set(constraints.venues_available || []);
        if (!allowedVenues.has(oracleAction.venue)) {
            throw new Error(
                `policyRegret: oracle used unavailable venue "${oracleAction.venue}"`
            );
        }
    }

    // 6) execution feasibility
    if (oracleAction.exec_path !== undefined) {
        const allowedPaths = new Set(constraints.exec_feasible_paths || []);
        if (!allowedPaths.has(oracleAction.exec_path)) {
            throw new Error(
                `policyRegret: oracle used infeasible exec path "${oracleAction.exec_path}"`
            );
        }
    }

    return { feasible: true, reason: 'all_constraints_respected' };
}

// ── recordOracleDecision ───────────────────────────────────────────
function recordOracleDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const oracleId = _required(params, 'oracleId');
    const decisionId = _required(params, 'decisionId');
    const actualAction = _required(params, 'actualAction');
    const optimalFeasibleAction = _required(params, 'optimalFeasibleAction');
    const totalRegret = _required(params, 'totalRegret');
    if (totalRegret < 0) {
        throw new Error('policyRegret: totalRegret must be >= 0');
    }
    const feasibilityConstraints = _required(params, 'feasibilityConstraints');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertOracle.run(
            userId, env, oracleId, decisionId,
            JSON.stringify(actualAction),
            JSON.stringify(optimalFeasibleAction),
            totalRegret,
            JSON.stringify(feasibilityConstraints),
            ts
        );
        return { recorded: true, oracleId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`policyRegret: duplicate oracleId "${oracleId}"`);
        }
        throw err;
    }
}

// ── recordRegretComponent ──────────────────────────────────────────
function recordRegretComponent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const componentId = _required(params, 'componentId');
    const oracleId = _required(params, 'oracleId');
    const regretKind = _required(params, 'regretKind');
    if (!REGRET_KINDS.includes(regretKind)) {
        throw new Error(`policyRegret: invalid regretKind "${regretKind}"`);
    }
    const componentValue = _required(params, 'componentValue');
    if (componentValue < 0) {
        throw new Error('policyRegret: componentValue must be >= 0');
    }
    const notes = (params && params.notes) ? params.notes : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertComponent.run(
            userId, env, componentId, oracleId,
            regretKind, componentValue, notes, ts
        );
        return { recorded: true, componentId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`policyRegret: duplicate componentId "${componentId}"`);
        }
        throw err;
    }
}

// ── aggregateRegret ────────────────────────────────────────────────
function aggregateRegret(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays !== undefined)
        ? params.lookbackDays : DEFAULT_LOOKBACK_DAYS;
    const regretKindFilter = params && params.regretKindFilter;
    const now = (params && params.now) ? params.now : Date.now();

    if (regretKindFilter && !REGRET_KINDS.includes(regretKindFilter)) {
        throw new Error(
            `policyRegret: invalid regretKindFilter "${regretKindFilter}"`
        );
    }
    const since = now - lookbackDays * DAY_MS;

    if (regretKindFilter) {
        const row = _stmts.aggregateOneKind.get(
            userId, env, regretKindFilter, since
        );
        return {
            total: row ? row.total : 0,
            samples: row ? row.samples : 0,
            byKind: { [regretKindFilter]: row ? row.total : 0 }
        };
    }

    const rows = _stmts.aggregateByKind.all(userId, env, since);
    const byKind = {};
    let total = 0;
    for (const k of REGRET_KINDS) byKind[k] = 0;
    for (const r of rows) {
        byKind[r.regret_kind] = r.total;
        total += r.total;
    }
    return { total, byKind };
}

// ── getRegretHistory ───────────────────────────────────────────────
function getRegretHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listOracle.all(userId, env, limit);
    return rows.map(r => ({
        oracleId: r.oracle_id,
        decisionId: r.decision_id,
        actualAction: JSON.parse(r.actual_action_json),
        optimalFeasibleAction: JSON.parse(r.optimal_feasible_action_json),
        totalRegret: r.total_regret,
        feasibilityConstraints: JSON.parse(r.feasibility_constraints_json),
        ts: r.ts
    }));
}

module.exports = {
    REGRET_KINDS,
    DEFAULT_LOOKBACK_DAYS,
    DECOMPOSITION_TOLERANCE,
    MIN_RECORDS_FOR_AGG,
    computeRegretFromPnl,
    validateOracleFeasibility,
    recordOracleDecision,
    recordRegretComponent,
    aggregateRegret,
    getRegretHistory
};
