'use strict';

/**
 * OMEGA R3A Safety — oodNoveltyGate (canonical §69)
 *
 * §69 SINGLE-DECISION NOVELTY / OUT-OF-DISTRIBUTION GATE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1837-1878.
 *
 * "Drift-ul detecteaza schimbari de distributie in timp. Dar uneori
 *  apare un caz singular, extrem de neobisnuit, chiar daca distributia
 *  globala nu a tipat inca."
 *
 * R3A. Per-decision OOD gate. Complement §21 driftDetection /
 * §52 driftOrchestration (population-level drift). §69 = per-case:
 * "am mai vazut vreodata ceva suficient de apropiat de asta?"
 *
 * 5 dimensions per spec:
 *   feature_vector / regime_state / microstructure_state /
 *   macro_context / portfolio_state
 *
 * Novelty score = min L2 distance to manifold reference points.
 * Aggregate across dimensions = mean.
 */

const { db } = require('../../database');

const OOD_DIMENSIONS = Object.freeze([
    'feature_vector', 'regime_state', 'microstructure_state',
    'macro_context', 'portfolio_state'
]);
const NOVELTY_CLASSIFICATIONS = Object.freeze([
    'drift_slow', 'local_outlier', 'new_valid', 'dangerous_unseen'
]);
const OOD_ACTIONS = Object.freeze([
    'continue_normal', 'reduce_size', 'observer', 'alert'
]);

const NOVELTY_THRESHOLD_LOCAL_OUTLIER = 0.5;
const NOVELTY_THRESHOLD_NEW_VALID = 1.0;
const NOVELTY_THRESHOLD_DANGEROUS = 2.0;
const MIN_MANIFOLD_SAMPLES = 50;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`oodNoveltyGate: missing ${key}`);
    }
    return params[key];
}

function _l2(a, b) {
    if (a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return Math.sqrt(sum);
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getManifold: db.prepare(`
        SELECT * FROM ml_ood_manifold
        WHERE user_id = ? AND resolved_env = ? AND dimension = ?
    `),
    upsertManifold: db.prepare(`
        INSERT INTO ml_ood_manifold
        (user_id, resolved_env, dimension, reference_points_json,
         n_samples, last_updated)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, dimension) DO UPDATE SET
            reference_points_json = excluded.reference_points_json,
            n_samples = excluded.n_samples,
            last_updated = excluded.last_updated
    `),
    insertDecision: db.prepare(`
        INSERT INTO ml_ood_decisions
        (user_id, resolved_env, decision_id, novelty_score,
         dimension_scores_json, classification, action, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    historyForUser: db.prepare(`
        SELECT * FROM ml_ood_decisions
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR classification = ?)
          AND (? = '' OR action = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── addReferencePoint ──────────────────────────────────────────────
function addReferencePoint(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const dimension = _required(params, 'dimension');
    const point = _required(params, 'point');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!OOD_DIMENSIONS.includes(dimension)) {
        throw new Error(`oodNoveltyGate: invalid dimension "${dimension}"`);
    }
    if (!Array.isArray(point) || point.length === 0) {
        throw new Error('oodNoveltyGate: point must be non-empty array');
    }

    const current = _stmts.getManifold.get(userId, env, dimension);
    const points = current ? JSON.parse(current.reference_points_json) : [];
    points.push(point);

    _stmts.upsertManifold.run(
        userId, env, dimension,
        JSON.stringify(points), points.length, ts
    );

    return { added: true, samples: points.length };
}

// ── computeNoveltyScore ────────────────────────────────────────────
function computeNoveltyScore(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const dimension = _required(params, 'dimension');
    const queryPoint = _required(params, 'queryPoint');

    if (!OOD_DIMENSIONS.includes(dimension)) {
        throw new Error(`oodNoveltyGate: invalid dimension "${dimension}"`);
    }
    if (!Array.isArray(queryPoint)) {
        throw new Error('oodNoveltyGate: queryPoint must be array');
    }

    const current = _stmts.getManifold.get(userId, env, dimension);
    if (!current || current.n_samples < MIN_MANIFOLD_SAMPLES) {
        return {
            score: Infinity,
            sufficient: false,
            samples: current ? current.n_samples : 0
        };
    }

    const points = JSON.parse(current.reference_points_json);
    let minDist = Infinity;
    for (const p of points) {
        const d = _l2(queryPoint, p);
        if (d < minDist) minDist = d;
    }

    return { score: minDist, sufficient: true, samples: current.n_samples };
}

// ── classifyNoveltyScore (pure) ────────────────────────────────────
function classifyNoveltyScore(score) {
    if (score < NOVELTY_THRESHOLD_LOCAL_OUTLIER) {
        return { classification: 'new_valid', action: 'continue_normal' };
    }
    if (score < NOVELTY_THRESHOLD_NEW_VALID) {
        return { classification: 'local_outlier', action: 'reduce_size' };
    }
    if (score < NOVELTY_THRESHOLD_DANGEROUS) {
        return { classification: 'drift_slow', action: 'observer' };
    }
    return { classification: 'dangerous_unseen', action: 'alert' };
}

// ── evaluateDecisionNovelty ────────────────────────────────────────
function evaluateDecisionNovelty(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const queryPoints = _required(params, 'queryPoints');

    if (typeof queryPoints !== 'object') {
        throw new Error('oodNoveltyGate: queryPoints must be object keyed by dimension');
    }

    const dimensionScores = {};
    let totalScore = 0;
    let dimCount = 0;
    let allSufficient = true;

    for (const dim of OOD_DIMENSIONS) {
        if (!queryPoints[dim]) continue;
        const r = computeNoveltyScore({
            userId, resolvedEnv: env, dimension: dim,
            queryPoint: queryPoints[dim]
        });
        dimensionScores[dim] = r.score;
        if (!r.sufficient) allSufficient = false;
        else {
            totalScore += r.score;
            dimCount++;
        }
    }

    if (!allSufficient) {
        return {
            aggregateNoveltyScore: Infinity,
            dimensionScores,
            classification: 'dangerous_unseen',
            action: 'alert',
            reason: 'insufficient_manifold_samples'
        };
    }

    const aggregate = dimCount > 0 ? totalScore / dimCount : Infinity;
    const cls = classifyNoveltyScore(aggregate);

    return {
        aggregateNoveltyScore: aggregate,
        dimensionScores,
        classification: cls.classification,
        action: cls.action
    };
}

// ── recordOODEvaluation ────────────────────────────────────────────
function recordOODEvaluation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const noveltyScore = _required(params, 'noveltyScore');
    const dimensionScores = _required(params, 'dimensionScores');
    const classification = _required(params, 'classification');
    const action = _required(params, 'action');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!NOVELTY_CLASSIFICATIONS.includes(classification)) {
        throw new Error(`oodNoveltyGate: invalid classification "${classification}"`);
    }
    if (!OOD_ACTIONS.includes(action)) {
        throw new Error(`oodNoveltyGate: invalid action "${action}"`);
    }

    // SQLite REAL cannot store Infinity directly; coerce.
    const safeScore = Number.isFinite(noveltyScore) ? noveltyScore : 1e18;

    _stmts.insertDecision.run(
        userId, env, decisionId, safeScore,
        JSON.stringify(dimensionScores),
        classification, action, ts
    );

    return { recorded: true };
}

// ── getOODHistory ──────────────────────────────────────────────────
function getOODHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const classification = (params && params.classification) ? params.classification : '';
    const action = (params && params.action) ? params.action : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.historyForUser.all(
        userId, env,
        classification, classification,
        action, action,
        since > 0 ? 1 : 0, since,
        limit
    );
}

// ── getManifoldSize ────────────────────────────────────────────────
function getManifoldSize(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const dimension = _required(params, 'dimension');
    const r = _stmts.getManifold.get(userId, env, dimension);
    return r ? r.n_samples : 0;
}

module.exports = {
    OOD_DIMENSIONS,
    NOVELTY_CLASSIFICATIONS,
    OOD_ACTIONS,
    NOVELTY_THRESHOLD_LOCAL_OUTLIER,
    NOVELTY_THRESHOLD_NEW_VALID,
    NOVELTY_THRESHOLD_DANGEROUS,
    MIN_MANIFOLD_SAMPLES,
    addReferencePoint,
    computeNoveltyScore,
    classifyNoveltyScore,
    evaluateDecisionNovelty,
    recordOODEvaluation,
    getOODHistory,
    getManifoldSize
};
