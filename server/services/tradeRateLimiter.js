'use strict';

// Zeus Terminal — Per-user trade rate limiter.
//
// Last-line defense against runaway brain bugs (e.g. confidence/dedup
// bypass) that could otherwise fire 100+ entries per minute. Default
// cap: 10 entries per hour per user. Sliding window (not fixed buckets),
// so the cap applies continuously without wraparound spikes.
//
// Per-user isolation: one user hitting limit doesn't affect another.
// setLimit allows per-user override, clamped to [1, 100].
//
// Memory: one entry per non-stale record per user. Pruned on every
// canEnter/recordEntry/getState call — no separate sweeper needed.

const DEFAULT_LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;  // 1 hour
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

const _state = new Map();  // userId → { recentEntries: number[], limit: number }

function _isValidUid(uid) {
    return Number.isFinite(Number(uid)) && Number(uid) > 0;
}

function _get(userId) {
    if (!_state.has(userId)) {
        _state.set(userId, { recentEntries: [], limit: DEFAULT_LIMIT });
    }
    return _state.get(userId);
}

function _prune(s) {
    const cutoff = Date.now() - WINDOW_MS;
    s.recentEntries = s.recentEntries.filter(ts => ts >= cutoff);
}

function canEnter(userId) {
    if (!_isValidUid(userId)) return true;  // missing uid → no rate limit
    const s = _get(userId);
    _prune(s);
    return s.recentEntries.length < s.limit;
}

function recordEntry(userId) {
    if (!_isValidUid(userId)) return;
    const s = _get(userId);
    _prune(s);
    s.recentEntries.push(Date.now());
}

function getState(userId) {
    const s = _get(userId);
    _prune(s);
    return {
        recentEntries: s.recentEntries.slice(),
        limit: s.limit,
        capacity: Math.max(0, s.limit - s.recentEntries.length),
    };
}

function setLimit(userId, limit) {
    const s = _get(userId);
    const n = Number(limit);
    s.limit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Number.isFinite(n) ? n : DEFAULT_LIMIT));
}

function _reset() { _state.clear(); }

function _testInjectEntry(userId, ts) {
    const s = _get(userId);
    s.recentEntries.push(ts);
}

module.exports = {
    canEnter,
    recordEntry,
    getState,
    setLimit,
    _reset,
    _testInjectEntry,
    DEFAULT_LIMIT,
    WINDOW_MS,
};
