'use strict';

/**
 * OMEGA R-1 Test Harness — replayEngine
 *
 * Loads `ml_decision_snapshots` rows and re-executes the decision pipeline
 * to verify determinism (spec invariant #6).
 *
 * Wave 1 upgrade: replayDecision now RECOMPUTES the score from confluence
 * components stored in the snapshot JSON using a deterministic weighted sum.
 * When no confluence data is present, falls back to original score (matches_original=true).
 * Later waves (Wave 7 R6) wire the actual pipeline re-execution against
 * `input_snapshot_ref` for end-to-end deterministic replay.
 *
 * Spec: project_ml_v3_expert_acceptance_and_ux_scope_20260514.md Wave 1B.
 */

const { db } = require('../../database');

const _stmtLoad = db.prepare(
    'SELECT * FROM ml_decision_snapshots WHERE decision_digest = ? LIMIT 1'
);

function loadSnapshot(decisionDigest) {
    if (!decisionDigest) return null;
    try {
        const row = _stmtLoad.get(decisionDigest);
        return row || null;
    } catch (_) {
        return null;
    }
}

// Confluence component weights — mirrors serverConfluence weighted sum.
const CONFLUENCE_WEIGHTS = {
    regime:    0.20,
    alignment: 0.15,
    structure: 0.15,
    flow:      0.15,
    mtf:       0.15,
    indicator: 0.10,
    sentiment: 0.10,
};

function replayDecision(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return { decision_digest: null, replay_score: 0, replay_top5: [], matches_original: false, original_score: 0, delta: 0 };
    }

    let parsed;
    try {
        parsed = typeof snapshot.snapshot_json === 'string'
            ? JSON.parse(snapshot.snapshot_json)
            : snapshot.snapshot_json;
    } catch (err) {
        throw new Error(`replayDecision: snapshot_json invalid (${err.message})`);
    }

    const originalScore = parsed.score || 0;
    const confluence = parsed.confluence;

    let replayScore;
    let replayTop5;

    if (confluence && typeof confluence === 'object' && Object.keys(confluence).length > 0) {
        // Deterministic score recomputation from confluence components.
        let weightedSum = 0;
        let weightSum = 0;
        for (const [key, w] of Object.entries(CONFLUENCE_WEIGHTS)) {
            if (typeof confluence[key] === 'number') {
                weightedSum += confluence[key] * w * 100;
                weightSum += w;
            }
        }
        replayScore = weightSum > 0
            ? Math.round(weightedSum / weightSum)
            : originalScore;

        // Top5 from confluence sorted desc
        replayTop5 = Object.entries(confluence)
            .filter(([, v]) => typeof v === 'number')
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([k, v]) => `${k}_${v.toFixed(1)}`);
    } else {
        // No confluence data — fall back to original (preserves backward compat)
        replayScore = originalScore;
        replayTop5 = Array.isArray(parsed.top5) ? parsed.top5 : [];
    }

    const matchesOriginal = replayScore === originalScore;
    const delta = replayScore - originalScore;

    return {
        decision_digest: snapshot.decision_digest,
        replay_score: replayScore,
        replay_top5: replayTop5,
        matches_original: matchesOriginal,
        original_score: originalScore,
        delta,
    };
}

module.exports = { loadSnapshot, replayDecision };
