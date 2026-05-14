'use strict';

/**
 * OMEGA R-1 Test Harness — replayEngine
 *
 * Loads `ml_decision_snapshots` rows and re-executes the decision pipeline
 * to verify determinism (spec invariant #6). At Wave 1B foundation level
 * `replayDecision` only echoes the original values + flags `matches_original`.
 * Later waves (Wave 7 R6) wire the actual pipeline re-execution against
 * `input_snapshot_ref` for end-to-end deterministic replay.
 *
 * Spec: project_ml_v3_expert_acceptance_and_ux_scope_20260514.md Wave 1B.
 */

const { db } = require('../../database');

function loadSnapshot(decisionDigest) {
    if (!decisionDigest || typeof decisionDigest !== 'string') {
        throw new Error('loadSnapshot: decisionDigest must be non-empty string');
    }
    const row = db.prepare(
        'SELECT * FROM ml_decision_snapshots WHERE decision_digest = ? LIMIT 1'
    ).get(decisionDigest);
    return row || null;
}

function replayDecision(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        throw new Error('replayDecision: snapshot must be an object');
    }
    let original;
    try {
        original = JSON.parse(snapshot.snapshot_json);
    } catch (err) {
        throw new Error(`replayDecision: snapshot_json invalid (${err.message})`);
    }
    return {
        decision_digest: snapshot.decision_digest,
        replay_score: original.score,
        replay_top5: Array.isArray(original.top5) ? original.top5 : [],
        matches_original: true
    };
}

module.exports = { loadSnapshot, replayDecision };
