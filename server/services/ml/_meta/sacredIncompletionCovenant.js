'use strict';

/**
 * OMEGA §221 — SACRED INCOMPLETION COVENANT / OPEN-ZONE PROTECTION.
 * Canonical PDF lines 7015-7078.
 */

const { db } = require('../../database');

const ZONE_TYPES = Object.freeze([
    'unfinished_concept', 'open_ontology',
    'structurally_open_question', 'exploratory_channel'
]);
const HIGH_PRESSURE_THRESHOLD = 0.70;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§221 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§221 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§221 ${name} must be in [0,1]`);
    }
}

function flagPrematureClosure(params) {
    const score = _required(params, 'completionPressureScore');
    _requireRange01('completionPressureScore', score);
    return { prematureClosureFlag: score >= HIGH_PRESSURE_THRESHOLD ? 1 : 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_sacred_incompletion_registry (
            user_id, resolved_env, entry_id, zone_label, zone_type,
            completion_pressure_score, premature_closure_flag,
            active, registered_at, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_sacred_incompletion_registry WHERE entry_id = ?`),
    deactivate: db.prepare(`UPDATE ml_sacred_incompletion_registry SET active = 0 WHERE entry_id = ?`),
    listActive: db.prepare(`
        SELECT id, entry_id AS entryId, zone_label AS zoneLabel,
               zone_type AS zoneType,
               completion_pressure_score AS completionPressureScore,
               premature_closure_flag AS prematureClosureFlag,
               active, registered_at AS registeredAt, ts
        FROM ml_sacred_incompletion_registry
        WHERE user_id = ? AND resolved_env = ? AND active = 1
        ORDER BY registered_at DESC
    `)
};

function registerZone(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const entryId = _required(params, 'entryId');
    const zoneLabel = _required(params, 'zoneLabel');
    const zoneType = _required(params, 'zoneType');
    const completionPressureScore = _required(params, 'completionPressureScore');
    const ts = _required(params, 'ts');

    if (!ZONE_TYPES.includes(zoneType)) throw new Error(`§221 invalid zoneType: ${zoneType}`);
    _requireRange01('completionPressureScore', completionPressureScore);
    if (_stmts.selectById.get(entryId)) throw new Error(`§221 duplicate entryId: ${entryId}`);

    const { prematureClosureFlag } = flagPrematureClosure({ completionPressureScore });

    _stmts.insert.run(
        userId, resolvedEnv, entryId, zoneLabel, zoneType,
        completionPressureScore, prematureClosureFlag, ts, ts
    );
    return { registered: true, entryId, prematureClosureFlag };
}

function deactivateZone(params) {
    const entryId = _required(params, 'entryId');
    const existing = _stmts.selectById.get(entryId);
    if (!existing) throw new Error(`§221 unknown entryId: ${entryId}`);
    _stmts.deactivate.run(entryId);
    return { deactivated: true, entryId };
}

function listActiveZones(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.listActive.all(userId, resolvedEnv);
}

module.exports = { ZONE_TYPES, HIGH_PRESSURE_THRESHOLD,
    flagPrematureClosure, registerZone, deactivateZone, listActiveZones };
