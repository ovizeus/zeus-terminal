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
const thompsonSampler = require('./_ring5/thompsonSampler');
const influenceProposer = require('./_ring5/influenceProposer');
const reflectionGate = require('./_ring5/reflectionGate');
const influenceAudit = require('./_ring5/influenceAudit');
const influenceEligibility = require('./_ring5/influenceEligibility');

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
    const mode = params.mode || 'shadow';

    if (mode === 'influence') {
        return _wrapInfluence({
            userId, resolvedEnv, symbol, phase2Decision, mlBrainProInputs,
            regime: params.regime || 'unknown',
            marketContext: params.marketContext || {},
            nowTs: params.nowTs || Date.now()
        });
    }

    // mode === 'shadow' (Day 1 behavior, unchanged)
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

function _wrapInfluence(ctx) {
    const { userId, resolvedEnv, symbol, phase2Decision, mlBrainProInputs, regime, marketContext, nowTs } = ctx;

    const eligibility = influenceEligibility.checkEligibility({
        userId, env: resolvedEnv, symbol, regime, nowTs
    });
    if (!eligibility.eligible) {
        influenceAudit.record({
            userId, env: resolvedEnv, symbol, regime,
            phase2Decision, proposedDecision: phase2Decision,
            gateStatus: 'skipped',
            gateReason: `not_eligible_${eligibility.reason}`,
            rationale: { eligibility },
            ts: nowTs
        });
        return { ...phase2Decision, layeredBy: 'ring5-influence-not-eligible' };
    }

    const draw = thompsonSampler.drawSample({ userId, env: resolvedEnv, symbol, regime, nowTs });
    const proposal = influenceProposer.propose({
        phase2Decision, banditSample: draw.sample, mlBrainProInputs
    });

    if (!proposal.hasProposal) {
        influenceAudit.record({
            userId, env: resolvedEnv, symbol, regime,
            phase2Decision, proposedDecision: phase2Decision,
            gateStatus: 'skipped', gateReason: 'no_proposal',
            rationale: proposal.rationale, ts: nowTs
        });
        return { ...phase2Decision, layeredBy: 'ring5-influence-skipped' };
    }

    const gate = reflectionGate.evaluate({
        userId, symbol, regime, marketContext,
        phase2Decision, proposedDecision: proposal.proposedDecision
    });

    if (!gate.accepted) {
        influenceAudit.record({
            userId, env: resolvedEnv, symbol, regime,
            phase2Decision, proposedDecision: proposal.proposedDecision,
            gateStatus: 'rejected', gateReason: 'reflection_blocked',
            rationale: { proposal: proposal.rationale, concerns: gate.concerns },
            ts: nowTs
        });
        return { ...phase2Decision, layeredBy: 'ring5-influence-blocked' };
    }

    influenceAudit.record({
        userId, env: resolvedEnv, symbol, regime,
        phase2Decision, proposedDecision: gate.finalDecision,
        gateStatus: 'accepted', gateReason: 'reflection_passed',
        rationale: {
            proposal: proposal.rationale,
            penalty: gate.reflectionResult.totalPenalty || 0
        },
        ts: nowTs
    });
    return { ...gate.finalDecision, layeredBy: 'ring5-influence-applied' };
}

function recordContribution(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const moduleId = _required(params, 'moduleId');
    const contribution = _required(params, 'contribution');
    const confidence = _required(params, 'confidence');
    const ts = _required(params, 'ts');
    const regime = params.regime || 'unknown';

    // [Phase 3 2026-05-17] Map contribution to outcome class. Threshold ±0.1
    // — small contributions don't move bandit; clear signals do.
    const outcomeClass = contribution >= 0.1 ? 'positive'
                      : contribution <= -0.1 ? 'negative'
                      : 'neutral';

    // Thompson Sampling: write evidence + L4 posterior + invalidate cache.
    thompsonSampler.recordObservation({
        userId, env: resolvedEnv, symbol, regime,
        moduleId, contribution, confidence, outcomeClass, ts
    });

    // Continue persisting Ring5 module state (Day 1 contract) for compatibility.
    _stateHelper.updateModuleState({
        userId, resolvedEnv, symbol, moduleId,
        trustScore: Math.max(0, Math.min(1, confidence)),
        banditParams: { lastContribution: contribution, outcomeClass },
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
