'use strict';

/**
 * OMEGA §237 — ARTICULATION LOSS LAW / WHAT-DIES-WHEN-NAMED.
 * Canonical PDF lines 7338-7383.
 */

const { db } = require('../../database');

const KNOWLEDGE_CLASSES = Object.freeze([
    'explicit_knowledge', 'tacit_knowledge',
    'fragile_insight', 'articulation_sensitive'
]);
const HIGH_LOSS_THRESHOLD = 0.60;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§237 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§237 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§237 ${name} must be in [0,1]`);
    }
}

function shouldPreserveTacit(params) {
    const knowledgeClass = _required(params, 'knowledgeClass');
    const articulationLossScore = _required(params, 'articulationLossScore');
    if (!KNOWLEDGE_CLASSES.includes(knowledgeClass)) throw new Error(`§237 invalid class`);
    _requireRange01('articulationLossScore', articulationLossScore);
    // Preserve tacit when fragile/articulation_sensitive AND loss high
    if ((knowledgeClass === 'fragile_insight' || knowledgeClass === 'articulation_sensitive')
        && articulationLossScore >= HIGH_LOSS_THRESHOLD) {
        return { preserveWithoutFullArticulation: 1 };
    }
    return { preserveWithoutFullArticulation: 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_articulation_loss_audits (
            user_id, resolved_env, audit_id, knowledge_class,
            articulation_loss_score, preserve_without_full_articulation,
            reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_articulation_loss_audits WHERE audit_id = ?`),
    selectAll: db.prepare(`
        SELECT id, audit_id AS auditId, knowledge_class AS knowledgeClass,
               articulation_loss_score AS articulationLossScore,
               preserve_without_full_articulation AS preserveWithoutFullArticulation, ts
        FROM ml_articulation_loss_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const knowledgeClass = _required(params, 'knowledgeClass');
    const articulationLossScore = _required(params, 'articulationLossScore');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!KNOWLEDGE_CLASSES.includes(knowledgeClass)) throw new Error(`§237 invalid class`);
    _requireRange01('articulationLossScore', articulationLossScore);
    if (_stmts.selectById.get(auditId)) throw new Error(`§237 duplicate auditId: ${auditId}`);

    const { preserveWithoutFullArticulation } = shouldPreserveTacit({
        knowledgeClass, articulationLossScore
    });

    _stmts.insert.run(
        userId, resolvedEnv, auditId, knowledgeClass,
        articulationLossScore, preserveWithoutFullArticulation,
        reasoning, ts
    );
    return { recorded: true, auditId, preserveWithoutFullArticulation };
}

function getRecentAudits(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { KNOWLEDGE_CLASSES, HIGH_LOSS_THRESHOLD,
    shouldPreserveTacit, recordAudit, getRecentAudits };
