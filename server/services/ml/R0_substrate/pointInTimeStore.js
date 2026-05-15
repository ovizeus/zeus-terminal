'use strict';

/**
 * OMEGA R0 Substrate — pointInTimeStore (canonical §55)
 *
 * §55 POINT-IN-TIME FEATURE STORE + DETERMINISTIC REPLAY ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1589-1602.
 *
 * "Coloana vertebrala a reproductibilitatii."
 *
 * Stores complete decision-time snapshots: market state, feature state,
 * model output, vetos, scores, order intent. Enables:
 *   - time-travel debugging: "ce stia botul la 14:03:21.428?"
 *   - deterministic replay tick-by-tick / event-by-event
 *   - clean separation: data available THEN vs data AFTER
 *
 * Critical: getStateAt(T1) returns ONLY snapshots with ts <= T1.
 * No future contamination. Replay must use what was known at T,
 * not recalculated post-hoc.
 *
 * Scope Wave 3: storage + replay primitives only. Integration hooks
 * (brainLogger, serverAT) deferred to consumer-side implementation.
 */

const { db } = require('../../database');

const SNAPSHOT_TYPES = Object.freeze(['decision', 'tick', 'event', 'manual']);
const MAX_SNAPSHOTS_PER_QUERY = 10000;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`pointInTimeStore: missing ${key}`);
    }
    return params[key];
}

function _stringifyOptional(obj) {
    if (obj === undefined || obj === null) return null;
    return JSON.stringify(obj);
}

function _parseOptional(str) {
    if (str === null || str === undefined) return null;
    try { return JSON.parse(str); } catch (_) { return null; }
}

function _rowToSnapshot(r) {
    return {
        id: r.id,
        snapshotType: r.snapshot_type,
        ts: r.ts,
        marketState: _parseOptional(r.market_state_json),
        featureState: _parseOptional(r.feature_state_json),
        modelOutput: _parseOptional(r.model_output_json),
        vetos: _parseOptional(r.vetos_json),
        scores: _parseOptional(r.scores_json),
        orderIntent: _parseOptional(r.order_intent_json),
        createdAt: r.created_at
    };
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertSnapshot: db.prepare(`
        INSERT INTO ml_pit_snapshots
        (user_id, resolved_env, snapshot_type, ts,
         market_state_json, feature_state_json, model_output_json,
         vetos_json, scores_json, order_intent_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    latestAtOrBefore: db.prepare(`
        SELECT * FROM ml_pit_snapshots
        WHERE user_id = ? AND resolved_env = ?
          AND ts <= ?
        ORDER BY ts DESC, id DESC
        LIMIT 1
    `),
    replayWindow: db.prepare(`
        SELECT * FROM ml_pit_snapshots
        WHERE user_id = ? AND resolved_env = ?
          AND ts >= ? AND ts <= ?
          AND (? = '' OR snapshot_type = ?)
        ORDER BY ts ASC, id ASC
        LIMIT ?
    `),
    byId: db.prepare(`SELECT * FROM ml_pit_snapshots WHERE id = ?`),
    countSince: db.prepare(`
        SELECT COUNT(*) AS count FROM ml_pit_snapshots
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR ts >= ?)
    `)
};

// ── recordSnapshot ─────────────────────────────────────────────────
function recordSnapshot(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const snapshotType = _required(params, 'snapshotType');
    const ts = _required(params, 'ts');

    if (!SNAPSHOT_TYPES.includes(snapshotType)) {
        throw new Error(`pointInTimeStore: invalid snapshotType "${snapshotType}"`);
    }

    if (typeof ts !== 'number' || ts <= 0) {
        throw new Error(`pointInTimeStore: ts must be positive number, got "${ts}"`);
    }

    const result = _stmts.insertSnapshot.run(
        userId, env, snapshotType, ts,
        _stringifyOptional(params.marketState),
        _stringifyOptional(params.featureState),
        _stringifyOptional(params.modelOutput),
        _stringifyOptional(params.vetos),
        _stringifyOptional(params.scores),
        _stringifyOptional(params.orderIntent),
        Date.now()
    );

    return { recorded: true, id: result.lastInsertRowid };
}

// ── getStateAt — time-travel debugging primitive ───────────────────
function getStateAt(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const ts = _required(params, 'ts');

    if (typeof ts !== 'number') {
        throw new Error(`pointInTimeStore: ts must be number`);
    }

    const row = _stmts.latestAtOrBefore.get(userId, env, ts);
    if (!row) {
        return { found: false, ts, snapshot: null };
    }

    return { found: true, ts, snapshot: _rowToSnapshot(row) };
}

// ── replaySnapshots — deterministic window replay ──────────────────
function replaySnapshots(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const startTs = _required(params, 'startTs');
    const endTs = _required(params, 'endTs');
    const snapshotType = (params && params.snapshotType) ? params.snapshotType : '';
    const limit = (params && params.limit) ? params.limit : MAX_SNAPSHOTS_PER_QUERY;

    if (snapshotType && !SNAPSHOT_TYPES.includes(snapshotType)) {
        throw new Error(`pointInTimeStore: invalid snapshotType filter "${snapshotType}"`);
    }

    if (startTs > endTs) {
        throw new Error('pointInTimeStore: startTs must be <= endTs');
    }

    const rows = _stmts.replayWindow.all(
        userId, env, startTs, endTs,
        snapshotType, snapshotType,
        Math.min(limit, MAX_SNAPSHOTS_PER_QUERY)
    );

    return rows.map(_rowToSnapshot);
}

// ── getSnapshotById ────────────────────────────────────────────────
function getSnapshotById(id) {
    if (id === undefined || id === null) {
        throw new Error('pointInTimeStore: id required');
    }
    const row = _stmts.byId.get(id);
    return row ? _rowToSnapshot(row) : null;
}

// ── countSnapshots ─────────────────────────────────────────────────
function countSnapshots(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;

    const row = _stmts.countSince.get(
        userId, env,
        since > 0 ? 1 : 0, since
    );

    return row ? row.count : 0;
}

module.exports = {
    SNAPSHOT_TYPES,
    MAX_SNAPSHOTS_PER_QUERY,
    recordSnapshot,
    getStateAt,
    replaySnapshots,
    getSnapshotById,
    countSnapshots
};
