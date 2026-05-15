'use strict';

/**
 * OMEGA R3A Safety — blackSwanAbstention (§248* Claude-extras)
 *
 * §248* BLACK SWAN ABSTENTION (R3A + R3B) — regime-level OOD detection
 * (flash crash, structural break) → abstain from new trading.
 * Source: project_ml_brain_pro_244.md "248*".
 * Claude-extras approved 2026-04-29, NOT in canonical PDF.
 *
 * Why: spec-level §69 OOD gate detects per-feature anomalies. §248*
 * catches REGIME-LEVEL breakdown — the whole market structure misbehaves
 * (flash crash, exchange halt, structural shift). When this hits, trading
 * stops regardless of bandit confidence.
 *
 * 5 detection signals (any threshold breach counts as 1 triggered condition):
 *   1. volatility_spike  — current ATR / baseline > 5.0x
 *   2. liquidity_drop    — orderbook depth drop > 80%
 *   3. price_gap         — single-bar move > 5%
 *   4. correlation_break — cross-asset corr delta from historical > 0.5
 *   5. funding_extreme   — |funding_rate| > 10%
 *
 * Severity = count of triggered conditions:
 *   1   → MINOR     (1h cooldown, auto-clear on expire)
 *   2   → MAJOR     (24h cooldown, auto-clear on expire)
 *   3+  → CRITICAL  (168h / 7d cooldown, MUST be cleared by operator)
 *
 * Operator-clear invariant: actor must start with "operator" to clear
 * a CRITICAL event. Auto-clear allowed only for MINOR/MAJOR.
 */

const { db } = require('../../database');

const THRESHOLDS = Object.freeze({
    volatility_spike_ratio: 5.0,
    liquidity_drop_pct: 0.80,
    price_gap_pct: 5.0,
    correlation_breakdown: 0.5,
    funding_extreme: 0.10
});

const SEVERITY_LEVELS = Object.freeze(['NONE', 'MINOR', 'MAJOR', 'CRITICAL']);
const ABSTENTION_STATES = Object.freeze(['ACTIVE', 'CLEARED', 'EXPIRED']);

const COOLDOWN_HOURS = Object.freeze({
    MINOR: 1,
    MAJOR: 24,
    CRITICAL: 168
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`blackSwanAbstention: missing ${key}`);
    }
    return params[key];
}

function _severityForTriggerCount(count) {
    if (count === 0) return 'NONE';
    if (count === 1) return 'MINOR';
    if (count === 2) return 'MAJOR';
    return 'CRITICAL';
}

function _actionForSeverity(severity) {
    switch (severity) {
        case 'MINOR': return 'abstain new positions, 1h cooldown';
        case 'MAJOR': return 'abstain new positions + close risky open, 24h cooldown';
        case 'CRITICAL': return 'full abstention + close all + alert operator, 7d cooldown (manual clear)';
        default: return 'none — no abstention needed';
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertEvent: db.prepare(`
        INSERT INTO ml_black_swan_events
        (user_id, resolved_env, symbol, severity, signals_json, triggers_json,
         abstention_state, cooldown_until, actor, detected_at)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
    `),
    getActive: db.prepare(`
        SELECT * FROM ml_black_swan_events
        WHERE user_id = ? AND resolved_env = ?
          AND abstention_state = 'ACTIVE'
        ORDER BY detected_at DESC
        LIMIT 1
    `),
    getById: db.prepare(`SELECT * FROM ml_black_swan_events WHERE id = ?`),
    clearEvent: db.prepare(`
        UPDATE ml_black_swan_events
        SET abstention_state = 'CLEARED', cleared_at = ?, cleared_by = ?,
            clear_reason = ?
        WHERE id = ? AND abstention_state = 'ACTIVE'
    `)
};

// ── evaluateBlackSwan ──────────────────────────────────────────────
function evaluateBlackSwan(params) {
    const signals = _required(params, 'signals');
    const triggers = [];

    if (typeof signals.volatility_ratio === 'number' &&
        signals.volatility_ratio > THRESHOLDS.volatility_spike_ratio) {
        triggers.push('volatility_spike');
    }
    if (typeof signals.liquidity_drop === 'number' &&
        signals.liquidity_drop > THRESHOLDS.liquidity_drop_pct) {
        triggers.push('liquidity_drop');
    }
    if (typeof signals.price_gap_pct === 'number' &&
        Math.abs(signals.price_gap_pct) > THRESHOLDS.price_gap_pct) {
        triggers.push('price_gap');
    }
    if (typeof signals.correlation_delta === 'number' &&
        Math.abs(signals.correlation_delta) > THRESHOLDS.correlation_breakdown) {
        triggers.push('correlation_break');
    }
    if (typeof signals.funding_rate === 'number' &&
        Math.abs(signals.funding_rate) > THRESHOLDS.funding_extreme) {
        triggers.push('funding_extreme');
    }

    const severity = _severityForTriggerCount(triggers.length);
    return {
        severity,
        triggered_conditions: triggers,
        recommended_action: _actionForSeverity(severity),
        reason: triggers.length === 0
            ? 'no conditions breached thresholds'
            : `${triggers.length} condition(s) triggered: ${triggers.join(', ')}`
    };
}

// ── recordEvent ────────────────────────────────────────────────────
function recordEvent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const symbol = _required(params, 'symbol');
    const signals = _required(params, 'signals');
    const severity = _required(params, 'severity');
    const triggers = _required(params, 'triggers');
    const actor = _required(params, 'actor');

    if (severity === 'NONE' || !COOLDOWN_HOURS[severity]) {
        throw new Error(`recordEvent: invalid severity "${severity}" (expected MINOR/MAJOR/CRITICAL)`);
    }
    if (!Array.isArray(triggers)) {
        throw new Error('recordEvent: triggers must be array');
    }

    const now = Date.now();
    const cooldownUntil = now + COOLDOWN_HOURS[severity] * 3600 * 1000;
    const result = _stmts.insertEvent.run(
        userId, env, symbol, severity,
        JSON.stringify(signals),
        JSON.stringify(triggers),
        cooldownUntil, actor, now
    );
    return { eventId: result.lastInsertRowid, cooldownUntil };
}

// ── isAbstaining ───────────────────────────────────────────────────
function isAbstaining(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const active = _stmts.getActive.get(userId, env);
    if (!active) return false;
    return Date.now() < active.cooldown_until;
}

// ── getActiveEvent ─────────────────────────────────────────────────
function getActiveEvent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    return _stmts.getActive.get(userId, env) || null;
}

// ── clearAbstention ────────────────────────────────────────────────
function clearAbstention(params) {
    const eventId = _required(params, 'eventId');
    const actor = _required(params, 'actor');
    const reason = _required(params, 'reason');

    const row = _stmts.getById.get(eventId);
    if (!row) {
        throw new Error(`clearAbstention: event ${eventId} not found`);
    }
    if (row.abstention_state !== 'ACTIVE') {
        throw new Error(`clearAbstention: event ${eventId} already in state ${row.abstention_state}`);
    }

    // CRITICAL events: actor must be operator (prefix 'operator')
    if (row.severity === 'CRITICAL') {
        if (!actor || !actor.toLowerCase().startsWith('operator')) {
            throw new Error(`clearAbstention: CRITICAL event requires operator manual clear (actor "${actor}" not allowed)`);
        }
    }

    _stmts.clearEvent.run(Date.now(), actor, reason, eventId);
    return _stmts.getById.get(eventId);
}

module.exports = {
    THRESHOLDS,
    SEVERITY_LEVELS,
    COOLDOWN_HOURS,
    ABSTENTION_STATES,
    evaluateBlackSwan,
    recordEvent,
    isAbstaining,
    getActiveEvent,
    clearAbstention
};
