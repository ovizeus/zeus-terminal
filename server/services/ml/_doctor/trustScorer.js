'use strict';

/**
 * OMEGA Doctor D-3.3 — Trust Scorer (separate from Health).
 *
 * Per FAILURE_ONTOLOGY + Phone Claude proposal:
 *   - health_score = does module RUN? (latency, errors — telemetryCollector)
 *   - trust_score = is module WORTH LISTENING to? (recommendations vs outcome)
 *
 * Trust is the post-hoc supervised signal: when module recommended X and we
 * eventually saw Y, was X correct? Updated via EMA so recent observations
 * weigh more.
 *
 * Input: recommendationCorrect ∈ [0,1] where 1 = perfectly correct
 * recommendation, 0 = completely wrong, 0.5 = partial/inconclusive.
 *
 * In-memory map; persistence to DB deferred to D-3.4 (decay) where we
 * also need to handle restart recovery.
 *
 * EMA: trust_new = trust_old + alpha * (observed - trust_old)
 * alpha = 0.10 → ~10 observations to converge ~63% (1/e), ~30 to converge 95%
 */

const EMA_ALPHA = 0.10;
const TRUST_THRESHOLD = 0.40;
const INITIAL_TRUST = 0.50;

const _scores = new Map();  // moduleId → { trustScore, observationCount, lastUpdateTs }

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`trustScorer: missing required field ${k}`);
    }
    return p[k];
}

function updateTrust(params) {
    const moduleId = _required(params, 'moduleId');
    const observed = _required(params, 'recommendationCorrect');
    const ts = _required(params, 'ts');

    if (typeof observed !== 'number' || observed < 0 || observed > 1) {
        throw new Error(`trustScorer: recommendationCorrect must be in [0,1], got ${observed}`);
    }

    let entry = _scores.get(moduleId);
    if (!entry) {
        entry = { trustScore: INITIAL_TRUST, observationCount: 0, lastUpdateTs: 0 };
    }

    entry.trustScore = entry.trustScore + EMA_ALPHA * (observed - entry.trustScore);
    entry.observationCount += 1;
    entry.lastUpdateTs = ts;
    _scores.set(moduleId, entry);

    return { trustScore: entry.trustScore, observationCount: entry.observationCount };
}

function getTrustScore(params) {
    const moduleId = _required(params, 'moduleId');
    const entry = _scores.get(moduleId);
    if (!entry) return { trustScore: INITIAL_TRUST, observationCount: 0 };
    return { trustScore: entry.trustScore, observationCount: entry.observationCount };
}

function isLowTrust(params) {
    const moduleId = _required(params, 'moduleId');
    const { trustScore } = getTrustScore({ moduleId });
    return { lowTrust: trustScore < TRUST_THRESHOLD, trustScore };
}

function listLowTrustModules() {
    const result = [];
    for (const [moduleId, entry] of _scores.entries()) {
        if (entry.trustScore < TRUST_THRESHOLD) {
            result.push({ moduleId, trustScore: entry.trustScore,
                          observationCount: entry.observationCount });
        }
    }
    return result;
}

// === DECAY SUPPORT (D-3.4) ===
// listAllScores + applyDecay let decayScheduler iterate and adjust without
// triggering observationCount increment. lastUpdateTs is the timestamp of
// the most recent updateTrust() call (NOT decay) — used for idle detection.

function listAllScores() {
    const result = [];
    for (const [moduleId, entry] of _scores.entries()) {
        result.push({
            moduleId,
            trustScore: entry.trustScore,
            observationCount: entry.observationCount,
            lastUpdateTs: entry.lastUpdateTs
        });
    }
    return result;
}

function applyDecay(params) {
    const moduleId = _required(params, 'moduleId');
    const newScore = _required(params, 'newScore');
    if (typeof newScore !== 'number' || newScore < 0 || newScore > 1) {
        throw new Error(`trustScorer.applyDecay: newScore must be in [0,1]`);
    }
    const entry = _scores.get(moduleId);
    if (!entry) return { applied: false, reason: 'unknown_module' };
    entry.trustScore = newScore;
    // Deliberately do NOT update lastUpdateTs — decay should not mask staleness.
    return { applied: true, trustScore: newScore };
}

function resetForTest() {
    _scores.clear();
}

module.exports = {
    EMA_ALPHA, TRUST_THRESHOLD, INITIAL_TRUST,
    updateTrust, getTrustScore, isLowTrust, listLowTrustModules,
    listAllScores, applyDecay, resetForTest
};
