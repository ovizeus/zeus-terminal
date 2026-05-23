'use strict';

/**
 * ML Plan v3 Phase 3 — Thompson Sampling public API.
 *
 * Composes banditPosteriors + banditEvidence + effectiveStatus.
 *
 * API:
 *   - drawSample({userId, env, symbol, regime, nowTs}) → Beta(α,β) random draw
 *   - recordObservation(...) → evidence + L4 posterior + cache invalidate
 */

const bp = require('./banditPosteriors');
const be = require('./banditEvidence');
const es = require('./effectiveStatus');

// Gamma(k) sample via Marsaglia-Tsang squeeze (k>=1) + boost (k<1).
function _gammaSample(k) {
    if (k < 1) {
        return _gammaSample(k + 1) * Math.pow(Math.random(), 1 / k);
    }
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
        let x, v;
        do {
            const u1 = Math.random();
            const u2 = Math.random();
            x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            v = 1 + c * x;
        } while (v <= 0);
        v = v * v * v;
        const u = Math.random();
        if (u < 1 - 0.0331 * x * x * x * x) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
}

function _betaSample(alpha, beta) {
    const x = _gammaSample(alpha);
    const y = _gammaSample(beta);
    return x / (x + y);
}

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`thompsonSampler: missing ${k}`);
    return p[k];
}

function drawSample(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const nowTs = _required(params, 'nowTs');

    const status = es.resolve({ userId, env, symbol, regime, nowTs });
    const sample = _betaSample(status.alpha, status.beta);
    return {
        sample,
        level: status.level,
        cellKey: status.cellKey,
        alpha: status.alpha,
        beta: status.beta,
        cacheHit: status.cacheHit
    };
}

function recordObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const moduleId = _required(params, 'moduleId');
    const contribution = _required(params, 'contribution');
    const confidence = _required(params, 'confidence');
    const outcomeClass = _required(params, 'outcomeClass');
    const ts = _required(params, 'ts');

    const cellKey = bp.buildCellKey({ level: 4, userId, env, symbol, regime });

    be.recordEvidence({ cellKey, moduleId, contribution, confidence, outcomeClass, ts });
    bp.updatePosterior({ level: 4, cellKey, outcomeClass, ts });
    es.invalidate({ cellKey });

    return { recorded: true, cellKey };
}

module.exports = { drawSample, recordObservation };
