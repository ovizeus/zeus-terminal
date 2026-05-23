'use strict';

/**
 * parityShadowLogger — Cross-exchange divergence tracking for brain decisions.
 *
 * Per brain cycle, after user's active exchange decision is made, compute what
 * the OTHER exchange would have produced. Log divergence to dsl_parity_log.
 *
 * Activated at Phase 1A ship (per spec pillar 25). Shadow logging is always-on
 * even when BYBIT_DRY_RUN_ONLY=true. It reads serverState from both namespaces
 * to detect regime/signal divergence without executing orders.
 *
 * Separate from existing bybitParityShadow.js (which handles real-time
 * shadow mode activation / dry-run request building). This module is the
 * brain cycle divergence tracker (Tasks 51-53).
 */

const { db } = require('./database');
const serverState = require('./serverState');

/**
 * Task 51 — Insert one divergence record per brain cycle.
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.symbol
 * @param {string} params.exchange        active exchange (e.g. 'binance')
 * @param {string} params.shadowExchange  shadow exchange (e.g. 'bybit')
 * @param {number} params.cycleNo
 * @param {string} params.decision        actual brain decision on active exchange
 * @param {string} params.shadowSignal    what shadow exchange would have produced
 * @param {boolean} params.diverged       true if decision !== shadowSignal
 * @param {object} [params.details]       optional extra context
 */
function logDivergence({ userId, symbol, exchange, shadowExchange, cycleNo, decision, shadowSignal, diverged, details }) {
    try {
        db.prepare(
            `INSERT INTO dsl_parity_log (user_id, symbol, exchange, cycle_no, decision, shadow_signal, diverged, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(userId, symbol, exchange, cycleNo, decision, shadowSignal, diverged ? 1 : 0, JSON.stringify(details || {}));
    } catch (_) {}
}

/**
 * Read-only shadow snapshot from the OTHER exchange via serverState.forExchange.
 * No orders are placed. Used to compute what the shadow exchange would signal.
 *
 * @param {string} symbol
 * @param {string} shadowExchange
 * @returns {{ available: boolean, price?: number, regime?: string|null, exchange?: string, reason?: string }}
 */
function computeShadowSignal(symbol, shadowExchange) {
    const shadowState = serverState.forExchange(shadowExchange);
    const snap = shadowState.getSnapshotForSymbol(symbol);
    if (!snap || !snap.price || snap.price <= 0) return { available: false, reason: 'no_data' };
    return {
        available: true,
        price: snap.price,
        regime: snap.regime || null,
        exchange: shadowExchange,
    };
}

/**
 * Task 52 — Daily aggregation: compute parity % for a given user + date.
 *
 * @param {number} userId
 * @param {string} date   'YYYY-MM-DD'
 * @returns {{ total: number, matched: number, parityPct: number }}
 */
function getDailyParity(userId, date) {
    const rows = db.prepare(
        `SELECT COUNT(*) as total, SUM(CASE WHEN diverged=0 THEN 1 ELSE 0 END) as matched
         FROM dsl_parity_log WHERE user_id=? AND created_at LIKE ?`
    ).get(userId, date + '%');
    if (!rows || rows.total === 0) return { total: 0, matched: 0, parityPct: 100 };
    return {
        total: rows.total,
        matched: rows.matched,
        parityPct: Math.round((rows.matched / rows.total) * 100),
    };
}

/**
 * Task 53 — Alert threshold: fire PARITY_ALERT_LOW to audit_log when daily
 * parity drops below 80% (requires at least 10 samples to avoid noise).
 *
 * @param {number} userId
 * @returns {{ alert: boolean, parity: { total: number, matched: number, parityPct: number } }}
 */
function checkParityAlert(userId) {
    const today = new Date().toISOString().slice(0, 10);
    const parity = getDailyParity(userId, today);
    if (parity.total >= 10 && parity.parityPct < 80) {
        try {
            db.prepare(
                `INSERT INTO audit_log (user_id, action, details) VALUES (?, 'PARITY_ALERT_LOW', ?)`
            ).run(userId, JSON.stringify(parity));
            require('./logger').warn('PARITY', `user ${userId} parity ${parity.parityPct}% (${parity.matched}/${parity.total}) — below 80% threshold`);
        } catch (_) {}
        return { alert: true, parity };
    }
    return { alert: false, parity };
}

module.exports = { logDivergence, computeShadowSignal, getDailyParity, checkParityAlert };
