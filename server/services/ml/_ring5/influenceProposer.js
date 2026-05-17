'use strict';

/**
 * ML Plan v3 Phase 4 — Influence Proposer.
 *
 * Decides whether Ring5 wants to modify the phase2 fusion decision.
 * Conservative Phase 4 rules: confidence boost or cut ONLY (no dir flip).
 * Output feeds into reflectionGate which may accept or reject.
 */

const POS_BANDIT = 0.70;
const NEG_BANDIT = 0.30;
const POS_ML = 0.10;
const NEG_ML = -0.10;
const MAX_DELTA = 15;

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`influenceProposer: missing ${k}`);
    return p[k];
}

function _sumContribution(mlInputs) {
    if (!mlInputs || !mlInputs.contributions) return 0;
    return mlInputs.contributions.reduce((s, c) => s + (c.contribution || 0), 0);
}

function _clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
}

function propose(params) {
    const phase2 = _required(params, 'phase2Decision');
    const banditSample = _required(params, 'banditSample');
    const mlInputs = params.mlBrainProInputs || null;
    const sumC = _sumContribution(mlInputs);

    if (banditSample >= POS_BANDIT && sumC >= POS_ML) {
        const delta = Math.min(MAX_DELTA, banditSample * 20);
        return {
            hasProposal: true,
            proposedDecision: {
                dir: phase2.dir,
                confidence: _clamp(phase2.confidence + delta, 0, 100),
                score: phase2.score,
                reasons: [...(phase2.reasons || []), 'ring5_boost'],
                ts: phase2.ts
            },
            rationale: `positive_boost: bandit=${banditSample.toFixed(3)} sumC=${sumC.toFixed(3)} delta=+${delta.toFixed(2)}`
        };
    }

    if (banditSample <= NEG_BANDIT && sumC <= NEG_ML) {
        const delta = Math.min(MAX_DELTA, (1 - banditSample) * 20);
        return {
            hasProposal: true,
            proposedDecision: {
                dir: phase2.dir,
                confidence: _clamp(phase2.confidence - delta, 0, 100),
                score: phase2.score,
                reasons: [...(phase2.reasons || []), 'ring5_cut'],
                ts: phase2.ts
            },
            rationale: `negative_cut: bandit=${banditSample.toFixed(3)} sumC=${sumC.toFixed(3)} delta=-${delta.toFixed(2)}`
        };
    }

    return {
        hasProposal: false,
        rationale: `neutral_or_insufficient: bandit=${banditSample.toFixed(3)} sumC=${sumC.toFixed(3)}`
    };
}

module.exports = { propose, _constants: { POS_BANDIT, NEG_BANDIT, POS_ML, NEG_ML, MAX_DELTA } };
