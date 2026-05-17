'use strict';

/**
 * OMEGA _meta — identityUnderTransformationTest (canonical §146)
 *
 * §146 IDENTITY-UNDER-TRANSFORMATION TEST / SAME-AGENT OR NEW-AGENT CHECK.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 4718-4775.
 *
 * "Daca ma modific inca putin, sunt tot eu sau deja altcineva?"
 *
 * Extension de §127 identityContinuity (score) cu THRESHOLD TEST +
 * GOVERNANCE ESCALATION (decizie verdict).
 *
 * Algorithm:
 *   structural_drift = Σ (dim_drift × weight) across 6 dimensions
 *                       (charter 0.30 heaviest — constitutional)
 *   composite_drift = structural × 0.70 + replay × 0.30
 *                      − semantic_preserve_bonus (if equiv ≥ 0.90)
 *   verdict = composite < 0.40 → same_agent
 *           = 0.40 ≤ composite < 0.70 → evolved_variant
 *           = composite ≥ 0.70 → materially_new_agent
 *   governance_escalation_required = (verdict === materially_new_agent)
 *
 * RULES (canonical, explicit):
 * - "mai performant ≠ aceeasi identitate"
 * - Materially_new → MUST be treated as new agent: shadow separat,
 *   canary separat, capital separat, audit separat
 * - "Schimbarea de identitate nu are voie sa fie accidentala"
 *
 * Distinct from §127 identityContinuity (continuity score over time);
 * §146 = verdict + escalation decision per snapshot pair.
 *
 * FK la ml_identity_snapshots (§127) pentru baseline + current refs.
 */

const { db } = require('../../database');

const IDENTITY_VERDICTS = Object.freeze([
    'same_agent', 'evolved_variant', 'materially_new_agent'
]);

const DRIFT_DIMENSIONS = Object.freeze([
    'charter', 'utility_function', 'policy_style',
    'ontology', 'regime_interpretation', 'boldness_humility'
]);

const VERDICT_THRESHOLDS = Object.freeze({
    new_agent: 0.70,
    evolved: 0.40
});

// Weights sum 1.0. Charter heaviest = constitutional layer most binding.
const DIMENSION_WEIGHTS = Object.freeze({
    charter: 0.30,
    utility_function: 0.20,
    ontology: 0.15,
    boldness_humility: 0.15,
    policy_style: 0.10,
    regime_interpretation: 0.10
});

const STRUCTURAL_WEIGHT = 0.70;
const REPLAY_WEIGHT = 0.30;
const SEMANTIC_PRESERVE_THRESHOLD = 0.90;
const SEMANTIC_PRESERVE_BONUS = 0.10;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`identityUnderTransformationTest: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertTest: db.prepare(`
        INSERT INTO ml_identity_transformation_tests
        (user_id, resolved_env, test_id, baseline_snapshot_id, current_snapshot_id,
         charter_drift_score, utility_function_drift_score,
         policy_style_drift_score, ontology_drift_score,
         regime_interpretation_drift_score, boldness_humility_drift_score,
         replay_divergence_pct, semantic_equivalence_score,
         composite_drift_score, identity_verdict,
         governance_escalation_required, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    latestTest: db.prepare(`
        SELECT * FROM ml_identity_transformation_tests
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT 1
    `),
    listByVerdict: db.prepare(`
        SELECT * FROM ml_identity_transformation_tests
        WHERE user_id = ? AND resolved_env = ? AND identity_verdict = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeStructuralDrift (pure) ──────────────────────────────────
function computeStructuralDrift(params) {
    let sum = 0;
    for (const dim of DRIFT_DIMENSIONS) {
        if (params[dim] === undefined || params[dim] === null) {
            throw new Error(`identityUnderTransformationTest: missing ${dim}`);
        }
        const v = params[dim];
        if (v < 0 || v > 1) {
            throw new Error(
                `identityUnderTransformationTest: ${dim} must be in [0,1]`
            );
        }
        sum += v * DIMENSION_WEIGHTS[dim];
    }
    return { structuralDrift: Math.max(0, Math.min(1, sum)) };
}

// ── computeCompositeDrift (pure) ───────────────────────────────────
function computeCompositeDrift(params) {
    const struct = _required(params, 'structuralDrift');
    const replay = _required(params, 'replayDivergencePct');
    const semantic = _required(params, 'semanticEquivalenceScore');

    for (const [k, v] of [['structuralDrift', struct],
                          ['replayDivergencePct', replay],
                          ['semanticEquivalenceScore', semantic]]) {
        if (v < 0 || v > 1) {
            throw new Error(
                `identityUnderTransformationTest: ${k} must be in [0,1]`
            );
        }
    }

    let raw = struct * STRUCTURAL_WEIGHT + replay * REPLAY_WEIGHT;
    const bonusApplied = semantic >= SEMANTIC_PRESERVE_THRESHOLD;
    if (bonusApplied) raw -= SEMANTIC_PRESERVE_BONUS;
    return {
        compositeDrift: Math.max(0, Math.min(1, raw)),
        semanticPreserveBonusApplied: bonusApplied
    };
}

// ── classifyIdentityVerdict (pure) ─────────────────────────────────
function classifyIdentityVerdict(params) {
    const drift = _required(params, 'compositeDrift');
    if (drift < 0 || drift > 1) {
        throw new Error(
            'identityUnderTransformationTest: compositeDrift must be in [0,1]'
        );
    }
    if (drift >= VERDICT_THRESHOLDS.new_agent) {
        return { verdict: 'materially_new_agent' };
    }
    if (drift >= VERDICT_THRESHOLDS.evolved) {
        return { verdict: 'evolved_variant' };
    }
    return { verdict: 'same_agent' };
}

// ── isGovernanceEscalationRequired (pure) ──────────────────────────
function isGovernanceEscalationRequired(params) {
    const verdict = _required(params, 'verdict');
    if (!IDENTITY_VERDICTS.includes(verdict)) {
        throw new Error(
            `identityUnderTransformationTest: invalid verdict "${verdict}"`
        );
    }
    return { escalationRequired: verdict === 'materially_new_agent' };
}

// ── assessSemanticEquivalence (pure) ───────────────────────────────
// Compare baseline vs current outputs element-by-element. Returns
// fraction of matching outputs.
function assessSemanticEquivalence(params) {
    const baseline = _required(params, 'baselineOutputs');
    const current = _required(params, 'currentOutputs');
    if (!Array.isArray(baseline) || !Array.isArray(current)) {
        throw new Error(
            'identityUnderTransformationTest: outputs must be arrays'
        );
    }
    if (baseline.length !== current.length) {
        throw new Error(
            `identityUnderTransformationTest: length mismatch (${baseline.length} vs ${current.length})`
        );
    }
    if (baseline.length === 0) {
        return { equivalenceScore: 1.0 };
    }
    let matches = 0;
    for (let i = 0; i < baseline.length; i++) {
        if (baseline[i] === current[i]) matches++;
    }
    return { equivalenceScore: matches / baseline.length };
}

// ── recordTransformationTest (integration) ─────────────────────────
function recordTransformationTest(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const testId = _required(params, 'testId');
    const baselineId = _required(params, 'baselineSnapshotId');
    const currentId = _required(params, 'currentSnapshotId');
    const charter = _required(params, 'charterDrift');
    const utility = _required(params, 'utilityFunctionDrift');
    const policy = _required(params, 'policyStyleDrift');
    const ontology = _required(params, 'ontologyDrift');
    const regime = _required(params, 'regimeInterpretationDrift');
    const boldness = _required(params, 'boldnessHumilityDrift');
    const replay = _required(params, 'replayDivergencePct');
    const semantic = _required(params, 'semanticEquivalenceScore');
    const ts = (params && params.ts) ? params.ts : Date.now();

    // Validate ranges (will also be DB-enforced via CHECK)
    for (const [k, v] of [
        ['charterDrift', charter], ['utilityFunctionDrift', utility],
        ['policyStyleDrift', policy], ['ontologyDrift', ontology],
        ['regimeInterpretationDrift', regime],
        ['boldnessHumilityDrift', boldness],
        ['replayDivergencePct', replay],
        ['semanticEquivalenceScore', semantic]
    ]) {
        if (v < 0 || v > 1) {
            throw new Error(
                `identityUnderTransformationTest: ${k} must be in [0,1], got ${v}`
            );
        }
    }

    const { structuralDrift } = computeStructuralDrift({
        charter, utility_function: utility, policy_style: policy,
        ontology, regime_interpretation: regime, boldness_humility: boldness
    });
    const { compositeDrift } = computeCompositeDrift({
        structuralDrift,
        replayDivergencePct: replay,
        semanticEquivalenceScore: semantic
    });
    const { verdict } = classifyIdentityVerdict({ compositeDrift });
    const { escalationRequired } = isGovernanceEscalationRequired({ verdict });

    try {
        _stmts.insertTest.run(
            userId, env, testId, baselineId, currentId,
            charter, utility, policy, ontology, regime, boldness,
            replay, semantic, compositeDrift, verdict,
            escalationRequired ? 1 : 0, ts
        );
        return {
            recorded: true, testId,
            structuralDrift, compositeDrift,
            verdict, escalationRequired
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `identityUnderTransformationTest: duplicate testId "${testId}"`
            );
        }
        // FK and CHECK pass through unchanged for visibility
        throw err;
    }
}

function _rowToTest(r) {
    return {
        testId: r.test_id,
        baselineSnapshotId: r.baseline_snapshot_id,
        currentSnapshotId: r.current_snapshot_id,
        charterDriftScore: r.charter_drift_score,
        utilityFunctionDriftScore: r.utility_function_drift_score,
        policyStyleDriftScore: r.policy_style_drift_score,
        ontologyDriftScore: r.ontology_drift_score,
        regimeInterpretationDriftScore: r.regime_interpretation_drift_score,
        boldnessHumilityDriftScore: r.boldness_humility_drift_score,
        replayDivergencePct: r.replay_divergence_pct,
        semanticEquivalenceScore: r.semantic_equivalence_score,
        compositeDriftScore: r.composite_drift_score,
        identityVerdict: r.identity_verdict,
        governanceEscalationRequired: r.governance_escalation_required === 1,
        ts: r.ts
    };
}

// ── getLatestTest ──────────────────────────────────────────────────
function getLatestTest(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const r = _stmts.latestTest.get(userId, env);
    if (!r) return null;
    return _rowToTest(r);
}

// ── getTestsByVerdict ──────────────────────────────────────────────
function getTestsByVerdict(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const verdict = _required(params, 'verdict');
    const limit = (params && params.limit) ? params.limit : 100;
    if (!IDENTITY_VERDICTS.includes(verdict)) {
        throw new Error(
            `identityUnderTransformationTest: invalid verdict "${verdict}"`
        );
    }
    const rows = _stmts.listByVerdict.all(userId, env, verdict, limit);
    return rows.map(_rowToTest);
}

module.exports = {
    IDENTITY_VERDICTS,
    DRIFT_DIMENSIONS,
    VERDICT_THRESHOLDS,
    DIMENSION_WEIGHTS,
    STRUCTURAL_WEIGHT,
    REPLAY_WEIGHT,
    SEMANTIC_PRESERVE_THRESHOLD,
    SEMANTIC_PRESERVE_BONUS,
    computeStructuralDrift,
    computeCompositeDrift,
    classifyIdentityVerdict,
    isGovernanceEscalationRequired,
    assessSemanticEquivalence,
    recordTransformationTest,
    getLatestTest,
    getTestsByVerdict
};
