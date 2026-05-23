'use strict';

/**
 * OMEGA _meta — assumptionSurfaceMapper (canonical §129)
 *
 * §129 ASSUMPTION SURFACE MAPPER / LOAD-BEARING PREMISE ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3714-3759.
 *
 * "Nu este suficient ca botul sa tina evidenta necunoscutelor. Trebuie sa
 *  tina evidenta explicita a presupunerilor tacute pe care se sprijina
 *  deciziile sale... 'pe ce anume ma bazez, chiar daca nu am spus-o
 *  explicit?'... registry de assumptions active per decizie + tagging al
 *  premiselor load-bearing + assumption fragility score + assumption
 *  dependency graph + distinctie intre premise tari / fragile / speculative
 *  + 6 tipuri canonice: structural/causal/execution/data integrity/
 *  regime persistence/cross-venue validity... transforma presupunerile
 *  invizibile in obiecte auditable... permite penalizare de size cand
 *  premisele centrale sunt fragile."
 *
 * Distinct from §120 unknownsRegistry (gap inventory of what we DON'T know;
 * §129 = positive registry of what we DO assume), §117 epistemicProvenance
 * (_audit, lineage), §113 socraticSelfDoubt (adversarial falsification of
 * premises; §129 = the registry being falsified), §122 selfModel (module
 * capability graph). §129 = per-decision tacit premise surface area.
 */

const { db } = require('../../database');

const PREMISE_TYPES = Object.freeze([
    'structural', 'causal', 'execution',
    'data_integrity', 'regime_persistence',
    'cross_venue_validity'
]);
const STRENGTH_LEVELS = Object.freeze([
    'strong', 'fragile', 'speculative'
]);
const FRAGILITY_THRESHOLDS = Object.freeze({
    strong: 0.30,
    fragile: 0.70
});
const LOAD_BEARING_THRESHOLD = 0.50;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`assumptionSurfaceMapper: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAssumption: db.prepare(`
        INSERT INTO ml_assumptions
        (user_id, resolved_env, assumption_id, decision_id,
         premise_type, strength_level, fragility_score,
         statement, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertDependency: db.prepare(`
        INSERT INTO ml_assumption_dependencies
        (user_id, resolved_env, dependency_id,
         parent_assumption_id, child_assumption_id, ts)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    listByDecision: db.prepare(`
        SELECT * FROM ml_assumptions
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts ASC
    `),
    listDependenciesByParent: db.prepare(`
        SELECT child_assumption_id FROM ml_assumption_dependencies
        WHERE user_id = ? AND resolved_env = ? AND parent_assumption_id = ?
    `)
};

// ── classifyStrength (pure) ────────────────────────────────────────
function classifyStrength(params) {
    const fragility = _required(params, 'fragilityScore');
    if (fragility < 0 || fragility > 1) {
        throw new Error(
            'assumptionSurfaceMapper: fragilityScore must be in [0,1]'
        );
    }
    let strengthLevel;
    if (fragility < FRAGILITY_THRESHOLDS.strong) strengthLevel = 'strong';
    else if (fragility <= FRAGILITY_THRESHOLDS.fragile) strengthLevel = 'fragile';
    else strengthLevel = 'speculative';
    return { strengthLevel, fragilityScore: fragility };
}

// ── computeLoadBearingScore (pure) ─────────────────────────────────
// loadBearing = fragility × (downstream / max(1, total-1))
// — fragile premise with many dependents = load-bearing
function computeLoadBearingScore(params) {
    const fragility = _required(params, 'fragilityScore');
    const downstreamCount = _required(params, 'downstreamCount');
    const totalAssumptions = _required(params, 'totalAssumptions');
    if (fragility < 0 || fragility > 1) {
        throw new Error(
            'assumptionSurfaceMapper: fragilityScore must be in [0,1]'
        );
    }
    if (downstreamCount < 0 || totalAssumptions < 0) {
        throw new Error('assumptionSurfaceMapper: counts must be non-negative');
    }
    if (totalAssumptions <= 1) return { loadBearingScore: 0 };
    const normalized = downstreamCount / (totalAssumptions - 1);
    const score = fragility * Math.min(1, normalized);
    return { loadBearingScore: Math.max(0, Math.min(1, score)) };
}

// ── isLoadBearing (pure) ───────────────────────────────────────────
function isLoadBearing(params) {
    const score = _required(params, 'loadBearingScore');
    return { loadBearing: score >= LOAD_BEARING_THRESHOLD };
}

// ── computeSizePenalty (pure) ──────────────────────────────────────
// returns max fragility among load-bearing assumptions
function computeSizePenalty(params) {
    const scores = _required(params, 'loadBearingFragilityScores');
    if (!Array.isArray(scores) || scores.length === 0) {
        return { sizePenalty: 0 };
    }
    let maxFrag = 0;
    for (const f of scores) {
        if (f > maxFrag) maxFrag = f;
    }
    return { sizePenalty: Math.max(0, Math.min(1, maxFrag)) };
}

// ── registerAssumption ─────────────────────────────────────────────
function registerAssumption(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const assumptionId = _required(params, 'assumptionId');
    const decisionId = _required(params, 'decisionId');
    const premiseType = _required(params, 'premiseType');
    const fragility = _required(params, 'fragilityScore');
    const statement = _required(params, 'statement');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!PREMISE_TYPES.includes(premiseType)) {
        throw new Error(
            `assumptionSurfaceMapper: invalid premiseType "${premiseType}"`
        );
    }
    const { strengthLevel } = classifyStrength({ fragilityScore: fragility });

    try {
        _stmts.insertAssumption.run(
            userId, env, assumptionId, decisionId,
            premiseType, strengthLevel, fragility,
            statement, ts
        );
        return {
            registered: true, assumptionId,
            strengthLevel, fragilityScore: fragility
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `assumptionSurfaceMapper: duplicate assumptionId "${assumptionId}"`
            );
        }
        throw err;
    }
}

// ── linkAssumptions ────────────────────────────────────────────────
function linkAssumptions(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const dependencyId = _required(params, 'dependencyId');
    const parentId = _required(params, 'parentAssumptionId');
    const childId = _required(params, 'childAssumptionId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (parentId === childId) {
        throw new Error(
            'assumptionSurfaceMapper: self-dependency forbidden (parent === child)'
        );
    }
    try {
        _stmts.insertDependency.run(
            userId, env, dependencyId, parentId, childId, ts
        );
        return { linked: true, dependencyId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `assumptionSurfaceMapper: duplicate dependencyId "${dependencyId}"`
            );
        }
        throw err;
    }
}

// ── getAssumptionsForDecision ──────────────────────────────────────
function getAssumptionsForDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const rows = _stmts.listByDecision.all(userId, env, decisionId);
    return rows.map(r => ({
        assumptionId: r.assumption_id,
        decisionId: r.decision_id,
        premiseType: r.premise_type,
        strengthLevel: r.strength_level,
        fragilityScore: r.fragility_score,
        statement: r.statement,
        ts: r.ts
    }));
}

// ── getLoadBearingAssumptions (integration) ────────────────────────
function getLoadBearingAssumptions(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');

    const assumptions = getAssumptionsForDecision({
        userId, resolvedEnv: env, decisionId
    });
    const total = assumptions.length;
    if (total === 0) return [];

    const result = [];
    for (const a of assumptions) {
        const downstream = _stmts.listDependenciesByParent
            .all(userId, env, a.assumptionId);
        const { loadBearingScore } = computeLoadBearingScore({
            fragilityScore: a.fragilityScore,
            downstreamCount: downstream.length,
            totalAssumptions: total
        });
        const { loadBearing } = isLoadBearing({ loadBearingScore });
        if (loadBearing) {
            result.push({
                ...a,
                downstreamCount: downstream.length,
                loadBearingScore
            });
        }
    }
    return result;
}

module.exports = {
    PREMISE_TYPES,
    STRENGTH_LEVELS,
    FRAGILITY_THRESHOLDS,
    LOAD_BEARING_THRESHOLD,
    classifyStrength,
    computeLoadBearingScore,
    isLoadBearing,
    computeSizePenalty,
    registerAssumption,
    linkAssumptions,
    getAssumptionsForDecision,
    getLoadBearingAssumptions
};
