'use strict';

/**
 * OMEGA R2 Cognition — spoofingDetector (audit-gap DOM-N1)
 *
 * DOM-N1 SPOOFING / FAKE-WALL DETECTOR EXPLICIT.
 * Source: audit 2026-05-05 (project_ml_v3_additional_gaps_audit_2026-05-05.md)
 * Priority: P2 (R2 cognition).
 *
 * Detect manipulative order book patterns:
 *   - Spoofing: large orders placed and quickly canceled to manipulate perception
 *   - Fake walls: large orders that disappear when price approaches
 *   - Layering: multiple fake orders at different levels to create illusion of support/resistance
 *
 * Per-symbol frequency tracking helps regime classifier identify
 * manipulated markets vs organic price discovery.
 */

const { db } = require('../../database');

const SPOOFING_EVENT_TYPES = Object.freeze([
    'suspected_spoof',
    'fake_wall_detected',
    'pulled_orders',
    'layering_pattern'
]);

const DEFAULT_DETECTION_PARAMS = Object.freeze({
    min_suspect_size_usd:        100000,    // Min order size to suspect spoofing
    cancel_velocity_threshold_ms: 1000,     // Cancel within 1s = suspicious
    fake_wall_disappear_pct:     0.7,       // 70% disappearance = fake wall
    layering_min_levels:         3          // 3+ fake levels = layering
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`spoofingDetector: missing ${key}`);
    }
    return params[key];
}

function _clampUnit(x) {
    return Math.max(0, Math.min(1, x));
}

// ── detectSpoofing (pure) ──────────────────────────────────────────
function detectSpoofing(params) {
    const events = (params && Array.isArray(params.orderBookEvents))
        ? params.orderBookEvents : [];
    const detectionParams = (params && params.detectionParams)
        ? params.detectionParams : DEFAULT_DETECTION_PARAMS;

    if (events.length < 2) {
        return { detected: false, severity: 0, suspectedOrders: [] };
    }

    const suspectedOrders = [];
    const placesByLevel = new Map();

    for (const event of events) {
        if (event.type === 'place') {
            placesByLevel.set(`${event.level}:${event.size}`, event);
        } else if (event.type === 'cancel') {
            const key = `${event.level}:${event.size}`;
            const placeEvent = placesByLevel.get(key);
            if (placeEvent) {
                const dwellMs = event.ts - placeEvent.ts;
                if (dwellMs < detectionParams.cancel_velocity_threshold_ms
                    && event.size >= detectionParams.min_suspect_size_usd) {
                    suspectedOrders.push({
                        level: event.level,
                        size: event.size,
                        dwellMs
                    });
                }
                placesByLevel.delete(key);
            }
        }
    }

    const detected = suspectedOrders.length > 0;
    // Severity scales with: count of suspicious orders + avg size
    let severity = 0;
    if (detected) {
        const countFactor = _clampUnit(suspectedOrders.length / 5);
        const avgSize = suspectedOrders.reduce((s, o) => s + o.size, 0) / suspectedOrders.length;
        const sizeFactor = _clampUnit(avgSize / 1000000);
        severity = _clampUnit(countFactor * 0.6 + sizeFactor * 0.4);
    }

    return { detected, severity, suspectedOrders };
}

// ── detectFakeWall (pure) ──────────────────────────────────────────
function detectFakeWall(params) {
    const orderBook = (params && params.orderBook) ? params.orderBook : {};
    const priceMovement = (params && params.priceMovement) ? params.priceMovement : {};
    const detectionParams = (params && params.detectionParams)
        ? params.detectionParams : DEFAULT_DETECTION_PARAMS;

    void orderBook;

    const priorSize = priceMovement.priorWallSize || 0;
    const currentSize = priceMovement.currentWallSize || 0;
    const direction = priceMovement.priceDirection || 'NEUTRAL';

    if (priorSize === 0) {
        return { detected: false };
    }

    const disappearedPct = (priorSize - currentSize) / priorSize;

    // Fake wall ONLY when wall disappears AND price moving TOWARD it
    if (disappearedPct >= detectionParams.fake_wall_disappear_pct
        && direction === 'TOWARD_WALL') {
        return {
            detected: true,
            wallSize: priorSize,
            disappearedPct,
            currentRemaining: currentSize
        };
    }

    return { detected: false, disappearedPct };
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertEvent: db.prepare(`
        INSERT INTO ml_spoofing_events
        (user_id, resolved_env, event_type, symbol, severity, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    listHistory: db.prepare(`
        SELECT * FROM ml_spoofing_events
        WHERE user_id = ? AND resolved_env = ?
          AND (? IS NULL OR symbol = ?)
          AND created_at >= ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `),
    countByType: db.prepare(`
        SELECT event_type, COUNT(*) AS count FROM ml_spoofing_events
        WHERE user_id = ? AND resolved_env = ?
          AND (? IS NULL OR symbol = ?)
          AND created_at >= ?
        GROUP BY event_type
    `)
};

// ── recordSpoofingEvent ────────────────────────────────────────────
function recordSpoofingEvent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const eventType = _required(params, 'eventType');
    const payload = _required(params, 'payload');
    const symbol = (params && params.symbol) ? params.symbol : null;
    const severity = (params && typeof params.severity === 'number') ? params.severity : 0;

    if (!SPOOFING_EVENT_TYPES.includes(eventType)) {
        throw new Error(`spoofingDetector: invalid eventType "${eventType}"`);
    }

    _stmts.insertEvent.run(
        userId, env, eventType, symbol, severity,
        JSON.stringify(payload), Date.now()
    );

    return { recorded: true };
}

// ── getSpoofingHistory ─────────────────────────────────────────────
function getSpoofingHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const symbol = (params && params.symbol) ? params.symbol : null;
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listHistory.all(
        userId, env, symbol, symbol, since, limit
    );

    return rows.map(r => ({
        id: r.id,
        eventType: r.event_type,
        symbol: r.symbol,
        severity: r.severity,
        payload: JSON.parse(r.payload_json),
        createdAt: r.created_at
    }));
}

// ── getSpoofingFrequency ───────────────────────────────────────────
function getSpoofingFrequency(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const symbol = (params && params.symbol) ? params.symbol : null;
    const since = (params && params.since) ? params.since : 0;

    const rows = _stmts.countByType.all(
        userId, env, symbol, symbol, since
    );

    const byType = {};
    let total = 0;
    for (const row of rows) {
        byType[row.event_type] = row.count;
        total += row.count;
    }

    return { total, byType, symbol };
}

module.exports = {
    SPOOFING_EVENT_TYPES,
    DEFAULT_DETECTION_PARAMS,
    detectSpoofing,
    detectFakeWall,
    recordSpoofingEvent,
    getSpoofingHistory,
    getSpoofingFrequency
};
