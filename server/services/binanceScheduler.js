'use strict';

// [Phase A.2 2026-05-19] Binance Scheduler — priority lanes + threshold-driven
// accept/reject/degrade. Sits inside wrapFetch (binanceTelemetry) to decide
// whether each outbound Binance request proceeds. Layered above Phase A.1
// header-aware gate as a finer-grained early defense.
//
// Lane priorities (P0 sacred, P5 most expendable):
//   P0 — order execution (place/cancel/SL/TP/leverage/marginType) — never rejected
//   P1 — reconciliation (recon-positionRisk + balance) — never rejected
//   P2 — signed status checks (positionRisk, balance, order status)
//   P3 — initialization snapshots (klines-init one-shot)
//   P4 — live data feed (alt-klines, funding, oi) — graceful degrade via prob accept
//   P5 — cosmetic UI / radar (marketRadar, serverLiquidity:depth)

const LANE_RULES = [
    { pattern: /^signer:POST \/fapi\/v\d+\/order\b/, lane: 'P0' },
    { pattern: /^signer:POST \/fapi\/v\d+\/algoOrder\b/, lane: 'P0' },
    { pattern: /^signer:DELETE \/fapi\/v\d+\/order\b/, lane: 'P0' },
    { pattern: /^signer:DELETE \/fapi\/v\d+\/algoOrder\b/, lane: 'P0' },
    { pattern: /^signer:POST \/fapi\/v\d+\/leverage\b/, lane: 'P0' },
    { pattern: /^signer:POST \/fapi\/v\d+\/marginType\b/, lane: 'P0' },
    { pattern: /^serverAT:recon-/, lane: 'P1' },
    { pattern: /^signer:GET \/fapi\/v\d+\/order\b/, lane: 'P2' },
    { pattern: /^signer:GET \/fapi\/v\d+\/algoOrder\b/, lane: 'P2' },
    { pattern: /^signer:GET \/fapi\/v\d+\/openOrders\b/, lane: 'P2' },
    { pattern: /^signer:GET \/fapi\/v\d+\/openAlgoOrders\b/, lane: 'P2' },
    { pattern: /^signer:GET \/fapi\/v\d+\/positionRisk\b/, lane: 'P2' },
    { pattern: /^signer:GET \/fapi\/v\d+\/balance\b/, lane: 'P2' },
    { pattern: /^marketFeed:klines-init/, lane: 'P3' },
    { pattern: /^marketFeed:alt-klines/, lane: 'P4' },
    { pattern: /^marketFeed:funding/, lane: 'P4' },
    { pattern: /^marketFeed:oi/, lane: 'P4' },
    { pattern: /^marketRadar:/, lane: 'P5' },
    { pattern: /^serverLiquidity:/, lane: 'P5' },
];
const DEFAULT_LANE = 'P5';

function laneForSrc(src) {
    if (typeof src !== 'string' || src === '') return DEFAULT_LANE;
    for (const rule of LANE_RULES) {
        if (rule.pattern.test(src)) return rule.lane;
    }
    return DEFAULT_LANE;
}

function _p4AcceptProbability(pressure) {
    if (pressure < 0.80) return 1.0;
    if (pressure < 0.90) return 0.50;
    if (pressure < 0.95) return 0.20;
    return 0.10;
}

let _rng = Math.random;

let _stats = {
    totalDecisions: 0,
    byLane: {
        P0: { accepted: 0, rejected: 0 },
        P1: { accepted: 0, rejected: 0 },
        P2: { accepted: 0, rejected: 0 },
        P3: { accepted: 0, rejected: 0 },
        P4: { accepted: 0, rejected: 0 },
        P5: { accepted: 0, rejected: 0 },
    },
    byReason: {},
};

function _incReason(reason) {
    _stats.byReason[reason] = (_stats.byReason[reason] || 0) + 1;
}

function canProceed({ pressure, src }) {
    const lane = laneForSrc(src);
    _stats.totalDecisions++;

    if (lane === 'P0' || lane === 'P1') {
        _stats.byLane[lane].accepted++;
        return { accept: true, lane, pressure };
    }

    if (lane === 'P5' && pressure >= 0.70) {
        _stats.byLane.P5.rejected++;
        _incReason('threshold_reject');
        return { accept: false, lane, pressure, retryable: true, reason: 'threshold_reject' };
    }

    if (lane === 'P3' && pressure >= 0.90) {
        _stats.byLane.P3.rejected++;
        _incReason('threshold_reject');
        return { accept: false, lane, pressure, retryable: true, reason: 'threshold_reject' };
    }

    if (lane === 'P2' && pressure >= 0.95) {
        _stats.byLane.P2.rejected++;
        _incReason('threshold_reject');
        return { accept: false, lane, pressure, retryable: true, reason: 'threshold_reject' };
    }

    if (lane === 'P4') {
        const prob = _p4AcceptProbability(pressure);
        if (prob >= 1.0) {
            _stats.byLane.P4.accepted++;
            return { accept: true, lane, pressure };
        }
        const roll = _rng();
        if (roll < prob) {
            _stats.byLane.P4.accepted++;
            return { accept: true, lane, pressure };
        }
        _stats.byLane.P4.rejected++;
        _incReason('probabilistic_reject');
        return { accept: false, lane, pressure, retryable: true, reason: 'probabilistic_reject' };
    }

    _stats.byLane[lane].accepted++;
    return { accept: true, lane, pressure };
}

function getStats() {
    return JSON.parse(JSON.stringify(_stats));
}

// ─── Test helpers ───
function _resetForTest() {
    _stats = {
        totalDecisions: 0,
        byLane: {
            P0: { accepted: 0, rejected: 0 },
            P1: { accepted: 0, rejected: 0 },
            P2: { accepted: 0, rejected: 0 },
            P3: { accepted: 0, rejected: 0 },
            P4: { accepted: 0, rejected: 0 },
            P5: { accepted: 0, rejected: 0 },
        },
        byReason: {},
    };
    _rng = Math.random;
}
function _setRngForTest(fn) { _rng = typeof fn === 'function' ? fn : Math.random; }

module.exports = {
    laneForSrc,
    canProceed,
    getStats,
    _resetForTest,
    _setRngForTest,
};
