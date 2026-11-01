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
    // [ML POOLING WRITE 2026-11-01] Write the WHOLE hierarchy, not just the narrowest
    // cell. Until today this line was `updatePosterior({ level: 4, ... })` alone, so
    // levels 0-3 stayed empty forever — and walkHierarchy(), whose entire job is to
    // rescue a thin L4 cell by borrowing a broader one, had nothing to borrow. Live
    // DB before the fix: 88 rows, all level 4, 742 observations between them, exactly
    // one cell at the promotion threshold of 30. Every other draw fell through to the
    // hardcoded Beta(1,1) default — a uniform coin flip dressed as a posterior.
    //
    // An observation is evidence at every level of generality: a losing BREAKOUT on
    // DEMO/ETHUSDT is also evidence about DEMO/ETHUSDT, about DEMO, and about the
    // book. buildCellKey decides what each level is keyed by, so DEMO never pools
    // into TESTNET and the user drops out above level 4 by design.
    for (const level of [4, 3, 2, 1, 0]) {
        bp.updatePosterior({
            level,
            cellKey: bp.buildCellKey({ level, userId, env, symbol, regime }),
            outcomeClass, ts,
        });
    }
    // Only this user's L4 key is cached (effectiveStatus keys its LRU by the L4
    // cellKey), so that is what we invalidate. Another user whose cached entry
    // resolved to a parent we just moved stays stale for at most the 60s TTL.
    es.invalidate({ cellKey });

    return { recorded: true, cellKey };
}

module.exports = { drawSample, recordObservation };
