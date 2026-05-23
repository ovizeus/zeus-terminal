'use strict';

/**
 * OMEGA Cross-cutting — explainability (canonical §25)
 *
 * §25 EXPLAINABILITY / SHAP / LIMBAJ UMAN.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1156-1168.
 *
 * "Botul trebuie sa explica uman de ce a decis."
 *
 * Per-decision spec (lines 1158-1165):
 *   - SHAP values per feature
 *   - top 3 positive factors
 *   - top 3 negative factors
 *   - decisive factor
 *   - human-language explanation
 *   - example: "factorul decisiv a fost CVD divergence + cross-venue signal
 *              + sweep reclaim"
 *
 * Feature lifecycle spec (lines 1166-1168):
 *   - feature importance report after trade
 *   - detection of features that no longer have value
 *   - ability to remove degraded features from model
 *
 * First module in _crosscutting/ directory. Cross-cutting because
 * explainability serves R2 detectors, R5A learning, R6 shadow comparison.
 *
 * Composability:
 *   - consumes §24 detector outputs (signal source for SHAP values)
 *   - feeds §16 attribution (decisive factor → outcome correlation)
 *   - feeds §17 regime metrics (per-regime feature importance)
 */

const { db } = require('../../database');

const TOP_K_FACTORS = 3;
const DEGRADATION_THRESHOLD = 0.02;       // mean importance < 2% considered degraded
const MIN_SAMPLES_FOR_DEGRADATION = 30;   // require 30 samples before assessing

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`explainability: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertExplanation: db.prepare(`
        INSERT INTO ml_explanations
        (user_id, resolved_env, decision_id, pos_id, decision,
         shap_values_json, top_positive_json, top_negative_json,
         decisive_factor, human_language, model_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getExplanation: db.prepare(`
        SELECT * FROM ml_explanations
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
    `),
    getFeatureHealth: db.prepare(`
        SELECT * FROM ml_feature_health
        WHERE user_id = ? AND resolved_env = ? AND feature_name = ?
    `),
    insertFeatureHealth: db.prepare(`
        INSERT INTO ml_feature_health
        (user_id, resolved_env, feature_name, sample_count, mean_importance,
         last_seen_at, disabled, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, 0, ?, ?)
    `),
    updateFeatureHealth: db.prepare(`
        UPDATE ml_feature_health
        SET sample_count = sample_count + 1,
            mean_importance = ((mean_importance * sample_count) + ?) / (sample_count + 1),
            last_seen_at = ?,
            updated_at = ?
        WHERE user_id = ? AND resolved_env = ? AND feature_name = ?
    `),
    listDegradedCandidates: db.prepare(`
        SELECT * FROM ml_feature_health
        WHERE user_id = ? AND resolved_env = ?
          AND sample_count >= ? AND mean_importance < ? AND disabled = 0
        ORDER BY mean_importance ASC, sample_count DESC
    `),
    disableFeature: db.prepare(`
        UPDATE ml_feature_health
        SET disabled = 1, disabled_reason = ?, disabled_at = ?, updated_at = ?
        WHERE user_id = ? AND resolved_env = ? AND feature_name = ?
    `)
};

// ── deriveTopK (pure) ──────────────────────────────────────────────
function _deriveTopK(shapValues, k = TOP_K_FACTORS) {
    const entries = Object.entries(shapValues).map(([f, v]) => ({
        feature: f, value: Number(v)
    })).filter(e => Number.isFinite(e.value));

    const sortedAbsDesc = [...entries].sort(
        (a, b) => Math.abs(b.value) - Math.abs(a.value)
    );

    const positives = entries
        .filter(e => e.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, k);

    const negatives = entries
        .filter(e => e.value < 0)
        .sort((a, b) => a.value - b.value)
        .slice(0, k);

    const decisive = sortedAbsDesc.length > 0 ? sortedAbsDesc[0].feature : null;

    return { topPositive: positives, topNegative: negatives, decisive };
}

// ── formatHumanExplanation (pure) ──────────────────────────────────
function formatHumanExplanation(shapValues, contextLabels) {
    const labels = contextLabels || {};
    const { topPositive, topNegative, decisive } = _deriveTopK(shapValues);

    if (!decisive) return 'no_explanation_available';

    const labelOf = (f) => labels[f] || f;

    const posText = topPositive.length > 0
        ? topPositive.map(p => labelOf(p.feature)).join(' + ')
        : 'no_positive_factors';

    const decisiveLabel = labelOf(decisive);
    let text = `factorul decisiv a fost ${decisiveLabel}`;
    if (topPositive.length > 1) {
        text += ` (sustinut de ${posText})`;
    }
    if (topNegative.length > 0) {
        const negText = topNegative.map(n => labelOf(n.feature)).join(', ');
        text += `; contrabalansat de ${negText}`;
    }
    return text;
}

// ── recordExplanation ──────────────────────────────────────────────
function recordExplanation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const shapValues = _required(params, 'shapValues');
    const decision = _required(params, 'decision');
    const posId = (params && params.posId) ? params.posId : null;
    const modelVersion = (params && params.modelVersion) ? params.modelVersion : null;
    const contextLabels = (params && params.contextLabels) ? params.contextLabels : null;

    const { topPositive, topNegative, decisive } = _deriveTopK(shapValues);
    const humanLanguage = formatHumanExplanation(shapValues, contextLabels);

    _stmts.insertExplanation.run(
        userId, env, decisionId, posId, decision,
        JSON.stringify(shapValues),
        JSON.stringify(topPositive),
        JSON.stringify(topNegative),
        decisive, humanLanguage,
        modelVersion, Date.now()
    );

    return { recorded: true, decisiveFactor: decisive, humanLanguage };
}

// ── getExplanation ─────────────────────────────────────────────────
function getExplanation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');

    const row = _stmts.getExplanation.get(userId, env, decisionId);
    if (!row) return null;

    return {
        decisionId: row.decision_id,
        posId: row.pos_id,
        decision: row.decision,
        shapValues: JSON.parse(row.shap_values_json),
        topPositive: JSON.parse(row.top_positive_json),
        topNegative: JSON.parse(row.top_negative_json),
        decisiveFactor: row.decisive_factor,
        humanLanguage: row.human_language,
        modelVersion: row.model_version,
        createdAt: row.created_at
    };
}

// ── trackFeaturePerformance ────────────────────────────────────────
function trackFeaturePerformance(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const feature = _required(params, 'feature');
    const importance = _required(params, 'importance');

    const now = Date.now();
    const existing = _stmts.getFeatureHealth.get(userId, env, feature);

    if (!existing) {
        _stmts.insertFeatureHealth.run(
            userId, env, feature, Math.abs(importance), now, now, now
        );
    } else {
        _stmts.updateFeatureHealth.run(
            Math.abs(importance), now, now,
            userId, env, feature
        );
    }

    return { tracked: true, feature };
}

// ── getDegradedFeatures ────────────────────────────────────────────
function getDegradedFeatures(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const threshold = (params && params.threshold !== undefined)
        ? params.threshold : DEGRADATION_THRESHOLD;
    const minSamples = (params && params.minSamples !== undefined)
        ? params.minSamples : MIN_SAMPLES_FOR_DEGRADATION;

    const rows = _stmts.listDegradedCandidates.all(userId, env, minSamples, threshold);
    return rows.map(r => ({
        featureName: r.feature_name,
        sampleCount: r.sample_count,
        meanImportance: r.mean_importance,
        lastSeenAt: r.last_seen_at
    }));
}

// ── disableFeatureInModel ──────────────────────────────────────────
function disableFeatureInModel(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const featureName = _required(params, 'featureName');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');

    const existing = _stmts.getFeatureHealth.get(userId, env, featureName);
    if (!existing) {
        throw new Error(`explainability: feature "${featureName}" not tracked`);
    }

    const now = Date.now();
    _stmts.disableFeature.run(
        reason, now, now,
        userId, env, featureName
    );
    void actor;

    return { disabled: true, featureName };
}

module.exports = {
    TOP_K_FACTORS,
    DEGRADATION_THRESHOLD,
    MIN_SAMPLES_FOR_DEGRADATION,
    formatHumanExplanation,
    recordExplanation,
    getExplanation,
    trackFeaturePerformance,
    getDegradedFeatures,
    disableFeatureInModel
};
