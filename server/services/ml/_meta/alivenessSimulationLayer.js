'use strict';

/**
 * OMEGA Wave 3 §161 — ALIVENESS SIMULATION LAYER / OPERATIONAL VITALITY INDEX.
 *
 * Canonical PDF §161 (ml_brain_canonic.txt lines 5403-5455).
 *
 * "nu constiinta, nu persoana, ci vitalitate de agent."
 *
 * 8 canonical vitality components (PDF lines 5414-5422):
 *   selfModelHealth | coherence | tensionField (INV) | capabilityTrust |
 *   learningFreshness | identityContinuity | unknownsPressure (INV) |
 *   decisionIntegrity
 *
 * Two components INVERTED in formula (high value = bad for vitality):
 *   - tensionField (more tension = less vitality)
 *   - unknownsPressure (more unknowns = less vitality)
 *
 * 6 canonical states (PDF lines 5423-5429):
 *   lucid (≥0.80) | strained (≥0.65) | degraded (≥0.50) |
 *   guarded (≥0.35) | observer (≥0.20) | shutdown_worthy (<0.20)
 *
 * Self-report templates per state (PDF lines 5430-5433):
 *   lucid             → "sunt lucid operational"
 *   strained          → "sunt functional dar tensionat"
 *   shutdown_worthy   → "nu am dreptul sa actionez agresiv acum"
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const VITALITY_COMPONENTS = Object.freeze([
    'selfModelHealth', 'coherence', 'tensionField',
    'capabilityTrust', 'learningFreshness',
    'identityContinuity', 'unknownsPressure', 'decisionIntegrity'
]);
const INVERTED_COMPONENTS = Object.freeze([
    'tensionField', 'unknownsPressure'
]);
const VITALITY_STATES = Object.freeze([
    'lucid', 'strained', 'degraded',
    'guarded', 'observer', 'shutdown_worthy'
]);

const STATE_THRESHOLDS = Object.freeze({
    lucid: 0.80,
    strained: 0.65,
    degraded: 0.50,
    guarded: 0.35,
    observer: 0.20,
    shutdown_worthy: 0
});

const SELF_REPORT_TEMPLATES = Object.freeze({
    lucid: 'sunt lucid operational — toate componentele coerente, capacitate plenă',
    strained: 'sunt functional dar tensionat — pot acționa cu prudență',
    degraded: 'capacitate redusă — acțiunile importante necesită verificare suplimentară',
    guarded: 'guarded mode — doar acțiuni reversibile, fără expunere nouă semnificativă',
    observer: 'observer mode — nu am dreptul să iau decizii agresive acum, observ și raportez',
    shutdown_worthy: 'nu am dreptul sa actionez — recomand shutdown sau handoff la operator'
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§161 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§161 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§161 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeCompositeVitality(params) {
    const components = _required(params, 'components');
    let sum = 0;
    const n = VITALITY_COMPONENTS.length;
    for (const c of VITALITY_COMPONENTS) {
        if (components[c] === undefined || components[c] === null) {
            throw new Error(`§161 missing component: ${c}`);
        }
        _requireRange01(c, components[c]);
        const contribution = INVERTED_COMPONENTS.includes(c)
            ? (1 - components[c])
            : components[c];
        sum += contribution;
    }
    const composite = sum / n;
    return { composite: Math.max(0, Math.min(1, composite)) };
}

function classifyVitalityState(params) {
    const compositeScore = _required(params, 'compositeScore');
    _requireRange01('compositeScore', compositeScore);
    if (compositeScore >= STATE_THRESHOLDS.lucid) return { state: 'lucid' };
    if (compositeScore >= STATE_THRESHOLDS.strained) return { state: 'strained' };
    if (compositeScore >= STATE_THRESHOLDS.degraded) return { state: 'degraded' };
    if (compositeScore >= STATE_THRESHOLDS.guarded) return { state: 'guarded' };
    if (compositeScore >= STATE_THRESHOLDS.observer) return { state: 'observer' };
    return { state: 'shutdown_worthy' };
}

function generateSelfReport(params) {
    const state = _required(params, 'state');
    if (!VITALITY_STATES.includes(state)) {
        throw new Error(`§161 invalid state: ${state}`);
    }
    return { report: SELF_REPORT_TEMPLATES[state] };
}

function validateTransition(params) {
    const fromState = _required(params, 'fromState');
    const toState = _required(params, 'toState');
    if (!VITALITY_STATES.includes(fromState)) {
        throw new Error(`§161 invalid fromState: ${fromState}`);
    }
    if (!VITALITY_STATES.includes(toState)) {
        throw new Error(`§161 invalid toState: ${toState}`);
    }
    // Unlike admission path (§150), vitality can fluctuate freely between
    // any non-equal pair — system can degrade or recover.
    return { valid: fromState !== toState };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertSnapshot: db.prepare(`
        INSERT INTO ml_vitality_index_snapshots (
            user_id, resolved_env, snapshot_id, self_model_health, coherence,
            tension_field, capability_trust, learning_freshness,
            identity_continuity, unknowns_pressure, decision_integrity,
            composite_vitality_score, state, self_report_text, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectSnapshot: db.prepare(`
        SELECT id, snapshot_id AS snapshotId,
               self_model_health AS selfModelHealth,
               coherence, tension_field AS tensionField,
               capability_trust AS capabilityTrust,
               learning_freshness AS learningFreshness,
               identity_continuity AS identityContinuity,
               unknowns_pressure AS unknownsPressure,
               decision_integrity AS decisionIntegrity,
               composite_vitality_score AS compositeVitalityScore,
               state, self_report_text AS selfReportText, ts
        FROM ml_vitality_index_snapshots
        WHERE snapshot_id = ?
    `),
    selectLatest: db.prepare(`
        SELECT id, snapshot_id AS snapshotId,
               composite_vitality_score AS compositeVitalityScore,
               state, self_report_text AS selfReportText, ts
        FROM ml_vitality_index_snapshots
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
        LIMIT 1
    `),
    selectAllRecent: db.prepare(`
        SELECT id, snapshot_id AS snapshotId,
               composite_vitality_score AS compositeVitalityScore,
               state, self_report_text AS selfReportText, ts
        FROM ml_vitality_index_snapshots
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByState: db.prepare(`
        SELECT id, snapshot_id AS snapshotId,
               composite_vitality_score AS compositeVitalityScore,
               state, self_report_text AS selfReportText, ts
        FROM ml_vitality_index_snapshots
        WHERE user_id = ? AND resolved_env = ? AND state = ?
        ORDER BY ts DESC
    `),
    insertTransition: db.prepare(`
        INSERT INTO ml_vitality_state_transitions (
            user_id, resolved_env, transition_id, from_state, to_state,
            trigger_reason, snapshot_id, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectTransition: db.prepare(`
        SELECT id, transition_id AS transitionId,
               from_state AS fromState, to_state AS toState,
               trigger_reason AS triggerReason,
               snapshot_id AS snapshotId, ts
        FROM ml_vitality_state_transitions
        WHERE transition_id = ?
    `)
};

function recordVitalitySnapshot(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const snapshotId = _required(params, 'snapshotId');
    const components = _required(params, 'components');
    const ts = _required(params, 'ts');

    if (_stmts.selectSnapshot.get(snapshotId)) {
        throw new Error(`§161 duplicate snapshotId: ${snapshotId}`);
    }

    const { composite } = computeCompositeVitality({ components });
    const { state } = classifyVitalityState({ compositeScore: composite });
    const { report } = generateSelfReport({ state });

    _stmts.insertSnapshot.run(
        userId, resolvedEnv, snapshotId,
        components.selfModelHealth, components.coherence,
        components.tensionField, components.capabilityTrust,
        components.learningFreshness, components.identityContinuity,
        components.unknownsPressure, components.decisionIntegrity,
        composite, state, report, ts
    );

    return {
        recorded: true,
        snapshotId,
        compositeVitalityScore: composite,
        state,
        selfReportText: report
    };
}

function recordStateTransition(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const transitionId = _required(params, 'transitionId');
    const fromState = _required(params, 'fromState');
    const toState = _required(params, 'toState');
    const triggerReason = _required(params, 'triggerReason');
    const ts = _required(params, 'ts');
    const snapshotId = params.snapshotId ?? null;

    const { valid } = validateTransition({ fromState, toState });
    if (!valid) {
        throw new Error(`§161 invalid transition: ${fromState} → ${toState}`);
    }
    if (_stmts.selectTransition.get(transitionId)) {
        throw new Error(`§161 duplicate transitionId: ${transitionId}`);
    }

    _stmts.insertTransition.run(
        userId, resolvedEnv, transitionId, fromState, toState,
        triggerReason, snapshotId, ts
    );

    return {
        recorded: true,
        transitionId, fromState, toState
    };
}

function getLatestSnapshot(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const row = _stmts.selectLatest.get(userId, resolvedEnv);
    return row || null;
}

function getRecentSnapshots(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const state = params.state;
    if (state !== undefined && !VITALITY_STATES.includes(state)) {
        throw new Error(`§161 invalid state filter: ${state}`);
    }
    return state
        ? _stmts.selectByState.all(userId, resolvedEnv, state)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

module.exports = {
    // constants
    VITALITY_COMPONENTS,
    VITALITY_STATES,
    INVERTED_COMPONENTS,
    STATE_THRESHOLDS,
    SELF_REPORT_TEMPLATES,
    // pure
    computeCompositeVitality,
    classifyVitalityState,
    generateSelfReport,
    validateTransition,
    // DB
    recordVitalitySnapshot,
    recordStateTransition,
    getLatestSnapshot,
    getRecentSnapshots
};

// FILE END §161 alivenessSimulationLayer.js
