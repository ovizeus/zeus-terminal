'use strict';

/**
 * OMEGA R3A Safety — runtimeInvariantEngine (canonical §61)
 *
 * §61 RUNTIME INVARIANT ENGINE / FORMAL SAFETY ASSERTIONS.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1710-1732.
 *
 * "Adversarial testing incearca sa sparga sistemul.
 *  Invariant engine defineste exact ce inseamna 'spart'.
 *  Este gardul logic suprem care sta deasupra modulelor."
 *
 * Hard safety layer: formal invariants enforced at every action.
 * 6 built-in invariants per spec. Custom registry accepts more.
 * On violation → lock + alert + snapshot + forensic_log.
 *
 * Distinct from §44 adversarialSelfTester (attempts to break)
 * and §28 positionReconciliation (post-hoc mismatch detection).
 */

const { db } = require('../../database');

const SEVERITY_LEVELS = Object.freeze(['warn', 'critical']);
const ACTIONS = Object.freeze(['lock', 'alert', 'snapshot', 'forensic_log', 'noop']);

const BUILTIN_INVARIANTS = Object.freeze([
    'INV-001-no-orphan-position',
    'INV-002-size-under-cap',
    'INV-003-no-order-in-locked',
    'INV-004-no-unhedged-contradiction',
    'INV-005-valid-thesis-id',
    'INV-006-no-orphan-sl-tp'
]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`runtimeInvariantEngine: missing ${key}`);
    }
    return params[key];
}

// ── Built-in invariant predicates ──────────────────────────────────
const _builtinPredicates = {
    'INV-001-no-orphan-position': (state) => {
        // Every live position must have exchange_confirmed === true
        if (!state || !Array.isArray(state.positions)) return { passed: true };
        for (const pos of state.positions) {
            if (pos.status === 'live' && !pos.exchangeConfirmed) {
                return {
                    passed: false,
                    severity: 'critical',
                    detail: `position ${pos.id} live without exchange confirmation`
                };
            }
        }
        return { passed: true };
    },
    'INV-002-size-under-cap': (state) => {
        const cap = state && state.sizeCap ? state.sizeCap : Infinity;
        if (!state || !Array.isArray(state.positions)) return { passed: true };
        for (const pos of state.positions) {
            if ((pos.size || 0) > cap) {
                return {
                    passed: false,
                    severity: 'critical',
                    detail: `position ${pos.id} size ${pos.size} > cap ${cap}`
                };
            }
        }
        return { passed: true };
    },
    'INV-003-no-order-in-locked': (state) => {
        const blockedStates = ['LOCKED', 'OBSERVER'];
        if (!state || !state.action) return { passed: true };
        if (state.action.type === 'place_order' && blockedStates.includes(state.systemState)) {
            return {
                passed: false,
                severity: 'critical',
                detail: `new order in ${state.systemState} state forbidden`
            };
        }
        return { passed: true };
    },
    'INV-004-no-unhedged-contradiction': (state) => {
        if (!state || !Array.isArray(state.positions)) return { passed: true };
        const bySymbol = {};
        for (const pos of state.positions) {
            if (!bySymbol[pos.symbol]) bySymbol[pos.symbol] = { LONG: 0, SHORT: 0 };
            bySymbol[pos.symbol][pos.side] = (bySymbol[pos.symbol][pos.side] || 0) + 1;
        }
        for (const sym of Object.keys(bySymbol)) {
            const hasLong = bySymbol[sym].LONG > 0;
            const hasShort = bySymbol[sym].SHORT > 0;
            if (hasLong && hasShort) {
                const positionsOnSym = state.positions.filter(p => p.symbol === sym);
                const allHedged = positionsOnSym.every(p => p.hedgeFlag === true);
                if (!allHedged) {
                    return {
                        passed: false,
                        severity: 'critical',
                        detail: `${sym} has LONG+SHORT without hedge flag`
                    };
                }
            }
        }
        return { passed: true };
    },
    'INV-005-valid-thesis-id': (state) => {
        if (!state || !Array.isArray(state.positions)) return { passed: true };
        for (const pos of state.positions) {
            if (pos.status === 'live' && (!pos.thesisId || pos.thesisId === '')) {
                return {
                    passed: false,
                    severity: 'warn',
                    detail: `position ${pos.id} has empty thesis_id`
                };
            }
        }
        return { passed: true };
    },
    'INV-006-no-orphan-sl-tp': (state) => {
        // After exit, no SL/TP order may reference exit position.
        if (!state || !Array.isArray(state.openOrders) || !Array.isArray(state.positions)) {
            return { passed: true };
        }
        const closedIds = new Set(
            state.positions.filter(p => p.status === 'closed').map(p => p.id)
        );
        for (const ord of state.openOrders) {
            if (closedIds.has(ord.positionId) && (ord.type === 'SL' || ord.type === 'TP')) {
                return {
                    passed: false,
                    severity: 'critical',
                    detail: `${ord.type} order ${ord.id} references closed position ${ord.positionId}`
                };
            }
        }
        return { passed: true };
    }
};

// ── Custom predicate registry ──────────────────────────────────────
const _customPredicates = new Map();

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertViolation: db.prepare(`
        INSERT INTO ml_invariant_violations
        (user_id, resolved_env, invariant_id, severity,
         context_json, snapshot_id, action_taken, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    historyForUser: db.prepare(`
        SELECT * FROM ml_invariant_violations
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR ts >= ?)
          AND (? = '' OR severity = ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── registerInvariant ──────────────────────────────────────────────
function registerInvariant(params) {
    const id = _required(params, 'id');
    const name = _required(params, 'name');
    const predicate = _required(params, 'predicate');

    if (typeof predicate !== 'function') {
        throw new Error('runtimeInvariantEngine: predicate must be function');
    }
    if (BUILTIN_INVARIANTS.includes(id)) {
        throw new Error(`runtimeInvariantEngine: cannot override builtin ${id}`);
    }

    _customPredicates.set(id, { name, predicate });
    return { registered: true, id };
}

// ── checkInvariant ─────────────────────────────────────────────────
function checkInvariant(params) {
    const id = _required(params, 'id');
    const state = _required(params, 'state');

    let predicate;
    if (_builtinPredicates[id]) {
        predicate = _builtinPredicates[id];
    } else if (_customPredicates.has(id)) {
        predicate = _customPredicates.get(id).predicate;
    } else {
        throw new Error(`runtimeInvariantEngine: unknown invariant "${id}"`);
    }

    const result = predicate(state);
    return {
        invariantId: id,
        passed: result.passed,
        severity: result.passed ? null : (result.severity || 'critical'),
        detail: result.passed ? null : (result.detail || 'invariant violated')
    };
}

// ── checkAllInvariants ─────────────────────────────────────────────
function checkAllInvariants(params) {
    const state = _required(params, 'state');
    const scope = (params && params.scope) ? params.scope : 'all';

    const idsToCheck = [];
    if (scope === 'all' || scope === 'builtin') {
        idsToCheck.push(...BUILTIN_INVARIANTS);
    }
    if (scope === 'all' || scope === 'custom') {
        idsToCheck.push(...Array.from(_customPredicates.keys()));
    }

    const results = idsToCheck.map(id => checkInvariant({ id, state }));
    const failures = results.filter(r => !r.passed);
    return {
        allPassed: failures.length === 0,
        totalChecked: results.length,
        failures,
        results
    };
}

// ── verifyBeforeAction ─────────────────────────────────────────────
function verifyBeforeAction(params) {
    const action = _required(params, 'action');
    const state = _required(params, 'state');
    const stateWithAction = Object.assign({}, state, { action });
    return checkAllInvariants({ state: stateWithAction });
}

// ── verifyAfterAction ──────────────────────────────────────────────
function verifyAfterAction(params) {
    const postState = _required(params, 'postState');
    return checkAllInvariants({ state: postState });
}

// ── recordViolation ────────────────────────────────────────────────
function recordViolation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const invariantId = _required(params, 'invariantId');
    const severity = _required(params, 'severity');
    const actionTaken = _required(params, 'actionTaken');
    const context = (params && params.context) ? params.context : null;
    const snapshotId = (params && params.snapshotId) ? params.snapshotId : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!SEVERITY_LEVELS.includes(severity)) {
        throw new Error(`runtimeInvariantEngine: invalid severity "${severity}"`);
    }
    if (!ACTIONS.includes(actionTaken)) {
        throw new Error(`runtimeInvariantEngine: invalid actionTaken "${actionTaken}"`);
    }

    _stmts.insertViolation.run(
        userId, env, invariantId, severity,
        context ? JSON.stringify(context) : null,
        snapshotId, actionTaken, ts
    );

    return { recorded: true };
}

// ── getViolationHistory ────────────────────────────────────────────
function getViolationHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const severity = (params && params.severity) ? params.severity : '';
    const limit = (params && params.limit) ? params.limit : 100;

    if (severity && !SEVERITY_LEVELS.includes(severity)) {
        throw new Error(`runtimeInvariantEngine: invalid severity filter "${severity}"`);
    }

    return _stmts.historyForUser.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        severity, severity,
        limit
    );
}

// ── getInvariantSummary ────────────────────────────────────────────
function getInvariantSummary() {
    return {
        builtin: BUILTIN_INVARIANTS.slice(),
        custom: Array.from(_customPredicates.entries()).map(([id, v]) => ({
            id, name: v.name
        })),
        total: BUILTIN_INVARIANTS.length + _customPredicates.size
    };
}

// ── _resetCustom (test helper) ─────────────────────────────────────
function _resetCustomPredicates() {
    _customPredicates.clear();
}

module.exports = {
    SEVERITY_LEVELS,
    ACTIONS,
    BUILTIN_INVARIANTS,
    registerInvariant,
    checkInvariant,
    checkAllInvariants,
    verifyBeforeAction,
    verifyAfterAction,
    recordViolation,
    getViolationHistory,
    getInvariantSummary,
    _resetCustomPredicates
};
