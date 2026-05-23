'use strict';

/**
 * OMEGA R2 Cognition — compositionalGeneralization (canonical §82)
 *
 * §82 GENERALIZARE COMPOZITIONALA — combinatii de conditii nevazute in training.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2145-2146.
 *
 * "Diferit de OOD gate care blocheaza cazul ciudat — §82 = capacitatea de a
 *  rationa corect despre el in loc sa-l blocheze orb."
 *
 * R2 cognition. Decompose novel case into known atomic conditions + reason
 * via composition (additive/multiplicative/min/max interaction rules).
 *
 * Distinct from:
 *   - §69 oodNoveltyGate (BLOCKS strange case)
 *   - §65 episodicMemory (analogy with similar past)
 * §82 = DECOMPOSE novel case + reason from principles.
 */

const { db } = require('../../database');

const INTERACTION_RULES = Object.freeze([
    'additive', 'multiplicative', 'min', 'max'
]);
const MIN_COMPONENTS_FOR_COMPOSITION = 2;
const COMPONENT_MATCH_THRESHOLD = 0.60;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`compositionalGeneralization: missing ${key}`);
    }
    return params[key];
}

function _cosineSimilarity(v1, v2) {
    const keys = new Set([...Object.keys(v1), ...Object.keys(v2)]);
    let dot = 0, n1 = 0, n2 = 0;
    for (const k of keys) {
        const a = v1[k] || 0;
        const b = v2[k] || 0;
        dot += a * b;
        n1 += a * a;
        n2 += b * b;
    }
    if (n1 === 0 || n2 === 0) return 0;
    return dot / (Math.sqrt(n1) * Math.sqrt(n2));
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertCondition: db.prepare(`
        INSERT INTO ml_condition_components
        (user_id, resolved_env, condition_id, name,
         atomic_features_json, known_outcomes_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    listConditions: db.prepare(`
        SELECT * FROM ml_condition_components
        WHERE user_id = ? AND resolved_env = ?
    `),
    insertPrediction: db.prepare(`
        INSERT INTO ml_compositional_predictions
        (user_id, resolved_env, prediction_id, components_used_json,
         interaction_rule, interaction_score, predicted_outcome_json,
         confidence, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updatePrediction: db.prepare(`
        UPDATE ml_compositional_predictions
        SET actual_outcome_json = ?, validated = 1
        WHERE prediction_id = ?
    `),
    getPrediction: db.prepare(`
        SELECT * FROM ml_compositional_predictions WHERE prediction_id = ?
    `),
    statsForUser: db.prepare(`
        SELECT interaction_rule, COUNT(*) AS count,
               AVG(confidence) AS avg_confidence,
               SUM(validated) AS validated_count
        FROM ml_compositional_predictions
        WHERE user_id = ? AND resolved_env = ?
          AND ts >= ?
        GROUP BY interaction_rule
    `)
};

// ── registerCondition ──────────────────────────────────────────────
function registerCondition(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const conditionId = _required(params, 'conditionId');
    const name = _required(params, 'name');
    const atomicFeatures = _required(params, 'atomicFeatures');
    const knownOutcomes = _required(params, 'knownOutcomes');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertCondition.run(
            userId, env, conditionId, name,
            JSON.stringify(atomicFeatures),
            JSON.stringify(knownOutcomes), ts
        );
        return { registered: true, conditionId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`compositionalGeneralization: duplicate conditionId "${conditionId}"`);
        }
        throw err;
    }
}

// ── decomposeNovelCase ─────────────────────────────────────────────
function decomposeNovelCase(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const observedFeatures = _required(params, 'observedFeatures');
    const threshold = (params && typeof params.threshold === 'number')
        ? params.threshold : COMPONENT_MATCH_THRESHOLD;

    const conditions = _stmts.listConditions.all(userId, env);
    const matches = [];

    for (const c of conditions) {
        const features = JSON.parse(c.atomic_features_json);
        const sim = _cosineSimilarity(observedFeatures, features);
        if (sim >= threshold) {
            matches.push({
                conditionId: c.condition_id,
                name: c.name,
                matchScore: sim,
                knownOutcomes: JSON.parse(c.known_outcomes_json)
            });
        }
    }

    // Sort by match score desc
    matches.sort((a, b) => b.matchScore - a.matchScore);

    return { matches, count: matches.length };
}

// ── predictCompositional ───────────────────────────────────────────
function predictCompositional(params) {
    const components = _required(params, 'components');
    const interactionRule = (params && params.interactionRule) ? params.interactionRule : 'additive';
    const outcomeKey = (params && params.outcomeKey) ? params.outcomeKey : 'expectedReturn';

    if (!INTERACTION_RULES.includes(interactionRule)) {
        throw new Error(`compositionalGeneralization: invalid interactionRule "${interactionRule}"`);
    }
    if (!Array.isArray(components) || components.length < MIN_COMPONENTS_FOR_COMPOSITION) {
        throw new Error(
            `compositionalGeneralization: require >= ${MIN_COMPONENTS_FOR_COMPOSITION} components`
        );
    }

    // Extract outcome values from components
    const outcomeValues = components.map(c => {
        const ko = c.knownOutcomes || {};
        return typeof ko[outcomeKey] === 'number' ? ko[outcomeKey] : 0;
    });

    let combinedOutcome;
    if (interactionRule === 'additive') {
        combinedOutcome = outcomeValues.reduce((s, x) => s + x, 0);
    } else if (interactionRule === 'multiplicative') {
        combinedOutcome = outcomeValues.reduce((s, x) => s * x, 1);
    } else if (interactionRule === 'min') {
        combinedOutcome = Math.min(...outcomeValues);
    } else {
        combinedOutcome = Math.max(...outcomeValues);
    }

    // Interaction score = product of match scores (compounding uncertainty)
    const interactionScore = components.reduce((s, c) => s * (c.matchScore || 1), 1);
    const confidence = interactionScore;

    return {
        predictedOutcome: { [outcomeKey]: combinedOutcome },
        confidence,
        interactionScore,
        interactionRule,
        componentsUsed: components.map(c => c.conditionId || c.name)
    };
}

// ── recordPrediction ───────────────────────────────────────────────
function recordPrediction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const predictionId = _required(params, 'predictionId');
    const components = _required(params, 'components');
    const interactionRule = _required(params, 'interactionRule');
    const interactionScore = _required(params, 'interactionScore');
    const predictedOutcome = _required(params, 'predictedOutcome');
    const confidence = _required(params, 'confidence');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!INTERACTION_RULES.includes(interactionRule)) {
        throw new Error(`compositionalGeneralization: invalid interactionRule`);
    }

    try {
        _stmts.insertPrediction.run(
            userId, env, predictionId,
            JSON.stringify(components), interactionRule, interactionScore,
            JSON.stringify(predictedOutcome), confidence, ts
        );
        return { recorded: true };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`compositionalGeneralization: duplicate predictionId "${predictionId}"`);
        }
        throw err;
    }
}

// ── validatePrediction ─────────────────────────────────────────────
function validatePrediction(params) {
    const predictionId = _required(params, 'predictionId');
    const actualOutcome = _required(params, 'actualOutcome');

    const row = _stmts.getPrediction.get(predictionId);
    if (!row) {
        throw new Error(`compositionalGeneralization: prediction "${predictionId}" not found`);
    }

    _stmts.updatePrediction.run(JSON.stringify(actualOutcome), predictionId);

    // Compute error
    const predicted = JSON.parse(row.predicted_outcome_json);
    const keys = Object.keys(predicted);
    let totalErr = 0;
    for (const k of keys) {
        const p = predicted[k] || 0;
        const a = actualOutcome[k] || 0;
        totalErr += Math.abs(p - a) / Math.max(Math.abs(p), 1);
    }
    const avgError = keys.length > 0 ? totalErr / keys.length : 0;

    return { validated: true, predictionError: avgError };
}

// ── getCompositionStats ────────────────────────────────────────────
function getCompositionStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.statsForUser.all(userId, env, since);

    return {
        byInteractionRule: rows.map(r => ({
            interactionRule: r.interaction_rule,
            count: r.count,
            avgConfidence: r.avg_confidence,
            validatedCount: r.validated_count
        })),
        total: rows.reduce((s, r) => s + r.count, 0)
    };
}

module.exports = {
    INTERACTION_RULES,
    MIN_COMPONENTS_FOR_COMPOSITION,
    COMPONENT_MATCH_THRESHOLD,
    registerCondition,
    decomposeNovelCase,
    predictCompositional,
    recordPrediction,
    validatePrediction,
    getCompositionStats
};
