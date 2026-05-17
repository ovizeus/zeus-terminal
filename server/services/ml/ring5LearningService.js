'use strict';

/**
 * ML Plan v3 Phase 2 — Ring5LearningService facade.
 *
 * Per constraint #4 (WRAP not REWRITE): this adapter sits between existing
 * Phase 2 fusion output and downstream consumers. Phase 2 fusion math stays
 * UNTOUCHED — Ring5 receives the already-computed phase2Decision and decorates
 * it with optional ML-Brain-Pro shadow metadata.
 *
 * Phase B Day 1 scope: READ-ONLY shadow mode. Ring5 attaches metadata about
 * what ML-Brain-Pro WOULD have done, but never modifies dir/confidence/score.
 * Promotion to influence-mode is Phase 4 (reflection enforcement + §247*
 * preRegistration + §252* tieredPromotion).
 *
 * API:
 *   - wrap({userId, resolvedEnv, symbol, phase2Decision, mlBrainProInputs?})
 *       → phase2Decision augmented with `layeredBy` marker + optional
 *         `ring5Shadow` metadata when mlBrainProInputs provided.
 *
 *   - recordContribution({userId, resolvedEnv, symbol, moduleId, contribution,
 *                        confidence, ts})
 *       → upserts per-module state row (atomic version increment).
 *
 * State persistence delegated to ring5State helper (isolated for testability).
 */

const _stateHelper = require('./_ring5/ring5State');

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`ring5LearningService: missing required field ${k}`);
    }
    return p[k];
}

function _validateEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`ring5LearningService: invalid resolvedEnv '${env}'`);
    }
    return env;
}

function wrap(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const phase2Decision = _required(params, 'phase2Decision');
    const mlBrainProInputs = params.mlBrainProInputs ?? null;

    // Phase 2 fields preserved EXACTLY — wrap is read-only in Phase B Day 1.
    const wrapped = {
        dir: phase2Decision.dir,
        confidence: phase2Decision.confidence,
        score: phase2Decision.score,
        reasons: phase2Decision.reasons,
        ts: phase2Decision.ts,
        layeredBy: mlBrainProInputs ? 'ring5-shadow' : 'phase2-only'
    };

    if (mlBrainProInputs) {
        wrapped.ring5Shadow = {
            contributionsCount: (mlBrainProInputs.contributions || []).length,
            sumContribution: (mlBrainProInputs.contributions || [])
                .reduce((s, c) => s + (c.contribution || 0), 0),
        };
    }

    return wrapped;
}

function recordContribution(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const moduleId = _required(params, 'moduleId');
    const contribution = _required(params, 'contribution');
    const confidence = _required(params, 'confidence');
    const ts = _required(params, 'ts');

    // Phase B Day 1: trust_score initialized to confidence; bandit params stub.
    // Phase 3 will replace this with real Thompson Sampling α/β state.
    _stateHelper.updateModuleState({
        userId, resolvedEnv, symbol, moduleId,
        trustScore: Math.max(0, Math.min(1, confidence)),
        banditParams: { alpha: 1, beta: 1, lastContribution: contribution },
        lastObservedTs: ts,
        ts
    });

    return { recorded: true };
}

module.exports = {
    wrap,
    recordContribution,
    // Exposed for testing only — internal helper composition.
    _stateHelper
};
