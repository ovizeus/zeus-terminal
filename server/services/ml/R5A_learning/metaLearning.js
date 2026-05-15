'use strict';

/**
 * OMEGA R5A Learning — metaLearning (canonical §72)
 *
 * §72 META-LEARNING — botul invata cum sa invete mai repede.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1974-1975.
 *
 * "Pe futures crypto unde regimurile se schimba uneori in 48 de ore,
 *  aceasta nu e optimizare — e supravietuire."
 *
 * R5A. Rapid adaptation primitives. Tracks adaptation speed per regime
 * transition. Bot normal 3-6 weeks → bot cu meta-learning 3-5 days.
 *
 * Scope Wave 3: episode tracking + speedup measurement. Actual model
 * training infrastructure (MAML/Reptile gradient-based meta-learning)
 * deferred to ML implementation phase.
 *
 * Lifecycle:
 *   DETECTING → ADAPTING → CALIBRATED (success) | FAILED
 *
 * Meta-learning success criterion:
 *   episode_hours < META_ADAPTATION_TARGET_HOURS (120) AND
 *   samples_used < MIN_SAMPLES_META (50)
 */

const { db } = require('../../database');

const EPISODE_STATUSES = Object.freeze([
    'DETECTING', 'ADAPTING', 'CALIBRATED', 'FAILED'
]);

const META_ADAPTATION_TARGET_HOURS = 120;    // 5 days
const STANDARD_ADAPTATION_TARGET_HOURS = 720; // 30 days baseline
const MIN_SAMPLES_META = 50;
const MIN_SAMPLES_STANDARD = 2000;
const MIN_EPISODES_FOR_BASELINE = 3;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`metaLearning: missing ${key}`);
    }
    return params[key];
}

function _percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const idx = Math.min(
        sortedArr.length - 1,
        Math.max(0, Math.floor(p * sortedArr.length))
    );
    return sortedArr[idx];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertEpisode: db.prepare(`
        INSERT INTO ml_meta_adaptation_episodes
        (user_id, resolved_env, episode_id, from_regime, to_regime,
         detection_ts, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'DETECTING', ?)
    `),
    incrementSamples: db.prepare(`
        UPDATE ml_meta_adaptation_episodes
        SET samples_used = samples_used + 1, status = 'ADAPTING'
        WHERE episode_id = ?
    `),
    completeEpisode: db.prepare(`
        UPDATE ml_meta_adaptation_episodes
        SET status = 'CALIBRATED', recalibration_complete_ts = ?,
            recalibration_quality_score = ?
        WHERE episode_id = ?
    `),
    failEpisode: db.prepare(`
        UPDATE ml_meta_adaptation_episodes
        SET status = 'FAILED', failure_reason = ?, recalibration_complete_ts = ?
        WHERE episode_id = ?
    `),
    getEpisode: db.prepare(`
        SELECT * FROM ml_meta_adaptation_episodes WHERE episode_id = ?
    `),
    completedEpisodesForUser: db.prepare(`
        SELECT * FROM ml_meta_adaptation_episodes
        WHERE user_id = ? AND resolved_env = ?
          AND status = 'CALIBRATED'
          AND created_at >= ?
    `),
    historyForUser: db.prepare(`
        SELECT * FROM ml_meta_adaptation_episodes
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR status = ?)
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `),
    upsertBaseline: db.prepare(`
        INSERT INTO ml_meta_baseline_speed
        (user_id, resolved_env, avg_adaptation_hours,
         p50_samples_to_calibrate, p95_samples_to_calibrate,
         episodes_observed, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            avg_adaptation_hours = excluded.avg_adaptation_hours,
            p50_samples_to_calibrate = excluded.p50_samples_to_calibrate,
            p95_samples_to_calibrate = excluded.p95_samples_to_calibrate,
            episodes_observed = excluded.episodes_observed,
            last_updated = excluded.last_updated
    `),
    getBaseline: db.prepare(`
        SELECT * FROM ml_meta_baseline_speed
        WHERE user_id = ? AND resolved_env = ?
    `)
};

// ── recordRegimeTransition ─────────────────────────────────────────
function recordRegimeTransition(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const episodeId = _required(params, 'episodeId');
    const fromRegime = _required(params, 'fromRegime');
    const toRegime = _required(params, 'toRegime');
    const detectionTs = (params && params.detectionTs) ? params.detectionTs : Date.now();
    const createdAt = (params && params.createdAt) ? params.createdAt : Date.now();

    try {
        _stmts.insertEpisode.run(
            userId, env, episodeId,
            fromRegime, toRegime,
            detectionTs, createdAt
        );
        return { recorded: true, episodeId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`metaLearning: duplicate episodeId "${episodeId}"`);
        }
        throw err;
    }
}

// ── recordAdaptationSample ─────────────────────────────────────────
function recordAdaptationSample(params) {
    const episodeId = _required(params, 'episodeId');

    const episode = _stmts.getEpisode.get(episodeId);
    if (!episode) {
        throw new Error(`metaLearning: episode "${episodeId}" not found`);
    }
    if (episode.status === 'CALIBRATED' || episode.status === 'FAILED') {
        throw new Error(`metaLearning: cannot add sample to ${episode.status} episode`);
    }

    _stmts.incrementSamples.run(episodeId);
    return { recorded: true, samplesUsed: episode.samples_used + 1 };
}

// ── completeAdaptation ─────────────────────────────────────────────
function completeAdaptation(params) {
    const episodeId = _required(params, 'episodeId');
    const recalibrationQualityScore = _required(params, 'recalibrationQualityScore');
    const completionTs = (params && params.completionTs) ? params.completionTs : Date.now();

    const episode = _stmts.getEpisode.get(episodeId);
    if (!episode) {
        throw new Error(`metaLearning: episode "${episodeId}" not found`);
    }
    if (episode.status !== 'DETECTING' && episode.status !== 'ADAPTING') {
        throw new Error(`metaLearning: cannot complete episode in status ${episode.status}`);
    }

    _stmts.completeEpisode.run(completionTs, recalibrationQualityScore, episodeId);
    return {
        completed: true,
        durationMs: completionTs - episode.detection_ts,
        samplesUsed: episode.samples_used
    };
}

// ── failAdaptation ─────────────────────────────────────────────────
function failAdaptation(params) {
    const episodeId = _required(params, 'episodeId');
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const episode = _stmts.getEpisode.get(episodeId);
    if (!episode) {
        throw new Error(`metaLearning: episode "${episodeId}" not found`);
    }

    _stmts.failEpisode.run(reason, ts, episodeId);
    return { failed: true };
}

// ── getAdaptationSpeed ─────────────────────────────────────────────
function getAdaptationSpeed(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 90;

    const since = Date.now() - lookbackDays * 86400000;
    const episodes = _stmts.completedEpisodesForUser.all(userId, env, since);

    if (episodes.length < MIN_EPISODES_FOR_BASELINE) {
        return {
            sufficient: false,
            episodes: episodes.length,
            reason: 'insufficient_episodes_for_baseline'
        };
    }

    const hoursArr = episodes.map(
        e => (e.recalibration_complete_ts - e.detection_ts) / 3600000
    );
    const samplesArr = episodes.map(e => e.samples_used).sort((a, b) => a - b);

    const avgHours = hoursArr.reduce((s, h) => s + h, 0) / hoursArr.length;
    const p50Samples = _percentile(samplesArr, 0.5);
    const p95Samples = _percentile(samplesArr, 0.95);

    _stmts.upsertBaseline.run(
        userId, env,
        avgHours, p50Samples, p95Samples,
        episodes.length, Date.now()
    );

    return {
        sufficient: true,
        avgAdaptationHours: avgHours,
        p50Samples,
        p95Samples,
        episodesObserved: episodes.length
    };
}

// ── compareToBaseline ──────────────────────────────────────────────
function compareToBaseline(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const currentEpisodeSamples = _required(params, 'currentEpisodeSamples');
    const currentEpisodeHours = _required(params, 'currentEpisodeHours');

    const baseline = _stmts.getBaseline.get(userId, env);
    const referenceHours = baseline ? baseline.avg_adaptation_hours : STANDARD_ADAPTATION_TARGET_HOURS;

    const speedupRatio = currentEpisodeHours > 0
        ? referenceHours / currentEpisodeHours
        : Infinity;

    const isMetaLearning =
        currentEpisodeHours < META_ADAPTATION_TARGET_HOURS &&
        currentEpisodeSamples < MIN_SAMPLES_META;

    return {
        speedupRatio,
        isMetaLearning,
        currentEpisodeHours,
        currentEpisodeSamples,
        baselineHours: referenceHours,
        targetMetaHours: META_ADAPTATION_TARGET_HOURS,
        targetMetaSamples: MIN_SAMPLES_META
    };
}

// ── getAdaptationHistory ───────────────────────────────────────────
function getAdaptationHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const status = (params && params.status) ? params.status : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.historyForUser.all(
        userId, env,
        status, status,
        since > 0 ? 1 : 0, since,
        limit
    );
}

module.exports = {
    EPISODE_STATUSES,
    META_ADAPTATION_TARGET_HOURS,
    STANDARD_ADAPTATION_TARGET_HOURS,
    MIN_SAMPLES_META,
    MIN_SAMPLES_STANDARD,
    MIN_EPISODES_FOR_BASELINE,
    recordRegimeTransition,
    recordAdaptationSample,
    completeAdaptation,
    failAdaptation,
    getAdaptationSpeed,
    compareToBaseline,
    getAdaptationHistory
};
