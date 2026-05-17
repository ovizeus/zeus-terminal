'use strict';

/**
 * OMEGA §240 — RETURN-PATH COVENANT / NEVER-EVOLVE-BEYOND-RETURN.
 * Canonical PDF lines 7484-7525.
 */

const { db } = require('../../database');

const CLASSIFICATIONS = Object.freeze([
    'fully_reversible', 'partially_reversible',
    'minimum_recoverable', 'non_recoverable'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§240 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§240 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§240 ${name} must be in [0,1]`);
    }
}

function classifyReversibility(params) {
    const reversibilityScore = _required(params, 'reversibilityScore');
    _requireRange01('reversibilityScore', reversibilityScore);
    if (reversibilityScore >= 0.80) return { classification: 'fully_reversible' };
    if (reversibilityScore >= 0.50) return { classification: 'partially_reversible' };
    if (reversibilityScore >= 0.20) return { classification: 'minimum_recoverable' };
    return { classification: 'non_recoverable' };
}

function governanceReviewRequired(params) {
    const classification = _required(params, 'classification');
    if (!CLASSIFICATIONS.includes(classification)) throw new Error(`§240 invalid class`);
    // Non-recoverable + minimum_recoverable require governance review
    return { governanceReviewRequired: (classification === 'non_recoverable' || classification === 'minimum_recoverable') ? 1 : 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_return_path_covenants (
            user_id, resolved_env, covenant_id, transformation_label,
            safe_prior_state_ref, minimum_recoverable_architecture,
            classification, governance_review_required, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_return_path_covenants WHERE covenant_id = ?`),
    selectAll: db.prepare(`
        SELECT id, covenant_id AS covenantId,
               transformation_label AS transformationLabel,
               safe_prior_state_ref AS safePriorStateRef,
               minimum_recoverable_architecture AS minimumRecoverableArchitecture,
               classification,
               governance_review_required AS governanceReviewRequired, ts
        FROM ml_return_path_covenants
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordCovenant(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const covenantId = _required(params, 'covenantId');
    const transformationLabel = _required(params, 'transformationLabel');
    const safePriorStateRef = _required(params, 'safePriorStateRef');
    const minimumRecoverableArchitecture = _required(params, 'minimumRecoverableArchitecture');
    const reversibilityScore = _required(params, 'reversibilityScore');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    _requireRange01('reversibilityScore', reversibilityScore);
    if (_stmts.selectById.get(covenantId)) throw new Error(`§240 duplicate covenantId: ${covenantId}`);

    const { classification } = classifyReversibility({ reversibilityScore });
    const { governanceReviewRequired: gr } = governanceReviewRequired({ classification });

    _stmts.insert.run(
        userId, resolvedEnv, covenantId, transformationLabel,
        safePriorStateRef, minimumRecoverableArchitecture,
        classification, gr, reasoning, ts
    );
    return { recorded: true, covenantId, classification, governanceReviewRequired: gr };
}

function getRecentCovenants(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { CLASSIFICATIONS,
    classifyReversibility, governanceReviewRequired,
    recordCovenant, getRecentCovenants };
