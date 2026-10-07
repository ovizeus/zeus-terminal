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

// [AUTO-RECOVERY 2026-10-07] The switch had no path back: it armed on a stale
// heartbeat and nothing ever disarmed it. That is what turned a transient
// event-loop freeze into a two-month silent outage — the freeze came and went
// every 5 min, but the halt it armed was permanent, and only a process restart
// (RECOVERY_BOOT_COMPLETE) cleared it. Now a sustained run of healthy
// heartbeats disarms it again.
//
// Hard constraint: we clear ONLY a halt this switch armed (reason prefixed
// DEAD_MAN_SWITCH:). An operator halt, or EMERGENCY_CLOSE_CATASTROPHIC, must
// survive — silently undoing a real safety halt would be far worse than the
// outage this fixes.
const HALT_REASON_PREFIX = 'DEAD_MAN_SWITCH:';
const HEALTHY_STREAK_TO_RECOVER = 6; // ×10s ≈ 1 min of proven-healthy brain

let _timer = null;
let _opts = {
    intervalMs: DEFAULT_INTERVAL_MS,
    staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
};
let _lastAlertTs = 0;
let _healthyStreak = 0;

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
        // No heartbeat row yet (brain not started or pre-Day-18 deploy) — don't
        // false-alarm. It is also not evidence of health, so the recovery
        // streak resets: we never un-halt on absence of evidence.
        _healthyStreak = 0;
        return { stale: false, ageMs: null, lastTs: null, reason: 'no_signal_yet' };
    }

    const ageMs = _now() - lastTs;
    const stale = ageMs > threshold;
    if (stale) {
        _healthyStreak = 0;
        _maybeFireAlert(ageMs, lastTs);
    } else {
        _healthyStreak++;
        if (_healthyStreak >= HEALTHY_STREAK_TO_RECOVER) _maybeRecover(ageMs);
    }
    return { stale, ageMs, lastTs, healthyStreak: _healthyStreak };
}

/**
 * Disarm the halt we armed, once the brain has been healthy long enough.
 * No-op unless the halt is active AND its reason says we are the one who
 * armed it.
 */
function _maybeRecover(ageMs) {
    let halt;
    try {
        const serverAT = require('./serverAT');
        halt = serverAT.getGlobalHaltState();
        if (!halt || !halt.active) return;
        if (!String(halt.reason || '').startsWith(HALT_REASON_PREFIX)) return; // not ours
        serverAT.setGlobalHalt(false, HALT_BY_USER_ID,
            HALT_REASON_PREFIX + 'brain_recovered_after_' + _healthyStreak + '_healthy_checks');
    } catch (e) {
        console.error('[BRAIN-WATCHDOG] auto-recover failed:', e.message);
        return;
    }
    _healthyStreak = 0;   // one recovery per outage
    _lastAlertTs = 0;     // next real outage alerts immediately

    try {
        require('./telegram').sendToAll(
            '✅ *BRAIN RECOVERED* — heartbeat healthy again\n'
            + 'Global halt auto-disarmed. Entries re-enabled.'
        );
    } catch (_) { /* best-effort */ }

    try {
        require('./audit').record('BRAIN_WATCHDOG_RECOVERED', {
            ageMs, userId: HALT_BY_USER_ID, previousReason: halt.reason,
        }, 'BRAIN_WATCHDOG');
    } catch (_) { /* best-effort */ }
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
    _healthyStreak = 0;
    _opts = {
        intervalMs: DEFAULT_INTERVAL_MS,
        staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
    };
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
}

module.exports = { start, stop, check, _reset, HEALTHY_STREAK_TO_RECOVER, HALT_REASON_PREFIX };
