'use strict';

/**
 * OMEGA R5A Learning — invarianceLayer (canonical §107)
 *
 * §107 INVARIANCE / NUISANCE-ROBUSTNESS LAYER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2729-2770.
 *
 * "Deciziile bune trebuie sa fie stabile la schimbari irelevante ale
 *  reprezentarii datelor... testare pe scale invariance / timestamp jitter /
 *  minor resampling / harmless feed perturbation / equivalent representation
 *  stability... 'Daca nu s-a schimbat sensul pietei, de ce s-a schimbat
 *  decizia?'... nu orice sensibilitate este edge, uneori e fragilitate."
 *
 * Distinct from §94 complexityBudget (MDL/IG pruning) — §107 = stability
 * audit pe modele/detectoare under nuisance perturbations.
 */

const { db } = require('../../database');

const PERTURBATION_KINDS = Object.freeze([
    'scale', 'timestamp_jitter', 'resampling',
    'feed_perturbation', 'representation'
]);
const SCORE_KINDS = Object.freeze([
    'scale', 'timestamp_jitter', 'resampling',
    'feed_perturbation', 'representation', 'aggregate'
]);
const ROBUSTNESS_STATUSES = Object.freeze([
    'ROBUST', 'FRAGILE', 'INSUFFICIENT'
]);

const DEFAULT_ROBUST_THRESHOLD = 0.80;
const MIN_SAMPLES_FOR_ROBUSTNESS = 10;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`invarianceLayer: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertTest: db.prepare(`
        INSERT INTO ml_invariance_tests
        (user_id, resolved_env, test_id, model_id, perturbation_kind,
         original_verdict, perturbed_verdict, verdict_stable, magnitude, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listTests: db.prepare(`
        SELECT * FROM ml_invariance_tests
        WHERE user_id = ? AND resolved_env = ? AND model_id = ?
        ORDER BY ts DESC LIMIT ?
    `),
    aggregateTests: db.prepare(`
        SELECT COUNT(*) AS total,
               COALESCE(SUM(verdict_stable), 0) AS stable_count
        FROM ml_invariance_tests
        WHERE user_id = ? AND resolved_env = ? AND model_id = ?
    `),
    aggregateTestsByKind: db.prepare(`
        SELECT COUNT(*) AS total,
               COALESCE(SUM(verdict_stable), 0) AS stable_count
        FROM ml_invariance_tests
        WHERE user_id = ? AND resolved_env = ? AND model_id = ?
          AND perturbation_kind = ?
    `),
    insertScore: db.prepare(`
        INSERT INTO ml_robustness_scores
        (user_id, resolved_env, score_id, model_id, kind,
         score, sample_count, status, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    latestScorePerModel: db.prepare(`
        SELECT model_id,
               (SELECT score FROM ml_robustness_scores s2
                WHERE s2.user_id = ml_robustness_scores.user_id
                  AND s2.resolved_env = ml_robustness_scores.resolved_env
                  AND s2.model_id = ml_robustness_scores.model_id
                  AND s2.kind = 'aggregate'
                ORDER BY ts DESC LIMIT 1) AS latest_score,
               (SELECT status FROM ml_robustness_scores s3
                WHERE s3.user_id = ml_robustness_scores.user_id
                  AND s3.resolved_env = ml_robustness_scores.resolved_env
                  AND s3.model_id = ml_robustness_scores.model_id
                  AND s3.kind = 'aggregate'
                ORDER BY ts DESC LIMIT 1) AS latest_status
        FROM ml_robustness_scores
        WHERE user_id = ? AND resolved_env = ? AND kind = 'aggregate'
        GROUP BY model_id
    `)
};

// ── computeRobustnessScore (pure) ──────────────────────────────────
function computeRobustnessScore(params) {
    const stableCount = _required(params, 'stableCount');
    const totalCount = _required(params, 'totalCount');
    if (stableCount < 0 || totalCount < 0) {
        throw new Error('invarianceLayer: counts must be >= 0');
    }
    if (stableCount > totalCount) {
        throw new Error('invarianceLayer: stableCount > totalCount invalid');
    }
    if (totalCount === 0) return { score: 0, stableCount, totalCount };
    return {
        score: stableCount / totalCount,
        stableCount, totalCount
    };
}

// ── evaluateRobustnessStatus (pure) ────────────────────────────────
function evaluateRobustnessStatus(params) {
    const score = _required(params, 'score');
    const sampleCount = _required(params, 'sampleCount');
    const minSamples = (params && params.minSamples !== undefined)
        ? params.minSamples : MIN_SAMPLES_FOR_ROBUSTNESS;
    const robustThreshold = (params && params.robustThreshold !== undefined)
        ? params.robustThreshold : DEFAULT_ROBUST_THRESHOLD;

    if (score < 0 || score > 1) {
        throw new Error('invarianceLayer: score must be in [0,1]');
    }
    if (sampleCount < minSamples) {
        return { status: 'INSUFFICIENT', score, sampleCount, minSamples };
    }
    if (score >= robustThreshold) {
        return { status: 'ROBUST', score, sampleCount };
    }
    return { status: 'FRAGILE', score, sampleCount };
}

// ── runInvarianceTest ──────────────────────────────────────────────
function runInvarianceTest(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const testId = _required(params, 'testId');
    const modelId = _required(params, 'modelId');
    const perturbationKind = _required(params, 'perturbationKind');
    if (!PERTURBATION_KINDS.includes(perturbationKind)) {
        throw new Error(
            `invarianceLayer: invalid perturbationKind "${perturbationKind}"`
        );
    }
    const originalVerdict = _required(params, 'originalVerdict');
    const perturbedVerdict = _required(params, 'perturbedVerdict');
    const magnitude = (params && params.magnitude !== undefined) ? params.magnitude : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const stable =
        JSON.stringify(originalVerdict) === JSON.stringify(perturbedVerdict)
            ? 1 : 0;

    try {
        _stmts.insertTest.run(
            userId, env, testId, modelId, perturbationKind,
            JSON.stringify(originalVerdict),
            JSON.stringify(perturbedVerdict),
            stable, magnitude, ts
        );
        return { recorded: true, testId, verdictStable: !!stable };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`invarianceLayer: duplicate testId "${testId}"`);
        }
        throw err;
    }
}

// ── aggregateRobustness ────────────────────────────────────────────
function aggregateRobustness(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const scoreId = _required(params, 'scoreId');
    const modelId = _required(params, 'modelId');
    const kindParam = (params && params.kind) ? params.kind : 'aggregate';
    if (!SCORE_KINDS.includes(kindParam)) {
        throw new Error(`invarianceLayer: invalid kind "${kindParam}"`);
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    const agg = kindParam === 'aggregate'
        ? _stmts.aggregateTests.get(userId, env, modelId)
        : _stmts.aggregateTestsByKind.get(userId, env, modelId, kindParam);

    const total = agg ? agg.total : 0;
    const stable = agg ? agg.stable_count : 0;
    const r = computeRobustnessScore({ stableCount: stable, totalCount: total });
    const st = evaluateRobustnessStatus({
        score: r.score, sampleCount: total
    });

    try {
        _stmts.insertScore.run(
            userId, env, scoreId, modelId, kindParam,
            r.score, total, st.status, ts
        );
        return {
            persisted: true, scoreId,
            score: r.score, sampleCount: total,
            status: st.status
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`invarianceLayer: duplicate scoreId "${scoreId}"`);
        }
        throw err;
    }
}

// ── getFragileModels ───────────────────────────────────────────────
function getFragileModels(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const threshold = (params && params.threshold !== undefined)
        ? params.threshold : DEFAULT_ROBUST_THRESHOLD;

    const rows = _stmts.latestScorePerModel.all(userId, env);
    return rows
        .filter(r => r.latest_status === 'FRAGILE' && r.latest_score !== null
            && r.latest_score < threshold)
        .map(r => ({
            modelId: r.model_id,
            latestScore: r.latest_score,
            latestStatus: r.latest_status
        }));
}

// ── getTestHistory ─────────────────────────────────────────────────
function getTestHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const modelId = _required(params, 'modelId');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listTests.all(userId, env, modelId, limit);
    return rows.map(r => ({
        testId: r.test_id,
        modelId: r.model_id,
        perturbationKind: r.perturbation_kind,
        originalVerdict: JSON.parse(r.original_verdict),
        perturbedVerdict: JSON.parse(r.perturbed_verdict),
        verdictStable: !!r.verdict_stable,
        magnitude: r.magnitude,
        ts: r.ts
    }));
}

module.exports = {
    PERTURBATION_KINDS,
    SCORE_KINDS,
    ROBUSTNESS_STATUSES,
    DEFAULT_ROBUST_THRESHOLD,
    MIN_SAMPLES_FOR_ROBUSTNESS,
    computeRobustnessScore,
    evaluateRobustnessStatus,
    runInvarianceTest,
    aggregateRobustness,
    getFragileModels,
    getTestHistory
};
