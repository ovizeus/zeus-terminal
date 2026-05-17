'use strict';

/**
 * OMEGA §190 — ANOMALY SANCTUARY / IRREDUCIBLE RESIDUAL PRESERVATION.
 * Canonical PDF lines 6154-6207.
 */

const { db } = require('../../database');

const ANOMALY_TAGS = Object.freeze([
    'unexplained_but_stable', 'unexplained_and_volatile',
    'repeat_anomaly', 'anomaly_cluster',
    'anomaly_with_ontological_pressure'
]);

const MIN_EVIDENCE_FOR_EXPLANATION = 0.60;
const TAG_PRESERVATION_PRIORITY = Object.freeze({
    anomaly_with_ontological_pressure: 0.95,
    anomaly_cluster: 0.85,
    repeat_anomaly: 0.75,
    unexplained_but_stable: 0.65,
    unexplained_and_volatile: 0.55
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§190 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§190 invalid env: ${env}`);
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§190 ${name} must be in [0,1]`);
    }
}

function computePreservationScore(params) {
    const tag = _required(params, 'anomalyTag');
    if (!ANOMALY_TAGS.includes(tag)) {
        throw new Error(`§190 invalid anomalyTag: ${tag}`);
    }
    return { preservationScore: TAG_PRESERVATION_PRIORITY[tag] };
}

function shouldForceExplain(params) {
    const evidence = _required(params, 'currentEvidenceForExplanation');
    _requireRange01('currentEvidenceForExplanation', evidence);
    // Per PDF rule 6180: interdicție de explicare forțată sub prag evidență
    return { forceExplainAllowed: evidence >= MIN_EVIDENCE_FOR_EXPLANATION ? 1 : 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_anomaly_sanctuary (
            user_id, resolved_env, anomaly_id, phenomenon_label, anomaly_tag,
            preservation_score, current_evidence_for_explanation,
            force_explain_allowed, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_anomaly_sanctuary WHERE anomaly_id = ?`),
    selectAllRecent: db.prepare(`
        SELECT id, anomaly_id AS anomalyId, phenomenon_label AS phenomenonLabel,
               anomaly_tag AS anomalyTag,
               preservation_score AS preservationScore,
               current_evidence_for_explanation AS currentEvidenceForExplanation,
               force_explain_allowed AS forceExplainAllowed,
               reasoning, ts
        FROM ml_anomaly_sanctuary
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByTag: db.prepare(`
        SELECT id, anomaly_id AS anomalyId, phenomenon_label AS phenomenonLabel,
               anomaly_tag AS anomalyTag,
               preservation_score AS preservationScore,
               current_evidence_for_explanation AS currentEvidenceForExplanation,
               force_explain_allowed AS forceExplainAllowed,
               reasoning, ts
        FROM ml_anomaly_sanctuary
        WHERE user_id = ? AND resolved_env = ? AND anomaly_tag = ?
        ORDER BY ts DESC
    `)
};

function recordAnomaly(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const anomalyId = _required(params, 'anomalyId');
    const phenomenonLabel = _required(params, 'phenomenonLabel');
    const anomalyTag = _required(params, 'anomalyTag');
    const currentEvidenceForExplanation = _required(params, 'currentEvidenceForExplanation');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!ANOMALY_TAGS.includes(anomalyTag)) {
        throw new Error(`§190 invalid anomalyTag: ${anomalyTag}`);
    }
    if (_stmts.selectById.get(anomalyId)) {
        throw new Error(`§190 duplicate anomalyId: ${anomalyId}`);
    }

    const { preservationScore } = computePreservationScore({ anomalyTag });
    const { forceExplainAllowed } = shouldForceExplain({ currentEvidenceForExplanation });

    _stmts.insert.run(
        userId, resolvedEnv, anomalyId, phenomenonLabel, anomalyTag,
        preservationScore, currentEvidenceForExplanation,
        forceExplainAllowed, reasoning, ts
    );

    return {
        recorded: true, anomalyId, anomalyTag,
        preservationScore, forceExplainAllowed
    };
}

function getRecentAnomalies(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const anomalyTag = params.anomalyTag;
    if (anomalyTag !== undefined && !ANOMALY_TAGS.includes(anomalyTag)) {
        throw new Error(`§190 invalid tag filter`);
    }
    return anomalyTag
        ? _stmts.selectByTag.all(userId, resolvedEnv, anomalyTag)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

module.exports = {
    ANOMALY_TAGS,
    MIN_EVIDENCE_FOR_EXPLANATION,
    TAG_PRESERVATION_PRIORITY,
    computePreservationScore,
    shouldForceExplain,
    recordAnomaly,
    getRecentAnomalies
};
