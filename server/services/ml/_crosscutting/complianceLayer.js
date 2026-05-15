'use strict';

/**
 * OMEGA cross-cutting — complianceLayer (canonical §66)
 *
 * §66 REGULATORY / COMPLIANCE LAYER — propriul comportament trebuie sa fie legal.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1741-1742.
 *
 * "Pe masura ce botul devine mai sofisticat, mai activ si eventual mai mare
 *  ca volum, acesta devine relevant. Exact ceea ce un regulator ar cere
 *  daca vreodata activitatea e investigata."
 *
 * Self-pattern detection (NOT market detection — those are in §31 smartMoney):
 *   - quote stuffing (rapid place/cancel ratio)
 *   - wash trading (self-fill LONG+SHORT same symbol fast)
 *   - event-sync manipulation (orders too close to events)
 *   - excessive cancel rate
 *
 * + per-decision economic justification audit (regulator-ready).
 */

const { db } = require('../../database');

const VIOLATION_TYPES = Object.freeze([
    'quote_stuff', 'wash_trade', 'event_sync', 'cancel_rate', 'other'
]);
const SEVERITY_LEVELS = Object.freeze(['info', 'warn', 'critical']);

const QUOTE_STUFF_CANCEL_RATIO_THRESHOLD = 0.80;
const QUOTE_STUFF_WINDOW_MS = 60000;
const EVENT_SYNC_THRESHOLD_MS = 500;
const WASH_TRADE_WINDOW_MS = 30000;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`complianceLayer: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertViolation: db.prepare(`
        INSERT INTO ml_compliance_violations
        (user_id, resolved_env, violation_type, severity,
         context_json, action_taken, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    statsForUser: db.prepare(`
        SELECT violation_type, severity, COUNT(*) AS count
        FROM ml_compliance_violations
        WHERE user_id = ? AND resolved_env = ?
          AND ts >= ?
        GROUP BY violation_type, severity
    `),
    insertJustification: db.prepare(`
        INSERT INTO ml_economic_justifications
        (user_id, resolved_env, decision_id, action_type,
         justification_text, supporting_signals_json,
         expected_economic_outcome, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getJustification: db.prepare(`
        SELECT * FROM ml_economic_justifications
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts DESC, id DESC
        LIMIT 1
    `)
};

// ── checkQuoteStuffing ─────────────────────────────────────────────
function checkQuoteStuffing(params) {
    const orderHistory = _required(params, 'orderHistory');
    const windowMs = (params && params.windowMs) ? params.windowMs : QUOTE_STUFF_WINDOW_MS;
    const now = (params && params.now) ? params.now : Date.now();

    if (!Array.isArray(orderHistory)) {
        throw new Error('complianceLayer: orderHistory must be array');
    }

    const inWindow = orderHistory.filter(o => o.ts >= now - windowMs);
    if (inWindow.length === 0) {
        return { violation: false, samples: 0 };
    }

    const cancels = inWindow.filter(o => o.action === 'cancel').length;
    const cancelRatio = cancels / inWindow.length;
    const violation = cancelRatio >= QUOTE_STUFF_CANCEL_RATIO_THRESHOLD && inWindow.length >= 5;

    return {
        violation,
        cancelRatio,
        samples: inWindow.length,
        cancelsCount: cancels,
        severity: violation ? (cancelRatio > 0.95 ? 'critical' : 'warn') : null
    };
}

// ── checkWashTrading ───────────────────────────────────────────────
function checkWashTrading(params) {
    const orderHistory = _required(params, 'orderHistory');
    const windowMs = (params && params.windowMs) ? params.windowMs : WASH_TRADE_WINDOW_MS;
    const now = (params && params.now) ? params.now : Date.now();

    if (!Array.isArray(orderHistory)) {
        throw new Error('complianceLayer: orderHistory must be array');
    }

    const inWindow = orderHistory.filter(
        o => o.ts >= now - windowMs && o.action === 'place'
    );

    // Group by symbol
    const bySymbol = {};
    for (const o of inWindow) {
        if (!bySymbol[o.symbol]) bySymbol[o.symbol] = [];
        bySymbol[o.symbol].push(o);
    }

    const flaggedSymbols = [];
    for (const sym of Object.keys(bySymbol)) {
        const longs = bySymbol[sym].filter(o => o.side === 'LONG');
        const shorts = bySymbol[sym].filter(o => o.side === 'SHORT');
        if (longs.length > 0 && shorts.length > 0) {
            // Check if same size pairs exist
            for (const l of longs) {
                for (const s of shorts) {
                    if (Math.abs(l.size - s.size) < 0.001) {
                        flaggedSymbols.push({
                            symbol: sym,
                            size: l.size,
                            longTs: l.ts,
                            shortTs: s.ts
                        });
                        break;
                    }
                }
            }
        }
    }

    return {
        violation: flaggedSymbols.length > 0,
        flaggedSymbols,
        severity: flaggedSymbols.length > 0 ? 'critical' : null
    };
}

// ── checkEventSyncManipulation ─────────────────────────────────────
function checkEventSyncManipulation(params) {
    const orderTs = _required(params, 'orderTs');
    const eventTs = _required(params, 'eventTs');
    const threshold = (params && params.threshold) ? params.threshold : EVENT_SYNC_THRESHOLD_MS;

    const deltaMs = Math.abs(orderTs - eventTs);
    const violation = deltaMs <= threshold;
    return {
        violation,
        deltaMs,
        severity: violation ? 'warn' : null
    };
}

// ── logEconomicJustification ───────────────────────────────────────
function logEconomicJustification(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const actionType = _required(params, 'actionType');
    const justification = _required(params, 'justification');
    const supportingSignals = (params && params.supportingSignals) ? params.supportingSignals : null;
    const expectedOutcome = (params && params.expectedOutcome) ? params.expectedOutcome : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    _stmts.insertJustification.run(
        userId, env, decisionId, actionType,
        justification,
        supportingSignals ? JSON.stringify(supportingSignals) : null,
        expectedOutcome, ts
    );

    return { logged: true };
}

// ── getJustificationForDecision ────────────────────────────────────
function getJustificationForDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const row = _stmts.getJustification.get(userId, env, decisionId);
    if (!row) return null;
    return {
        decisionId: row.decision_id,
        actionType: row.action_type,
        justification: row.justification_text,
        supportingSignals: row.supporting_signals_json
            ? JSON.parse(row.supporting_signals_json) : null,
        expectedOutcome: row.expected_economic_outcome,
        ts: row.ts
    };
}

// ── recordViolation ────────────────────────────────────────────────
function recordViolation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const violationType = _required(params, 'violationType');
    const severity = _required(params, 'severity');
    const context = (params && params.context) ? params.context : null;
    const actionTaken = (params && params.actionTaken) ? params.actionTaken : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!VIOLATION_TYPES.includes(violationType)) {
        throw new Error(`complianceLayer: invalid violationType "${violationType}"`);
    }
    if (!SEVERITY_LEVELS.includes(severity)) {
        throw new Error(`complianceLayer: invalid severity "${severity}"`);
    }

    _stmts.insertViolation.run(
        userId, env, violationType, severity,
        context ? JSON.stringify(context) : null,
        actionTaken, ts
    );

    return { recorded: true };
}

// ── getComplianceStats ─────────────────────────────────────────────
function getComplianceStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.statsForUser.all(userId, env, since);
    return {
        byTypeAndSeverity: rows.map(r => ({
            violationType: r.violation_type,
            severity: r.severity,
            count: r.count
        })),
        total: rows.reduce((s, r) => s + r.count, 0)
    };
}

module.exports = {
    VIOLATION_TYPES,
    SEVERITY_LEVELS,
    QUOTE_STUFF_CANCEL_RATIO_THRESHOLD,
    QUOTE_STUFF_WINDOW_MS,
    EVENT_SYNC_THRESHOLD_MS,
    WASH_TRADE_WINDOW_MS,
    checkQuoteStuffing,
    checkWashTrading,
    checkEventSyncManipulation,
    logEconomicJustification,
    getJustificationForDecision,
    recordViolation,
    getComplianceStats
};
