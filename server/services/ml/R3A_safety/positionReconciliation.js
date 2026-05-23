'use strict';

/**
 * OMEGA R3A Safety — positionReconciliation (canonical §28)
 *
 * §28 OPERATIONAL SAFETY SI POSITION RECONCILIATION.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1217-1231.
 *
 * Three operational safety primitives under one module:
 *
 *   1. reconcilePosition({userId, env, symbol, internal, exchange})
 *      — verifies internal state matches exchange. position_truth > model
 *      confidence. Severe divergence (side mismatch, missing position) →
 *      FLATTEN. SL/TP missing → LOCK. Small numerical drift → ALERT.
 *
 *   2. monitorLatency({userId, env, kind, valueMs})
 *      — checks order_ack / cancel / websocket_lag / clock_drift latencies
 *      against thresholds; emits ALERT when degraded.
 *
 *   3. checkRateLimit({userId, env, budgetTotal, used, priorityTier})
 *      — API request budget guard with priority bypass (CRITICAL always
 *      passes). NORMAL throttles above 90% used.
 *
 * Composability:
 *   - severe RECON action → §14 evaluateVetoSignals(reconciliation_failed)
 *   - LATENCY alert → §14 evaluateVetoSignals(api_latency_severe)
 */

const { db } = require('../../database');

const DIVERGENCE_TYPES = Object.freeze([
    'position_qty',
    'position_side',
    'position_missing',
    'sl_missing',
    'sl_mismatch',
    'tp_missing',
    'tp_mismatch',
    'order_phantom'
]);

const LATENCY_KINDS = Object.freeze([
    'order_ack',
    'cancel',
    'websocket_lag',
    'clock_drift'
]);

// Ordered ascending severity (OK → FLATTEN = nuclear).
const ACTION_LADDER = Object.freeze(['OK', 'ALERT', 'LOCK', 'FLATTEN']);

const DEFAULT_THRESHOLDS = Object.freeze({
    qty_tolerance_pct:    0.5,    // 0.5% qty drift tolerated
    price_tolerance_pct:  0.05,   // 0.05% price drift tolerated
    order_ack_ms:         500,    // 500ms ack threshold
    cancel_ms:            500,    // 500ms cancel threshold
    websocket_lag_ms:     2000,   // 2s ws lag threshold
    clock_drift_ms:       2000    // 2s clock drift threshold
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`positionReconciliation: missing ${key}`);
    }
    return params[key];
}

function _diffPct(a, b) {
    if (a === b) return 0;
    if (a === 0 && b === 0) return 0;
    const denom = Math.abs(a) > 1e-12 ? Math.abs(a) : Math.abs(b);
    if (denom === 0) return 0;
    return Math.abs(a - b) / denom * 100;
}

function _maxAction(actions) {
    let best = 'OK';
    let bestIdx = 0;
    for (const a of actions) {
        const idx = ACTION_LADDER.indexOf(a);
        if (idx > bestIdx) { bestIdx = idx; best = a; }
    }
    return best;
}

// ── Prepared statement ─────────────────────────────────────────────
const _stmts = {
    insertLog: db.prepare(`
        INSERT INTO ml_recon_log
        (user_id, resolved_env, check_type, subject,
         action, severity, divergences_json, details_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── reconcilePosition ──────────────────────────────────────────────
function reconcilePosition(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const symbol = _required(params, 'symbol');
    const internal = (params && params.internal !== undefined) ? params.internal : null;
    const exchange = (params && params.exchange !== undefined) ? params.exchange : null;
    const thresholds = (params && params.thresholds) ? params.thresholds : DEFAULT_THRESHOLDS;

    const divergences = [];
    const actions = [];

    // Both null: nothing to reconcile
    if (!internal && !exchange) {
        _logRow({ userId, env, checkType: 'RECON', subject: symbol,
                  action: 'OK', severity: 0, divergences: [], details: { matches: true } });
        return { matches: true, action: 'OK', divergences: [], severity: 0 };
    }

    // Internal has, exchange has none → position vanished (or never opened)
    if (internal && !exchange) {
        divergences.push('position_missing');
        actions.push('FLATTEN');
    }
    // Exchange has, internal has none → phantom order
    if (!internal && exchange) {
        divergences.push('order_phantom');
        actions.push('ALERT');
    }

    if (internal && exchange) {
        // qty drift
        const qtyDiff = _diffPct(internal.qty, exchange.qty);
        if (qtyDiff > thresholds.qty_tolerance_pct) {
            divergences.push('position_qty');
            actions.push('ALERT');
        }
        // side mismatch — critical
        if (internal.side && exchange.side && internal.side !== exchange.side) {
            divergences.push('position_side');
            actions.push('FLATTEN');
        }
        // SL checks
        if (internal.slPrice !== undefined && internal.slPrice !== null) {
            if (exchange.slPrice === null || exchange.slPrice === undefined) {
                divergences.push('sl_missing');
                actions.push('LOCK');
            } else {
                const slDiff = _diffPct(internal.slPrice, exchange.slPrice);
                if (slDiff > thresholds.price_tolerance_pct) {
                    divergences.push('sl_mismatch');
                    actions.push('ALERT');
                }
            }
        }
        // TP checks
        if (internal.tpPrice !== undefined && internal.tpPrice !== null) {
            if (exchange.tpPrice === null || exchange.tpPrice === undefined) {
                divergences.push('tp_missing');
                actions.push('ALERT');
            } else {
                const tpDiff = _diffPct(internal.tpPrice, exchange.tpPrice);
                if (tpDiff > thresholds.price_tolerance_pct) {
                    divergences.push('tp_mismatch');
                    actions.push('ALERT');
                }
            }
        }
    }

    const action = actions.length > 0 ? _maxAction(actions) : 'OK';
    const severity = ACTION_LADDER.indexOf(action);
    const matches = action === 'OK';

    _logRow({ userId, env, checkType: 'RECON', subject: symbol,
              action, severity, divergences,
              details: { matches, internal, exchange } });

    return { matches, action, divergences, severity };
}

// ── monitorLatency ─────────────────────────────────────────────────
function monitorLatency(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kind = _required(params, 'kind');
    const valueMs = _required(params, 'valueMs');
    const thresholds = (params && params.thresholds) ? params.thresholds : DEFAULT_THRESHOLDS;

    if (!LATENCY_KINDS.includes(kind)) {
        throw new Error(`monitorLatency: invalid kind "${kind}" (must be ${LATENCY_KINDS.join('|')})`);
    }

    const thresholdKey = {
        order_ack:     'order_ack_ms',
        cancel:        'cancel_ms',
        websocket_lag: 'websocket_lag_ms',
        clock_drift:   'clock_drift_ms'
    }[kind];

    const threshold = thresholds[thresholdKey] !== undefined
        ? thresholds[thresholdKey]
        : DEFAULT_THRESHOLDS[thresholdKey];

    const alert = valueMs > threshold;
    const severity = alert ? Math.min(3, Math.floor(valueMs / threshold)) : 0;
    const action = alert ? 'ALERT' : 'OK';

    _logRow({ userId, env, checkType: 'LATENCY', subject: kind,
              action, severity, divergences: [],
              details: { kind, valueMs, threshold } });

    return { alert, severity, kind, valueMs, threshold, action };
}

// ── checkRateLimit ─────────────────────────────────────────────────
function checkRateLimit(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const budgetTotal = _required(params, 'budgetTotal');
    const used = (params && typeof params.used === 'number') ? params.used : 0;
    const priorityTier = (params && params.priorityTier) ? params.priorityTier : 'NORMAL';

    const ratio = budgetTotal > 0 ? used / budgetTotal : 1;
    const remainingBudget = Math.max(0, budgetTotal - used);

    let shouldThrottle = false;
    let throttleMs = 0;
    let action = 'OK';
    let severity = 0;

    if (priorityTier === 'CRITICAL') {
        // Bypass throttle always
    } else if (ratio >= 1.0) {
        shouldThrottle = true;
        throttleMs = 2000;
        action = 'ALERT';
        severity = 1;
    } else if (ratio >= 0.9) {
        shouldThrottle = true;
        throttleMs = 500;
        action = 'ALERT';
        severity = 1;
    }

    _logRow({ userId, env, checkType: 'RATE_LIMIT', subject: priorityTier,
              action, severity, divergences: [],
              details: { budgetTotal, used, ratio, shouldThrottle, throttleMs } });

    return { shouldThrottle, throttleMs, remainingBudget, ratio, action };
}

// ── Internal logger ────────────────────────────────────────────────
function _logRow({ userId, env, checkType, subject, action, severity, divergences, details }) {
    _stmts.insertLog.run(
        userId, env, checkType, subject,
        action, severity,
        JSON.stringify(divergences || []),
        details ? JSON.stringify(details) : null,
        Date.now()
    );
}

module.exports = {
    DIVERGENCE_TYPES,
    LATENCY_KINDS,
    ACTION_LADDER,
    DEFAULT_THRESHOLDS,
    reconcilePosition,
    monitorLatency,
    checkRateLimit
};
