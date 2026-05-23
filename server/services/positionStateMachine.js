'use strict';

/**
 * positionStateMachine — 8-state machine + atomic transitions for at_positions.status
 *
 * States:
 *   PENDING    → entry order sent, awaiting fill
 *   OPENING    → entry filled, SL/TP placement in progress
 *   OPEN       → entry + SL fully placed
 *   CLOSING    → close order sent, awaiting fill
 *   CLOSED     → fully closed, PnL realized
 *   ORPHANED   → user disconnected exchange; Zeus no longer manages
 *   RECOVERING → boot scan reconciling state
 *   EMERGENCY  → emergency close triggered (catastrophic SL failure)
 *   CANCELLED  → entry rejected before fill (never opened)
 *
 * transition() is atomic: UPDATE at_positions.status + INSERT position_events
 * inside a single SQLite transaction. Either both succeed or both rollback.
 *
 * Race protection: transition() verifies position is in expected from_state.
 * If state already changed (concurrent transition), throws state mismatch.
 */

const { db } = require('./database');
const positionEvents = require('./positionEvents');

const STATES = Object.freeze([
    'PENDING', 'OPENING', 'OPEN', 'CLOSING', 'CLOSED',
    'ORPHANED', 'RECOVERING', 'EMERGENCY', 'CANCELLED'
]);

const VALID_EDGES = Object.freeze({
    'PENDING':    ['OPENING', 'CANCELLED'],
    'OPENING':    ['OPEN', 'EMERGENCY'],
    'OPEN':       ['CLOSING', 'EMERGENCY'],
    'CLOSING':    ['CLOSED'],
    'RECOVERING': ['OPEN', 'EMERGENCY', 'ORPHANED', 'CLOSED'],
    'EMERGENCY':  ['CLOSING', 'CLOSED'],
    'ORPHANED':   ['CLOSED'],
    'CLOSED':     [],
    'CANCELLED':  [],
});

function isValidTransition(from, to) {
    if (!STATES.includes(from) || !STATES.includes(to)) return false;
    const allowed = VALID_EDGES[from] || [];
    return allowed.includes(to);
}

const _statusStmt = db.prepare(`SELECT status, user_id, exchange FROM at_positions WHERE seq = ?`);
const _updateStmt = db.prepare(`UPDATE at_positions SET status = ?, updated_at = datetime('now') WHERE seq = ?`);

function transition(position_seq, expected_from, to, payload) {
    if (!isValidTransition(expected_from, to)) {
        throw new Error(`positionStateMachine.transition: invalid transition ${expected_from} → ${to}`);
    }
    const row = _statusStmt.get(position_seq);
    if (!row) {
        throw new Error(`positionStateMachine.transition: position not found seq=${position_seq}`);
    }
    if (row.status !== expected_from) {
        throw new Error(`positionStateMachine.transition: state mismatch seq=${position_seq} expected=${expected_from} actual=${row.status}`);
    }

    // Atomic: UPDATE status + INSERT position_events in single transaction
    db.transaction(() => {
        _updateStmt.run(to, position_seq);
        positionEvents.append({
            position_seq,
            user_id: row.user_id,
            exchange: row.exchange,
            event_type: 'STATE_CHANGE',
            from_state: expected_from,
            to_state: to,
            payload: payload || {}
        });
    })();
}

function getCurrentState(position_seq) {
    const row = _statusStmt.get(position_seq);
    return row ? row.status : null;
}

module.exports = { STATES, VALID_EDGES, isValidTransition, transition, getCurrentState };
