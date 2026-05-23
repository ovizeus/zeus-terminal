'use strict';

/**
 * positionEvents — Append-only journal for position state transitions + events.
 *
 * Append-only contract: production code MUST NEVER UPDATE or DELETE rows.
 * Test cleanup is allowed in beforeEach to isolate test runs.
 *
 * Two event categories supported:
 *   1. State transitions: event_type='STATE_CHANGE', from_state + to_state filled
 *   2. Informational events: e.g., 'SL_PLACED', 'EMERGENCY_CLOSE_SUCCESS' — no from/to states
 *
 * Used by: positionStateMachine.transition (Task 7), binanceOps + bybitOps placeEntry flows.
 */

const { db } = require('./database');

function _parseRow(r) {
    let payload;
    try { payload = JSON.parse(r.payload); }
    catch (_) {
        // Defensive: corrupted payload string → empty object, log warning
        try { require('./logger').warn('POSITION_EVENTS', `corrupt payload on id=${r.id}, defaulting to {}`); } catch (__) {}
        payload = {};
    }
    return { ...r, payload };
}

function _validateParams(params) {
    if (!params || typeof params !== 'object') throw new Error('positionEvents.append: params object required');
    if (typeof params.position_seq !== 'number') throw new Error('positionEvents.append: position_seq required');
    if (typeof params.user_id !== 'number') throw new Error('positionEvents.append: user_id required');
    if (typeof params.exchange !== 'string' || !params.exchange) throw new Error('positionEvents.append: exchange required');
    if (typeof params.event_type !== 'string' || !params.event_type) throw new Error('positionEvents.append: event_type required');
}

const _insertStmt = db.prepare(`
    INSERT INTO position_events
        (position_seq, user_id, exchange, event_type, from_state, to_state, payload, cycle_no, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function append(params) {
    _validateParams(params);
    const ts = (params.ts != null) ? params.ts : Date.now();
    const payloadJson = JSON.stringify(params.payload || {});
    const result = _insertStmt.run(
        params.position_seq, params.user_id, params.exchange,
        params.event_type, params.from_state || null, params.to_state || null,
        payloadJson, params.cycle_no || null, ts
    );
    return Number(result.lastInsertRowid);
}

const _queryByPositionStmt = db.prepare(`
    SELECT id, position_seq, user_id, exchange, event_type, from_state, to_state, payload, cycle_no, ts
    FROM position_events
    WHERE position_seq = ?
    ORDER BY ts ASC, id ASC
`);

const _queryByUserStmt = db.prepare(`
    SELECT id, position_seq, user_id, exchange, event_type, from_state, to_state, payload, cycle_no, ts
    FROM position_events
    WHERE user_id = ? AND ts >= ?
    ORDER BY ts DESC, id DESC
    LIMIT ?
`);

function queryByPosition(position_seq) {
    const rows = _queryByPositionStmt.all(position_seq);
    return rows.map(r => _parseRow(r));
}

function queryByUser(user_id, opts) {
    const limit = (opts && opts.limit) || 100;
    const since = (opts && opts.since) || 0;
    const rows = _queryByUserStmt.all(user_id, since, limit);
    return rows.map(r => _parseRow(r));
}

module.exports = { append, queryByPosition, queryByUser };
