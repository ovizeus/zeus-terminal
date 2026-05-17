'use strict';

/**
 * OMEGA Wave 3 §187 — REALITY CONTACT RATIO / LIVE-WORLD GROUNDING COVENANT.
 *
 * Canonical PDF §187 (ml_brain_canonic.txt lines 5989-6039).
 *
 * "cat din aceasta decizie vine din realitatea de acum si cat vine din ce
 *  cred deja despre realitate?"
 *
 * 6 canonical contribution sources (PDF lines 6013-6019):
 *   directObservedData       (LIVE — counts full weight)
 *   derivedInferences        (SEMI-LIVE — half weight, derived from current)
 *   episodicMemories         (DERIVED — 0 weight)
 *   consolidatedConcepts     (DERIVED — 0 weight)
 *   structuralPriors         (DERIVED — 0 weight)
 *   historicalOntologies     (DERIVED — 0 weight)
 *
 * Reality contact ratio = sum(weight*coefficient) / sum(weight) where
 * coefficient is 1.0 for live, 0.5 for semi-live, 0 for derived.
 *
 * 4 grounding classifications (thresholds):
 *   ratio >= 0.65 → live
 *   ratio >= 0.40 → balanced
 *   ratio >= 0.20 → drift (scholastic_drift_detected = 1)
 *   ratio <  0.20 → scholastic (scholastic_drift_detected = 1)
 *
 * Boldness adjustment per classification (multiplier on action size):
 *   live: 1.0 | balanced: 0.80 | drift: 0.50 | scholastic: 0.20
 *
 * Per canonical rules 6032-6035:
 * - inteligenta derivata nu este interzisă, dar nu poate înlocui contactul cu prezentul
 * - decizii cu grounding live scăzut → boldness redus
 * - orice narativă frumoasă cu reality_contact slab = SUSPECTĂ
 *
 * Plasament R3A_safety (anti-fantasy safety guard, alături de blackSwan
 * Abstention, oodNoveltyGate, dataFreshness, dependencyGraphBlastRadius).
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const CONTRIBUTION_SOURCES = Object.freeze([
    'directObservedData', 'derivedInferences',
    'episodicMemories', 'consolidatedConcepts',
    'structuralPriors', 'historicalOntologies'
]);
const LIVE_SOURCES = Object.freeze(['directObservedData']);
const SEMI_LIVE_SOURCES = Object.freeze(['derivedInferences']);
const GROUNDING_CLASSIFICATIONS = Object.freeze([
    'live', 'balanced', 'drift', 'scholastic'
]);

const CONTACT_THRESHOLDS = Object.freeze({
    live: 0.65,
    balanced: 0.40,
    drift: 0.20
});

const BOLDNESS_ADJUSTMENT_MAP = Object.freeze({
    live: 1.0,
    balanced: 0.80,
    drift: 0.50,
    scholastic: 0.20
});

const SEMI_LIVE_WEIGHT = 0.5;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§187 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§187 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§187 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeRealityContactRatio(params) {
    const weights = _required(params, 'weights');
    let totalWeight = 0;
    let liveWeight = 0;
    for (const src of CONTRIBUTION_SOURCES) {
        if (weights[src] === undefined || weights[src] === null) {
            throw new Error(`§187 missing source: ${src}`);
        }
        _requireRange01(src, weights[src]);
        totalWeight += weights[src];
        const coefficient = LIVE_SOURCES.includes(src) ? 1.0
                          : SEMI_LIVE_SOURCES.includes(src) ? SEMI_LIVE_WEIGHT
                          : 0;
        liveWeight += weights[src] * coefficient;
    }
    if (totalWeight === 0) {
        return { realityContactRatio: 0 };
    }
    const ratio = liveWeight / totalWeight;
    return { realityContactRatio: Math.max(0, Math.min(1, ratio)) };
}

function classifyGrounding(params) {
    const contactRatio = _required(params, 'contactRatio');
    _requireRange01('contactRatio', contactRatio);
    if (contactRatio >= CONTACT_THRESHOLDS.live) return { classification: 'live' };
    if (contactRatio >= CONTACT_THRESHOLDS.balanced) return { classification: 'balanced' };
    if (contactRatio >= CONTACT_THRESHOLDS.drift) return { classification: 'drift' };
    return { classification: 'scholastic' };
}

function detectScholasticDrift(params) {
    const classification = _required(params, 'classification');
    if (!GROUNDING_CLASSIFICATIONS.includes(classification)) {
        throw new Error(`§187 invalid classification: ${classification}`);
    }
    // Drift detected for both 'drift' and 'scholastic'
    const detected = (classification === 'drift' || classification === 'scholastic');
    return { scholasticDriftDetected: detected ? 1 : 0 };
}

function computeBoldnessAdjustment(params) {
    const classification = _required(params, 'classification');
    if (!GROUNDING_CLASSIFICATIONS.includes(classification)) {
        throw new Error(`§187 invalid classification: ${classification}`);
    }
    return { adjustment: BOLDNESS_ADJUSTMENT_MAP[classification] };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertSnapshot: db.prepare(`
        INSERT INTO ml_reality_contact_snapshots (
            user_id, resolved_env, snapshot_id, decision_id,
            direct_observed_data_weight, derived_inferences_weight,
            episodic_memories_weight, consolidated_concepts_weight,
            structural_priors_weight, historical_ontologies_weight,
            reality_contact_ratio, scholastic_drift_detected,
            grounding_classification, boldness_adjustment, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectSnapshot: db.prepare(`
        SELECT id, snapshot_id AS snapshotId, decision_id AS decisionId,
               direct_observed_data_weight AS directObservedDataWeight,
               derived_inferences_weight AS derivedInferencesWeight,
               episodic_memories_weight AS episodicMemoriesWeight,
               consolidated_concepts_weight AS consolidatedConceptsWeight,
               structural_priors_weight AS structuralPriorsWeight,
               historical_ontologies_weight AS historicalOntologiesWeight,
               reality_contact_ratio AS realityContactRatio,
               scholastic_drift_detected AS scholasticDriftDetected,
               grounding_classification AS groundingClassification,
               boldness_adjustment AS boldnessAdjustment,
               reasoning, ts
        FROM ml_reality_contact_snapshots
        WHERE snapshot_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, snapshot_id AS snapshotId, decision_id AS decisionId,
               reality_contact_ratio AS realityContactRatio,
               scholastic_drift_detected AS scholasticDriftDetected,
               grounding_classification AS groundingClassification,
               boldness_adjustment AS boldnessAdjustment, ts
        FROM ml_reality_contact_snapshots
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByClassification: db.prepare(`
        SELECT id, snapshot_id AS snapshotId, decision_id AS decisionId,
               reality_contact_ratio AS realityContactRatio,
               scholastic_drift_detected AS scholasticDriftDetected,
               grounding_classification AS groundingClassification,
               boldness_adjustment AS boldnessAdjustment, ts
        FROM ml_reality_contact_snapshots
        WHERE user_id = ? AND resolved_env = ? AND grounding_classification = ?
        ORDER BY ts DESC
    `),
    countByClassification: db.prepare(`
        SELECT grounding_classification AS groundingClassification, COUNT(*) AS count
        FROM ml_reality_contact_snapshots
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY grounding_classification
    `)
};

function recordRealityContactSnapshot(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const snapshotId = _required(params, 'snapshotId');
    const decisionId = _required(params, 'decisionId');
    const weights = _required(params, 'weights');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectSnapshot.get(snapshotId)) {
        throw new Error(`§187 duplicate snapshotId: ${snapshotId}`);
    }
    // Validate all sources present + range
    for (const src of CONTRIBUTION_SOURCES) {
        if (weights[src] === undefined || weights[src] === null) {
            throw new Error(`§187 missing source: ${src}`);
        }
        _requireRange01(src, weights[src]);
    }

    const { realityContactRatio } = computeRealityContactRatio({ weights });
    const { classification: groundingClassification } = classifyGrounding({
        contactRatio: realityContactRatio
    });
    const { scholasticDriftDetected } = detectScholasticDrift({
        classification: groundingClassification
    });
    const { adjustment: boldnessAdjustment } = computeBoldnessAdjustment({
        classification: groundingClassification
    });

    _stmts.insertSnapshot.run(
        userId, resolvedEnv, snapshotId, decisionId,
        weights.directObservedData, weights.derivedInferences,
        weights.episodicMemories, weights.consolidatedConcepts,
        weights.structuralPriors, weights.historicalOntologies,
        realityContactRatio, scholasticDriftDetected,
        groundingClassification, boldnessAdjustment, reasoning, ts
    );

    return {
        recorded: true,
        snapshotId, decisionId,
        realityContactRatio,
        scholasticDriftDetected,
        groundingClassification,
        boldnessAdjustment
    };
}

function getRecentSnapshots(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const groundingClassification = params.groundingClassification;
    if (groundingClassification !== undefined && !GROUNDING_CLASSIFICATIONS.includes(groundingClassification)) {
        throw new Error(`§187 invalid groundingClassification filter: ${groundingClassification}`);
    }
    return groundingClassification
        ? _stmts.selectByClassification.all(userId, resolvedEnv, groundingClassification)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function getStatsByClassification(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByClassification.all(userId, resolvedEnv, sinceTs);
    const stats = {
        live: 0, balanced: 0, drift: 0, scholastic: 0, totalCount: 0
    };
    for (const r of rows) {
        stats[r.groundingClassification] = r.count;
        stats.totalCount += r.count;
    }
    return stats;
}

module.exports = {
    // constants
    CONTRIBUTION_SOURCES,
    LIVE_SOURCES,
    SEMI_LIVE_SOURCES,
    GROUNDING_CLASSIFICATIONS,
    CONTACT_THRESHOLDS,
    BOLDNESS_ADJUSTMENT_MAP,
    SEMI_LIVE_WEIGHT,
    // pure
    computeRealityContactRatio,
    classifyGrounding,
    detectScholasticDrift,
    computeBoldnessAdjustment,
    // DB
    recordRealityContactSnapshot,
    getRecentSnapshots,
    getStatsByClassification
};

// FILE END §187 realityContactRatio.js
