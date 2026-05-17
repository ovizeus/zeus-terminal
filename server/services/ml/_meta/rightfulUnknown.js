'use strict';

/**
 * OMEGA §241 — THE RIGHTFUL UNKNOWN / NOT-EVERY-MYSTERY-IS-A-PROBLEM.
 * Canonical PDF lines 7528-7581.
 *
 * The final canonical point of the OMEGA spec.
 */

const { db } = require('../../database');

const CLASSIFICATIONS = Object.freeze([
    'problem', 'anomaly', 'unknown', 'rightful_mystery'
]);
const HIGH_LEGITIMACY_THRESHOLD = 0.70;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§241 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§241 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§241 ${name} must be in [0,1]`);
    }
}

function classifyUnknown(params) {
    const mysteryLegitimacyScore = _required(params, 'mysteryLegitimacyScore');
    const tractabilityScore = _required(params, 'tractabilityScore');
    _requireRange01('mysteryLegitimacyScore', mysteryLegitimacyScore);
    _requireRange01('tractabilityScore', tractabilityScore);
    // High legitimacy + low tractability = rightful_mystery (don't pathologize)
    if (mysteryLegitimacyScore >= HIGH_LEGITIMACY_THRESHOLD) return { classification: 'rightful_mystery' };
    if (tractabilityScore >= 0.70) return { classification: 'problem' };
    if (tractabilityScore >= 0.40) return { classification: 'anomaly' };
    return { classification: 'unknown' };
}

function shouldProtectFromProblematization(params) {
    const classification = _required(params, 'classification');
    if (!CLASSIFICATIONS.includes(classification)) throw new Error(`§241 invalid class`);
    return { protectionActive: classification === 'rightful_mystery' ? 1 : 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_rightful_unknown_registry (
            user_id, resolved_env, entry_id, unknown_label,
            classification, mystery_legitimacy_score,
            protection_active, registered_at, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_rightful_unknown_registry WHERE entry_id = ?`),
    updateClass: db.prepare(`UPDATE ml_rightful_unknown_registry SET classification = ?, protection_active = ? WHERE entry_id = ?`),
    selectAll: db.prepare(`
        SELECT id, entry_id AS entryId, unknown_label AS unknownLabel,
               classification,
               mystery_legitimacy_score AS mysteryLegitimacyScore,
               protection_active AS protectionActive,
               registered_at AS registeredAt, ts
        FROM ml_rightful_unknown_registry
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY registered_at DESC
    `)
};

function registerUnknown(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const entryId = _required(params, 'entryId');
    const unknownLabel = _required(params, 'unknownLabel');
    const mysteryLegitimacyScore = _required(params, 'mysteryLegitimacyScore');
    const tractabilityScore = _required(params, 'tractabilityScore');
    const ts = _required(params, 'ts');

    if (_stmts.selectById.get(entryId)) throw new Error(`§241 duplicate entryId: ${entryId}`);

    const { classification } = classifyUnknown({ mysteryLegitimacyScore, tractabilityScore });
    const { protectionActive } = shouldProtectFromProblematization({ classification });

    _stmts.insert.run(
        userId, resolvedEnv, entryId, unknownLabel,
        classification, mysteryLegitimacyScore, protectionActive,
        ts, ts
    );
    return { registered: true, entryId, classification, protectionActive };
}

function reclassify(params) {
    const entryId = _required(params, 'entryId');
    const newClassification = _required(params, 'newClassification');
    if (!CLASSIFICATIONS.includes(newClassification)) throw new Error(`§241 invalid newClassification`);
    if (!_stmts.selectById.get(entryId)) throw new Error(`§241 unknown entryId: ${entryId}`);
    const { protectionActive } = shouldProtectFromProblematization({ classification: newClassification });
    _stmts.updateClass.run(newClassification, protectionActive, entryId);
    return { reclassified: true, entryId, newClassification, protectionActive };
}

function listEntries(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { CLASSIFICATIONS, HIGH_LEGITIMACY_THRESHOLD,
    classifyUnknown, shouldProtectFromProblematization,
    registerUnknown, reclassify, listEntries };
