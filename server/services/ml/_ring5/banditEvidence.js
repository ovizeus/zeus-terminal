'use strict';

/**
 * ML Plan v3 Phase 3 — Bandit Evidence (atomic observation rows).
 * Source of truth for pooled aggregation per SPEC-7.
 */

const { db } = require('../../database');

const VALID_OUTCOMES = new Set(['positive', 'negative', 'neutral']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`banditEvidence: missing ${k}`);
    return p[k];
}

function _validateConfidence(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`banditEvidence: confidence must be in [0,1], got ${v}`);
    }
    return v;
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_bandit_evidence
            (cell_key, module_id, contribution, confidence, outcome_class, ts, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    countSince: db.prepare(`
        SELECT COUNT(*) AS n FROM ml_bandit_evidence
        WHERE cell_key = ? AND ts >= ?
    `),
    aggregateSince: db.prepare(`
        SELECT
            SUM(CASE WHEN outcome_class='positive' THEN 1 ELSE 0 END) AS positives,
            SUM(CASE WHEN outcome_class='negative' THEN 1 ELSE 0 END) AS negatives,
            SUM(CASE WHEN outcome_class='neutral'  THEN 1 ELSE 0 END) AS neutrals,
            COALESCE(SUM(contribution), 0) AS sum_contribution,
            COUNT(*) AS n
        FROM ml_bandit_evidence
        WHERE cell_key = ? AND ts >= ?
    `)
};

function recordEvidence(params) {
    const cellKey = _required(params, 'cellKey');
    const moduleId = _required(params, 'moduleId');
    const contribution = _required(params, 'contribution');
    const confidence = _validateConfidence(_required(params, 'confidence'));
    const outcomeClass = _required(params, 'outcomeClass');
    const ts = _required(params, 'ts');
    if (!VALID_OUTCOMES.has(outcomeClass)) {
        throw new Error(`banditEvidence: invalid outcomeClass '${outcomeClass}'`);
    }
    _stmts.insert.run(cellKey, moduleId, contribution, confidence, outcomeClass, ts, ts);
    return { recorded: true };
}

function countSince(params) {
    const cellKey = _required(params, 'cellKey');
    const sinceTs = _required(params, 'sinceTs');
    return _stmts.countSince.get(cellKey, sinceTs).n;
}

function aggregateSince(params) {
    const cellKey = _required(params, 'cellKey');
    const sinceTs = _required(params, 'sinceTs');
    const row = _stmts.aggregateSince.get(cellKey, sinceTs);
    const positives = row.positives || 0;
    const negatives = row.negatives || 0;
    return {
        pooledAlpha: 1 + positives,
        pooledBeta: 1 + negatives,
        sumContribution: row.sum_contribution || 0,
        n: row.n || 0
    };
}

module.exports = { recordEvidence, countSince, aggregateSince };
