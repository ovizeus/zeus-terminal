'use strict';

/**
 * OMEGA R4 Execution — idempotencyLayer (canonical §57)
 *
 * §57 EXACTLY-ONCE EXECUTION / IDEMPOTENCY LAYER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1626-1642.
 *
 * "Reconciliation iti spune dupa aceea ca ceva e gresit.
 *  Idempotency previne ca acel ceva sa se intample."
 *
 * Prevents duplicate orders / phantom exposures on retry / reconnect /
 * timeout. UNIQUE intent_id at DB level = physically impossible duplicate.
 *
 * Flow:
 *   1. generateIntentId(payload) → deterministic hash + nonce
 *   2. registerIntent(intentId, payload) → INSERT or throw on UNIQUE conflict
 *   3. submit to exchange with intentId in client_order_id
 *   4. confirmIntent(intentId, orderId, fillId?) → PENDING → CONFIRMED
 *   5. (or) rejectIntent(intentId, reason) → PENDING → REJECTED
 *   6. expireStaleIntents() → TTL housekeeping
 *
 * Pre-submit dedup: getIntentByPayloadHash() answers "did we already send
 * this exact request?" without needing exchange round-trip.
 */

const { db } = require('../../database');
const crypto = require('crypto');

const ACTION_TYPES = Object.freeze([
    'place_order', 'cancel_order', 'modify_order', 'close_position'
]);
const INTENT_STATUSES = Object.freeze([
    'PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED'
]);
const DEFAULT_INTENT_TTL_MS = 60000;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`idempotencyLayer: missing ${key}`);
    }
    return params[key];
}

function _canonicalStringify(obj) {
    // Sort keys recursively for stable hash.
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return `[${obj.map(_canonicalStringify).join(',')}]`;
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => JSON.stringify(k) + ':' + _canonicalStringify(obj[k])).join(',')}}`;
}

function _hashPayload(payload) {
    return crypto.createHash('sha256')
        .update(_canonicalStringify(payload))
        .digest('hex');
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertIntent: db.prepare(`
        INSERT INTO ml_execution_intents
        (intent_id, user_id, resolved_env, action_type,
         payload_hash, payload_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `),
    getById: db.prepare(`SELECT * FROM ml_execution_intents WHERE intent_id = ?`),
    byPayloadHash: db.prepare(`
        SELECT * FROM ml_execution_intents
        WHERE user_id = ? AND resolved_env = ? AND payload_hash = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `),
    updateConfirmed: db.prepare(`
        UPDATE ml_execution_intents
        SET status = 'CONFIRMED', order_id = ?, fill_id = ?,
            position_id = ?, confirmed_at = ?
        WHERE intent_id = ? AND status = 'PENDING'
    `),
    updateRejected: db.prepare(`
        UPDATE ml_execution_intents
        SET status = 'REJECTED', reject_reason = ?, confirmed_at = ?
        WHERE intent_id = ? AND status = 'PENDING'
    `),
    expireStale: db.prepare(`
        UPDATE ml_execution_intents
        SET status = 'EXPIRED', confirmed_at = ?
        WHERE user_id = ? AND resolved_env = ?
          AND status = 'PENDING'
          AND created_at < ?
    `),
    listByStatus: db.prepare(`
        SELECT * FROM ml_execution_intents
        WHERE user_id = ? AND resolved_env = ? AND status = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── generateIntentId ───────────────────────────────────────────────
function generateIntentId(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const actionType = _required(params, 'actionType');
    const payload = _required(params, 'payload');
    const nonce = (params && params.nonce) ? params.nonce : Date.now();

    if (!ACTION_TYPES.includes(actionType)) {
        throw new Error(`idempotencyLayer: invalid actionType "${actionType}"`);
    }

    const payloadHash = _hashPayload(payload);
    const idHash = crypto.createHash('sha256')
        .update(`${userId}:${env}:${actionType}:${payloadHash}:${nonce}`)
        .digest('hex')
        .substring(0, 32);

    return {
        intentId: `omega-${idHash}`,
        payloadHash,
        nonce
    };
}

// ── registerIntent ─────────────────────────────────────────────────
function registerIntent(params) {
    const intentId = _required(params, 'intentId');
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const actionType = _required(params, 'actionType');
    const payload = _required(params, 'payload');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!ACTION_TYPES.includes(actionType)) {
        throw new Error(`idempotencyLayer: invalid actionType "${actionType}"`);
    }

    const payloadHash = _hashPayload(payload);

    try {
        _stmts.insertIntent.run(
            intentId, userId, env, actionType,
            payloadHash, JSON.stringify(payload), ts
        );
        return { registered: true, intentId, payloadHash };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`idempotencyLayer: duplicate intent_id "${intentId}"`);
        }
        throw err;
    }
}

// ── confirmIntent — PENDING → CONFIRMED ────────────────────────────
function confirmIntent(params) {
    const intentId = _required(params, 'intentId');
    const orderId = _required(params, 'orderId');
    const fillId = (params && params.fillId) ? params.fillId : null;
    const positionId = (params && params.positionId) ? params.positionId : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const result = _stmts.updateConfirmed.run(
        orderId, fillId, positionId, ts, intentId
    );

    if (result.changes === 0) {
        const existing = _stmts.getById.get(intentId);
        if (!existing) {
            throw new Error(`idempotencyLayer: intent "${intentId}" not found`);
        }
        throw new Error(
            `idempotencyLayer: cannot confirm intent in status "${existing.status}" (must be PENDING)`
        );
    }

    return { confirmed: true, intentId, orderId };
}

// ── rejectIntent — PENDING → REJECTED ──────────────────────────────
function rejectIntent(params) {
    const intentId = _required(params, 'intentId');
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const result = _stmts.updateRejected.run(reason, ts, intentId);

    if (result.changes === 0) {
        const existing = _stmts.getById.get(intentId);
        if (!existing) {
            throw new Error(`idempotencyLayer: intent "${intentId}" not found`);
        }
        throw new Error(
            `idempotencyLayer: cannot reject intent in status "${existing.status}" (must be PENDING)`
        );
    }

    return { rejected: true, intentId };
}

// ── expireStaleIntents — TTL housekeeping ─────────────────────────
function expireStaleIntents(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const olderThanMs = (params && params.olderThanMs) ? params.olderThanMs : DEFAULT_INTENT_TTL_MS;
    const now = (params && params.now) ? params.now : Date.now();

    const threshold = now - olderThanMs;
    const result = _stmts.expireStale.run(now, userId, env, threshold);

    return { expired: result.changes };
}

// ── getIntentByPayloadHash — pre-submit dedup check ────────────────
function getIntentByPayloadHash(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const payloadHash = _required(params, 'payloadHash');

    const row = _stmts.byPayloadHash.get(userId, env, payloadHash);
    return row ? _rowToIntent(row) : null;
}

// ── getIntent (by ID) ──────────────────────────────────────────────
function getIntent(intentId) {
    if (!intentId) return null;
    const row = _stmts.getById.get(intentId);
    return row ? _rowToIntent(row) : null;
}

function _rowToIntent(r) {
    return {
        id: r.id,
        intentId: r.intent_id,
        userId: r.user_id,
        resolvedEnv: r.resolved_env,
        actionType: r.action_type,
        payloadHash: r.payload_hash,
        payload: r.payload_json ? JSON.parse(r.payload_json) : null,
        status: r.status,
        orderId: r.order_id,
        fillId: r.fill_id,
        positionId: r.position_id,
        rejectReason: r.reject_reason,
        createdAt: r.created_at,
        confirmedAt: r.confirmed_at
    };
}

module.exports = {
    ACTION_TYPES,
    INTENT_STATUSES,
    DEFAULT_INTENT_TTL_MS,
    generateIntentId,
    registerIntent,
    confirmIntent,
    rejectIntent,
    expireStaleIntents,
    getIntentByPayloadHash,
    getIntent
};
