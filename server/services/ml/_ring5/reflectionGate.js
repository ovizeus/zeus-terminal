'use strict';

/**
 * ML Plan v3 Phase 4 — Reflection Gate.
 *
 * Adapter that runs an already-proposed Ring5 modification through the
 * existing serverReflection.questionEntry() pipeline. If reflection blocks,
 * Ring5 falls back to the unchanged phase2 decision. If reflection allows
 * with a confidence penalty, the penalty is applied to the proposed
 * decision's confidence (clamped to [0, 100]) before acceptance.
 */

const serverReflection = require('../../serverReflection');

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`reflectionGate: missing ${k}`);
    return p[k];
}

function _clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
}

function evaluate(params) {
    const userId = _required(params, 'userId');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const marketContext = _required(params, 'marketContext');
    const phase2Decision = _required(params, 'phase2Decision');
    const proposedDecision = _required(params, 'proposedDecision');

    const reflectionResult = serverReflection.questionEntry(
        symbol, proposedDecision.dir, proposedDecision.confidence, regime, marketContext, userId
    );

    if (!reflectionResult.proceed) {
        return {
            accepted: false,
            concerns: reflectionResult.concerns || [],
            finalDecision: phase2Decision,
            reflectionResult
        };
    }

    const penalty = reflectionResult.totalPenalty || 0;
    const adjustedConfidence = _clamp(proposedDecision.confidence + penalty, 0, 100);

    return {
        accepted: true,
        concerns: reflectionResult.concerns || [],
        finalDecision: {
            ...proposedDecision,
            confidence: adjustedConfidence
        },
        reflectionResult
    };
}

module.exports = { evaluate };
