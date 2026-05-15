'use strict';

/**
 * OMEGA R4 Execution — positionStateMachine (canonical §12)
 *
 * §12 STATE MACHINE A POZITIEI.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 828-849.
 *
 * Explicit 12-state FSM lifecycle per spec:
 *
 *   Forward path: IDLE → WATCHING → ARMED → READY → ENTERED → MANAGING
 *                 → PARTIAL_TAKEN → RUNNER_ACTIVE → EXITED → COOLDOWN → IDLE
 *
 *   Safety states (entered from anywhere):
 *     INVALIDATED  → entry conditions broke; transition out via COOLDOWN
 *     LOCKED       → safety veto; manual or risk-layer unlock via COOLDOWN
 *     COOLDOWN     → temporal pause post-EXIT/INVALIDATED/LOCKED
 *
 * Per state requirements (lines 843-849):
 *   - entry conditions     → enforced via VALID_TRANSITIONS matrix
 *   - exit conditions      → same matrix (reverse lookup)
 *   - events that change   → transitionState `event` param
 *   - protection rules     → safety states LOCKED/INVALIDATED bypass normal flow
 *   - clear ownership      → STATE_OWNERSHIP map (signal/execution/risk layer)
 *   - layer responsibility → ownership tag persisted in transition audit
 *
 * First OMEGA module in R4 execution layer.
 */

const { db } = require('../../database');

const POSITION_STATES = Object.freeze([
    'IDLE',
    'WATCHING',
    'ARMED',
    'READY',
    'ENTERED',
    'MANAGING',
    'PARTIAL_TAKEN',
    'RUNNER_ACTIVE',
    'EXITED',
    'INVALIDATED',
    'LOCKED',
    'COOLDOWN'
]);

// Layer ownership per state (signal / execution / risk).
// Per spec line 849: "responsabilitati clare intre signal layer, execution layer si risk layer"
const STATE_OWNERSHIP = Object.freeze({
    IDLE:           'signal',
    WATCHING:       'signal',
    ARMED:          'signal',
    READY:          'execution',
    ENTERED:        'execution',
    MANAGING:       'execution',
    PARTIAL_TAKEN:  'execution',
    RUNNER_ACTIVE:  'execution',
    EXITED:         'execution',
    INVALIDATED:    'risk',
    LOCKED:         'risk',
    COOLDOWN:       'risk'
});

// Safety transitions: ANY state can go to INVALIDATED/LOCKED (risk layer veto).
const SAFETY_TRANSITIONS = Object.freeze(['INVALIDATED', 'LOCKED']);

// Forward-flow valid transitions per spec lifecycle.
const VALID_TRANSITIONS = Object.freeze({
    IDLE:           ['WATCHING', 'INVALIDATED', 'LOCKED'],
    WATCHING:       ['ARMED', 'IDLE', 'INVALIDATED', 'LOCKED'],
    ARMED:          ['READY', 'WATCHING', 'INVALIDATED', 'LOCKED'],
    READY:          ['ENTERED', 'ARMED', 'INVALIDATED', 'LOCKED'],
    ENTERED:        ['MANAGING', 'EXITED', 'INVALIDATED', 'LOCKED'],
    MANAGING:       ['PARTIAL_TAKEN', 'EXITED', 'INVALIDATED', 'LOCKED'],
    PARTIAL_TAKEN:  ['RUNNER_ACTIVE', 'EXITED', 'INVALIDATED', 'LOCKED'],
    RUNNER_ACTIVE:  ['EXITED', 'INVALIDATED', 'LOCKED'],
    EXITED:         ['COOLDOWN', 'IDLE'],
    INVALIDATED:    ['COOLDOWN', 'IDLE'],
    LOCKED:         ['COOLDOWN', 'IDLE'],
    COOLDOWN:       ['IDLE']
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`positionStateMachine: missing ${key}`);
    }
    return params[key];
}

function _validateState(state) {
    if (!POSITION_STATES.includes(state)) {
        throw new Error(`positionStateMachine: invalid state "${state}"`);
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getState: db.prepare(`
        SELECT * FROM ml_position_state
        WHERE user_id = ? AND resolved_env = ? AND pos_id = ?
    `),
    insertState: db.prepare(`
        INSERT INTO ml_position_state
        (user_id, resolved_env, pos_id, symbol, state, state_since, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateState: db.prepare(`
        UPDATE ml_position_state
        SET state = ?, state_since = ?, updated_at = ?
        WHERE user_id = ? AND resolved_env = ? AND pos_id = ?
    `),
    insertTransition: db.prepare(`
        INSERT INTO ml_position_transitions
        (user_id, resolved_env, pos_id, from_state, to_state, event, reason, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listTransitions: db.prepare(`
        SELECT * FROM ml_position_transitions
        WHERE user_id = ? AND resolved_env = ? AND pos_id = ?
        ORDER BY created_at ASC, id ASC
        LIMIT ?
    `)
};

// ── isTransitionAllowed (pure) ─────────────────────────────────────
function isTransitionAllowed({ fromState, toState, event }) {
    if (!POSITION_STATES.includes(fromState)) return false;
    if (!POSITION_STATES.includes(toState)) return false;
    // Self-transition disallowed
    if (fromState === toState) return false;
    // Safety transitions are always allowed (risk-layer veto)
    if (SAFETY_TRANSITIONS.includes(toState)) return true;
    const allowed = VALID_TRANSITIONS[fromState] || [];
    return allowed.includes(toState);
}

// ── initializePosition ─────────────────────────────────────────────
function initializePosition(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = _required(params, 'posId');
    const symbol = _required(params, 'symbol');
    const initialState = (params && params.initialState) ? params.initialState : 'IDLE';

    _validateState(initialState);

    const now = Date.now();
    _stmts.insertState.run(userId, env, posId, symbol, initialState, now, now, now);

    return { created: true, state: initialState, posId };
}

// ── transitionState ────────────────────────────────────────────────
function transitionState(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = _required(params, 'posId');
    const toState = _required(params, 'toState');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');
    const event = (params && params.event) ? params.event : null;

    _validateState(toState);

    const state = _stmts.getState.get(userId, env, posId);
    if (!state) {
        throw new Error(`positionStateMachine: pos ${posId} not initialized`);
    }
    const fromState = state.state;

    if (!isTransitionAllowed({ fromState, toState, event })) {
        throw new Error(`positionStateMachine: transition ${fromState} → ${toState} not allowed`);
    }

    const now = Date.now();
    _stmts.updateState.run(toState, now, now, userId, env, posId);
    _stmts.insertTransition.run(userId, env, posId, fromState, toState, event, reason, actor, now);

    return {
        transitioned: true,
        fromState,
        toState,
        actor,
        reason
    };
}

// ── getCurrentState ────────────────────────────────────────────────
function getCurrentState(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = _required(params, 'posId');

    const state = _stmts.getState.get(userId, env, posId);
    if (!state) {
        return { exists: false, state: null };
    }
    const age = Date.now() - state.state_since;
    return {
        exists: true,
        state: state.state,
        symbol: state.symbol,
        stateSince: state.state_since,
        age,
        ownership: STATE_OWNERSHIP[state.state]
    };
}

// ── getStateHistory ────────────────────────────────────────────────
function getStateHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = _required(params, 'posId');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listTransitions.all(userId, env, posId, limit);
    return rows.map(r => ({
        id: r.id,
        fromState: r.from_state,
        toState: r.to_state,
        event: r.event,
        reason: r.reason,
        actor: r.actor,
        createdAt: r.created_at
    }));
}

module.exports = {
    POSITION_STATES,
    VALID_TRANSITIONS,
    STATE_OWNERSHIP,
    SAFETY_TRANSITIONS,
    isTransitionAllowed,
    initializePosition,
    transitionState,
    getCurrentState,
    getStateHistory
};
