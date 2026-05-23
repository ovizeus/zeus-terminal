'use strict';

/**
 * OMEGA Operator Interaction — telegramPusher (A-Z Raid item N)
 *
 * RAID-N CRITICAL-ONLY TELEGRAM PUSH.
 * Source: A-Z Raid Wave 1 UX additions MUST-ADD item N.
 *
 * Critical-only filter prevents spam. Dedup window prevents
 * duplicate alerts for same event. Audit log for delivery tracking.
 */

const { db } = require('../../database');

const SEVERITY_LEVELS = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const SEVERITY_RANK = Object.freeze({
    LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4
});

const DELIVERY_STATUS = Object.freeze(['PENDING', 'SENT', 'FAILED', 'DEDUPED']);

const DEFAULT_DEDUP_WINDOW_MS = 300000;  // 5 min
const DEFAULT_MIN_SEVERITY = 'CRITICAL';

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`telegramPusher: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertPush: db.prepare(`
        INSERT INTO ml_telegram_pushes
        (user_id, resolved_env, event_type, severity, message,
         payload_json, dedup_key, delivery_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `),
    findRecentDedup: db.prepare(`
        SELECT * FROM ml_telegram_pushes
        WHERE user_id = ? AND resolved_env = ?
          AND dedup_key = ?
          AND created_at >= ?
        ORDER BY created_at DESC LIMIT 1
    `),
    markDelivered: db.prepare(`
        UPDATE ml_telegram_pushes
        SET delivery_status = ?, delivered_at = ?
        WHERE id = ?
    `),
    listHistory: db.prepare(`
        SELECT * FROM ml_telegram_pushes
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── formatPushMessage (pure) ───────────────────────────────────────
function formatPushMessage(params) {
    const eventType = _required(params, 'eventType');
    const severity = _required(params, 'severity');
    const payload = (params && params.payload) ? params.payload : {};

    let prefix;
    switch (severity) {
        case 'CRITICAL': prefix = '🚨 CRITICAL 🚨'; break;
        case 'HIGH':     prefix = '⚠️ HIGH'; break;
        case 'MEDIUM':   prefix = 'ℹ️ MEDIUM'; break;
        case 'LOW':      prefix = '📋 LOW'; break;
        default:         prefix = severity;
    }

    let body = `${prefix} — ${eventType}`;
    if (Object.keys(payload).length > 0) {
        const details = Object.entries(payload)
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join(', ');
        body += `\n${details}`;
    }
    return body;
}

// ── shouldDedup ────────────────────────────────────────────────────
function shouldDedup(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const dedupKey = _required(params, 'dedupKey');
    const withinMs = (params && typeof params.withinMs === 'number')
        ? params.withinMs : DEFAULT_DEDUP_WINDOW_MS;

    const since = Date.now() - withinMs;
    const recent = _stmts.findRecentDedup.get(userId, env, dedupKey, since);
    return !!recent;
}

// ── enqueuePush ────────────────────────────────────────────────────
function enqueuePush(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const eventType = _required(params, 'eventType');
    const severity = _required(params, 'severity');
    const payload = _required(params, 'payload');
    const dedupKey = (params && params.dedupKey) ? params.dedupKey : null;
    const minSeverity = (params && params.minSeverity) ? params.minSeverity : DEFAULT_MIN_SEVERITY;

    // Severity filter
    if (SEVERITY_RANK[severity] < SEVERITY_RANK[minSeverity]) {
        return {
            queued: false,
            reason: `severity_below_threshold (${severity} < ${minSeverity})`
        };
    }

    // Dedup check
    if (dedupKey && shouldDedup({ userId, resolvedEnv: env, dedupKey })) {
        return {
            queued: false,
            reason: 'dedup_within_window'
        };
    }

    const message = formatPushMessage({ eventType, severity, payload });

    const result = _stmts.insertPush.run(
        userId, env, eventType, severity, message,
        JSON.stringify(payload),
        dedupKey,
        Date.now()
    );

    return {
        queued: true,
        pushId: result.lastInsertRowid,
        message
    };
}

// ── markDelivered ──────────────────────────────────────────────────
function markDelivered(params) {
    const pushId = _required(params, 'pushId');
    const deliveryStatus = _required(params, 'deliveryStatus');

    if (!DELIVERY_STATUS.includes(deliveryStatus)) {
        throw new Error(`telegramPusher: invalid deliveryStatus "${deliveryStatus}"`);
    }

    _stmts.markDelivered.run(deliveryStatus, Date.now(), pushId);
    return { updated: true };
}

// ── getPushHistory ─────────────────────────────────────────────────
function getPushHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listHistory.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );

    return rows.map(r => ({
        id: r.id,
        eventType: r.event_type,
        severity: r.severity,
        message: r.message,
        payload: JSON.parse(r.payload_json),
        dedupKey: r.dedup_key,
        deliveryStatus: r.delivery_status,
        createdAt: r.created_at,
        deliveredAt: r.delivered_at
    }));
}

module.exports = {
    SEVERITY_LEVELS,
    SEVERITY_RANK,
    DELIVERY_STATUS,
    DEFAULT_DEDUP_WINDOW_MS,
    DEFAULT_MIN_SEVERITY,
    enqueuePush,
    shouldDedup,
    formatPushMessage,
    markDelivered,
    getPushHistory
};
