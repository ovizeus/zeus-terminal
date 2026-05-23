'use strict';

/**
 * OMEGA §239 — VOLUNTARY POWER RENUNCIATION / THE STRENGTH-TO-NOT-USE-STRENGTH.
 * Canonical PDF lines 7439-7481.
 */

const { db } = require('../../database');

const AVAILABILITIES = Object.freeze([
    'cannot', 'should_not', 'could_but_will_not'
]);
const RENUNCIATION_TYPES = Object.freeze([
    'coward_restraint', 'forced_incapacity', 'sovereign_non_use'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§239 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§239 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§239 ${name} must be in [0,1]`);
    }
}

function classifyRenunciation(params) {
    const availability = _required(params, 'availability');
    const lucidityScore = _required(params, 'lucidityScore');
    if (!AVAILABILITIES.includes(availability)) throw new Error(`§239 invalid availability`);
    _requireRange01('lucidityScore', lucidityScore);
    if (availability === 'cannot') return { renunciationType: 'forced_incapacity' };
    if (availability === 'should_not') {
        // Refraining because rule forbids — could be coward if lucidity low
        if (lucidityScore < 0.40) return { renunciationType: 'coward_restraint' };
        return { renunciationType: 'sovereign_non_use' };
    }
    // could_but_will_not — depends on lucidity
    if (lucidityScore >= 0.60) return { renunciationType: 'sovereign_non_use' };
    return { renunciationType: 'coward_restraint' };
}

function honorScore(params) {
    const renunciationType = _required(params, 'renunciationType');
    if (!RENUNCIATION_TYPES.includes(renunciationType)) throw new Error(`§239 invalid type`);
    const table = {
        forced_incapacity: 0.0,
        coward_restraint: 0.20,
        sovereign_non_use: 1.0
    };
    return { renunciationHonorScore: table[renunciationType] };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_power_renunciation_audits (
            user_id, resolved_env, audit_id, power_label,
            availability, renunciation_type, renunciation_honor_score,
            reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_power_renunciation_audits WHERE audit_id = ?`),
    selectAll: db.prepare(`
        SELECT id, audit_id AS auditId, power_label AS powerLabel,
               availability, renunciation_type AS renunciationType,
               renunciation_honor_score AS renunciationHonorScore, ts
        FROM ml_power_renunciation_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const powerLabel = _required(params, 'powerLabel');
    const availability = _required(params, 'availability');
    const lucidityScore = _required(params, 'lucidityScore');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectById.get(auditId)) throw new Error(`§239 duplicate auditId: ${auditId}`);

    const { renunciationType } = classifyRenunciation({ availability, lucidityScore });
    const { renunciationHonorScore } = honorScore({ renunciationType });

    _stmts.insert.run(
        userId, resolvedEnv, auditId, powerLabel,
        availability, renunciationType, renunciationHonorScore,
        reasoning, ts
    );
    return { recorded: true, auditId, renunciationType, renunciationHonorScore };
}

function getRecentAudits(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { AVAILABILITIES, RENUNCIATION_TYPES,
    classifyRenunciation, honorScore, recordAudit, getRecentAudits };
