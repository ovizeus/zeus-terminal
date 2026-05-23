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

// [Phase A.2 2026-05-19] Detect signer ops that should auto-trigger critical
// section. Mirrors P0 lane patterns but on (method, path) shape directly so
// callers can decide BEFORE building the src tag.
const ORDER_OP_RULES = [
    { method: 'POST', pattern: /^\/fapi\/v\d+\/order\b/ },
    { method: 'POST', pattern: /^\/fapi\/v\d+\/algoOrder\b/ },
    { method: 'DELETE', pattern: /^\/fapi\/v\d+\/order\b/ },
    { method: 'DELETE', pattern: /^\/fapi\/v\d+\/algoOrder\b/ },
    { method: 'POST', pattern: /^\/fapi\/v\d+\/leverage\b/ },
    { method: 'POST', pattern: /^\/fapi\/v\d+\/marginType\b/ },
];

function isOrderOp(method, path) {
    if (typeof method !== 'string' || typeof path !== 'string') return false;
    for (const rule of ORDER_OP_RULES) {
        if (method === rule.method && rule.pattern.test(path)) return true;
    }
    return false;
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

// Critical section ref-counted state
const CRITICAL_SECTION_DEFAULT_MS = 5000;
let _criticalSections = new Map();
let _now = null;

function _ts() { return _now == null ? Date.now() : _now; }

function _pruneExpiredSections() {
    const now = _ts();
    for (const [opId, expiresAt] of _criticalSections) {
        if (expiresAt <= now) _criticalSections.delete(opId);
    }
}

function beginCriticalSection(opId, maxMs) {
    if (!opId) return;
    const dur = (typeof maxMs === 'number' && maxMs > 0) ? maxMs : CRITICAL_SECTION_DEFAULT_MS;
    _criticalSections.set(opId, _ts() + dur);
}

function endCriticalSection(opId) {
    if (!opId) return;
    _criticalSections.delete(opId);
}

function getActiveCriticalSections() {
    _pruneExpiredSections();
    return _criticalSections.size;
}

function _isCriticalSectionActive() {
    _pruneExpiredSections();
    return _criticalSections.size > 0;
}

function canProceed({ pressure, src, path }) {
    const lane = laneForSrc(src);
    _stats.totalDecisions++;

    // [V6 2026-05-20] Mode-based gating — sits BEFORE lane logic.
    // Honors persistent rate state: SUPPRESSED rejects everything,
    // WARM rejects CLASS_B (degradable analytics), A+C allowed.
    // Defensive — if rateState load throws (DB unreachable), fall through
    // to lane-based logic unchanged.
    //
    // Test-skip: _v6Disabled set by _resetForTest() so legacy scheduler/telemetry
    // tests that don't mock the rate-state DB aren't affected by live ban rows.
    try {
        if (_v6Disabled) throw new Error('v6_test_skip');
        const rateState = require('./binanceRateState');
        const now = _ts();
        // [V6.5 fix] Lazy state advance — if ban just expired and warm hasn't
        // started, auto-promote to WARM here. Without this, the natural
        // expiry would skip warm and burst back to NORMAL.
        rateState.advanceState({ now });
        const state = rateState.load();
        const mode = rateState.computeCurrentMode(state, now);

        if (mode === 'SUPPRESSED') {
            _stats.byLane[lane].rejected++;
            _incReason('suppressed_banned');
            return {
                accept: false, lane, pressure,
                retryable: true,
                reason: 'suppressed_banned',
            };
        }
        if (mode === 'WARM') {
            const klass = rateState.classifyEndpoint(path || '');
            if (!rateState.shouldAllowDuringWarm(klass)) {
                _stats.byLane[lane].rejected++;
                _incReason('warm_class_b');
                return {
                    accept: false, lane, pressure,
                    retryable: true,
                    reason: 'warm_class_b',
                    endpointClass: klass,
                };
            }
        }
    } catch (_err) { /* defensive — never block scheduler on state read */ }

    if (lane === 'P0' || lane === 'P1') {
        _stats.byLane[lane].accepted++;
        return { accept: true, lane, pressure };
    }

    // Critical section override — when active, reject all P3/P4/P5 regardless of pressure
    if (_isCriticalSectionActive() && (lane === 'P3' || lane === 'P4' || lane === 'P5')) {
        _stats.byLane[lane].rejected++;
        _incReason('critical_section');
        return { accept: false, lane, pressure, retryable: true, reason: 'critical_section' };
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
// [V6 2026-05-20] Default-disabled in test runs so legacy scheduler tests
// that don't mock rateState DB aren't affected by live ban rows.
let _v6Disabled = false;
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
    _criticalSections = new Map();
    _now = null;
    // Disable V6 mode gate by default in test reset; V6 integration tests
    // re-enable explicitly with _setV6EnabledForTest(true).
    _v6Disabled = true;
}
function _setV6EnabledForTest(enabled) { _v6Disabled = !enabled; }
function _setRngForTest(fn) { _rng = typeof fn === 'function' ? fn : Math.random; }
function _setNowForTest(ts) { _now = ts; }

module.exports = {
    laneForSrc,
    canProceed,
    getStats,
    beginCriticalSection,
    endCriticalSection,
    getActiveCriticalSections,
    isOrderOp,
    _resetForTest,
    _setV6EnabledForTest,
    _setRngForTest,
    _setNowForTest,
};
