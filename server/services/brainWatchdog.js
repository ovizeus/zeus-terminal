'use strict';

// Zeus Terminal — Brain Watchdog (Dead Man's Switch consumer)
//
// serverBrain._runCycle emits per-cycle heartbeat via telemetryCollector
// (Day 18 wiring 2026-05-18) → flushed to ml_module_heartbeats every 1s
// with module_id='serverBrain', latency_ms, ran_ok flag.
//
// This watchdog polls MAX(ts) for that row every 10s. If MAX(ts) is older
// than the staleness threshold (default 60s), the brain is "dead" → arm
// globalHalt + Telegram P0 + audit. Brain heartbeats EVERY 30s normally
// (CYCLE_INTERVAL_MS), so a 60s gap = at least one missed cycle = serious.
//
// Debounced: re-alerts at most once per 5min so a continuously-dead brain
// doesn't spam the channel. Defensive: DB errors are swallowed (table may
// not exist on fresh DB or before first heartbeat).

const DEFAULT_INTERVAL_MS = 10 * 1000;
const DEFAULT_STALE_THRESHOLD_MS = 60 * 1000;
const ALERT_DEBOUNCE_MS = 5 * 60 * 1000;
// Halt is recorded under user_id=1 (operator); per-user halt doesn't apply
// here because brain runs at process level, not per-user.
const HALT_BY_USER_ID = 1;

let _timer = null;
let _opts = {
    intervalMs: DEFAULT_INTERVAL_MS,
    staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
};
let _lastAlertTs = 0;

function _now() { return Date.now(); }

function check(opts) {
    const threshold = (opts && Number(opts.staleThresholdMs) > 0)
        ? Number(opts.staleThresholdMs)
        : _opts.staleThresholdMs;

    let row;
    try {
        const { db } = require('./database');
        row = db.prepare(
            "SELECT MAX(ts) AS last_ts FROM ml_module_heartbeats WHERE module_id = 'serverBrain'"
        ).get();
    } catch (_) {
        // Table may not exist on fresh DB or DB unavailable — treat as no signal.
        return { stale: false, ageMs: null, lastTs: null, reason: 'db_unavailable' };
    }

    const lastTs = row && row.last_ts ? Number(row.last_ts) : null;
    if (!lastTs) {
        // No heartbeat row yet (brain not started or pre-Day-18 deploy) — don't false-alarm.
        return { stale: false, ageMs: null, lastTs: null, reason: 'no_signal_yet' };
    }

    const ageMs = _now() - lastTs;
    const stale = ageMs > threshold;
    if (stale) {
        _maybeFireAlert(ageMs, lastTs);
    }
    return { stale, ageMs, lastTs };
}

function _maybeFireAlert(ageMs, lastTs) {
    if (_now() - _lastAlertTs < ALERT_DEBOUNCE_MS) return;
    _lastAlertTs = _now();

    const ageSec = Math.round(ageMs / 1000);
    try {
        const serverAT = require('./serverAT');
        serverAT.setGlobalHalt(true, HALT_BY_USER_ID,
            'DEAD_MAN_SWITCH:brain_heartbeat_stale_' + ageSec + 's');
    } catch (e) {
        console.error('[BRAIN-WATCHDOG] setGlobalHalt failed:', e.message);
    }

    try {
        const telegram = require('./telegram');
        telegram.sendToAll(
            '🚨 *BRAIN DEAD* — heartbeat stale\n'
            + 'Last heartbeat: ' + ageSec + 's ago.\n'
            + 'Global halt ARMED. Manual investigation needed.'
        );
    } catch (_) { /* best-effort */ }

    try {
        const audit = require('./audit');
        audit.record('BRAIN_WATCHDOG_HALT', {
            ageMs, lastTs, userId: HALT_BY_USER_ID,
        }, 'BRAIN_WATCHDOG');
    } catch (_) { /* best-effort */ }
}

function start(opts) {
    if (_timer) return;
    if (opts && Number(opts.intervalMs) > 0) _opts.intervalMs = Number(opts.intervalMs);
    if (opts && Number(opts.staleThresholdMs) > 0) _opts.staleThresholdMs = Number(opts.staleThresholdMs);
    _timer = setInterval(() => {
        try { check(); } catch (e) {
            console.error('[BRAIN-WATCHDOG] check error:', e.message);
        }
    }, _opts.intervalMs);
    console.log('[BRAIN-WATCHDOG] started interval=' + _opts.intervalMs + 'ms threshold=' + _opts.staleThresholdMs + 'ms');
}

function stop() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
}

function _reset() {
    _lastAlertTs = 0;
    _opts = {
        intervalMs: DEFAULT_INTERVAL_MS,
        staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
    };
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
}

module.exports = { start, stop, check, _reset };
