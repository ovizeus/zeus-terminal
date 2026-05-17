'use strict';

/**
 * OMEGA Wave 3 §152 — NEGATIVE EVIDENCE SEMANTICS / ABSENCE-AS-SIGNAL ENGINE.
 *
 * Canonical PDF §152 (ml_brain_canonic.txt lines 5034-5084).
 *
 * "ce ar fi trebuit sa vad pana acum si n-am vazut?"
 *
 * Distinct de:
 *   - R3A_safety/circuitBreaker — absence pe FEEDS (data sources down)
 *   - R2_cognition/beliefPropagation — propagation of belief changes
 *   - R2_cognition/thesisGraphEngine — hypothesis graph nodes
 *   - R2_cognition/narrativeCoherence — coherence across narrative
 *
 * §152 = ABSENCE OF EXPECTED MARKET SIGNALS as informative event. Two
 * tables:
 *   - registry: declared expectations (event_trigger → expected_signal +
 *     timing windows + causal interpretation)
 *   - events: per trigger occurrence, state machine (pending →
 *     normal_absence → significant_absence → expired | observed)
 *
 * State logic per elapsed time vs 3 windows:
 *   elapsed <  normalWindowMs        → pending          (sig 0)
 *   normal  ≤ elapsed < significant  → normal_absence   (sig 0..0.50)
 *   signif. ≤ elapsed < max          → signif_absence   (sig 0.50..1.0)
 *   elapsed ≥ maxWindowMs            → expired          (sig 1.0)
 *
 * "absenta devine informatie doar relativ la o asteptare explicita si la
 *  o fereastra temporala definita" (PDF line 5079).
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const ABSENCE_STATES = Object.freeze([
    'pending', 'normal_absence',
    'significant_absence', 'observed', 'expired'
]);
const SIGNIFICANCE_RAMP_THRESHOLD = 0.50;
const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§152 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§152 invalid resolvedEnv: ${env}`);
    }
    return env;
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function classifyAbsenceState(params) {
    const elapsedMs = _required(params, 'elapsedMs');
    const normalWindowMs = _required(params, 'normalWindowMs');
    const significantWindowMs = _required(params, 'significantWindowMs');
    const maxWindowMs = _required(params, 'maxWindowMs');
    if (elapsedMs < 0) throw new Error('§152 elapsedMs must be non-negative');
    if (normalWindowMs <= 0 || significantWindowMs <= 0 || maxWindowMs <= 0) {
        throw new Error('§152 windows must be positive');
    }
    if (normalWindowMs > significantWindowMs || significantWindowMs > maxWindowMs) {
        throw new Error('§152 windows must be ordered: normal ≤ significant ≤ max');
    }
    let state;
    if (elapsedMs >= maxWindowMs) state = 'expired';
    else if (elapsedMs >= significantWindowMs) state = 'significant_absence';
    else if (elapsedMs >= normalWindowMs) state = 'normal_absence';
    else state = 'pending';
    return { state, elapsedMs };
}

function computeAbsenceSignificance(params) {
    const { state, elapsedMs } = classifyAbsenceState(params);
    const normalWindowMs = params.normalWindowMs;
    const significantWindowMs = params.significantWindowMs;
    const maxWindowMs = params.maxWindowMs;
    let significance;
    if (state === 'pending') {
        significance = 0;
    } else if (state === 'normal_absence') {
        // Ramp 0 → SIGNIFICANCE_RAMP_THRESHOLD across [normal, significant)
        const range = significantWindowMs - normalWindowMs;
        const into = elapsedMs - normalWindowMs;
        significance = range > 0
            ? (into / range) * SIGNIFICANCE_RAMP_THRESHOLD
            : SIGNIFICANCE_RAMP_THRESHOLD;
    } else if (state === 'significant_absence') {
        // Ramp SIGNIFICANCE_RAMP_THRESHOLD → 1.0 across [significant, max)
        const range = maxWindowMs - significantWindowMs;
        const into = elapsedMs - significantWindowMs;
        significance = range > 0
            ? SIGNIFICANCE_RAMP_THRESHOLD + (into / range) * (1 - SIGNIFICANCE_RAMP_THRESHOLD)
            : 1;
    } else {
        significance = 1;  // expired
    }
    const clamped = Math.max(0, Math.min(1, significance));
    return { state, significance: clamped };
}

function detectExpectationViolation(params) {
    const signalAppeared = _required(params, 'signalAppeared');
    const state = _required(params, 'state');
    const significance = _required(params, 'significance');
    if (!ABSENCE_STATES.includes(state)) {
        throw new Error(`§152 invalid state: ${state}`);
    }
    if (signalAppeared) return { violation: false, state, significance };
    const violation = (state === 'significant_absence' || state === 'expired');
    return { violation, state, significance };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertSignal: db.prepare(`
        INSERT INTO ml_expected_signals_registry (
            user_id, resolved_env, expected_signal_id, event_trigger,
            expected_signal_name, normal_window_ms, significant_window_ms,
            max_window_ms, causal_interpretation, thesis_link_label,
            registered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectSignal: db.prepare(`
        SELECT id, expected_signal_id AS expectedSignalId,
               event_trigger AS eventTrigger,
               expected_signal_name AS expectedSignalName,
               normal_window_ms AS normalWindowMs,
               significant_window_ms AS significantWindowMs,
               max_window_ms AS maxWindowMs,
               causal_interpretation AS causalInterpretation,
               thesis_link_label AS thesisLinkLabel,
               registered_at AS registeredAt
        FROM ml_expected_signals_registry
        WHERE expected_signal_id = ?
    `),
    selectAllSignals: db.prepare(`
        SELECT id, expected_signal_id AS expectedSignalId,
               event_trigger AS eventTrigger,
               expected_signal_name AS expectedSignalName,
               normal_window_ms AS normalWindowMs,
               significant_window_ms AS significantWindowMs,
               max_window_ms AS maxWindowMs,
               causal_interpretation AS causalInterpretation,
               thesis_link_label AS thesisLinkLabel,
               registered_at AS registeredAt
        FROM ml_expected_signals_registry
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY registered_at ASC
    `),
    insertEvent: db.prepare(`
        INSERT INTO ml_negative_evidence_events (
            user_id, resolved_env, evidence_id, expected_signal_id,
            trigger_event_label, trigger_ts, observation_deadline_ts,
            observed, observed_ts, absence_significance_score, state,
            resolved_ts, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, 'pending', NULL, ?)
    `),
    selectEvent: db.prepare(`
        SELECT id, evidence_id AS evidenceId,
               expected_signal_id AS expectedSignalId,
               trigger_event_label AS triggerEventLabel,
               trigger_ts AS triggerTs,
               observation_deadline_ts AS observationDeadlineTs,
               observed, observed_ts AS observedTs,
               absence_significance_score AS absenceSignificanceScore,
               state, resolved_ts AS resolvedTs, ts
        FROM ml_negative_evidence_events
        WHERE evidence_id = ?
    `),
    selectAllEvents: db.prepare(`
        SELECT id, evidence_id AS evidenceId,
               expected_signal_id AS expectedSignalId,
               trigger_event_label AS triggerEventLabel,
               trigger_ts AS triggerTs,
               observation_deadline_ts AS observationDeadlineTs,
               observed, observed_ts AS observedTs,
               absence_significance_score AS absenceSignificanceScore,
               state, resolved_ts AS resolvedTs, ts
        FROM ml_negative_evidence_events
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectEventsByState: db.prepare(`
        SELECT id, evidence_id AS evidenceId,
               expected_signal_id AS expectedSignalId,
               trigger_event_label AS triggerEventLabel,
               trigger_ts AS triggerTs,
               observation_deadline_ts AS observationDeadlineTs,
               observed, observed_ts AS observedTs,
               absence_significance_score AS absenceSignificanceScore,
               state, resolved_ts AS resolvedTs, ts
        FROM ml_negative_evidence_events
        WHERE user_id = ? AND resolved_env = ? AND state = ?
        ORDER BY ts DESC
    `),
    updateEventObserved: db.prepare(`
        UPDATE ml_negative_evidence_events
        SET observed = 1, observed_ts = ?, state = 'observed', resolved_ts = ?,
            absence_significance_score = 0
        WHERE evidence_id = ? AND user_id = ? AND resolved_env = ?
    `),
    updateEventState: db.prepare(`
        UPDATE ml_negative_evidence_events
        SET state = ?, absence_significance_score = ?, resolved_ts = ?
        WHERE evidence_id = ? AND user_id = ? AND resolved_env = ?
    `)
};

function registerExpectedSignal(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const expectedSignalId = _required(params, 'expectedSignalId');
    const eventTrigger = _required(params, 'eventTrigger');
    const expectedSignalName = _required(params, 'expectedSignalName');
    const normalWindowMs = _required(params, 'normalWindowMs');
    const significantWindowMs = _required(params, 'significantWindowMs');
    const maxWindowMs = _required(params, 'maxWindowMs');
    const causalInterpretation = _required(params, 'causalInterpretation');
    const ts = _required(params, 'ts');
    const thesisLinkLabel = params.thesisLinkLabel ?? null;

    if (normalWindowMs <= 0 || significantWindowMs <= 0 || maxWindowMs <= 0) {
        throw new Error('§152 windows must be positive');
    }
    if (normalWindowMs > significantWindowMs || significantWindowMs > maxWindowMs) {
        throw new Error('§152 windows must be ordered: normal ≤ significant ≤ max');
    }
    if (_stmts.selectSignal.get(expectedSignalId)) {
        throw new Error(`§152 duplicate expectedSignalId: ${expectedSignalId}`);
    }
    _stmts.insertSignal.run(
        userId, resolvedEnv, expectedSignalId, eventTrigger,
        expectedSignalName, normalWindowMs, significantWindowMs,
        maxWindowMs, causalInterpretation, thesisLinkLabel, ts
    );
    return { registered: true, expectedSignalId };
}

function recordTriggerEvent(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const evidenceId = _required(params, 'evidenceId');
    const expectedSignalId = _required(params, 'expectedSignalId');
    const triggerEventLabel = _required(params, 'triggerEventLabel');
    const triggerTs = _required(params, 'triggerTs');
    const ts = _required(params, 'ts');

    const signal = _stmts.selectSignal.get(expectedSignalId);
    if (!signal) {
        throw new Error(`§152 expected signal not found: ${expectedSignalId}`);
    }
    if (_stmts.selectEvent.get(evidenceId)) {
        throw new Error(`§152 duplicate evidenceId: ${evidenceId}`);
    }
    const observationDeadlineTs = triggerTs + signal.maxWindowMs;
    _stmts.insertEvent.run(
        userId, resolvedEnv, evidenceId, expectedSignalId,
        triggerEventLabel, triggerTs, observationDeadlineTs, ts
    );
    return {
        recorded: true,
        evidenceId, expectedSignalId,
        triggerTs, observationDeadlineTs,
        state: 'pending'
    };
}

function markSignalObserved(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const evidenceId = _required(params, 'evidenceId');
    const observedTs = _required(params, 'observedTs');

    const existing = _stmts.selectEvent.get(evidenceId);
    if (!existing) {
        throw new Error(`§152 evidence event not found: ${evidenceId}`);
    }
    if (existing.state === 'observed' || existing.state === 'expired') {
        throw new Error(`§152 event already resolved (state=${existing.state}): ${evidenceId}`);
    }
    _stmts.updateEventObserved.run(observedTs, observedTs, evidenceId, userId, resolvedEnv);
    return { marked: true, evidenceId, state: 'observed', observedTs };
}

function evaluatePendingEvent(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const evidenceId = _required(params, 'evidenceId');
    const currentTs = _required(params, 'currentTs');

    const existing = _stmts.selectEvent.get(evidenceId);
    if (!existing) {
        throw new Error(`§152 evidence event not found: ${evidenceId}`);
    }
    if (existing.state === 'observed') {
        return {
            evidenceId,
            state: 'observed',
            significance: 0,
            violation: false
        };
    }
    const signal = _stmts.selectSignal.get(existing.expectedSignalId);
    if (!signal) {
        throw new Error(`§152 referenced signal vanished: ${existing.expectedSignalId}`);
    }
    const elapsedMs = currentTs - existing.triggerTs;
    const { state, significance } = computeAbsenceSignificance({
        elapsedMs,
        normalWindowMs: signal.normalWindowMs,
        significantWindowMs: signal.significantWindowMs,
        maxWindowMs: signal.maxWindowMs
    });
    const { violation } = detectExpectationViolation({
        signalAppeared: false, state, significance
    });
    const resolvedTs = (state === 'expired') ? currentTs : null;
    _stmts.updateEventState.run(
        state, significance, resolvedTs, evidenceId, userId, resolvedEnv
    );
    return { evidenceId, state, significance, violation, elapsedMs };
}

function getExpectedSignals(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAllSignals.all(userId, resolvedEnv);
}

function getNegativeEvidenceEvents(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const state = params.state;
    if (state !== undefined && !ABSENCE_STATES.includes(state)) {
        throw new Error(`§152 invalid state filter: ${state}`);
    }
    return state
        ? _stmts.selectEventsByState.all(userId, resolvedEnv, state)
        : _stmts.selectAllEvents.all(userId, resolvedEnv);
}

module.exports = {
    // constants
    ABSENCE_STATES,
    SIGNIFICANCE_RAMP_THRESHOLD,
    // pure
    classifyAbsenceState,
    computeAbsenceSignificance,
    detectExpectationViolation,
    // DB
    registerExpectedSignal,
    recordTriggerEvent,
    markSignalObserved,
    evaluatePendingEvent,
    getExpectedSignals,
    getNegativeEvidenceEvents
};

// FILE END §152 negativeEvidenceSemantics.js
