'use strict';

/**
 * OMEGA §197 — EXTERIORITY COVENANT / TRUTH-REQUIRES-OUTSIDE.
 * Canonical PDF lines 6274-6320.
 */

const { db } = require('../../database');

const VALIDATION_ZONES = Object.freeze([
    'self_knowledge_internal',
    'self_knowledge_external_only',
    'mixed_validation'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§197 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§197 invalid env: ${env}`);
    return env;
}

function determineExternalRequirement(params) {
    const zone = _required(params, 'validationZone');
    if (!VALIDATION_ZONES.includes(zone)) {
        throw new Error(`§197 invalid validationZone: ${zone}`);
    }
    const required = (zone === 'self_knowledge_external_only' || zone === 'mixed_validation') ? 1 : 0;
    return { externalValidatorRequired: required };
}

function computeSelfSufficiencyPenalty(params) {
    const zone = _required(params, 'validationZone');
    const claimsAutonomy = _required(params, 'claimsCompleteAutonomy');
    if (!VALIDATION_ZONES.includes(zone)) {
        throw new Error(`§197 invalid validationZone: ${zone}`);
    }
    // Per rule 6315: any claim of complete self-foundation = penalty
    if (claimsAutonomy === true) {
        if (zone === 'self_knowledge_external_only') return { penalty: 1.0 };
        if (zone === 'mixed_validation') return { penalty: 0.50 };
        return { penalty: 0.30 };
    }
    return { penalty: 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_exteriority_validation_requirements (
            user_id, resolved_env, requirement_id, category_label,
            validation_zone, external_validator_required,
            self_sufficiency_penalty, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_exteriority_validation_requirements WHERE requirement_id = ?`),
    selectAll: db.prepare(`
        SELECT id, requirement_id AS requirementId, category_label AS categoryLabel,
               validation_zone AS validationZone,
               external_validator_required AS externalValidatorRequired,
               self_sufficiency_penalty AS selfSufficiencyPenalty,
               reasoning, ts
        FROM ml_exteriority_validation_requirements
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordValidationRequirement(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const requirementId = _required(params, 'requirementId');
    const categoryLabel = _required(params, 'categoryLabel');
    const validationZone = _required(params, 'validationZone');
    const claimsCompleteAutonomy = params.claimsCompleteAutonomy === true;
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!VALIDATION_ZONES.includes(validationZone)) {
        throw new Error(`§197 invalid validationZone: ${validationZone}`);
    }
    if (_stmts.selectById.get(requirementId)) {
        throw new Error(`§197 duplicate requirementId: ${requirementId}`);
    }

    const { externalValidatorRequired } = determineExternalRequirement({ validationZone });
    const { penalty: selfSufficiencyPenalty } = computeSelfSufficiencyPenalty({
        validationZone, claimsCompleteAutonomy
    });

    _stmts.insert.run(
        userId, resolvedEnv, requirementId, categoryLabel,
        validationZone, externalValidatorRequired,
        selfSufficiencyPenalty, reasoning, ts
    );

    return {
        recorded: true, requirementId, validationZone,
        externalValidatorRequired, selfSufficiencyPenalty
    };
}

function getRequirements(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = {
    VALIDATION_ZONES,
    determineExternalRequirement,
    computeSelfSufficiencyPenalty,
    recordValidationRequirement,
    getRequirements
};
