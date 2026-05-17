'use strict';

/**
 * OMEGA §207 — PERFORMATIVE LABEL AWARENESS / NAMING-IS-AN-ACTION.
 * Canonical PDF lines 6530-6581.
 */

const { db } = require('../../database');

const COMMITMENT_STRENGTHS = Object.freeze([
    'tentative', 'working', 'strong', 'operationally_binding'
]);
const PREMATURE_NAMING_THRESHOLD = 0.50;  // sensitivity < this for strong label = premature

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§207 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§207 invalid env: ${env}`);
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§207 ${name} must be in [0,1]`);
    }
}

function detectPrematureNaming(params) {
    const commitmentStrength = _required(params, 'commitmentStrength');
    const sensitivityAuditScore = _required(params, 'sensitivityAuditScore');
    _requireRange01('sensitivityAuditScore', sensitivityAuditScore);
    // Per rule 6576: large labels must be earned gradually
    if ((commitmentStrength === 'strong' || commitmentStrength === 'operationally_binding')
        && sensitivityAuditScore < PREMATURE_NAMING_THRESHOLD) {
        return { prematureNamingFlag: 1 };
    }
    return { prematureNamingFlag: 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_performative_label_registry (
            user_id, resolved_env, label_id, label_text,
            commitment_strength, sensitivity_audit_score,
            premature_naming_flag, downstream_consequences_json,
            reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_performative_label_registry WHERE label_id = ?`),
    selectAll: db.prepare(`
        SELECT id, label_id AS labelId, label_text AS labelText,
               commitment_strength AS commitmentStrength,
               sensitivity_audit_score AS sensitivityAuditScore,
               premature_naming_flag AS prematureNamingFlag,
               downstream_consequences_json AS downstreamConsequencesJson,
               reasoning, ts
        FROM ml_performative_label_registry
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordLabel(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const labelId = _required(params, 'labelId');
    const labelText = _required(params, 'labelText');
    const commitmentStrength = _required(params, 'commitmentStrength');
    const sensitivityAuditScore = _required(params, 'sensitivityAuditScore');
    const downstreamConsequences = _required(params, 'downstreamConsequences');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!COMMITMENT_STRENGTHS.includes(commitmentStrength)) {
        throw new Error(`§207 invalid commitmentStrength: ${commitmentStrength}`);
    }
    if (!Array.isArray(downstreamConsequences)) {
        throw new Error('§207 downstreamConsequences must be array');
    }
    if (_stmts.selectById.get(labelId)) {
        throw new Error(`§207 duplicate labelId: ${labelId}`);
    }

    const { prematureNamingFlag } = detectPrematureNaming({
        commitmentStrength, sensitivityAuditScore
    });

    _stmts.insert.run(
        userId, resolvedEnv, labelId, labelText, commitmentStrength,
        sensitivityAuditScore, prematureNamingFlag,
        JSON.stringify(downstreamConsequences), reasoning, ts
    );

    return {
        recorded: true, labelId, commitmentStrength,
        prematureNamingFlag
    };
}

function getRecentLabels(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = {
    COMMITMENT_STRENGTHS, PREMATURE_NAMING_THRESHOLD,
    detectPrematureNaming, recordLabel, getRecentLabels
};
