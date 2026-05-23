'use strict';

/**
 * OMEGA _meta — metacognitiveLoadMonitor (canonical §142)
 *
 * §142 METACOGNITIVE LOAD MONITOR — cand propria complexitate devine
 * vulnerabilitate.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 4709-4710.
 *
 * "Spec-ul are compute budget governor (85) care gestioneaza timpul de
 *  inferenta. Are cognitive routing (110) care alege traseul de rationament.
 *  Dar nu exista niciun modul care masoara cand sistemul in ansamblu este
 *  supraincarcat cognitiv: prea multe ipoteze rivale active simultan, prea
 *  multe pozitii in management, prea multe semnale contradictorii procesate
 *  in paralel, prea multe module in stari degradate simultan... Metacognitive
 *  load score agrega: numarul de ipoteze active, numarul de pozitii managed,
 *  numarul de module in alerta, adancimea scenario tree curent, volumul de
 *  belief updates in coada. Cand scorul depaseste pragul, sistemul nu
 *  gandeste mai mult — simplifica activ, reduce ipotezele la cele mai
 *  probabile doua, suspenda explorarea si trece pe reguli simple robuste.
 *  Complexitatea excesiva in momente de incertitudine inalta nu e
 *  intelepciune — e risc."
 *
 * Distinct from §85 computeBudgetGovernor (R4 — per-inference time
 * gestionare); §142 = HOLISTIC system state aggregator + intervention
 * trigger.
 */

const { db } = require('../../database');

const COGNITIVE_MODES = Object.freeze([
    'normal', 'elevated', 'overloaded'
]);
const INTERVENTIONS = Object.freeze([
    'none', 'simplify_hypotheses', 'simple_rules_mode'
]);
const LOAD_THRESHOLDS = Object.freeze({
    overloaded: 0.75,
    elevated: 0.45
});
const INPUT_NORM_THRESHOLDS = Object.freeze({
    active_hypotheses: 10,
    managed_positions: 8,
    degraded_modules: 5,
    scenario_tree_depth: 8,
    belief_updates_queue: 100
});
const INPUT_WEIGHTS = Object.freeze({
    active_hypotheses: 0.25,
    managed_positions: 0.20,
    degraded_modules: 0.20,
    belief_updates_queue: 0.20,
    scenario_tree_depth: 0.15
});
const MAX_HYPOTHESES_IN_SIMPLE_RULES = 2;

const _MODE_TO_INTERVENTION = Object.freeze({
    normal: 'none',
    elevated: 'simplify_hypotheses',
    overloaded: 'simple_rules_mode'
});

const _MODE_TO_HYP_LIMIT = Object.freeze({
    normal: Number.MAX_SAFE_INTEGER,
    elevated: 5,
    overloaded: MAX_HYPOTHESES_IN_SIMPLE_RULES
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`metacognitiveLoadMonitor: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAssessment: db.prepare(`
        INSERT INTO ml_metacognitive_load_assessments
        (user_id, resolved_env, assessment_id,
         active_hypotheses_count, managed_positions_count,
         degraded_modules_count, scenario_tree_depth,
         belief_updates_queue_size, load_score,
         cognitive_mode, intervention_applied, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    latestAssessment: db.prepare(`
        SELECT * FROM ml_metacognitive_load_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT 1
    `),
    listAssessments: db.prepare(`
        SELECT * FROM ml_metacognitive_load_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    distribution: db.prepare(`
        SELECT intervention_applied, COUNT(*) AS cnt
        FROM ml_metacognitive_load_assessments
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY intervention_applied
    `)
};

// ── computeLoadScore (pure) ────────────────────────────────────────
function computeLoadScore(params) {
    const hyp = _required(params, 'activeHypotheses');
    const pos = _required(params, 'managedPositions');
    const deg = _required(params, 'degradedModules');
    const dep = _required(params, 'scenarioTreeDepth');
    const queue = _required(params, 'beliefUpdatesQueueSize');

    for (const [k, v] of [
        ['activeHypotheses', hyp], ['managedPositions', pos],
        ['degradedModules', deg], ['scenarioTreeDepth', dep],
        ['beliefUpdatesQueueSize', queue]
    ]) {
        if (v < 0) {
            throw new Error(
                `metacognitiveLoadMonitor: ${k} must be ≥ 0, got ${v}`
            );
        }
    }

    const T = INPUT_NORM_THRESHOLDS;
    const W = INPUT_WEIGHTS;
    const hypN = Math.min(1, hyp / T.active_hypotheses);
    const posN = Math.min(1, pos / T.managed_positions);
    const degN = Math.min(1, deg / T.degraded_modules);
    const depN = Math.min(1, dep / T.scenario_tree_depth);
    const queN = Math.min(1, queue / T.belief_updates_queue);

    const score = hypN * W.active_hypotheses +
                  posN * W.managed_positions +
                  degN * W.degraded_modules +
                  depN * W.scenario_tree_depth +
                  queN * W.belief_updates_queue;
    return { loadScore: Math.max(0, Math.min(1, score)) };
}

// ── classifyCognitiveMode (pure) ───────────────────────────────────
function classifyCognitiveMode(params) {
    const score = _required(params, 'loadScore');
    if (score < 0 || score > 1) {
        throw new Error(
            'metacognitiveLoadMonitor: loadScore must be in [0,1]'
        );
    }
    let mode;
    if (score >= LOAD_THRESHOLDS.overloaded) mode = 'overloaded';
    else if (score >= LOAD_THRESHOLDS.elevated) mode = 'elevated';
    else mode = 'normal';
    return { cognitiveMode: mode };
}

// ── selectIntervention (pure) ──────────────────────────────────────
function selectIntervention(params) {
    const mode = _required(params, 'cognitiveMode');
    if (!COGNITIVE_MODES.includes(mode)) {
        throw new Error(
            `metacognitiveLoadMonitor: invalid cognitiveMode "${mode}"`
        );
    }
    return { intervention: _MODE_TO_INTERVENTION[mode] };
}

// ── recommendedActiveHypothesesLimit (pure) ────────────────────────
function recommendedActiveHypothesesLimit(params) {
    const mode = _required(params, 'cognitiveMode');
    if (!COGNITIVE_MODES.includes(mode)) {
        throw new Error(
            `metacognitiveLoadMonitor: invalid cognitiveMode "${mode}"`
        );
    }
    return { limit: _MODE_TO_HYP_LIMIT[mode] };
}

// ── recordLoadAssessment (integration) ─────────────────────────────
function recordLoadAssessment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const assessmentId = _required(params, 'assessmentId');
    const hyp = _required(params, 'activeHypotheses');
    const pos = _required(params, 'managedPositions');
    const deg = _required(params, 'degradedModules');
    const dep = _required(params, 'scenarioTreeDepth');
    const queue = _required(params, 'beliefUpdatesQueueSize');
    const ts = (params && params.ts) ? params.ts : Date.now();

    for (const [k, v] of [
        ['activeHypotheses', hyp], ['managedPositions', pos],
        ['degradedModules', deg], ['scenarioTreeDepth', dep],
        ['beliefUpdatesQueueSize', queue]
    ]) {
        if (v < 0) {
            throw new Error(
                `metacognitiveLoadMonitor: ${k} must be ≥ 0, got ${v}`
            );
        }
    }

    const { loadScore } = computeLoadScore({
        activeHypotheses: hyp,
        managedPositions: pos,
        degradedModules: deg,
        scenarioTreeDepth: dep,
        beliefUpdatesQueueSize: queue
    });
    const { cognitiveMode } = classifyCognitiveMode({ loadScore });
    const { intervention } = selectIntervention({ cognitiveMode });

    try {
        _stmts.insertAssessment.run(
            userId, env, assessmentId,
            hyp, pos, deg, dep, queue,
            loadScore, cognitiveMode, intervention, ts
        );
        return {
            recorded: true, assessmentId,
            loadScore, cognitiveMode, intervention
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `metacognitiveLoadMonitor: duplicate assessmentId "${assessmentId}"`
            );
        }
        throw err;
    }
}

function _rowToAssessment(r) {
    return {
        assessmentId: r.assessment_id,
        activeHypothesesCount: r.active_hypotheses_count,
        managedPositionsCount: r.managed_positions_count,
        degradedModulesCount: r.degraded_modules_count,
        scenarioTreeDepth: r.scenario_tree_depth,
        beliefUpdatesQueueSize: r.belief_updates_queue_size,
        loadScore: r.load_score,
        cognitiveMode: r.cognitive_mode,
        interventionApplied: r.intervention_applied,
        ts: r.ts
    };
}

// ── getLatestAssessment ────────────────────────────────────────────
function getLatestAssessment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const r = _stmts.latestAssessment.get(userId, env);
    if (!r) return null;
    return _rowToAssessment(r);
}

// ── getLoadHistory ─────────────────────────────────────────────────
function getLoadHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;
    const rows = _stmts.listAssessments.all(userId, env, limit);
    return rows.map(_rowToAssessment);
}

// ── getInterventionDistribution ────────────────────────────────────
function getInterventionDistribution(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sinceTs = (params && params.sinceTs !== undefined)
        ? params.sinceTs : 0;
    const rows = _stmts.distribution.all(userId, env, sinceTs);
    const dist = {};
    for (const r of rows) {
        dist[r.intervention_applied] = r.cnt;
    }
    return dist;
}

module.exports = {
    COGNITIVE_MODES,
    INTERVENTIONS,
    LOAD_THRESHOLDS,
    INPUT_NORM_THRESHOLDS,
    INPUT_WEIGHTS,
    MAX_HYPOTHESES_IN_SIMPLE_RULES,
    computeLoadScore,
    classifyCognitiveMode,
    selectIntervention,
    recommendedActiveHypothesesLimit,
    recordLoadAssessment,
    getLatestAssessment,
    getLoadHistory,
    getInterventionDistribution
};
