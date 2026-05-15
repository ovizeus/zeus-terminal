'use strict';

/**
 * OMEGA Operator Interaction — quietHoursScheduler (A-Z Raid item Q)
 *
 * RAID-Q QUIET HOURS SCHEDULER.
 * Source: A-Z Raid Wave 1 UX additions MUST-ADD item Q.
 *
 * Window-based quiet hours. Suppresses non-CRITICAL alerts during configured
 * windows. CRITICAL alerts always pass through (operator must always know).
 *
 * Windows format: [{ start: 'HH:MM', end: 'HH:MM', daysOfWeek?: [0-6] }]
 * Cross-midnight handled (end < start means wrap to next day).
 */

const { db } = require('../../database');

const DEFAULT_QUIET_HOURS_TZ = 'UTC';
const SUPPRESSION_MIN_SEVERITY = 'CRITICAL';  // CRITICAL never suppressed

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`quietHoursScheduler: missing ${key}`);
    }
    return params[key];
}

function _parseHM(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function _isInWindow(minutesOfDay, window) {
    const startMin = _parseHM(window.start);
    const endMin = _parseHM(window.end);

    if (endMin > startMin) {
        // Same-day window
        return minutesOfDay >= startMin && minutesOfDay < endMin;
    } else {
        // Cross-midnight window
        return minutesOfDay >= startMin || minutesOfDay < endMin;
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getConfig: db.prepare(`
        SELECT * FROM ml_quiet_hours
        WHERE user_id = ? AND resolved_env = ?
    `),
    upsertConfig: db.prepare(`
        INSERT INTO ml_quiet_hours
        (user_id, resolved_env, windows_json, timezone, actor, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            windows_json = excluded.windows_json,
            timezone = excluded.timezone,
            actor = excluded.actor,
            enabled = 1,
            updated_at = excluded.updated_at
    `),
    deleteConfig: db.prepare(`
        DELETE FROM ml_quiet_hours
        WHERE user_id = ? AND resolved_env = ?
    `)
};

// ── setQuietHours ──────────────────────────────────────────────────
function setQuietHours(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const windows = _required(params, 'windows');
    const actor = _required(params, 'actor');
    const timezone = (params && params.timezone) ? params.timezone : DEFAULT_QUIET_HOURS_TZ;

    if (!Array.isArray(windows) || windows.length === 0) {
        throw new Error(`quietHoursScheduler: windows must be non-empty array`);
    }

    _stmts.upsertConfig.run(
        userId, env,
        JSON.stringify(windows),
        timezone, actor,
        Date.now()
    );

    return { configured: true };
}

// ── isInQuietHours ─────────────────────────────────────────────────
function isInQuietHours(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const currentTime = (params && typeof params.currentTime === 'number')
        ? params.currentTime : Date.now();

    const row = _stmts.getConfig.get(userId, env);
    if (!row || row.enabled !== 1) return false;

    const windows = JSON.parse(row.windows_json);
    const date = new Date(currentTime);
    const dayOfWeek = date.getUTCDay();
    const minutesOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();

    for (const win of windows) {
        if (win.daysOfWeek && Array.isArray(win.daysOfWeek)) {
            if (!win.daysOfWeek.includes(dayOfWeek)) continue;
        }
        if (_isInWindow(minutesOfDay, win)) return true;
    }
    return false;
}

// ── shouldSuppressAlert ────────────────────────────────────────────
function shouldSuppressAlert(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const severity = _required(params, 'severity');
    const currentTime = (params && typeof params.currentTime === 'number')
        ? params.currentTime : Date.now();

    // CRITICAL never suppressed
    if (severity === SUPPRESSION_MIN_SEVERITY) {
        return { suppressed: false, reason: 'critical_always_passes' };
    }

    const inQuiet = isInQuietHours({ userId, resolvedEnv: env, currentTime });
    if (inQuiet) {
        return { suppressed: true, reason: 'in_quiet_hours' };
    }
    return { suppressed: false, reason: 'outside_quiet_hours' };
}

// ── clearQuietHours ────────────────────────────────────────────────
function clearQuietHours(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const actor = _required(params, 'actor');
    void actor;

    const result = _stmts.deleteConfig.run(userId, env);
    return { cleared: result.changes > 0 };
}

// ── getQuietHoursConfig ────────────────────────────────────────────
function getQuietHoursConfig(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');

    const row = _stmts.getConfig.get(userId, env);
    if (!row) return null;

    return {
        windows: JSON.parse(row.windows_json),
        timezone: row.timezone,
        actor: row.actor,
        enabled: row.enabled === 1,
        updatedAt: row.updated_at
    };
}

module.exports = {
    DEFAULT_QUIET_HOURS_TZ,
    SUPPRESSION_MIN_SEVERITY,
    setQuietHours,
    isInQuietHours,
    shouldSuppressAlert,
    clearQuietHours,
    getQuietHoursConfig
};
