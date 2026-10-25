'use strict';
// ══════════════════════════════════════════════════════════════════
// brain_decisions.final_action — the names, and what each one means
// ══════════════════════════════════════════════════════════════════
//
// [G-5 2026-10-25] Written because retention asked a string whether a decision
// had been blocked:
//
//     DELETE FROM brain_decisions WHERE final_action LIKE 'blocked_%' AND ts < ?
//
// `entry_blocked` means exactly what the name says — autotrade rejected the
// entry, serverBrain.js:1655 — but it does not START with 'blocked_', so the
// 90-day rule never saw it. 128,744 rows, oldest 152 days on a 90-day rule.
//
// A prefix is not a classification. This file is the classification: one list,
// shared, with tests/unit/brain-actions-retention.test.js failing if a new
// action name is written without being placed in a class. That is the fix on
// the class, not on the instance (R-C-22).
//
// NOTE — the server decides "was this a block?" in two OTHER places as well,
// both in brainLogger.js (no-trade sampling at :79, ML event label at :125),
// both still using startsWith('blocked_'), both therefore treating
// entry_blocked as a trade. Measured consequence: 179,452 of the 181,135 rows
// labelled 'TRADE' for ML are not trades (99.07%). That is a change to what ML
// trains on, so it is NOT made here — it is G-6, the operator's decision.
// Do not "tidy" those two call sites into this module without reading G-6.

// A decision that never became a trade and, by construction, cannot carry a
// linked_seq. Telemetry under R-C-21 → retention 90 days.
const BLOCKED_ACTIONS = Object.freeze([
    'blocked_gates',
    'blocked_reflection',
    'blocked_reflection_penalty',
    'blocked_correlation',
    'blocked_correlation_penalty',
    'blocked_session',
    'blocked_drawdown',
    'entry_blocked',
]);

// These CAN carry a linked_seq: the row is trade history. R-C-21 — never
// deleted while linked, whatever its age.
const HISTORY_ACTIONS = Object.freeze([
    'entry',
    'pending_fill',
    'pending_momentum',
]);

// Lifecycle telemetry with no trade attached. 'no_trade' is pruned at 30 days
// by its tier, not by its name. The pending_* states and 'unknown' have NO
// retention rule today — 77,688 rows, measured, reported as G-7; they are
// listed here so they are classified rather than invisible.
const TELEMETRY_ACTIONS = Object.freeze([
    'no_trade',
    'pending_created',
    'pending_expire',
    'pending_cancel',
    'unknown',
]);

const ALL_ACTIONS = Object.freeze([...BLOCKED_ACTIONS, ...HISTORY_ACTIONS, ...TELEMETRY_ACTIONS]);

function isBlocked(action) { return BLOCKED_ACTIONS.includes(String(action)); }
function isHistory(action) { return HISTORY_ACTIONS.includes(String(action)); }

// 'blocked' | 'history' | 'telemetry' | null — null means a name nobody classified.
function classify(action) {
    const a = String(action);
    if (BLOCKED_ACTIONS.includes(a)) return 'blocked';
    if (HISTORY_ACTIONS.includes(a)) return 'history';
    if (TELEMETRY_ACTIONS.includes(a)) return 'telemetry';
    return null;
}

module.exports = {
    BLOCKED_ACTIONS,
    HISTORY_ACTIONS,
    TELEMETRY_ACTIONS,
    ALL_ACTIONS,
    isBlocked,
    isHistory,
    classify,
};
