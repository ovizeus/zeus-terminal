'use strict';

/**
 * OMEGA §199 — ONTOLOGICAL MOURNING / FUNERAL FOR DEAD FRAMEWORKS.
 * Canonical PDF lines 6370-6417.
 */

const { db } = require('../../database');

const FRAMEWORK_TYPES = Object.freeze([
    'concept', 'detector', 'causal_belief',
    'strategy_archetype', 'worldview'
]);
const REASONS_FOR_DEATH = Object.freeze([
    'crowding', 'drift', 'ontological_insufficiency',
    'causal_collapse', 'local_only_truth_universalized'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§199 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§199 invalid env: ${env}`);
    return env;
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_ontological_mourning_records (
            user_id, resolved_env, mourning_id, framework_label,
            framework_type, reason_for_death, epitaph_text,
            preserved_lesson_text, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_ontological_mourning_records WHERE mourning_id = ?`),
    selectAll: db.prepare(`
        SELECT id, mourning_id AS mourningId, framework_label AS frameworkLabel,
               framework_type AS frameworkType,
               reason_for_death AS reasonForDeath,
               epitaph_text AS epitaphText,
               preserved_lesson_text AS preservedLessonText, ts
        FROM ml_ontological_mourning_records
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByType: db.prepare(`
        SELECT id, mourning_id AS mourningId, framework_label AS frameworkLabel,
               framework_type AS frameworkType,
               reason_for_death AS reasonForDeath,
               epitaph_text AS epitaphText,
               preserved_lesson_text AS preservedLessonText, ts
        FROM ml_ontological_mourning_records
        WHERE user_id = ? AND resolved_env = ? AND framework_type = ?
        ORDER BY ts DESC
    `)
};

function recordMourning(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const mourningId = _required(params, 'mourningId');
    const frameworkLabel = _required(params, 'frameworkLabel');
    const frameworkType = _required(params, 'frameworkType');
    const reasonForDeath = _required(params, 'reasonForDeath');
    const epitaphText = _required(params, 'epitaphText');
    const ts = _required(params, 'ts');
    const preservedLessonText = params.preservedLessonText ?? null;

    if (!FRAMEWORK_TYPES.includes(frameworkType)) {
        throw new Error(`§199 invalid frameworkType: ${frameworkType}`);
    }
    if (!REASONS_FOR_DEATH.includes(reasonForDeath)) {
        throw new Error(`§199 invalid reasonForDeath: ${reasonForDeath}`);
    }
    if (_stmts.selectById.get(mourningId)) {
        throw new Error(`§199 duplicate mourningId: ${mourningId}`);
    }

    _stmts.insert.run(
        userId, resolvedEnv, mourningId, frameworkLabel,
        frameworkType, reasonForDeath, epitaphText,
        preservedLessonText, ts
    );

    return { recorded: true, mourningId, frameworkType, reasonForDeath };
}

function getRecentMournings(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const frameworkType = params.frameworkType;
    if (frameworkType !== undefined && !FRAMEWORK_TYPES.includes(frameworkType)) {
        throw new Error(`§199 invalid frameworkType filter`);
    }
    return frameworkType
        ? _stmts.selectByType.all(userId, resolvedEnv, frameworkType)
        : _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = {
    FRAMEWORK_TYPES,
    REASONS_FOR_DEATH,
    recordMourning,
    getRecentMournings
};
