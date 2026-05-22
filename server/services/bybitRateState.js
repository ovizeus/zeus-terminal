'use strict';

/**
 * bybitRateState — DB-persistent rate limit + ban tracking per user.
 *
 * Mirror of binanceRateState pattern. Survives PM2 reload via SQLite.
 * Bybit V5 has per-IP rate limits (different shape than Binance per-endpoint).
 *
 * Schema: bybit_rate_state(id, user_id UNIQUE, used_weight DEFAULT 0,
 *   reset_at, banned_until DEFAULT 0, ban_reason, last_request_at)
 *
 * Note: reset_at + last_request_at have NO DEFAULT in DB schema — this helper
 * must always provide them on INSERT.
 */

const { db } = require('./database');

const WINDOW_MS = 60_000;

const _loadStmt = db.prepare(`SELECT * FROM bybit_rate_state WHERE user_id = ?`);
const _upsertStmt = db.prepare(`
    INSERT INTO bybit_rate_state (user_id, used_weight, reset_at, banned_until, ban_reason, last_request_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
        used_weight = excluded.used_weight,
        reset_at = excluded.reset_at,
        banned_until = excluded.banned_until,
        ban_reason = excluded.ban_reason,
        last_request_at = excluded.last_request_at
`);

function _defaultState(user_id) {
    const now = Date.now();
    return {
        user_id,
        used_weight: 0,
        reset_at: now + WINDOW_MS,
        banned_until: 0,
        ban_reason: null,
        last_request_at: now
    };
}

function load(user_id) {
    const row = _loadStmt.get(user_id);
    if (!row) return _defaultState(user_id);
    return row;
}

function _persist(state) {
    _upsertStmt.run(
        state.user_id, state.used_weight, state.reset_at,
        state.banned_until, state.ban_reason, state.last_request_at
    );
}

function recordRequest(user_id, weight) {
    const state = load(user_id);
    const now = Date.now();
    if (now >= state.reset_at) {
        // Window expired — reset
        state.used_weight = weight;
        state.reset_at = now + WINDOW_MS;
    } else {
        state.used_weight += weight;
    }
    state.last_request_at = now;
    _persist(state);
}

function setBan(user_id, durationMs, reason) {
    const state = load(user_id);
    state.banned_until = Date.now() + durationMs;
    state.ban_reason = reason || 'unknown';
    state.last_request_at = Date.now();
    _persist(state);
}

function isBanned(user_id) {
    const state = load(user_id);
    return state.banned_until > Date.now();
}

function resetWindow(user_id) {
    const state = load(user_id);
    state.used_weight = 0;
    state.reset_at = Date.now() + WINDOW_MS;
    _persist(state);
}

module.exports = { load, recordRequest, setBan, isBanned, resetWindow, WINDOW_MS };
