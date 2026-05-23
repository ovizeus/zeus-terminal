'use strict';

/**
 * OMEGA Wave 3 §153 — SOURCE ABLATION ROBUSTNESS / BELIEF-SURVIVES-DELETION.
 *
 * Canonical PDF §153 (ml_brain_canonic.txt lines 5087-5129).
 *
 * "daca pierd exact dovezile pe care ma bazez cel mai mult,
 *  credinta mea mai are coloana?"
 *
 * Distinct de:
 *   - falseConsensus (R3A) — pseudo-agreement detection
 *   - §125 epistemicTensionField — tension BETWEEN sources
 *   - §135 epistemicHumilityGovernor — humility within knowledge
 *   - §147 intellectualHonestyAudit — reason drift on decisions
 *   - §148 ontologicalHumility — reality exceeds model
 *   - §149 purposeDriftDetector — scope substitution
 *
 * §153 = STRESS TEST belief robustness prin deliberate source ablation.
 *
 * 5 ablation categories (PDF lines 5104-5108):
 *   top_source | top_detector | top_venue | top_macro | top_concept
 *
 * Two-table architecture:
 *   - ablation_tests: one row per (belief × ablation_category × ablated)
 *   - fragility_snapshots: aggregate at moment t, mean+min survival across
 *                          multiple ablations + max single source dependency
 *
 * Classification:
 *   source_captured (priority) — max single source dependency ≥ 0.60
 *   robust — survival ≥ 0.70 AND dependency < 0.60
 *   brittle — everything else
 *
 * Boldness penalty per classification (consumed by R3 sizing/governance).
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const ABLATION_CATEGORIES = Object.freeze([
    'top_source', 'top_detector', 'top_venue',
    'top_macro', 'top_concept'
]);
const BELIEF_CLASSIFICATIONS = Object.freeze([
    'robust', 'brittle', 'source_captured'
]);

const ROBUST_MIN_SURVIVAL = 0.70;
const BRITTLE_MAX_SURVIVAL = 0.30;
const SOURCE_CAPTURED_MIN_DEPENDENCY = 0.60;

const BOLDNESS_PENALTY_MAP = Object.freeze({
    robust: 0,
    brittle: 0.50,
    source_captured: 0.70
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§153 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§153 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§153 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeSurvivalScore(params) {
    const originalSupport = _required(params, 'originalSupport');
    const postAblationSupport = _required(params, 'postAblationSupport');
    _requireRange01('originalSupport', originalSupport);
    _requireRange01('postAblationSupport', postAblationSupport);
    if (originalSupport === 0) {
        // Vacuous case — nothing to lose, so vacuously full survival.
        return { survivalScore: 1, originalSupport, postAblationSupport };
    }
    const raw = postAblationSupport / originalSupport;
    const clamped = Math.max(0, Math.min(1, raw));
    return { survivalScore: clamped, originalSupport, postAblationSupport };
}

function classifyBeliefRobustness(params) {
    const survivalScore = _required(params, 'survivalScore');
    const maxSingleSourceDependency = _required(params, 'maxSingleSourceDependency');
    _requireRange01('survivalScore', survivalScore);
    _requireRange01('maxSingleSourceDependency', maxSingleSourceDependency);
    // source_captured takes priority — heavy dependency is structurally
    // diagnostic regardless of survival outcome.
    if (maxSingleSourceDependency >= SOURCE_CAPTURED_MIN_DEPENDENCY) {
        return { classification: 'source_captured' };
    }
    if (survivalScore >= ROBUST_MIN_SURVIVAL) {
        return { classification: 'robust' };
    }
    return { classification: 'brittle' };
}

function computeBoldnessPenalty(params) {
    const classification = _required(params, 'classification');
    if (!BELIEF_CLASSIFICATIONS.includes(classification)) {
        throw new Error(`§153 invalid classification: ${classification}`);
    }
    return { penalty: BOLDNESS_PENALTY_MAP[classification], classification };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertTest: db.prepare(`
        INSERT INTO ml_belief_ablation_tests (
            user_id, resolved_env, test_id, belief_id, original_support_score,
            supporting_sources_json, ablation_category, ablated_source_label,
            post_ablation_support_score, survival_score, classification, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectTest: db.prepare(`
        SELECT id, test_id AS testId, belief_id AS beliefId,
               original_support_score AS originalSupportScore,
               supporting_sources_json AS supportingSourcesJson,
               ablation_category AS ablationCategory,
               ablated_source_label AS ablatedSourceLabel,
               post_ablation_support_score AS postAblationSupportScore,
               survival_score AS survivalScore,
               classification, ts
        FROM ml_belief_ablation_tests
        WHERE test_id = ?
    `),
    selectTestsForBelief: db.prepare(`
        SELECT id, test_id AS testId, belief_id AS beliefId,
               original_support_score AS originalSupportScore,
               supporting_sources_json AS supportingSourcesJson,
               ablation_category AS ablationCategory,
               ablated_source_label AS ablatedSourceLabel,
               post_ablation_support_score AS postAblationSupportScore,
               survival_score AS survivalScore,
               classification, ts
        FROM ml_belief_ablation_tests
        WHERE user_id = ? AND resolved_env = ? AND belief_id = ?
        ORDER BY ts ASC
    `),
    insertSnapshot: db.prepare(`
        INSERT INTO ml_belief_fragility_snapshots (
            user_id, resolved_env, snapshot_id, belief_id,
            ablation_tests_count, mean_survival_score, min_survival_score,
            max_single_source_dependency, captured_by_source_label,
            classification, boldness_penalty, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectSnapshot: db.prepare(`
        SELECT id, snapshot_id AS snapshotId, belief_id AS beliefId,
               ablation_tests_count AS ablationTestsCount,
               mean_survival_score AS meanSurvivalScore,
               min_survival_score AS minSurvivalScore,
               max_single_source_dependency AS maxSingleSourceDependency,
               captured_by_source_label AS capturedBySourceLabel,
               classification, boldness_penalty AS boldnessPenalty, ts
        FROM ml_belief_fragility_snapshots
        WHERE snapshot_id = ?
    `),
    selectLatestSnapshot: db.prepare(`
        SELECT id, snapshot_id AS snapshotId, belief_id AS beliefId,
               ablation_tests_count AS ablationTestsCount,
               mean_survival_score AS meanSurvivalScore,
               min_survival_score AS minSurvivalScore,
               max_single_source_dependency AS maxSingleSourceDependency,
               captured_by_source_label AS capturedBySourceLabel,
               classification, boldness_penalty AS boldnessPenalty, ts
        FROM ml_belief_fragility_snapshots
        WHERE user_id = ? AND resolved_env = ? AND belief_id = ?
        ORDER BY ts DESC
        LIMIT 1
    `)
};

function _maxWeightWithLabel(sources) {
    let maxW = 0;
    let label = null;
    for (const s of sources) {
        if (s.weight > maxW) {
            maxW = s.weight;
            label = s.source;
        }
    }
    return { maxWeight: maxW, label };
}

function recordAblationTest(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const testId = _required(params, 'testId');
    const beliefId = _required(params, 'beliefId');
    const originalSupportScore = _required(params, 'originalSupportScore');
    const supportingSources = _required(params, 'supportingSources');
    const ablationCategory = _required(params, 'ablationCategory');
    const ablatedSourceLabel = _required(params, 'ablatedSourceLabel');
    const postAblationSupportScore = _required(params, 'postAblationSupportScore');
    const ts = _required(params, 'ts');

    if (!Array.isArray(supportingSources)) {
        throw new Error('§153 supportingSources must be array');
    }
    if (!ABLATION_CATEGORIES.includes(ablationCategory)) {
        throw new Error(`§153 invalid ablationCategory: ${ablationCategory}`);
    }
    _requireRange01('originalSupportScore', originalSupportScore);
    _requireRange01('postAblationSupportScore', postAblationSupportScore);
    for (const s of supportingSources) {
        if (typeof s.weight !== 'number') {
            throw new Error('§153 supportingSources entries must have numeric weight');
        }
        _requireRange01('source.weight', s.weight);
    }
    if (_stmts.selectTest.get(testId)) {
        throw new Error(`§153 duplicate testId: ${testId}`);
    }

    const { survivalScore } = computeSurvivalScore({
        originalSupport: originalSupportScore,
        postAblationSupport: postAblationSupportScore
    });
    const { maxWeight } = _maxWeightWithLabel(supportingSources);
    const { classification } = classifyBeliefRobustness({
        survivalScore,
        maxSingleSourceDependency: maxWeight
    });

    _stmts.insertTest.run(
        userId, resolvedEnv, testId, beliefId, originalSupportScore,
        JSON.stringify(supportingSources), ablationCategory, ablatedSourceLabel,
        postAblationSupportScore, survivalScore, classification, ts
    );

    return {
        recorded: true,
        testId, beliefId,
        survivalScore, classification
    };
}

function recordFragilitySnapshot(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const snapshotId = _required(params, 'snapshotId');
    const beliefId = _required(params, 'beliefId');
    const ts = _required(params, 'ts');

    if (_stmts.selectSnapshot.get(snapshotId)) {
        throw new Error(`§153 duplicate snapshotId: ${snapshotId}`);
    }

    const tests = _stmts.selectTestsForBelief.all(userId, resolvedEnv, beliefId);
    if (tests.length === 0) {
        throw new Error(`§153 no ablation tests found for belief ${beliefId} — tests required before snapshot`);
    }

    let sumSurvival = 0;
    let minSurvival = Infinity;
    let maxDependency = 0;
    let capturedLabel = null;
    for (const t of tests) {
        sumSurvival += t.survivalScore;
        if (t.survivalScore < minSurvival) minSurvival = t.survivalScore;
        const sources = JSON.parse(t.supportingSourcesJson);
        const { maxWeight, label } = _maxWeightWithLabel(sources);
        if (maxWeight > maxDependency) {
            maxDependency = maxWeight;
            if (maxWeight >= SOURCE_CAPTURED_MIN_DEPENDENCY) {
                capturedLabel = label;
            }
        }
    }
    const meanSurvival = sumSurvival / tests.length;

    const { classification } = classifyBeliefRobustness({
        survivalScore: meanSurvival,
        maxSingleSourceDependency: maxDependency
    });
    const { penalty: boldnessPenalty } = computeBoldnessPenalty({ classification });

    _stmts.insertSnapshot.run(
        userId, resolvedEnv, snapshotId, beliefId,
        tests.length, meanSurvival, minSurvival,
        maxDependency, capturedLabel,
        classification, boldnessPenalty, ts
    );

    return {
        recorded: true,
        snapshotId, beliefId,
        ablationTestsCount: tests.length,
        meanSurvivalScore: meanSurvival,
        minSurvivalScore: minSurvival,
        maxSingleSourceDependency: maxDependency,
        capturedBySourceLabel: capturedLabel,
        classification,
        boldnessPenalty
    };
}

function getAblationTestsForBelief(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const beliefId = _required(params, 'beliefId');
    return _stmts.selectTestsForBelief.all(userId, resolvedEnv, beliefId);
}

function getLatestFragilitySnapshot(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const beliefId = _required(params, 'beliefId');
    const row = _stmts.selectLatestSnapshot.get(userId, resolvedEnv, beliefId);
    return row || null;
}

module.exports = {
    // constants
    ABLATION_CATEGORIES,
    BELIEF_CLASSIFICATIONS,
    ROBUST_MIN_SURVIVAL,
    BRITTLE_MAX_SURVIVAL,
    SOURCE_CAPTURED_MIN_DEPENDENCY,
    BOLDNESS_PENALTY_MAP,
    // pure
    computeSurvivalScore,
    classifyBeliefRobustness,
    computeBoldnessPenalty,
    // DB
    recordAblationTest,
    recordFragilitySnapshot,
    getAblationTestsForBelief,
    getLatestFragilitySnapshot
};

// FILE END §153 sourceAblationRobustness.js
