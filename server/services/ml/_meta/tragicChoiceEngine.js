'use strict';

/**
 * OMEGA §198 — TRAGIC CHOICE ENGINE / LEAST-BETRAYAL DECISION LAYER.
 * Canonical PDF lines 6322-6368.
 */

const { db } = require('../../database');

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§198 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§198 invalid env: ${env}`);
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§198 ${name} must be in [0,1]`);
    }
}
function _requireArray(name, v) {
    if (!Array.isArray(v)) throw new Error(`§198 ${name} must be array`);
}

function computeLeastBetrayalScore(params) {
    const sacrificed = _required(params, 'sacrificedValues');
    const preserved = _required(params, 'preservedValues');
    _requireArray('sacrificedValues', sacrificed);
    _requireArray('preservedValues', preserved);
    // Each value has a weight (importance). Score = preserved_weight /
    // (preserved + sacrificed). Higher = chose option that betrays least.
    let preservedTotal = 0;
    let sacrificedTotal = 0;
    for (const v of preserved) {
        if (typeof v.weight !== 'number') throw new Error('§198 value entries need numeric weight');
        _requireRange01('preservedValue.weight', v.weight);
        preservedTotal += v.weight;
    }
    for (const v of sacrificed) {
        if (typeof v.weight !== 'number') throw new Error('§198 value entries need numeric weight');
        _requireRange01('sacrificedValue.weight', v.weight);
        sacrificedTotal += v.weight;
    }
    const total = preservedTotal + sacrificedTotal;
    if (total === 0) return { leastBetrayalScore: 0.5 };
    return { leastBetrayalScore: preservedTotal / total };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_tragic_choice_decisions (
            user_id, resolved_env, decision_id, dilemma_label,
            conflicting_values_json, chosen_option,
            sacrificed_values_json, preserved_values_json,
            least_betrayal_score, dignity_of_loss_acknowledged,
            reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_tragic_choice_decisions WHERE decision_id = ?`),
    selectAll: db.prepare(`
        SELECT id, decision_id AS decisionId, dilemma_label AS dilemmaLabel,
               conflicting_values_json AS conflictingValuesJson,
               chosen_option AS chosenOption,
               sacrificed_values_json AS sacrificedValuesJson,
               preserved_values_json AS preservedValuesJson,
               least_betrayal_score AS leastBetrayalScore,
               dignity_of_loss_acknowledged AS dignityOfLossAcknowledged,
               reasoning, ts
        FROM ml_tragic_choice_decisions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordTragicChoice(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const decisionId = _required(params, 'decisionId');
    const dilemmaLabel = _required(params, 'dilemmaLabel');
    const conflictingValues = _required(params, 'conflictingValues');
    const chosenOption = _required(params, 'chosenOption');
    const sacrificedValues = _required(params, 'sacrificedValues');
    const preservedValues = _required(params, 'preservedValues');
    const dignityOfLossAcknowledged = params.dignityOfLossAcknowledged !== false ? 1 : 0;
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    _requireArray('conflictingValues', conflictingValues);
    if (_stmts.selectById.get(decisionId)) {
        throw new Error(`§198 duplicate decisionId: ${decisionId}`);
    }

    const { leastBetrayalScore } = computeLeastBetrayalScore({
        sacrificedValues, preservedValues
    });

    _stmts.insert.run(
        userId, resolvedEnv, decisionId, dilemmaLabel,
        JSON.stringify(conflictingValues), chosenOption,
        JSON.stringify(sacrificedValues), JSON.stringify(preservedValues),
        leastBetrayalScore, dignityOfLossAcknowledged, reasoning, ts
    );

    return {
        recorded: true, decisionId, chosenOption,
        leastBetrayalScore, dignityOfLossAcknowledged
    };
}

function getRecentDecisions(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = {
    computeLeastBetrayalScore,
    recordTragicChoice,
    getRecentDecisions
};
