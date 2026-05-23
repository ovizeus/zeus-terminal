'use strict';

/**
 * OMEGA R2 Cognition — confidenceDecay (canonical §15)
 *
 * §15 CONFIDENCE DECAY SI TIME-TO-THESIS.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 909-927.
 *
 * "Dupa intrare, increderea nu ramane fixa."
 *
 * Confidence evolves post-entry via two mechanisms:
 *   (1) time-based exponential decay (signals age out)
 *   (2) signal-driven jumps (7 DECAY_SIGNALS reduce confidence;
 *       priceProgress can partially recover it)
 *
 * Decay signals (lines 912-918):
 *   - no_follow_through, volume_disappears, impulse_dies,
 *     time_no_progress, context_degrades, macro_pulse_reverses,
 *     venue_confirmation_lost
 *
 * Structural requirements (lines 920-927):
 *   - max_stagnation_time
 *   - thesis_validation_window
 *   - exit on failed thesis progression
 *   - exponential decay of old signals
 *   - time-weighted signal decay
 *   - decay on confirmations
 *   - decay on entry thesis
 *
 * Composability: EXIT action → §14 (entry-time veto downstream),
 * §29 circuit breaker (severe degradation).
 *
 * First OMEGA module in R2 cognition layer.
 */

const { db } = require('../../database');

const DECAY_SIGNALS = Object.freeze([
    'no_follow_through',
    'volume_disappears',
    'impulse_dies',
    'time_no_progress',
    'context_degrades',
    'macro_pulse_reverses',
    'venue_confirmation_lost'
]);

const ACTION_LADDER = Object.freeze(['HOLD', 'REDUCE', 'EXIT']);

const DEFAULT_PARAMS = Object.freeze({
    max_stagnation_ms:       300000,   // 5 min stagnation threshold
    validation_window_ms:    600000,   // 10 min thesis validation
    decay_rate_per_signal:   0.08,     // 8% reduction per active signal/tick
    time_decay_per_tick:     0.01,     // 1% time decay per update call
    progress_recovery:       0.05,     // 5% recovery from strong priceProgress
    exit_threshold:          0.30,     // below 30% → exit
    reduce_threshold:        0.55      // 30-55% → reduce
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`confidenceDecay: missing ${key}`);
    }
    return params[key];
}

function _clampUnit(x) {
    return Math.max(0, Math.min(1, x));
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getState: db.prepare(`
        SELECT * FROM ml_confidence_state
        WHERE user_id = ? AND resolved_env = ? AND pos_id = ?
    `),
    insertState: db.prepare(`
        INSERT INTO ml_confidence_state
        (user_id, resolved_env, pos_id, symbol, entry_confidence, current_confidence,
         max_stagnation_ms, validation_window_ms,
         thesis_criteria_json, decay_signals_json, last_signal_at,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateState: db.prepare(`
        UPDATE ml_confidence_state
        SET current_confidence = ?, decay_signals_json = ?, last_signal_at = ?, updated_at = ?
        WHERE user_id = ? AND resolved_env = ? AND pos_id = ?
    `)
};

// ── _classifyAction ────────────────────────────────────────────────
function _classifyAction(confidence, params) {
    if (confidence < params.exit_threshold) return 'EXIT';
    if (confidence < params.reduce_threshold) return 'REDUCE';
    return 'HOLD';
}

// ── initializeThesis ───────────────────────────────────────────────
function initializeThesis(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = _required(params, 'posId');
    const symbol = _required(params, 'symbol');
    const entryConfidence = _required(params, 'entryConfidence');

    if (typeof entryConfidence !== 'number' || entryConfidence < 0 || entryConfidence > 1) {
        throw new Error(`confidenceDecay: entryConfidence out of range [0,1]`);
    }

    const maxStagnationMs = (params && params.maxStagnationMs) || DEFAULT_PARAMS.max_stagnation_ms;
    const validationWindowMs = (params && params.validationWindowMs) || DEFAULT_PARAMS.validation_window_ms;
    const thesisCriteria = (params && params.thesisCriteria) ? params.thesisCriteria : null;

    const now = Date.now();
    _stmts.insertState.run(
        userId, env, posId, symbol,
        entryConfidence, entryConfidence,
        maxStagnationMs, validationWindowMs,
        thesisCriteria ? JSON.stringify(thesisCriteria) : null,
        '[]', null, now, now
    );

    return { created: true, entryConfidence, posId };
}

// ── updateThesisProgress ───────────────────────────────────────────
function updateThesisProgress(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = _required(params, 'posId');
    const signals = (params && params.signals) ? params.signals : {};
    const priceProgress = (params && typeof params.priceProgress === 'number')
        ? params.priceProgress : 0;
    const paramOverrides = (params && params.params) ? params.params : DEFAULT_PARAMS;

    const state = _stmts.getState.get(userId, env, posId);
    if (!state) {
        throw new Error(`confidenceDecay: pos ${posId} not initialized (call initializeThesis first)`);
    }

    const activeSignals = DECAY_SIGNALS.filter(k => signals[k] === true);
    const signalDecay = activeSignals.length * paramOverrides.decay_rate_per_signal;
    const timeDecay = paramOverrides.time_decay_per_tick;
    const progressRecovery = Math.max(0, Math.min(1, priceProgress)) * paramOverrides.progress_recovery;

    const newConfidence = _clampUnit(
        state.current_confidence - signalDecay - timeDecay + progressRecovery
    );

    const now = Date.now();
    _stmts.updateState.run(
        newConfidence,
        JSON.stringify(activeSignals),
        activeSignals.length > 0 ? now : state.last_signal_at,
        now,
        userId, env, posId
    );

    return {
        currentConfidence: newConfidence,
        entryConfidence: state.entry_confidence,
        activeSignals,
        action: _classifyAction(newConfidence, paramOverrides)
    };
}

// ── getCurrentConfidence ───────────────────────────────────────────
function getCurrentConfidence(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = _required(params, 'posId');

    const state = _stmts.getState.get(userId, env, posId);
    if (!state) {
        return { exists: false, confidence: null, action: null };
    }

    const age = Date.now() - state.created_at;
    const decayedSignals = state.decay_signals_json
        ? JSON.parse(state.decay_signals_json) : [];

    return {
        exists: true,
        confidence: state.current_confidence,
        entryConfidence: state.entry_confidence,
        age,
        decayedSignals,
        action: _classifyAction(state.current_confidence, DEFAULT_PARAMS),
        symbol: state.symbol
    };
}

// ── shouldExitOnFailedThesis ───────────────────────────────────────
function shouldExitOnFailedThesis(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = _required(params, 'posId');

    const state = _stmts.getState.get(userId, env, posId);
    if (!state) {
        return { shouldExit: false, reasons: ['not_initialized'] };
    }

    const reasons = [];
    const now = Date.now();
    const age = now - state.created_at;

    if (state.current_confidence < DEFAULT_PARAMS.exit_threshold) {
        reasons.push('confidence_below_exit_threshold');
    }
    if (age > state.max_stagnation_ms) {
        reasons.push('max_stagnation_exceeded');
    }
    if (age > state.validation_window_ms
        && state.current_confidence < state.entry_confidence * 0.5) {
        reasons.push('validation_window_failed_progression');
    }

    return {
        shouldExit: reasons.length > 0,
        reasons,
        currentConfidence: state.current_confidence,
        age
    };
}

module.exports = {
    DECAY_SIGNALS,
    ACTION_LADDER,
    DEFAULT_PARAMS,
    initializeThesis,
    updateThesisProgress,
    getCurrentConfidence,
    shouldExitOnFailedThesis
};
