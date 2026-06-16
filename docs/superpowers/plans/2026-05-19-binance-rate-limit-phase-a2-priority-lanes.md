# Binance Rate-Limit Phase A.2 — Priority Lanes + Critical Section

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-process priority scheduler around Binance requests so that under quota pressure, low-priority cosmetic polling degrades or is rejected with synthetic 503 BEFORE high-priority order execution (P0) or reconciliation (P1) ever sees pressure. Operator order flow auto-protected via ref-counted critical sections.

**Architecture:**
- New `server/services/binanceScheduler.js`: pure decision engine. `canProceed(host, src)` returns `{accept: boolean, reason?, lane, pressure, retryable}`. Lane is derived from `src` tag via static `_laneForSrc(src)` map. Threshold table per-lane drives accept/reject/degrade decisions. `P4` (alt-klines) uses probabilistic accept at high pressure (graceful degrade, not hard block) so brain keeps receiving data — just slower.
- Critical section: `beginCriticalSection(opId, maxMs?)` adds to `Map<opId, expiresAt>`, `endCriticalSection(opId)` removes. Ref-counted by design — section is "active" while map.size > 0 (after lazy expired cleanup). While any section active, P3/P4/P5 always reject (regardless of pressure) — protects order weight reserve.
- Integration: `binanceTelemetry.wrapFetch` calls `binanceScheduler.canProceed(host, src)` BEFORE actual fetch. If rejected, returns synthetic 503 structured response with `{code: 'BINANCE_SCHEDULER_BACKPRESSURE', lane, pressure, retryable, synthetic, msg}`. recordCall tracks `rejectedByScheduler` flag (analog to `blockedByPressure` from A.1).
- Auto critical section: `binanceSigner.sendSignedRequest` detects order-path operations (`POST /fapi/v1/order`, `POST /fapi/v1/algoOrder`, `DELETE` variants, `POST /fapi/v1/leverage`, `POST /fapi/v1/marginType`) and wraps the call in begin/endCriticalSection automatically. Manual API exposed for advanced use.
- Defense in depth: Phase A.1 quota gate (95%/97%) STAYS as final safety net. Scheduler thresholds (70-95%) fire earlier. Phase B ref-counting + Phase C tab dedupe untouched.
- Phase 2 fusion math UNTOUCHED. ARCH-3 per-(user × env × symbol) isolation preserved — scheduler is per-host process-global.

**Tech Stack:** Node.js, better-sqlite3 unchanged, jest unit tests using `_resetForTest()` injection pattern + seeded RNG for deterministic probabilistic-accept tests.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `server/services/binanceScheduler.js` | NEW: canProceed/decision engine + lane mapping + threshold table + critical section ref-count + state introspection for telemetry | Create |
| `tests/unit/binanceScheduler.test.js` | Unit tests TDD for canProceed, lane mapping, thresholds, probabilistic accept (seeded), critical section ref-count, expiry cleanup | Create |
| `server/services/binanceTelemetry.js` | Wire `scheduler.canProceed` into `wrapFetch` BEFORE fetch; record `rejectedByScheduler` flag; expose `schedulerStats` in `getSnapshot` | Modify |
| `tests/unit/binanceTelemetry.test.js` | Append tests for scheduler integration in wrapFetch | Modify |
| `server/services/binanceSigner.js` | Auto begin/endCriticalSection wrap for order-path operations | Modify |
| `tests/unit/binanceSigner.test.js` (if exists) | Tests for auto critical section behavior | Modify if exists |
| `server/version.js` | Bump v1.7.95 b121, prepend changelog entry | Modify |

---

## Constants Reference (used across tasks)

These must be used VERBATIM in implementations:

```js
// Lane priorities
const LANES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']

// Lane → Source matching patterns (used by _laneForSrc)
// Order matters: first match wins
const LANE_RULES = [
    // P0 — order execution (sacred, never rejected)
    { pattern: /^signer:POST \/fapi\/v\d+\/order\b/, lane: 'P0' },
    { pattern: /^signer:POST \/fapi\/v\d+\/algoOrder\b/, lane: 'P0' },
    { pattern: /^signer:DELETE \/fapi\/v\d+\/order\b/, lane: 'P0' },
    { pattern: /^signer:DELETE \/fapi\/v\d+\/algoOrder\b/, lane: 'P0' },
    { pattern: /^signer:POST \/fapi\/v\d+\/leverage\b/, lane: 'P0' },
    { pattern: /^signer:POST \/fapi\/v\d+\/marginType\b/, lane: 'P0' },
    // P1 — reconciliation (safety, never rejected)
    { pattern: /^serverAT:recon-/, lane: 'P1' },
    // P2 — signed status checks
    { pattern: /^signer:GET \/fapi\/v\d+\/order\b/, lane: 'P2' },
    { pattern: /^signer:GET \/fapi\/v\d+\/algoOrder\b/, lane: 'P2' },
    { pattern: /^signer:GET \/fapi\/v\d+\/openOrders\b/, lane: 'P2' },
    { pattern: /^signer:GET \/fapi\/v\d+\/openAlgoOrders\b/, lane: 'P2' },
    { pattern: /^signer:GET \/fapi\/v\d+\/positionRisk\b/, lane: 'P2' },
    { pattern: /^signer:GET \/fapi\/v\d+\/balance\b/, lane: 'P2' },
    // P3 — initialization snapshots (one-shot)
    { pattern: /^marketFeed:klines-init/, lane: 'P3' },
    // P4 — live data feed (degrades, not paused)
    { pattern: /^marketFeed:alt-klines/, lane: 'P4' },
    { pattern: /^marketFeed:funding/, lane: 'P4' },
    { pattern: /^marketFeed:oi/, lane: 'P4' },
    // P5 — cosmetic UI / radar
    { pattern: /^marketRadar:/, lane: 'P5' },
    { pattern: /^serverLiquidity:/, lane: 'P5' },
]
const DEFAULT_LANE = 'P5'  // unknown sources treated as cosmetic

// Threshold table — pressure cutoffs per lane
// At each row: lane X has special behavior when pressure >= threshold
const THRESHOLDS = {
    P0: { reject: null, degradeAt: null },           // never rejected
    P1: { reject: null, degradeAt: null },           // never rejected
    P2: { reject: 0.95, degradeAt: null },           // hard reject at 95%
    P3: { reject: 0.90, degradeAt: null },           // hard reject at 90%
    P4: {                                             // graceful degrade
        reject: null,
        degradeAt: 0.80,                              // start accepting probabilistically
        // Accept probabilities at pressure ranges:
        // 80-89% → 0.50, 90-94% → 0.20, 95%+ → 0.10
        acceptProbability: (pressure) => {
            if (pressure < 0.80) return 1.0
            if (pressure < 0.90) return 0.50
            if (pressure < 0.95) return 0.20
            return 0.10
        }
    },
    P5: { reject: 0.70, degradeAt: null },           // hard reject at 70%
}

// Critical section default timeout
const CRITICAL_SECTION_DEFAULT_MS = 5000
```

---

## Task 1: binanceScheduler core — lane mapping + threshold rules (RED + GREEN)

**Files:**
- Create: `server/services/binanceScheduler.js`
- Create: `tests/unit/binanceScheduler.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/binanceScheduler.test.js`:

```js
'use strict';

const scheduler = require('../../server/services/binanceScheduler');

beforeEach(() => {
    scheduler._resetForTest();
});

describe('binanceScheduler — lane mapping', () => {
    test('signer order POST → P0', () => {
        expect(scheduler.laneForSrc('signer:POST /fapi/v1/order')).toBe('P0');
        expect(scheduler.laneForSrc('signer:POST /fapi/v1/algoOrder')).toBe('P0');
        expect(scheduler.laneForSrc('signer:DELETE /fapi/v1/order')).toBe('P0');
        expect(scheduler.laneForSrc('signer:POST /fapi/v1/leverage')).toBe('P0');
        expect(scheduler.laneForSrc('signer:POST /fapi/v1/marginType')).toBe('P0');
    });

    test('serverAT recon → P1', () => {
        expect(scheduler.laneForSrc('serverAT:recon-positionRisk')).toBe('P1');
    });

    test('signer status checks → P2', () => {
        expect(scheduler.laneForSrc('signer:GET /fapi/v2/positionRisk')).toBe('P2');
        expect(scheduler.laneForSrc('signer:GET /fapi/v2/balance')).toBe('P2');
        expect(scheduler.laneForSrc('signer:GET /fapi/v1/order')).toBe('P2');
        expect(scheduler.laneForSrc('signer:GET /fapi/v1/openOrders')).toBe('P2');
    });

    test('marketFeed klines-init → P3', () => {
        expect(scheduler.laneForSrc('marketFeed:klines-init')).toBe('P3');
    });

    test('marketFeed live data → P4', () => {
        expect(scheduler.laneForSrc('marketFeed:alt-klines')).toBe('P4');
        expect(scheduler.laneForSrc('marketFeed:funding')).toBe('P4');
        expect(scheduler.laneForSrc('marketFeed:oi')).toBe('P4');
    });

    test('marketRadar + serverLiquidity → P5', () => {
        expect(scheduler.laneForSrc('marketRadar:ticker24h')).toBe('P5');
        expect(scheduler.laneForSrc('marketRadar:oi')).toBe('P5');
        expect(scheduler.laneForSrc('marketRadar:funding')).toBe('P5');
        expect(scheduler.laneForSrc('serverLiquidity:depth')).toBe('P5');
    });

    test('unknown source → P5 default', () => {
        expect(scheduler.laneForSrc('mystery:something')).toBe('P5');
        expect(scheduler.laneForSrc('')).toBe('P5');
        expect(scheduler.laneForSrc(null)).toBe('P5');
        expect(scheduler.laneForSrc(undefined)).toBe('P5');
    });
});

describe('binanceScheduler — canProceed thresholds (deterministic)', () => {
    // Use fixed RNG=0 for deterministic P4 probabilistic accept tests
    beforeEach(() => {
        scheduler._setRngForTest(() => 0.5);  // mid-value: triggers reject when prob<0.5, accept when prob>=0.5
    });

    test('P0 always accepted regardless of pressure', () => {
        for (const p of [0, 0.5, 0.85, 0.95, 0.99]) {
            const r = scheduler.canProceed({ pressure: p, src: 'signer:POST /fapi/v1/order' });
            expect(r.accept).toBe(true);
            expect(r.lane).toBe('P0');
        }
    });

    test('P1 always accepted regardless of pressure', () => {
        for (const p of [0, 0.5, 0.95, 0.99]) {
            const r = scheduler.canProceed({ pressure: p, src: 'serverAT:recon-positionRisk' });
            expect(r.accept).toBe(true);
            expect(r.lane).toBe('P1');
        }
    });

    test('P2 rejected at >= 95% pressure', () => {
        expect(scheduler.canProceed({ pressure: 0.94, src: 'signer:GET /fapi/v2/balance' }).accept).toBe(true);
        const r = scheduler.canProceed({ pressure: 0.95, src: 'signer:GET /fapi/v2/balance' });
        expect(r.accept).toBe(false);
        expect(r.lane).toBe('P2');
        expect(r.reason).toBe('threshold_reject');
    });

    test('P3 rejected at >= 90% pressure', () => {
        expect(scheduler.canProceed({ pressure: 0.89, src: 'marketFeed:klines-init' }).accept).toBe(true);
        const r = scheduler.canProceed({ pressure: 0.90, src: 'marketFeed:klines-init' });
        expect(r.accept).toBe(false);
        expect(r.lane).toBe('P3');
    });

    test('P5 rejected at >= 70% pressure', () => {
        expect(scheduler.canProceed({ pressure: 0.69, src: 'marketRadar:oi' }).accept).toBe(true);
        const r = scheduler.canProceed({ pressure: 0.70, src: 'marketRadar:oi' });
        expect(r.accept).toBe(false);
        expect(r.lane).toBe('P5');
    });

    test('P4 below 80% always accepts', () => {
        const r = scheduler.canProceed({ pressure: 0.79, src: 'marketFeed:alt-klines' });
        expect(r.accept).toBe(true);
        expect(r.lane).toBe('P4');
    });

    test('P4 between 80-89% probabilistic (acceptProb=0.5) — RNG 0.5 → reject (>=, exclusive)', () => {
        scheduler._setRngForTest(() => 0.51);  // > 0.50 → reject
        const r = scheduler.canProceed({ pressure: 0.85, src: 'marketFeed:alt-klines' });
        expect(r.accept).toBe(false);
        expect(r.reason).toBe('probabilistic_reject');
    });

    test('P4 between 80-89% probabilistic — RNG 0.49 → accept', () => {
        scheduler._setRngForTest(() => 0.49);  // < 0.50 → accept
        const r = scheduler.canProceed({ pressure: 0.85, src: 'marketFeed:alt-klines' });
        expect(r.accept).toBe(true);
        expect(r.lane).toBe('P4');
    });

    test('P4 between 90-94% probabilistic acceptProb=0.20', () => {
        scheduler._setRngForTest(() => 0.21);  // > 0.20 → reject
        expect(scheduler.canProceed({ pressure: 0.92, src: 'marketFeed:alt-klines' }).accept).toBe(false);
        scheduler._setRngForTest(() => 0.19);  // < 0.20 → accept
        expect(scheduler.canProceed({ pressure: 0.92, src: 'marketFeed:alt-klines' }).accept).toBe(true);
    });

    test('P4 above 95% acceptProb=0.10', () => {
        scheduler._setRngForTest(() => 0.11);  // > 0.10 → reject
        expect(scheduler.canProceed({ pressure: 0.97, src: 'marketFeed:alt-klines' }).accept).toBe(false);
        scheduler._setRngForTest(() => 0.09);  // < 0.10 → accept
        expect(scheduler.canProceed({ pressure: 0.97, src: 'marketFeed:alt-klines' }).accept).toBe(true);
    });
});

describe('binanceScheduler — reject response shape', () => {
    test('reject response includes lane, pressure, retryable, reason', () => {
        const r = scheduler.canProceed({ pressure: 0.85, src: 'marketRadar:oi' });
        expect(r.accept).toBe(false);
        expect(r.lane).toBe('P5');
        expect(r.pressure).toBe(0.85);
        expect(r.retryable).toBe(true);
        expect(r.reason).toBe('threshold_reject');
    });

    test('accept response includes lane', () => {
        const r = scheduler.canProceed({ pressure: 0.5, src: 'marketRadar:oi' });
        expect(r.accept).toBe(true);
        expect(r.lane).toBe('P5');
    });
});

describe('binanceScheduler — stats introspection', () => {
    test('getStats returns counts per lane and per reason', () => {
        scheduler.canProceed({ pressure: 0.5, src: 'marketRadar:oi' });
        scheduler.canProceed({ pressure: 0.75, src: 'marketRadar:oi' });
        scheduler.canProceed({ pressure: 0.99, src: 'signer:POST /fapi/v1/order' });
        const s = scheduler.getStats();
        expect(s.totalDecisions).toBe(3);
        expect(s.byLane.P5.accepted).toBe(1);
        expect(s.byLane.P5.rejected).toBe(1);
        expect(s.byLane.P0.accepted).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceScheduler.test.js --forceExit`
Expected: FAIL — module `'../../server/services/binanceScheduler'` does not exist.

- [ ] **Step 3: Implement scheduler core**

Create `server/services/binanceScheduler.js`:

```js
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

// Pluggable RNG for deterministic tests
let _rng = Math.random;

// Stats tracking
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

    // P0 and P1 — sacred, always accept
    if (lane === 'P0' || lane === 'P1') {
        _stats.byLane[lane].accepted++;
        return { accept: true, lane, pressure };
    }

    // P5 hard reject at 70%
    if (lane === 'P5' && pressure >= 0.70) {
        _stats.byLane.P5.rejected++;
        _incReason('threshold_reject');
        return { accept: false, lane, pressure, retryable: true, reason: 'threshold_reject' };
    }

    // P3 hard reject at 90%
    if (lane === 'P3' && pressure >= 0.90) {
        _stats.byLane.P3.rejected++;
        _incReason('threshold_reject');
        return { accept: false, lane, pressure, retryable: true, reason: 'threshold_reject' };
    }

    // P2 hard reject at 95%
    if (lane === 'P2' && pressure >= 0.95) {
        _stats.byLane.P2.rejected++;
        _incReason('threshold_reject');
        return { accept: false, lane, pressure, retryable: true, reason: 'threshold_reject' };
    }

    // P4 probabilistic accept
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

    // Otherwise accept (below thresholds for P2/P3/P5)
    _stats.byLane[lane].accepted++;
    return { accept: true, lane, pressure };
}

function getStats() {
    // Deep copy to prevent external mutation
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
```

- [ ] **Step 4: Run test to verify passes**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceScheduler.test.js --forceExit`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/binanceScheduler.js tests/unit/binanceScheduler.test.js
git commit -m "[Phase A.2] binanceScheduler core — lane mapping + threshold rules

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Critical section ref-counted (RED + GREEN)

**Files:**
- Modify: `server/services/binanceScheduler.js` — add critical section API
- Modify: `tests/unit/binanceScheduler.test.js` — append tests

- [ ] **Step 1: Append failing tests**

Add to `tests/unit/binanceScheduler.test.js` (after existing describe blocks):

```js
describe('binanceScheduler — critical section ref-counted', () => {
    test('beginCriticalSection adds to active map', () => {
        scheduler.beginCriticalSection('order-1');
        expect(scheduler.getActiveCriticalSections()).toBe(1);
    });

    test('endCriticalSection removes from active map', () => {
        scheduler.beginCriticalSection('order-1');
        scheduler.endCriticalSection('order-1');
        expect(scheduler.getActiveCriticalSections()).toBe(0);
    });

    test('two overlapping sections — end of one does NOT release until both ended', () => {
        scheduler.beginCriticalSection('order-A');
        scheduler.beginCriticalSection('order-B');
        expect(scheduler.getActiveCriticalSections()).toBe(2);
        scheduler.endCriticalSection('order-A');
        expect(scheduler.getActiveCriticalSections()).toBe(1);
        scheduler.endCriticalSection('order-B');
        expect(scheduler.getActiveCriticalSections()).toBe(0);
    });

    test('beginCriticalSection with same opId is idempotent (no double-count)', () => {
        scheduler.beginCriticalSection('order-1');
        scheduler.beginCriticalSection('order-1');
        expect(scheduler.getActiveCriticalSections()).toBe(1);
    });

    test('endCriticalSection on unknown opId is no-op', () => {
        scheduler.endCriticalSection('never-started');
        expect(scheduler.getActiveCriticalSections()).toBe(0);
    });

    test('expired sections are cleaned lazily on next access', () => {
        scheduler._setNowForTest(1000);
        scheduler.beginCriticalSection('order-1', 100);  // expires at 1100
        expect(scheduler.getActiveCriticalSections()).toBe(1);
        scheduler._setNowForTest(1200);  // past expiry
        expect(scheduler.getActiveCriticalSections()).toBe(0);  // lazy cleanup
    });

    test('during critical section P3/P4/P5 always reject regardless of pressure', () => {
        scheduler.beginCriticalSection('order-1');
        // Even at low pressure, P5 rejected
        const r5 = scheduler.canProceed({ pressure: 0.10, src: 'marketRadar:oi' });
        expect(r5.accept).toBe(false);
        expect(r5.reason).toBe('critical_section');
        // P4 also rejected (overrides probabilistic accept)
        const r4 = scheduler.canProceed({ pressure: 0.10, src: 'marketFeed:alt-klines' });
        expect(r4.accept).toBe(false);
        expect(r4.reason).toBe('critical_section');
        // P3 rejected
        const r3 = scheduler.canProceed({ pressure: 0.10, src: 'marketFeed:klines-init' });
        expect(r3.accept).toBe(false);
        expect(r3.reason).toBe('critical_section');
    });

    test('during critical section P0/P1/P2 still accept (preserved)', () => {
        scheduler.beginCriticalSection('order-1');
        expect(scheduler.canProceed({ pressure: 0.10, src: 'signer:POST /fapi/v1/order' }).accept).toBe(true);
        expect(scheduler.canProceed({ pressure: 0.10, src: 'serverAT:recon-positionRisk' }).accept).toBe(true);
        expect(scheduler.canProceed({ pressure: 0.10, src: 'signer:GET /fapi/v2/balance' }).accept).toBe(true);
    });

    test('after endCriticalSection P3/P4/P5 resume normal threshold rules', () => {
        scheduler.beginCriticalSection('order-1');
        scheduler.endCriticalSection('order-1');
        // P5 at low pressure accepts again
        expect(scheduler.canProceed({ pressure: 0.10, src: 'marketRadar:oi' }).accept).toBe(true);
    });

    test('default maxMs is 5000', () => {
        scheduler._setNowForTest(1000);
        scheduler.beginCriticalSection('order-1');
        scheduler._setNowForTest(5999);
        expect(scheduler.getActiveCriticalSections()).toBe(1);  // still active
        scheduler._setNowForTest(6001);
        expect(scheduler.getActiveCriticalSections()).toBe(0);  // expired
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceScheduler.test.js --forceExit`
Expected: FAIL — `beginCriticalSection`, `endCriticalSection`, `getActiveCriticalSections`, `_setNowForTest` undefined.

- [ ] **Step 3: Add critical section implementation**

In `server/services/binanceScheduler.js`, locate the existing module body. After the `_stats` block but BEFORE `function canProceed`, add:

```js
// Critical section ref-counted state
const CRITICAL_SECTION_DEFAULT_MS = 5000;
let _criticalSections = new Map();  // opId → expiresAt (ms)
let _now = null;  // test override; null → Date.now()

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
```

- [ ] **Step 4: Wire critical section check into canProceed**

In `canProceed`, find the `// P0 and P1 — sacred, always accept` block. AFTER that block (so P0/P1 stay protected) but BEFORE the lane-specific threshold checks, add:

```js
    // Critical section override — when active, reject all P3/P4/P5 regardless of pressure
    if (_isCriticalSectionActive() && (lane === 'P3' || lane === 'P4' || lane === 'P5')) {
        _stats.byLane[lane].rejected++;
        _incReason('critical_section');
        return { accept: false, lane, pressure, retryable: true, reason: 'critical_section' };
    }
```

So the structure becomes:

```js
function canProceed({ pressure, src }) {
    const lane = laneForSrc(src);
    _stats.totalDecisions++;

    // P0 and P1 — sacred, always accept
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

    // ... rest unchanged (P5 reject 70%, P3 reject 90%, P2 reject 95%, P4 probabilistic)
}
```

- [ ] **Step 5: Add `_setNowForTest` test helper**

In the test helpers block at the end of the file, before `module.exports`, add:

```js
function _setNowForTest(ts) { _now = ts; }
```

In `_resetForTest`, add `_criticalSections = new Map(); _now = null;`:

```js
function _resetForTest() {
    _stats = { /* ... */ };
    _rng = Math.random;
    _criticalSections = new Map();
    _now = null;
}
```

In `module.exports`, add the new public exports + test helper:

```js
module.exports = {
    laneForSrc,
    canProceed,
    getStats,
    beginCriticalSection,
    endCriticalSection,
    getActiveCriticalSections,
    _resetForTest,
    _setRngForTest,
    _setNowForTest,
};
```

- [ ] **Step 6: Run tests to verify all pass**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceScheduler.test.js --forceExit`
Expected: PASS — all tests including new critical section tests.

- [ ] **Step 7: Commit**

```bash
cd /root/zeus-terminal && git add server/services/binanceScheduler.js tests/unit/binanceScheduler.test.js
git commit -m "[Phase A.2] critical section ref-counted with lazy expiry cleanup

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Wire scheduler into wrapFetch (RED + GREEN)

**Files:**
- Modify: `server/services/binanceTelemetry.js` — call `scheduler.canProceed` in wrapFetch
- Modify: `tests/unit/binanceTelemetry.test.js` — append tests

- [ ] **Step 1: Append failing tests**

Add to `tests/unit/binanceTelemetry.test.js` (after the existing describe blocks):

```js
describe('binanceTelemetry — scheduler integration (Phase A.2)', () => {
    test('wrapFetch returns synthetic 503 when scheduler rejects', async () => {
        // Seed pressure at 75% — P5 reject at 70%
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 4500,  // 75%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'marketRadar:oi' });
        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(503);
        expect(res.ok).toBe(false);
        const body = await res.json();
        expect(body.code).toBe('BINANCE_SCHEDULER_BACKPRESSURE');
        expect(body.lane).toBe('P5');
        expect(body.retryable).toBe(true);
        expect(body.synthetic).toBe(true);
        expect(body.pressure).toBeCloseTo(0.75, 2);
    });

    test('wrapFetch records rejectedByScheduler flag in stats', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 4500,
        });
        const fakeFetch = async () => ({ status: 200 });
        await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'marketRadar:oi' });
        const snap = telemetry.getSnapshot();
        expect(snap.bySource['marketRadar:oi'].rejectedByScheduler).toBe(1);
    });

    test('wrapFetch P0 always proceeds even at extreme pressure', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'signer:warmup',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 5950,  // 99.2%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) }; };
        await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'signer:POST /fapi/v1/order' });
        expect(fetchCalled).toBe(true);  // P0 proceeds
    });

    test('wrapFetch low pressure allows normal flow', async () => {
        telemetry.recordCall({
            host: 'fapi.binance.com', path: '/seed', source: 'marketRadar',
            weight: 1, status: 200, latencyMs: 1, usedWeight: 1000,  // 16.7%
        });
        let fetchCalled = false;
        const fakeFetch = async () => { fetchCalled = true; return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({}) }; };
        const res = await telemetry.wrapFetch(fakeFetch, 'https://fapi.binance.com/x', { __src: 'marketRadar:oi' });
        expect(fetchCalled).toBe(true);
        expect(res.status).toBe(200);
    });

    test('getSnapshot exposes schedulerStats', () => {
        const snap = telemetry.getSnapshot();
        expect(snap.schedulerStats).toBeDefined();
        expect(snap.schedulerStats.byLane).toBeDefined();
        expect(snap.schedulerStats.totalDecisions).toBeGreaterThanOrEqual(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceTelemetry.test.js --forceExit`
Expected: FAIL — wrapFetch doesn't yet check scheduler; tests expect status 503 but get 200.

- [ ] **Step 3: Wire scheduler into wrapFetch**

In `server/services/binanceTelemetry.js`, find the existing `wrapFetch` function (around line 90). The current implementation has the Phase A.1 gate:

```js
async function wrapFetch(fetchFn, url, opts) {
    const src = (opts && opts.__src) || 'unknown';
    let host = 'unknown', path = '/';
    try {
        const u = new URL(url);
        host = u.host;
        path = u.pathname;
    } catch (_) { /* leave defaults */ }

    // [Phase A.1 2026-05-19] Preemptive gate — if Binance reported usedWeight
    // is over threshold, refuse to issue the request and synthesize a 429
    // response. ...
    if (shouldBlockForPressure(host, src)) {
        // ... returns synthetic 429
    }

    const t0 = Date.now();
    try {
        const res = await fetchFn(url, opts);
        // ... record call
        return res;
    } catch (err) {
        // ... record error
        throw err;
    }
}
```

Insert the scheduler check BEFORE the A.1 gate. The scheduler should be the FIRST decision in the pipeline. Modify the function to:

```js
async function wrapFetch(fetchFn, url, opts) {
    const src = (opts && opts.__src) || 'unknown';
    let host = 'unknown', path = '/';
    try {
        const u = new URL(url);
        host = u.host;
        path = u.pathname;
    } catch (_) { /* leave defaults */ }

    // [Phase A.2 2026-05-19] Scheduler — priority lanes + critical section.
    // Sits BEFORE Phase A.1 gate so lane-based rejection fires earlier than
    // the binary header threshold. P0 (order ops) and P1 (recon) are never
    // rejected by the scheduler; P2-P5 follow threshold table.
    const pressure = getQuotaPressure(host);
    let _scheduler = null;
    try { _scheduler = require('./binanceScheduler'); } catch (_) { _scheduler = null; }
    if (_scheduler) {
        const decision = _scheduler.canProceed({ pressure, src });
        if (!decision.accept) {
            recordCall({
                host, path, source: src,
                weight: 0,
                status: 503,
                latencyMs: 0,
                usedWeight: null,
                rejectedByScheduler: true,
            });
            const msg = `synthetic 503 scheduler backpressure — lane=${decision.lane} pressure=${(pressure * 100).toFixed(1)}% reason=${decision.reason}`;
            return {
                status: 503,
                ok: false,
                headers: { get: () => null },
                json: async () => ({
                    code: 'BINANCE_SCHEDULER_BACKPRESSURE',
                    lane: decision.lane,
                    pressure: decision.pressure,
                    retryable: !!decision.retryable,
                    synthetic: true,
                    reason: decision.reason,
                    msg,
                }),
            };
        }
    }

    // [Phase A.1 2026-05-19] Preemptive gate — if Binance reported usedWeight
    // is over threshold, refuse to issue the request and synthesize a 429
    // response. (Existing logic UNCHANGED.)
    if (shouldBlockForPressure(host, src)) {
        const lastUsed = Math.round(pressure * QUOTA_CAP);
        recordCall({
            host, path, source: src,
            weight: 0,
            status: 429,
            latencyMs: 0,
            usedWeight: lastUsed,
            blockedByPressure: true,
        });
        const msg = `preemptive synthetic 429 — quota pressure ${(pressure * 100).toFixed(1)}% (lastUsedWeight=${lastUsed}/${QUOTA_CAP})`;
        return {
            status: 429,
            ok: false,
            headers: { get: (k) => k.toLowerCase() === 'x-mbx-used-weight-1m' ? String(lastUsed) : null },
            json: async () => ({ msg, code: -1003 }),
        };
    }

    const t0 = Date.now();
    try {
        const res = await fetchFn(url, opts);
        const latencyMs = Date.now() - t0;
        const usedWeight = parseUsedWeight(res && res.headers);
        recordCall({
            host, path, source: src,
            weight: (opts && typeof opts.__weight === 'number') ? opts.__weight : 0,
            status: res ? res.status : 0,
            latencyMs,
            usedWeight,
        });
        return res;
    } catch (err) {
        const latencyMs = Date.now() - t0;
        recordCall({
            host, path, source: src,
            weight: 0,
            status: 0,
            latencyMs,
            networkError: true,
        });
        throw err;
    }
}
```

- [ ] **Step 4: Add `rejectedByScheduler` field to recordCall**

In `recordCall` function (around line 29), update the field list:

```js
function recordCall(entry) {
    if (!entry || typeof entry !== 'object') return;
    _ring.push({
        ts: _ts(),
        host: entry.host || 'unknown',
        path: entry.path || '/',
        source: entry.source || 'unknown',
        weight: typeof entry.weight === 'number' ? entry.weight : 0,
        status: typeof entry.status === 'number' ? entry.status : 0,
        latencyMs: typeof entry.latencyMs === 'number' ? entry.latencyMs : 0,
        usedWeight: typeof entry.usedWeight === 'number' ? entry.usedWeight : null,
        networkError: !!entry.networkError,
        blockedByPressure: !!entry.blockedByPressure,
        rejectedByScheduler: !!entry.rejectedByScheduler,
    });
    _prune();
}
```

- [ ] **Step 5: Update `_aggregateBySource` to count `rejectedByScheduler`**

In `_aggregateBySource`, update the per-source seed object and increment block:

```js
function _aggregateBySource() {
    _prune();
    const out = {};
    for (const e of _ring) {
        if (!out[e.source]) {
            out[e.source] = { calls: 0, weightSum: 0, errors2xx: 0, errors4xx: 0, errors5xx: 0, networkErrors: 0, latencySum: 0, blockedByPressure: 0, rejectedByScheduler: 0 };
        }
        const s = out[e.source];
        s.calls++;
        s.weightSum += e.weight;
        s.latencySum += e.latencyMs;
        if (e.blockedByPressure) s.blockedByPressure++;
        if (e.rejectedByScheduler) s.rejectedByScheduler++;
        if (e.networkError) s.networkErrors++;
        else if (e.status >= 200 && e.status < 300) {
            s.errors2xx++;
        } else if (e.status >= 400 && e.status < 500) s.errors4xx++;
        else if (e.status >= 500) s.errors5xx++;
    }
    return out;
}
```

- [ ] **Step 6: Expose schedulerStats in getSnapshot**

In `getSnapshot`, add `schedulerStats` to the return object:

```js
function getSnapshot() {
    _prune();
    let activePollers = null;
    if (_pollersProvider) {
        try { activePollers = _pollersProvider(); } catch (_) { activePollers = null; }
    }
    const byHost = _aggregateByHost();
    const quotaPressure = {};
    for (const [host, v] of Object.entries(byHost)) {
        quotaPressure[host] = v.lastUsedWeight != null ? v.lastUsedWeight / QUOTA_CAP : 0;
    }
    let schedulerStats = null;
    try { schedulerStats = require('./binanceScheduler').getStats(); } catch (_) { /* optional */ }
    return {
        bootTs: _bootTs,
        uptimeMs: _ts() - _bootTs,
        totalCalls: _ring.length,
        callsPer1min: _countSince(ONE_MIN_MS),
        callsPer5min: _countSince(FIVE_MIN_MS),
        bySource: _aggregateBySource(),
        byHost,
        topEndpoints: _topEndpoints(),
        activePollers,
        quotaPressure,
        quotaThresholds: {
            cap: QUOTA_CAP,
            blockPublicPct: BLOCK_PUBLIC_PCT,
            blockSignedPct: BLOCK_SIGNED_PCT,
        },
        schedulerStats,
    };
}
```

- [ ] **Step 7: Run tests to verify pass**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceTelemetry.test.js --forceExit`
Expected: PASS — all 5 new tests + existing 33 still green = 38/38.

- [ ] **Step 8: Quick sanity load**

```bash
cd /root/zeus-terminal && node -e "
const t = require('./server/services/binanceTelemetry');
const s = require('./server/services/binanceScheduler');
t.recordCall({host:'fapi.binance.com', path:'/x', source:'marketRadar', weight:1, status:200, latencyMs:1, usedWeight:4500});
(async () => {
  let called = false;
  const fake = async () => { called = true; return {status:200, ok:true, headers:{get:()=>null}, json:async()=>({})}; };
  const r = await t.wrapFetch(fake, 'https://fapi.binance.com/y', {__src: 'marketRadar:oi'});
  console.log('called:', called, 'status:', r.status);
  const body = await r.json();
  console.log('body:', JSON.stringify(body));
  process.exit(0);
})();
"
```

Expected: `called: false`, `status: 503`, body contains `BINANCE_SCHEDULER_BACKPRESSURE`, `lane: P5`, `synthetic: true`.

- [ ] **Step 9: Commit**

```bash
cd /root/zeus-terminal && git add server/services/binanceTelemetry.js tests/unit/binanceTelemetry.test.js
git commit -m "[Phase A.2] wire scheduler into wrapFetch (synthetic 503 backpressure)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Auto critical section in binanceSigner for order ops (RED + GREEN)

**Files:**
- Modify: `server/services/binanceSigner.js` — auto begin/endCriticalSection
- Modify: `tests/unit/binanceScheduler.test.js` OR create separate signer test

- [ ] **Step 1: Append failing tests**

Add to `tests/unit/binanceScheduler.test.js` (after existing critical section tests):

```js
describe('binanceScheduler — auto critical section detection helper', () => {
    test('isOrderOp detects POST /fapi/v1/order', () => {
        expect(scheduler.isOrderOp('POST', '/fapi/v1/order')).toBe(true);
    });

    test('isOrderOp detects POST /fapi/v1/algoOrder', () => {
        expect(scheduler.isOrderOp('POST', '/fapi/v1/algoOrder')).toBe(true);
    });

    test('isOrderOp detects DELETE /fapi/v1/order (cancel)', () => {
        expect(scheduler.isOrderOp('DELETE', '/fapi/v1/order')).toBe(true);
        expect(scheduler.isOrderOp('DELETE', '/fapi/v1/algoOrder')).toBe(true);
    });

    test('isOrderOp detects POST /fapi/v1/leverage and marginType', () => {
        expect(scheduler.isOrderOp('POST', '/fapi/v1/leverage')).toBe(true);
        expect(scheduler.isOrderOp('POST', '/fapi/v1/marginType')).toBe(true);
    });

    test('isOrderOp returns false for GET requests', () => {
        expect(scheduler.isOrderOp('GET', '/fapi/v2/balance')).toBe(false);
        expect(scheduler.isOrderOp('GET', '/fapi/v2/positionRisk')).toBe(false);
        expect(scheduler.isOrderOp('GET', '/fapi/v1/order')).toBe(false);  // query, not place
    });

    test('isOrderOp returns false for non-order POST', () => {
        // No such endpoint, but defensive
        expect(scheduler.isOrderOp('POST', '/fapi/v1/userTrades')).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceScheduler.test.js --forceExit`
Expected: FAIL — `isOrderOp` is not exported.

- [ ] **Step 3: Add `isOrderOp` helper to binanceScheduler.js**

In `server/services/binanceScheduler.js`, after `laneForSrc` function (around line 50), add:

```js
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
```

Then add `isOrderOp` to `module.exports`:

```js
module.exports = {
    laneForSrc,
    canProceed,
    getStats,
    beginCriticalSection,
    endCriticalSection,
    getActiveCriticalSections,
    isOrderOp,
    _resetForTest,
    _setRngForTest,
    _setNowForTest,
};
```

- [ ] **Step 4: Run tests to verify isOrderOp tests pass**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceScheduler.test.js --forceExit`
Expected: PASS — all scheduler tests including isOrderOp.

- [ ] **Step 5: Wire auto critical section in binanceSigner**

In `server/services/binanceSigner.js`, find the `sendSignedRequest` function. Locate the for-loop that retries the fetch (around line 144). BEFORE the retry loop starts, add auto-detection of order ops:

```js
async function sendSignedRequest(method, path, params = {}, creds = {}) {
  if (!creds.apiKey || !creds.apiSecret) {
    throw new Error('Exchange credentials required — connect your API keys in Settings');
  }

  // [BE-04] Per-user circuit breaker key — userId preferred, fallback to apiKey
  const _cbKey = creds.userId ? String(creds.userId) : creds.apiKey;

  // ... existing IP-CB check + circuit breaker check + baseUrl check ...

  const baseUrl = creds.baseUrl;
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 300;

  // [Phase A.2 2026-05-19] Auto critical section for order ops. begin BEFORE
  // first attempt, end in finally after all retries done (success OR failure).
  // Ensures lane-based degradation paused for the entire order pipeline.
  let _criticalOpId = null;
  try {
    const _scheduler = require('./binanceScheduler');
    if (_scheduler.isOrderOp(method, path)) {
      _criticalOpId = `signer:${creds.userId || creds.apiKey}:${method}:${path}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
      _scheduler.beginCriticalSection(_criticalOpId);
    }
  } catch (_) { _criticalOpId = null; }

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // ... existing retry loop body UNCHANGED ...
    }
  } finally {
    if (_criticalOpId) {
      try { require('./binanceScheduler').endCriticalSection(_criticalOpId); } catch (_) {}
    }
  }
}
```

Read the existing function carefully and wrap the existing for-loop in the try/finally as shown above. The existing internal logic of the loop stays UNCHANGED.

Concrete diff approach:

Find:
```js
  const baseUrl = creds.baseUrl;
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 300;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
```

Replace with:
```js
  const baseUrl = creds.baseUrl;
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 300;

  // [Phase A.2 2026-05-19] Auto critical section for order ops — begin before
  // retry loop, end in finally so lane-based degradation pauses for the entire
  // order pipeline (place + algoOrder for SL/TP + retries).
  let _criticalOpId = null;
  try {
    const _scheduler = require('./binanceScheduler');
    if (_scheduler.isOrderOp(method, path)) {
      _criticalOpId = `signer:${creds.userId || creds.apiKey}:${method}:${path}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
      _scheduler.beginCriticalSection(_criticalOpId);
    }
  } catch (_) { _criticalOpId = null; }

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
```

And find the closing `}` of the for-loop, then the closing `}` of the async function. Insert finally BEFORE the function's closing `}`:

Actually the cleanest is: locate the existing `for (let attempt = 0; ...)` block, find its closing brace (end of for loop). After that, add the closing of the outer try plus finally:

The structure becomes:

```js
async function sendSignedRequest(method, path, params = {}, creds = {}) {
  // ... existing prelude ...

  // [Phase A.2] Begin critical section
  let _criticalOpId = null;
  try {
    const _scheduler = require('./binanceScheduler');
    if (_scheduler.isOrderOp(method, path)) {
      _criticalOpId = `signer:${creds.userId || creds.apiKey}:${method}:${path}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
      _scheduler.beginCriticalSection(_criticalOpId);
    }
  } catch (_) { _criticalOpId = null; }

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // ... existing loop body UNCHANGED ...
    }
  } finally {
    if (_criticalOpId) {
      try { require('./binanceScheduler').endCriticalSection(_criticalOpId); } catch (_) {}
    }
  }
}
```

CRITICAL: The for-loop body has `throw err` and `return data` paths. Both must trigger the finally. JavaScript guarantees finally runs on both return and throw, so this is correct.

WAIT — the function as-is doesn't have an explicit return after the for-loop. The loop body either returns data (success) or throws err (failure). Either way, control exits the for-loop early. The finally must catch BOTH paths. This is exactly what try/finally does in JavaScript, so the wrap is safe.

- [ ] **Step 6: Verify sendSignedRequest still works**

Run: `cd /root/zeus-terminal && npx jest tests/unit/binanceSigner.test.js --forceExit 2>&1 | tail -10`

If `binanceSigner.test.js` doesn't exist OR has no failures, we're good. If existing tests fail because they don't have the scheduler module mocked, ensure that `_scheduler.isOrderOp` returns boolean and `try/catch` swallows any error — the wrap is best-effort.

- [ ] **Step 7: Sanity load**

```bash
cd /root/zeus-terminal && node -e "
const signer = require('./server/services/binanceSigner');
const sched = require('./server/services/binanceScheduler');
console.log('signer loads OK:', typeof signer.sendSignedRequest);
console.log('scheduler loads OK:', typeof sched.beginCriticalSection);
sched.beginCriticalSection('test');
console.log('active sections:', sched.getActiveCriticalSections());
sched.endCriticalSection('test');
console.log('after end:', sched.getActiveCriticalSections());
process.exit(0);
"
```

Expected: signer + scheduler both load; active sections 1 then 0.

- [ ] **Step 8: Commit**

```bash
cd /root/zeus-terminal && git add server/services/binanceSigner.js server/services/binanceScheduler.js tests/unit/binanceScheduler.test.js
git commit -m "[Phase A.2] auto critical section in binanceSigner for order ops

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Full regression + bump + deploy + smoke

**Files:** `server/version.js` (modify) + verification only otherwise

- [ ] **Step 1: Full jest regression**

Run: `cd /root/zeus-terminal && npx jest --forceExit 2>&1 | tail -10`
Expected: 7100+ tests PASS (was 7114 baseline Phase A.1+C; Phase A.2 adds ~30 new scheduler tests + ~5 new telemetry tests). Total ~7150 PASS, 0 NEW failures (pre-existing 5 unchanged is OK).

- [ ] **Step 2: Bump version**

Edit `server/version.js`. Change `version: '1.7.94'` → `version: '1.7.95'`, `build: 120` → `build: 121`. Prepend new changelog entry:

```js
'b121 v1.7.95 — BIN-TELEM Phase A.2 priority lanes + critical section 2026-05-19. Adds binanceScheduler.js with 6-lane priority queue (P0 sacred order ops, P1 sacred reconciliation, P2 signed status, P3 init snapshots, P4 live data graceful-degrade, P5 cosmetic) wrapping wrapFetch as FIRST decision point. Phone Claude review-driven design: instant-reject (no queue buildup), P0+P1 never rejected, P4 probabilistic accept (50%/20%/10% at 80/90/95% pressure — alt-klines degrade not pause, brain keeps data flow), ref-counted critical sections (Map<opId, expiresAt>, lazy cleanup, 5s default timeout). Structured 503 backpressure response: {code: BINANCE_SCHEDULER_BACKPRESSURE, lane, pressure, retryable, synthetic, reason}. Auto critical section in binanceSigner.sendSignedRequest detects order ops (POST/DELETE order/algoOrder + POST leverage/marginType) and wraps entire retry pipeline in begin/endCriticalSection — during section, P3/P4/P5 reject regardless of pressure, preserving weight for order. Defense in depth: Phase A.1 (95%/97% gate) + Phase B (leak fix) + Phase C (tab dedupe) all preserved. Scheduler is per-host process-global (ARCH-3 unaffected). +~35 jest tests (binanceScheduler.test.js 20+ + binanceTelemetry integration 5). Phase 2 fusion math UNTOUCHED. getSnapshot exposes schedulerStats (byLane/byReason/totalDecisions) for diag. Next: Phase D Binance Futures WS unblock (infra), sau soak 24h all 4 phases combined.',
```

- [ ] **Step 3: Commit version bump**

```bash
cd /root/zeus-terminal && git add server/version.js
git commit -m "[Phase A.2] bump v1.7.95 b121 — priority lanes + critical section

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 4: Tag + PM2 reload + smoke**

```bash
cd /root/zeus-terminal && git tag post-v2/PHASE-A2-121 HEAD
pm2 reload zeus
sleep 5
curl -s http://127.0.0.1:3000/api/diag/binance-rates | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('=== Post-PhaseA2 smoke ===')
print('schedulerStats present:', 'schedulerStats' in d)
print('schedulerStats:', json.dumps(d.get('schedulerStats'), indent=2))
print()
print('quotaThresholds (A.1 still active):', d.get('quotaThresholds'))
print('pollers (B preserved):', d['activePollers']['marketFeed']['altKlinePollersCount'])
print('symbolRefsTotal (B preserved):', d['activePollers']['marketFeed'].get('symbolRefsTotal'))
"
```

Expected: schedulerStats present with byLane counts non-zero (some calls already happened post-boot), quotaThresholds still showing 6000/95/97, pollers 12 + refs ≥ 4 (Phase B preserved).

- [ ] **Step 5: Push branch + tag**

```bash
cd /root/zeus-terminal && git push origin omega/wave-1-foundation
git push origin post-v2/PHASE-A2-121
```

- [ ] **Step 6: Save baseline T+0-post-PhaseA2 for soak**

```bash
cd /root/zeus-terminal && curl -s http://127.0.0.1:3000/api/diag/binance-rates > /tmp/zeus-T0-postPhaseA2.json
echo "Saved $(wc -c < /tmp/zeus-T0-postPhaseA2.json) bytes"
```

---

# Self-Review Checklist

**1. Spec coverage:**
- ✅ Lane mapping P0..P5 with patterns → Task 1
- ✅ Threshold rules (P0+P1 sacred, P2 95%, P3 90%, P4 probabilistic, P5 70%) → Task 1
- ✅ Synthetic 503 structured response → Task 3
- ✅ rejectedByScheduler counter per source → Task 3
- ✅ Critical section ref-counted Map<opId, expiresAt> → Task 2
- ✅ Lazy expiry cleanup → Task 2
- ✅ During section: P3/P4/P5 reject; P0/P1/P2 still accept → Task 2
- ✅ Auto critical section detection in signer → Task 4
- ✅ schedulerStats in getSnapshot → Task 3
- ✅ Deploy + smoke → Task 5

**2. Placeholders:** None — every code block is complete and explicit.

**3. Type consistency:**
- `canProceed({pressure, src})` returns `{accept, lane, pressure, retryable?, reason?}` consistent in Tasks 1-3
- `beginCriticalSection(opId, maxMs?)` / `endCriticalSection(opId)` / `getActiveCriticalSections()` consistent Tasks 2, 4
- `isOrderOp(method, path)` returns boolean, consistent Task 4
- `laneForSrc(src)` returns string lane name, consistent Tasks 1, 3
- `recordCall` adds `rejectedByScheduler: boolean` field; `_aggregateBySource` adds `rejectedByScheduler: number` counter

**4. Defense in depth verified:**
- Phase A.2 scheduler reject (status 503) → caller treats as transient → retry
- Phase A.1 gate (status 429) → binanceSigner._setIpBan → IP-CB 60s
- Phase B ref-count → no leaked pollers
- Phase C tab dedupe → reduced fanout
- All layers compose: scheduler fires earliest, A.1 fires next, B+C work passively

**5. ARCH-3 preserved:** Scheduler is per-host process-global. Critical sections are global. No per-(user × env × symbol) state mutation.

**6. P0/P1 never rejected (operator safety):**
- P0 (order ops) never rejected by scheduler — sacred
- P1 (recon) never rejected by scheduler — sacred
- A.1 gate has signed threshold 97% (higher than scheduler) — extra headroom for signed
- Worst case: order request reaches Binance even at 99% pressure; if Binance returns real 429, `binanceSigner._setIpBan` triggers — last resort
- This is the correct safety architecture: P0/P1 trust Binance's own response over preemptive blocks

**7. Test coverage:**
- Lane mapping 7 tests (one per lane + unknown)
- canProceed deterministic threshold tests 10+ (P0/P1 sacred, P2/P3/P5 reject at threshold, P4 probabilistic at 4 ranges)
- Reject response shape 2 tests
- getStats 1 test
- Critical section 10 tests (begin/end/idempotent/expiry/active rules)
- isOrderOp 6 tests (POST order, algoOrder, DELETE, leverage, marginType, GET=false, other POST=false)
- Telemetry integration 5 tests (synthetic 503, rejectedByScheduler stat, P0 always proceeds, low pressure normal, schedulerStats in snapshot)
- Total ~35 new tests

**8. Risk assessment:**
- **Low risk:** Tasks 1-2 (pure new module, isolated)
- **Medium risk:** Task 3 (modifies hot path wrapFetch — but additive, lazy require with try/catch fallback if scheduler missing)
- **Medium risk:** Task 4 (modifies signer hot path — but lazy require + best-effort, finally guarantees cleanup)
- **Mitigation:** All scheduler calls wrapped in try/catch — if module fails to load or throws, scheduler is bypassed and wrapFetch falls through to existing A.1 logic
- **Test seeding:** P4 probabilistic tests use `_setRngForTest` for determinism
- **Server-only changes** — Phase C client untouched
