'use strict';

/**
 * OMEGA Cross-cutting — Operator Approval Queue
 *
 * Facade over `ml_operator_approval` for tiered authority (spec 252*):
 * - `enqueue(...)` — submit pending decision (MINOR/MAJOR/CRITICAL)
 * - `getPending({userId, tier?})` — operator dashboard queue read
 * - `decide({id, decision, decidedBy, signature})` — operator action
 * - `getById(id)` — single row lookup
 *
 * Wave 1D scope: queue mechanics + DB wiring. The UI (operator dashboard +
 * approval modal + signature verification flow) wires in Wave 5 R1 +
 * Operator Interaction Layer.
 *
 * Tier policy:
 * - MINOR — auto-applied per ML_BANDIT_AUTO_APPLY_MINOR flag (no cooldown)
 * - MAJOR — operator approval required, no cooldown
 * - CRITICAL — operator approval + 24h cooldown before apply allowed
 */

const { db } = require('../../database');

const TIERS = Object.freeze(['MINOR', 'MAJOR', 'CRITICAL']);
const REQUEST_TYPES = Object.freeze([
    'PROMOTION', 'DEMOTION', 'QUARANTINE', 'RESUME', 'CHARTER_CHANGE',
    'OVERRIDE_ADD', 'OVERRIDE_REMOVE', 'EMERGENCY_HALT', 'RESUME_FROM_HALT'
]);
const DECISIONS = Object.freeze(['APPROVED', 'REJECTED', 'EXPIRED']);

const CRITICAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_operator_approval
        (user_id, request_type, request_payload_json, tier, queue_state,
         cooldown_until, requested_at)
        VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
    `),
    getById: db.prepare(`SELECT * FROM ml_operator_approval WHERE id = ?`),
    getPendingForUser: db.prepare(`
        SELECT * FROM ml_operator_approval
        WHERE user_id = ? AND queue_state = 'PENDING'
        ORDER BY requested_at ASC
    `),
    getPendingByTier: db.prepare(`
        SELECT * FROM ml_operator_approval
        WHERE user_id = ? AND queue_state = 'PENDING' AND tier = ?
        ORDER BY requested_at ASC
    `),
    decide: db.prepare(`
        UPDATE ml_operator_approval
        SET queue_state = ?, decision = ?, decided_at = ?, decided_by = ?, signature = ?
        WHERE id = ?
    `)
};

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`approvalQueue: missing required field "${key}"`);
    }
    return params[key];
}

function enqueue(params) {
    const userId = _required(params, 'userId');
    const requestType = _required(params, 'requestType');
    const payload = _required(params, 'payload');
    const tier = _required(params, 'tier');
    const now = Date.now();
    const cooldownUntil = (tier === 'CRITICAL') ? (now + CRITICAL_COOLDOWN_MS) : null;
    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const result = _stmts.insert.run(
        userId, requestType, payloadJson, tier, cooldownUntil, now
    );
    return { id: result.lastInsertRowid };
}

function getById(id) {
    if (!Number.isInteger(id) || id <= 0) return null;
    return _stmts.getById.get(id) || null;
}

function getPending(params) {
    const userId = _required(params, 'userId');
    if (params.tier) {
        return _stmts.getPendingByTier.all(userId, params.tier);
    }
    return _stmts.getPendingForUser.all(userId);
}

function decide(params) {
    const id = _required(params, 'id');
    const decision = _required(params, 'decision');
    const decidedBy = _required(params, 'decidedBy');
    const signature = params.signature || null;
    if (!DECISIONS.includes(decision)) {
        throw new Error(`approvalQueue: invalid decision "${decision}" (expected ${DECISIONS.join('|')})`);
    }
    _stmts.decide.run(decision, decision, Date.now(), decidedBy, signature, id);
    return getById(id);
}

module.exports = {
    enqueue,
    getPending,
    decide,
    getById,
    TIERS,
    REQUEST_TYPES,
    DECISIONS,
    CRITICAL_COOLDOWN_MS
};
