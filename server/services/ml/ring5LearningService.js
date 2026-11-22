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

const MF = require('../../migrationFlags');

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

// [2026-11-22] „skipped" se scria la FIECARE ciclu, pe fiecare moneda si cont:
// ~130.000 de randuri pe zi, toate cu acelasi mesaj. Acum un rand pe celula la
// SKIP_AUDIT_EVERY_MS (randurile accepted/rejected/shadow raman intregi — pe ele
// se masoara efectul).
const SKIP_AUDIT_EVERY_MS = 10 * 60_000;
const _lastSkipAudit = new Map();
function _skipAuditDue(key, nowTs) {
    const last = _lastSkipAudit.get(key) || 0;
    if (nowTs - last < SKIP_AUDIT_EVERY_MS) return false;
    _lastSkipAudit.set(key, nowTs);
    if (_lastSkipAudit.size > 5000) _lastSkipAudit.clear();
    return true;
}
function _resetSkipAuditForTest() { _lastSkipAudit.clear(); }

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
            nowTs: params.nowTs || Date.now(),
            tierFor: typeof params.tierFor === 'function' ? params.tierFor : null
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
    const { userId, resolvedEnv, symbol, phase2Decision, mlBrainProInputs, regime, marketContext, nowTs, tierFor } = ctx;
    const _cell = `${userId}:${resolvedEnv}:${symbol}:${regime}`;

    const eligibility = influenceEligibility.checkEligibility({
        userId, env: resolvedEnv, symbol, regime, nowTs
    });
    if (!eligibility.eligible) {
        if (_skipAuditDue(_cell + ':ne', nowTs)) influenceAudit.record({
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
        if (_skipAuditDue(_cell + ':np', nowTs)) influenceAudit.record({
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

    const _rationale = {
        proposal: proposal.rationale,
        penalty: gate.reflectionResult.totalPenalty || 0,
        cellLevel: eligibility.cellLevel || 4,
        sample: +draw.sample.toFixed(4),
    };
    // [2026-11-22] Ce ar face decizia cu treapta (SMALL/MEDIUM/LARGE/NO_TRADE): serverBrain
    // da functia lui de retrogradare. „wouldTier = NO_TRADE" la o taiere = intrare blocata.
    if (tierFor) {
        try {
            _rationale.phase2Tier = phase2Decision.decision || null;
            _rationale.wouldTier = tierFor(gate.finalDecision.confidence);
        } catch (_) { /* masuratoare, nu blocheaza */ }
    }

    // [2026-11-22] UMBRA: cat RING5_INFLUENCE_APPLY e oprit, decizia se noteaza dar
    // creierul primeste decizia lui NEATINSA (serverBrain aplica doar 'ring5-influence-applied').
    if (!MF.RING5_INFLUENCE_APPLY) {
        influenceAudit.record({
            userId, env: resolvedEnv, symbol, regime,
            phase2Decision, proposedDecision: gate.finalDecision,
            // tabela are CHECK gate_status IN (accepted, rejected, skipped): in umbra
            // decizia NU e aplicata → 'skipped', motivul spune ca ar fi trecut.
            gateStatus: 'skipped', gateReason: 'shadow_accepted',
            rationale: _rationale, ts: nowTs
        });
        return { ...phase2Decision, layeredBy: 'ring5-influence-shadow', ring5Would: gate.finalDecision };
    }

    influenceAudit.record({
        userId, env: resolvedEnv, symbol, regime,
        phase2Decision, proposedDecision: gate.finalDecision,
        gateStatus: 'accepted', gateReason: 'reflection_passed',
        rationale: _rationale,
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
    _resetSkipAuditForTest,
    wrap,
    recordContribution,
    // Exposed for testing only — internal helper composition.
    _stateHelper
};
