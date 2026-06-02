'use strict';
// Per-user trading-loop liveness, server-stamped. SP2 spec §5.
const HEARTBEAT_TIMEOUT_MS = 20000;
const HYSTERESIS_N = 2;
const COLD_START_GRACE_MS = 30000;

let _bootTs = Date.now();
const _state = new Map(); // userId -> { lastBeatTs, forcedAbsent, missStreak }

function _reset(bootTs) { _bootTs = bootTs != null ? bootTs : Date.now(); _state.clear(); }

function recordBeat(userId, serverTs) {
  const s = _state.get(userId) || { lastBeatTs: 0, forcedAbsent: false, missStreak: 0 };
  s.lastBeatTs = serverTs; s.forcedAbsent = false; s.missStreak = 0;
  _state.set(userId, s);
}

function markAbsent(userId) {
  const s = _state.get(userId) || { lastBeatTs: 0, missStreak: 0 };
  s.forcedAbsent = true; _state.set(userId, s);
}

function isClientPresent(userId, now) {
  const s = _state.get(userId);
  if (!s || !s.lastBeatTs) {
    if (s && s.forcedAbsent) return false;
    return (now - _bootTs) < (COLD_START_GRACE_MS + HEARTBEAT_TIMEOUT_MS);
  }
  if (s.forcedAbsent) return false;
  const fresh = (now - s.lastBeatTs) < HEARTBEAT_TIMEOUT_MS;
  if (fresh) { s.missStreak = 0; return true; }
  s.missStreak = (s.missStreak || 0) + 1;
  return s.missStreak < HYSTERESIS_N;
}

module.exports = { recordBeat, markAbsent, isClientPresent, _reset,
  HEARTBEAT_TIMEOUT_MS, HYSTERESIS_N, COLD_START_GRACE_MS };
