'use strict';

/**
 * OMEGA §231 — PRECONCEPTUAL TRACE VAULT / SAVE-WHAT-CANNOT-YET-BE-SAID.
 * Canonical PDF lines 7269-7325.
 */

const { db } = require('../../database');

const TRACE_TYPES = Object.freeze([
    'texture_fragment', 'timing_irregularity', 'pre_pattern_discomfort',
    'unclassified_perceptual_signature', 'something_was_off'
]);
const NAMING_STATUSES = Object.freeze([
    'already_nameable', 'preserved_as_raw', 'resisting_concept'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§231 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§231 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§231 ${name} must be in [0,1]`);
    }
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_preconceptual_trace_vault (
            user_id, resolved_env, trace_id, trace_type, naming_status,
            raw_payload_json, persistence_score, forced_label_attempted,
            captured_at, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_preconceptual_trace_vault WHERE trace_id = ?`),
    updateStatus: db.prepare(`UPDATE ml_preconceptual_trace_vault SET naming_status = ? WHERE trace_id = ?`),
    selectAll: db.prepare(`
        SELECT id, trace_id AS traceId, trace_type AS traceType,
               naming_status AS namingStatus,
               raw_payload_json AS rawPayloadJson,
               persistence_score AS persistenceScore,
               forced_label_attempted AS forcedLabelAttempted,
               captured_at AS capturedAt, ts
        FROM ml_preconceptual_trace_vault
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY captured_at DESC
    `)
};

function captureTrace(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const traceId = _required(params, 'traceId');
    const traceType = _required(params, 'traceType');
    const rawPayload = _required(params, 'rawPayload');
    const persistenceScore = _required(params, 'persistenceScore');
    const ts = _required(params, 'ts');
    const forcedLabelAttempted = params.forcedLabelAttempted ?? 0;

    if (!TRACE_TYPES.includes(traceType)) throw new Error(`§231 invalid traceType: ${traceType}`);
    _requireRange01('persistenceScore', persistenceScore);
    if (_stmts.selectById.get(traceId)) throw new Error(`§231 duplicate traceId: ${traceId}`);

    _stmts.insert.run(
        userId, resolvedEnv, traceId, traceType, 'preserved_as_raw',
        JSON.stringify(rawPayload), persistenceScore, forcedLabelAttempted,
        ts, ts
    );
    return { captured: true, traceId, namingStatus: 'preserved_as_raw' };
}

function reIlluminate(params) {
    const traceId = _required(params, 'traceId');
    const newStatus = _required(params, 'newStatus');
    if (!NAMING_STATUSES.includes(newStatus)) throw new Error(`§231 invalid newStatus: ${newStatus}`);
    if (!_stmts.selectById.get(traceId)) throw new Error(`§231 unknown traceId: ${traceId}`);
    _stmts.updateStatus.run(newStatus, traceId);
    return { reIlluminated: true, traceId, newStatus };
}

function listTraces(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { TRACE_TYPES, NAMING_STATUSES,
    captureTrace, reIlluminate, listTraces };
