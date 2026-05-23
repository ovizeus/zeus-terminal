'use strict';

/**
 * OMEGA Wave 3 §179 — WORLDHOOD PRESSURE INDEX / HOW-MUCH-REALITY-IS-NOT-FITTING.
 *
 * Canonical PDF §179 (ml_brain_canonic.txt lines 5834-5884).
 *
 * "cat de multa realitate incepe sa nu mai incapa in lumea mea interna?"
 *
 * 7 canonical aggregation components (PDF lines 5850-5856):
 *   unexplainedResiduals           — from §148 residual signal
 *   ontologyStrain                 — from §123 ontology revision pressure
 *   unknownPressure                — from §120 unknowns registry
 *   narrativeFractures             — from §35 narrative coherence cracks
 *   weakSemanticGrounding          — from §132 semantic grounding check
 *   repeatedLowDignityExplanations — from §178 causal dignity audit
 *   regimeGrammarTension           — from §93 regime grammar
 *
 * 5 recommended actions (PDF lines 5859-5863, threshold-driven):
 *   continue            — pressure < 0.40
 *   simplify            — pressure 0.40..0.55
 *   research_escalation — pressure 0.55..0.70
 *   ontology_revision   — pressure 0.70..0.85
 *   observer_retreat    — pressure >= 0.85
 *
 * Per canonical rules 5873-5880:
 * - presiune mare PERSISTENTĂ nu se tratează cu patch-uri locale
 * - presiunea mare cere: simplificare + quarantine + reducere boldness + observatie
 * - persistența și distribuția contează — nu orice presiune cere remodelare
 *
 * Distinct de modulele componente:
 * - §120 unknownsRegistry        = ONE source (unknown_pressure component)
 * - §134 representationDebt      = ONE source (ontology_strain component)
 * - §148 ontologyHumility        = ONE source (unexplained_residuals)
 * - §179 = INDEX COMPUS al tuturor presiunilor pe lumea internă întreagă
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const PRESSURE_COMPONENTS = Object.freeze([
    'unexplainedResiduals', 'ontologyStrain',
    'unknownPressure', 'narrativeFractures',
    'weakSemanticGrounding', 'repeatedLowDignityExplanations',
    'regimeGrammarTension'
]);
const RECOMMENDED_ACTIONS = Object.freeze([
    'continue', 'simplify', 'research_escalation',
    'ontology_revision', 'observer_retreat'
]);
const TREND_DIRECTIONS = Object.freeze(['rising', 'steady', 'falling']);

const PRESSURE_THRESHOLDS = Object.freeze({
    observer_retreat: 0.85,
    ontology_revision: 0.70,
    research_escalation: 0.55,
    simplify: 0.40
});

const TREND_DELTA_THRESHOLD = 0.05;
const PERSISTENCE_WINDOW = 3;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§179 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§179 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§179 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeWorldhoodPressureScore(params) {
    const components = _required(params, 'components');
    let sum = 0;
    for (const c of PRESSURE_COMPONENTS) {
        if (components[c] === undefined || components[c] === null) {
            throw new Error(`§179 missing component: ${c}`);
        }
        _requireRange01(c, components[c]);
        sum += components[c];
    }
    return { pressureScore: Math.max(0, Math.min(1, sum / PRESSURE_COMPONENTS.length)) };
}

function classifyRecommendedAction(params) {
    const pressureScore = _required(params, 'pressureScore');
    _requireRange01('pressureScore', pressureScore);
    if (pressureScore >= PRESSURE_THRESHOLDS.observer_retreat) {
        return { action: 'observer_retreat' };
    }
    if (pressureScore >= PRESSURE_THRESHOLDS.ontology_revision) {
        return { action: 'ontology_revision' };
    }
    if (pressureScore >= PRESSURE_THRESHOLDS.research_escalation) {
        return { action: 'research_escalation' };
    }
    if (pressureScore >= PRESSURE_THRESHOLDS.simplify) {
        return { action: 'simplify' };
    }
    return { action: 'continue' };
}

function detectTrend(params) {
    const recentScores = _required(params, 'recentScores');
    if (!Array.isArray(recentScores)) {
        throw new Error('§179 recentScores must be array');
    }
    if (recentScores.length < 2) {
        return { trendDirection: 'steady' };
    }
    const first = recentScores[0];
    const last = recentScores[recentScores.length - 1];
    const delta = last - first;
    if (delta > TREND_DELTA_THRESHOLD) return { trendDirection: 'rising' };
    if (delta < -TREND_DELTA_THRESHOLD) return { trendDirection: 'falling' };
    return { trendDirection: 'steady' };
}

function detectPersistentPressure(params) {
    const recentScores = _required(params, 'recentScores');
    const threshold = _required(params, 'threshold');
    if (!Array.isArray(recentScores)) {
        throw new Error('§179 recentScores must be array');
    }
    _requireRange01('threshold', threshold);
    if (recentScores.length < PERSISTENCE_WINDOW) {
        return { persistent: false, reason: 'insufficient_window' };
    }
    const window = recentScores.slice(-PERSISTENCE_WINDOW);
    const allAbove = window.every(s => s >= threshold);
    return {
        persistent: allAbove,
        reason: allAbove ? 'all_above_threshold' : 'gap_in_window'
    };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertSnapshot: db.prepare(`
        INSERT INTO ml_worldhood_pressure_snapshots (
            user_id, resolved_env, snapshot_id, unexplained_residuals,
            ontology_strain, unknown_pressure, narrative_fractures,
            weak_semantic_grounding, repeated_low_dignity_explanations,
            regime_grammar_tension, composite_pressure_score,
            recommended_action, trend_direction, persistent_zones_json,
            reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectSnapshot: db.prepare(`
        SELECT id, snapshot_id AS snapshotId,
               unexplained_residuals AS unexplainedResiduals,
               ontology_strain AS ontologyStrain,
               unknown_pressure AS unknownPressure,
               narrative_fractures AS narrativeFractures,
               weak_semantic_grounding AS weakSemanticGrounding,
               repeated_low_dignity_explanations AS repeatedLowDignityExplanations,
               regime_grammar_tension AS regimeGrammarTension,
               composite_pressure_score AS compositePressureScore,
               recommended_action AS recommendedAction,
               trend_direction AS trendDirection,
               persistent_zones_json AS persistentZonesJson,
               reasoning, ts
        FROM ml_worldhood_pressure_snapshots
        WHERE snapshot_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, snapshot_id AS snapshotId,
               composite_pressure_score AS compositePressureScore,
               recommended_action AS recommendedAction,
               trend_direction AS trendDirection,
               persistent_zones_json AS persistentZonesJson, ts
        FROM ml_worldhood_pressure_snapshots
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByAction: db.prepare(`
        SELECT id, snapshot_id AS snapshotId,
               composite_pressure_score AS compositePressureScore,
               recommended_action AS recommendedAction,
               trend_direction AS trendDirection,
               persistent_zones_json AS persistentZonesJson, ts
        FROM ml_worldhood_pressure_snapshots
        WHERE user_id = ? AND resolved_env = ? AND recommended_action = ?
        ORDER BY ts DESC
    `),
    countByTrend: db.prepare(`
        SELECT trend_direction AS trendDirection, COUNT(*) AS count
        FROM ml_worldhood_pressure_snapshots
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY trend_direction
    `)
};

function recordWorldhoodPressureSnapshot(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const snapshotId = _required(params, 'snapshotId');
    const components = _required(params, 'components');
    const recentScores = _required(params, 'recentScores');
    const persistentZones = _required(params, 'persistentZones');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!Array.isArray(recentScores)) {
        throw new Error('§179 recentScores must be array');
    }
    if (!Array.isArray(persistentZones)) {
        throw new Error('§179 persistentZones must be array');
    }
    if (_stmts.selectSnapshot.get(snapshotId)) {
        throw new Error(`§179 duplicate snapshotId: ${snapshotId}`);
    }

    const { pressureScore } = computeWorldhoodPressureScore({ components });
    const { action: recommendedAction } = classifyRecommendedAction({ pressureScore });
    const { trendDirection } = detectTrend({ recentScores });

    _stmts.insertSnapshot.run(
        userId, resolvedEnv, snapshotId,
        components.unexplainedResiduals, components.ontologyStrain,
        components.unknownPressure, components.narrativeFractures,
        components.weakSemanticGrounding, components.repeatedLowDignityExplanations,
        components.regimeGrammarTension,
        pressureScore, recommendedAction, trendDirection,
        JSON.stringify(persistentZones), reasoning, ts
    );

    return {
        recorded: true,
        snapshotId,
        compositePressureScore: pressureScore,
        recommendedAction,
        trendDirection
    };
}

function getRecentSnapshots(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const recommendedAction = params.recommendedAction;
    if (recommendedAction !== undefined && !RECOMMENDED_ACTIONS.includes(recommendedAction)) {
        throw new Error(`§179 invalid recommendedAction filter: ${recommendedAction}`);
    }
    return recommendedAction
        ? _stmts.selectByAction.all(userId, resolvedEnv, recommendedAction)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function getTrendStats(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByTrend.all(userId, resolvedEnv, sinceTs);
    const stats = {
        rising: 0, steady: 0, falling: 0, totalCount: 0
    };
    for (const r of rows) {
        stats[r.trendDirection] = r.count;
        stats.totalCount += r.count;
    }
    return stats;
}

module.exports = {
    // constants
    PRESSURE_COMPONENTS,
    RECOMMENDED_ACTIONS,
    TREND_DIRECTIONS,
    PRESSURE_THRESHOLDS,
    TREND_DELTA_THRESHOLD,
    PERSISTENCE_WINDOW,
    // pure
    computeWorldhoodPressureScore,
    classifyRecommendedAction,
    detectTrend,
    detectPersistentPressure,
    // DB
    recordWorldhoodPressureSnapshot,
    getRecentSnapshots,
    getTrendStats
};

// FILE END §179 worldhoodPressureIndex.js
