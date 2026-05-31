# SP1 — Server Shadow for Testnet (uid=1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server brain shadow-compute uid=1 (testnet) trade *directions* alongside the demo main cycle and log them to `brain_parity_log`, so we accumulate client↔server direction-parity evidence — plus a replay test proving the fusion formula is bit-identical — that (with SP1.5 sizing parity) gates the SP2 cutover. **Zero execution, zero money-path.**

**Architecture:** Add a second, additive shadow cycle (`_runTestnetShadowCycle`) that runs ONLY when the demo main cycle is active (which suppresses the existing `_runShadowCycle`) and ONLY for testnet-live users. It shares the exact symbol/user loop with the existing shadow (DRY → identical formula), writes `source='server'` parity rows via `db.logParityRow`, and never calls execution/telegram/persist. A pure `_fuseDecision()` is extracted from `_computeFusionParity` so a golden-vector replay test can prove server fusion == client fusion bit-for-bit. A gate-evaluation wrapper over the existing `queryParityReport` applies pre-fixed thresholds with a pairing-integrity floor.

**Tech Stack:** Node + Express + better-sqlite3, Jest (server). Client capture is TypeScript (Vite). Live VPS `/root/zeus-terminal`, PM2 process "zeus".

**Spec:** `docs/superpowers/specs/2026-05-31-sp1-server-shadow-testnet-design.md` (Option A scope).

**Operator rules in force:** backup → TDD RED → GREEN → diff → confirm; verifică 3×; checkpoint git after each green step; NEVER `git stash`/`git checkout` on the live repo; English UI / Romanian conversation; this whole plan is shadow-only — no execution path is touched.

**Pre-fixed thresholds (locked before soak, never tuned to pass):**
`N = 98` (primaryAgreementPct ≥ 98), `P = 500` (primaryPairs ≥ 500), `U = 0.05` (primaryUnpaired/(primaryPairs+primaryUnpaired) ≤ 5%), `M = 3` (sustained days). Replay epsilon for confidence/score = `0` (formula is identical → bit-identical expected).

---

## Phase 1 — Server testnet shadow + parity gate (actionable now)

### Task 1: `_isTestnetShadowTarget(userId)` helper

**Files:**
- Modify: `server/services/serverBrain.js` (add helper near `_isServerAuthoritativeForUser`, ~line 351; add to module exports ~line 2390)
- Test: `tests/unit/sp1-testnet-shadow-target.test.js`

- [ ] **Step 1: Backup**

```bash
cp server/services/serverBrain.js server/services/serverBrain.js.bak.pre-sp1
```

- [ ] **Step 2: Write the failing test**

```javascript
// tests/unit/sp1-testnet-shadow-target.test.js
const path = require('path');

describe('SP1 _isTestnetShadowTarget', () => {
  let brain, serverAT;
  beforeEach(() => {
    jest.resetModules();
    serverAT = require('../../server/services/serverAT');
    brain = require('../../server/services/serverBrain');
  });

  test('true for a live-mode user whose execution env resolves TESTNET', () => {
    jest.spyOn(serverAT, 'getMode').mockReturnValue('live');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'TESTNET' });
    expect(brain.__sp1.isTestnetShadowTarget(1)).toBe(true);
  });

  test('false for a demo-mode user', () => {
    jest.spyOn(serverAT, 'getMode').mockReturnValue('demo');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'TESTNET' });
    expect(brain.__sp1.isTestnetShadowTarget(2)).toBe(false);
  });

  test('false for a live-mode user whose env is REAL', () => {
    jest.spyOn(serverAT, 'getMode').mockReturnValue('live');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'REAL' });
    expect(brain.__sp1.isTestnetShadowTarget(1)).toBe(false);
  });

  test('false (never throws) when serverAT lookups throw', () => {
    jest.spyOn(serverAT, 'getMode').mockImplementation(() => { throw new Error('boom'); });
    expect(brain.__sp1.isTestnetShadowTarget(1)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/unit/sp1-testnet-shadow-target.test.js -v`
Expected: FAIL — `brain.__sp1` is undefined.

- [ ] **Step 4: Add the helper + a test-only export**

In `server/services/serverBrain.js`, immediately after `_isServerAuthoritativeForUser` (ends ~line 351):

```javascript
// [SP1] Testnet shadow target: a live-mode user whose execution env is TESTNET.
// Flag-independent (purely "is this a testnet-live user") — the SP1 shadow runs
// for these users alongside the demo main cycle, writing parity rows only.
function _isTestnetShadowTarget(userId) {
    try {
        if (serverAT.getMode(userId) !== 'live') return false;
        const execEnv = serverAT._resolveExecutionEnv(userId);
        return !!(execEnv && execEnv.env === 'TESTNET');
    } catch (_) { return false; }
}
```

In the module exports object (~line 2390, alongside `isServerAuthoritativeForUser`), add a test-only namespace:

```javascript
    __sp1: {
        isTestnetShadowTarget: _isTestnetShadowTarget,
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/sp1-testnet-shadow-target.test.js -v`
Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
git add server/services/serverBrain.js tests/unit/sp1-testnet-shadow-target.test.js
git commit -m "feat(sp1): _isTestnetShadowTarget helper for testnet-only shadow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Extract shared shadow loop `_runShadowForUsers(includeUserFn)` (behavior-preserving)

**Files:**
- Modify: `server/services/serverBrain.js` (`_runShadowCycle` ~1511–1577)
- Test: `tests/unit/sp1-shadow-shared-loop.test.js` + existing parity tests must stay green

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/sp1-shadow-shared-loop.test.js
describe('SP1 _runShadowForUsers (shared loop)', () => {
  let brain, serverState, db;
  beforeEach(() => {
    jest.resetModules();
    serverState = require('../../server/services/serverState');
    db = require('../../server/services/database');
    brain = require('../../server/services/serverBrain');

    jest.spyOn(serverState, 'getReadySymbols').mockReturnValue(['BTCUSDT']);
    jest.spyOn(serverState, 'getSnapshotForSymbol').mockReturnValue({
      symbol: 'BTCUSDT', price: 50000, priceTs: Date.now(), stale: false,
      indicators: { regime: 'RANGE', stDir: 'bull' }, rsi: { '5m': 55 },
      fr: -0.001, oi: 100, oiPrev: 90,
    });
    jest.spyOn(serverState, 'getBarsForSymbol').mockReturnValue([]);
  });

  test('logs a server parity row for every included user', () => {
    const seen = [];
    jest.spyOn(db, 'logParityRow').mockImplementation((uid, sym, src) => seen.push([uid, sym, src]));
    // Seed two users in the stc map via the test hook.
    brain.__sp1.setStcForTest(1, { symbols: ['BTCUSDT'] });
    brain.__sp1.setStcForTest(2, { symbols: ['BTCUSDT'] });

    brain.__sp1.runShadowForUsers(uid => uid === 1); // include only uid=1

    expect(seen).toEqual([[1, 'BTCUSDT', 'server']]);
  });

  test('skips a symbol the user has not subscribed to', () => {
    const seen = [];
    jest.spyOn(db, 'logParityRow').mockImplementation((uid, sym) => seen.push([uid, sym]));
    brain.__sp1.setStcForTest(1, { symbols: ['ETHUSDT'] }); // not BTCUSDT
    brain.__sp1.runShadowForUsers(null);
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/sp1-shadow-shared-loop.test.js -v`
Expected: FAIL — `runShadowForUsers` / `setStcForTest` not exported.

- [ ] **Step 3: Refactor `_runShadowCycle` to delegate to `_runShadowForUsers`**

Replace the body of `_runShadowCycle` (lines ~1511–1577) with:

```javascript
function _runShadowCycle() {
    if (_shadowRunning) return;
    // [S6-B1] Suppressed when the main cycle is the active path; SP1's
    // _runTestnetShadowCycle covers testnet users in that case.
    if (!MF.PARITY_SHADOW_ENABLED || _shouldRunMainCycle()) return;
    _shadowRunning = true;
    try {
        _runShadowForUsers(null); // null filter = all users in _stcMap
    } catch (err) {
        logger.warn('BRAIN', '[S3] Shadow cycle error: ' + (err && err.message));
    } finally {
        _shadowRunning = false;
    }
}

// [SP1] Shared shadow body — extracted verbatim from the old _runShadowCycle
// loop so the testnet shadow uses the IDENTICAL formula path (DRY: no drift).
// includeUserFn: (userId) => boolean, or null to include all _stcMap users.
// Writes source='server' parity rows ONLY. No execution / telegram / persist.
function _runShadowForUsers(includeUserFn) {
    const readySymbols = serverState.getReadySymbols();
    if (!readySymbols || readySymbols.length === 0) return;
    if (_stcMap.size === 0) return;

    for (const symbol of readySymbols) {
        const snap = serverState.getSnapshotForSymbol(symbol);
        if (!snap || !snap.indicators) continue;
        if (snap.stale || (Date.now() - snap.priceTs) > STALE_DATA_MS) continue;

        const ind = snap.indicators;
        let confluence, regime, bars;
        try {
            confluence = _calcConfluenceParity(snap, ind);
            regime = {
                regime: ind.regime || 'RANGE',
                confidence: ind.regimeConf || 0,
                trendBias: ind.trendBias || 'neutral',
                volatilityState: ind.volatilityState || 'normal',
                trapRisk: ind.trapRisk || 0,
            };
            bars = serverState.getBarsForSymbol(symbol);
        } catch (_e) { continue; }

        for (const [userId, stc] of _stcMap) {
            if (includeUserFn && !includeUserFn(userId)) continue;
            if (Array.isArray(stc.symbols) && !stc.symbols.includes(symbol)) continue;
            try {
                const fusion = _computeFusionParity(snap, ind, confluence, regime, bars);
                if (!fusion) continue;
                db.logParityRow(userId, symbol, 'server', {
                    dir: fusion.dir,
                    decision: fusion.decision,
                    confidence: fusion.confidence,
                    score: fusion.score,
                    reasons: fusion.reasons,
                }, _cycleCount);
            } catch (_userErr) { /* per-user shadow failure is non-fatal */ }
        }
    }
}
```

Extend the `__sp1` test namespace:

```javascript
    __sp1: {
        isTestnetShadowTarget: _isTestnetShadowTarget,
        runShadowForUsers: _runShadowForUsers,
        setStcForTest: (uid, stc) => { _stcMap.set(uid, stc); },
    },
```

- [ ] **Step 4: Run new + existing shadow tests**

Run: `npx jest tests/unit/sp1-shadow-shared-loop.test.js -v`
Expected: PASS (2/2).
Run the existing parity suite to prove behavior preserved:
`npx jest -t parity 2>&1 | tail -20`
Expected: no NEW failures vs the pre-existing baseline.

- [ ] **Step 5: Commit**

```bash
git add server/services/serverBrain.js tests/unit/sp1-shadow-shared-loop.test.js
git commit -m "refactor(sp1): extract _runShadowForUsers shared loop (behavior-preserving)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `_runTestnetShadowCycle` + second timer wired in `start()`/`stop()`

**Files:**
- Modify: `server/services/serverBrain.js` (state decls ~228; `start()` ~414–421; `stop()` ~601–606; new function near `_runShadowCycle`)
- Test: `tests/unit/sp1-testnet-shadow-cycle.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/sp1-testnet-shadow-cycle.test.js
describe('SP1 _runTestnetShadowCycle', () => {
  let brain, serverState, serverAT, db;
  beforeEach(() => {
    jest.resetModules();
    serverState = require('../../server/services/serverState');
    serverAT = require('../../server/services/serverAT');
    db = require('../../server/services/database');
    brain = require('../../server/services/serverBrain');

    jest.spyOn(serverState, 'getReadySymbols').mockReturnValue(['BTCUSDT']);
    jest.spyOn(serverState, 'getSnapshotForSymbol').mockReturnValue({
      symbol: 'BTCUSDT', price: 50000, priceTs: Date.now(), stale: false,
      indicators: { regime: 'RANGE', stDir: 'bull' }, rsi: { '5m': 55 },
      fr: -0.001, oi: 100, oiPrev: 90,
    });
    jest.spyOn(serverState, 'getBarsForSymbol').mockReturnValue([]);
    brain.__sp1.setStcForTest(1, { symbols: ['BTCUSDT'] }); // testnet-live
    brain.__sp1.setStcForTest(2, { symbols: ['BTCUSDT'] }); // demo
    jest.spyOn(serverAT, 'getMode').mockImplementation(uid => uid === 1 ? 'live' : 'demo');
    jest.spyOn(serverAT, '_resolveExecutionEnv').mockReturnValue({ env: 'TESTNET' });
  });

  test('writes server rows ONLY for testnet-live users (uid=1), not demo (uid=2)', () => {
    const seen = [];
    jest.spyOn(db, 'logParityRow').mockImplementation((uid, sym, src) => seen.push([uid, src]));
    brain.__sp1.setMainCycleActiveForTest(true); // demo main cycle active
    brain.__sp1.runTestnetShadowCycle();
    expect(seen).toEqual([[1, 'server']]);
  });

  test('is a no-op when the main cycle is NOT active (regular shadow covers it)', () => {
    const spy = jest.spyOn(db, 'logParityRow');
    brain.__sp1.setMainCycleActiveForTest(false);
    brain.__sp1.runTestnetShadowCycle();
    expect(spy).not.toHaveBeenCalled();
  });

  test('never calls execution / telegram side-effects', () => {
    const exec = jest.spyOn(serverAT, 'processBrainDecision').mockImplementation(() => {});
    jest.spyOn(db, 'logParityRow').mockImplementation(() => {});
    brain.__sp1.setMainCycleActiveForTest(true);
    brain.__sp1.runTestnetShadowCycle();
    expect(exec).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/sp1-testnet-shadow-cycle.test.js -v`
Expected: FAIL — `runTestnetShadowCycle` / `setMainCycleActiveForTest` not exported.

- [ ] **Step 3: Add state + function + test hooks**

Add near line 230 (`let _shadowRunning = false;`):

```javascript
let _testnetShadowTimer = null;   // [SP1] separate timer for testnet parity shadow
let _testnetShadowRunning = false; // [SP1] re-entry guard
let _mainCycleActiveOverrideForTest = null; // test-only; null in production
```

Add the function next to `_runShadowCycle`:

```javascript
// [SP1] Testnet parity shadow — runs ALONGSIDE the demo main cycle (which
// suppresses _runShadowCycle), scoped to testnet-live users. Writes
// source='server' parity rows only; zero execution / telegram / persist.
function _runTestnetShadowCycle() {
    if (_testnetShadowRunning) return;
    const mainActive = _mainCycleActiveOverrideForTest != null
        ? _mainCycleActiveOverrideForTest : _shouldRunMainCycle();
    // Only fill the gap left by the suppressed regular shadow.
    if (!MF.PARITY_SHADOW_ENABLED || !mainActive) return;
    _testnetShadowRunning = true;
    try {
        _runShadowForUsers(_isTestnetShadowTarget);
    } catch (err) {
        logger.warn('BRAIN', '[SP1] Testnet shadow cycle error: ' + (err && err.message));
    } finally {
        _testnetShadowRunning = false;
    }
}
```

In `start()`, change the guard at line 386 from `if (_timer || _shadowTimer) return;` to:

```javascript
    if (_timer || _shadowTimer || _testnetShadowTimer) return;
```

In `start()`, after the existing `if (_shouldRunMainCycle()) { ... } else if (MF.PARITY_SHADOW_ENABLED) { ... }` block (after line 421), add:

```javascript
    if (_shouldRunMainCycle() && MF.PARITY_SHADOW_ENABLED) {
        // [SP1] Demo main cycle suppresses _runShadowCycle → testnet users get
        // no parity rows. This additive shadow restores them, execution-free.
        logger.info('BRAIN', '[SP1] Testnet parity shadow starting alongside main cycle (testnet-live users, 30s cycle)');
        _testnetShadowTimer = setInterval(_runTestnetShadowCycle, CYCLE_INTERVAL_MS);
        setTimeout(_runTestnetShadowCycle, 7000);
    }
```

In `stop()`, after the `_shadowTimer` cleanup (lines ~601–606), add:

```javascript
    if (_testnetShadowTimer) {
        clearInterval(_testnetShadowTimer);
        _testnetShadowTimer = null;
    }
    _testnetShadowRunning = false;
```

Extend the `__sp1` namespace:

```javascript
    __sp1: {
        isTestnetShadowTarget: _isTestnetShadowTarget,
        runShadowForUsers: _runShadowForUsers,
        runTestnetShadowCycle: _runTestnetShadowCycle,
        setStcForTest: (uid, stc) => { _stcMap.set(uid, stc); },
        setMainCycleActiveForTest: (v) => { _mainCycleActiveOverrideForTest = v; },
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/sp1-testnet-shadow-cycle.test.js -v`
Expected: PASS (3/3).

- [ ] **Step 5: Full server suite — no new regressions**

Run: `npx jest 2>&1 | tail -25`
Expected: same failure count as the known baseline (23 pre-existing), no new failures.

- [ ] **Step 6: Commit**

```bash
git add server/services/serverBrain.js tests/unit/sp1-testnet-shadow-cycle.test.js
git commit -m "feat(sp1): testnet parity shadow cycle alongside demo main cycle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Parity gate evaluation wrapper (pairing-integrity floor)

**Files:**
- Create: `server/services/parityGate.js`
- Create: `scripts/sp1-parity-gate.js` (CLI report)
- Test: `tests/unit/sp1-parity-gate.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/sp1-parity-gate.test.js
const { evaluateParityGate, SP1_THRESHOLDS } = require('../../server/services/parityGate');

function mkReport({ pct, pairs, unpaired }) {
  return { totals: { primaryAgreementPct: pct, primaryPairs: pairs, primaryUnpaired: unpaired } };
}

describe('SP1 evaluateParityGate', () => {
  test('PASS when agreement, pairs, and unpaired-ratio all clear thresholds', () => {
    const r = evaluateParityGate(mkReport({ pct: 99.1, pairs: 800, unpaired: 10 }));
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  test('FAIL on insufficient pairs even at 100% agreement (false-high guard)', () => {
    const r = evaluateParityGate(mkReport({ pct: 100, pairs: 3, unpaired: 0 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('paired');
  });

  test('FAIL when unpaired ratio exceeds U', () => {
    const r = evaluateParityGate(mkReport({ pct: 99, pairs: 600, unpaired: 400 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('unpairedRatio');
  });

  test('FAIL when agreement below N', () => {
    const r = evaluateParityGate(mkReport({ pct: 90, pairs: 800, unpaired: 5 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('agreement');
  });

  test('thresholds are the locked SP1 values', () => {
    expect(SP1_THRESHOLDS).toEqual({ N: 98, P: 500, U: 0.05, M: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/sp1-parity-gate.test.js -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

```javascript
// server/services/parityGate.js
// [SP1] Pure gate evaluation over queryParityReport output. No DB access here —
// caller passes the report so this stays unit-testable and side-effect-free.

// Locked pre-soak (spec 2026-05-31). DO NOT tune to make a soak pass.
const SP1_THRESHOLDS = { N: 98, P: 500, U: 0.05, M: 3 };

function evaluateParityGate(report, thresholds) {
    const t = thresholds || SP1_THRESHOLDS;
    const tot = (report && report.totals) || {};
    const pct = Number(tot.primaryAgreementPct);
    const pairs = Number(tot.primaryPairs) || 0;
    const unpaired = Number(tot.primaryUnpaired) || 0;
    const denom = pairs + unpaired;
    const unpairedRatio = denom > 0 ? unpaired / denom : 1;

    const failures = [];
    if (!(pct >= t.N)) failures.push('agreement');
    if (!(pairs >= t.P)) failures.push('paired');
    if (!(unpairedRatio <= t.U)) failures.push('unpairedRatio');

    return {
        pass: failures.length === 0,
        failures,
        metrics: { agreementPct: pct, pairs, unpaired, unpairedRatio: Number(unpairedRatio.toFixed(4)) },
        thresholds: t,
    };
}

module.exports = { evaluateParityGate, SP1_THRESHOLDS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/sp1-parity-gate.test.js -v`
Expected: PASS (5/5).

- [ ] **Step 5: Add the CLI report script**

```javascript
// scripts/sp1-parity-gate.js
// Usage: node scripts/sp1-parity-gate.js [windowDays]
// Reports the SP1 direction-parity gate status for uid=1 over the window.
const db = require('../server/services/database');
const { evaluateParityGate, SP1_THRESHOLDS } = require('../server/services/parityGate');

const days = Number(process.argv[2]) || SP1_THRESHOLDS.M;
const since = Date.now() - days * 24 * 3600 * 1000;
const report = db.queryParityReport({ userId: 1, since });
const gate = evaluateParityGate(report);

console.log(JSON.stringify({
    windowDays: days,
    sustainedTargetDays: SP1_THRESHOLDS.M,
    gate,
    totals: report.totals,
}, null, 2));
process.exit(gate.pass ? 0 : 1);
```

- [ ] **Step 6: Commit**

```bash
git add server/services/parityGate.js scripts/sp1-parity-gate.js tests/unit/sp1-parity-gate.test.js
git commit -m "feat(sp1): parity gate wrapper with pairing-integrity floor + CLI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Deploy Phase 1 + verify live shadow rows appear

**Files:** none (deploy + verify)

- [ ] **Step 1: Reload PM2 and confirm clean boot**

```bash
pm2 reload zeus --update-env && sleep 8 && pm2 logs zeus --nostream --lines 40 | grep -iE 'SP1|error|brain' | tail -20
```
Expected: `[SP1] Testnet parity shadow starting alongside main cycle` and no crash/restart loop.

- [ ] **Step 2: Wait ~3 cycles, then confirm server rows exist for uid=1**

```bash
sleep 100 && node -e "const db=require('./server/services/database'); const r=db.db.prepare(\"SELECT source, COUNT(*) c FROM brain_parity_log WHERE user_id=1 AND created_at>=? GROUP BY source\").all(Date.now()-600000); console.log(r);"
```
Expected: a `{source:'server', c:>0}` row now exists for uid=1 (previously 0).

- [ ] **Step 3: Run the gate CLI (informational — will not pass yet, soak just started)**

```bash
node scripts/sp1-parity-gate.js 1
```
Expected: JSON with `gate.pass=false` and `failures:["paired"]` early on (sample still accumulating) — proves the wrapper + report wire to live data.

- [ ] **Step 4: Checkpoint commit (deploy marker)**

```bash
git add -A && git commit -m "chore(sp1): deploy Phase 1 testnet shadow (live verify: server rows present)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" --allow-empty
```

---

## Phase 2 — Replay equivalence proof (formula bit-identical)

### Task 6: Extract pure `_fuseDecision()` from `_computeFusionParity` (behavior-preserving)

**Files:**
- Modify: `server/services/serverBrain.js` (`_computeFusionParity` ~1683–1772)
- Test: `tests/unit/sp1-fuse-decision.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/sp1-fuse-decision.test.js
const brain = require('../../server/services/serverBrain');
const fuse = brain.__sp1.fuseDecision;

describe('SP1 _fuseDecision (pure fusion math)', () => {
  test('neutral when dirScore within ±0.15 → NO_TRADE', () => {
    const r = fuse({ conf: 50, ofi: 0, probN: 0.5, regimeN: 0.5, liqDangerN: 0.2, sigDirBonus: 0 });
    expect(r.dir).toBe('neutral');
    expect(r.decision).toBe('NO_TRADE');
  });

  test('strong long inputs → long + a non-NO_TRADE tier', () => {
    const r = fuse({ conf: 90, ofi: 0.9, probN: 0.8, regimeN: 0.75, liqDangerN: 0, sigDirBonus: 0 });
    expect(r.dir).toBe('long');
    expect(['SMALL', 'MEDIUM', 'LARGE']).toContain(r.decision);
  });

  test('sigDirBonus shifts direction (client parity input)', () => {
    const base = fuse({ conf: 55, ofi: 0.1, probN: 0.5, regimeN: 0.55, liqDangerN: 0.2, sigDirBonus: 0 });
    const boosted = fuse({ conf: 55, ofi: 0.1, probN: 0.5, regimeN: 0.55, liqDangerN: 0.2, sigDirBonus: 0.25 });
    expect(base.dir).toBe('neutral');
    expect(boosted.dir).toBe('long');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/sp1-fuse-decision.test.js -v`
Expected: FAIL — `brain.__sp1.fuseDecision` undefined.

- [ ] **Step 3: Extract the pure function and call it from `_computeFusionParity`**

Add before `_computeFusionParity`:

```javascript
// [SP1] Pure fusion math — the steps 7–9 of client computeFusionDecision and
// server _computeFusionParity, identical formula, no service reads / no Date.now.
// Inputs are the resolved scalars; used by both the live shadow and the replay
// equivalence test so "server == client" is provable on captured vectors.
function _fuseDecision(inp) {
    const conf = Number.isFinite(inp.conf) ? inp.conf : 50;
    const confN = Math.max(0, Math.min(1, (conf - 50) / 50));
    const ofi = Number.isFinite(inp.ofi) ? inp.ofi : 0;
    const ofiN = (ofi + 1) / 2;
    const probN = Number.isFinite(inp.probN) ? inp.probN : 0.5;
    const regimeN = Number.isFinite(inp.regimeN) ? inp.regimeN : 0.5;
    const liqDangerN = Number.isFinite(inp.liqDangerN) ? inp.liqDangerN : 0.2;
    const sigDirBonus = Number.isFinite(inp.sigDirBonus) ? inp.sigDirBonus : 0;

    let dirScore = 0;
    dirScore += ofi * 0.55;
    dirScore += ((conf - 50) / 50) * 0.30;
    dirScore += sigDirBonus;
    dirScore = Math.max(-1, Math.min(1, dirScore));
    const dir = dirScore > 0.15 ? 'long' : dirScore < -0.15 ? 'short' : 'neutral';

    const alignN = dir === 'neutral' ? 0 : (dir === 'long' ? ofiN : (1 - ofiN));
    let confF = (confN * 0.35) + (probN * 0.25) + (regimeN * 0.20) + (alignN * 0.20);
    confF *= (1 - (liqDangerN * 0.55));
    confF = Math.max(0, Math.min(1, confF));
    const confidence = Math.round(confF * 100);

    let decision;
    if (dir === 'neutral') decision = 'NO_TRADE';
    else if (confidence >= 82 && conf >= 75 && regimeN >= 0.55) decision = 'LARGE';
    else if (confidence >= 72 && conf >= 68) decision = 'MEDIUM';
    else if (confidence >= 62 && conf >= 60) decision = 'SMALL';
    else decision = 'NO_TRADE';

    return { dir, decision, confidence, score: Math.round(dirScore * confidence) };
}
```

In `_computeFusionParity`, replace the inline steps 7–9 (lines ~1725–1753, from `// 7) Direction score` through the `decision` if/else) with a call:

```javascript
    // [SP1] Delegate the formula to the pure _fuseDecision (server always feeds
    // probN=0.5 and sigDirBonus=0 — no Scenario, no multi-scan dir bonus).
    const fused = _fuseDecision({ conf, ofi, probN, regimeN, liqDangerN, sigDirBonus: 0 });
    const dirScore = (function () {
        let d = ofi * 0.55 + ((conf - 50) / 50) * 0.30;
        return Math.max(-1, Math.min(1, d));
    })();
    const dir = fused.dir;
    const confidence = fused.confidence;
    const decision = fused.decision;
```

(The `reasons`/return block below stays as-is; `dirScore`, `dir`, `confidence`, `decision` keep their names so the rest is unchanged. `score` in the return becomes `fused.score` — update `score: Math.round(dirScore * confidence)` to `score: fused.score`.)

Add to `__sp1`:

```javascript
        fuseDecision: _fuseDecision,
```

- [ ] **Step 4: Run new + existing parity tests**

Run: `npx jest tests/unit/sp1-fuse-decision.test.js -v`
Expected: PASS (3/3).
Run: `npx jest -t parity 2>&1 | tail -20` — Expected: no new failures (extraction is behavior-preserving).

- [ ] **Step 5: Commit**

```bash
git add server/services/serverBrain.js tests/unit/sp1-fuse-decision.test.js
git commit -m "refactor(sp1): extract pure _fuseDecision from _computeFusionParity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Client golden-vector capture (debug-flag-gated, read-only)

**Files:**
- Modify: `client/src/trading/autotrade.ts` (`computeFusionDecision` ~543–638)
- (No server change.)

> This adds a capture that records the resolved fusion inputs + output into a window buffer when a debug flag is set. It does NOT change any decision, order, or behavior. The operator collects vectors by opening the app with the flag, then exports `window.__SP1_VECTORS`.

- [ ] **Step 1: Add the capture at the end of `computeFusionDecision`**

Immediately before `return { ...out, reasons }` (line ~637), add:

```typescript
  // [SP1] Golden-vector capture for the server replay-equivalence test.
  // Read-only: gated on window.__SP1_CAPTURE, records the resolved scalar
  // inputs + the output. KillSwitch-vetoed ticks are excluded above (they
  // return early) — they are out of formula scope (server has no killswitch).
  try {
    if ((w as any).__SP1_CAPTURE) {
      const sigDir = (() => { try { return w.LAST_SCAN?.sigDir } catch (_) { return null } })()
      const sigDirBonus = sigDir === 'bull' ? 0.25 : sigDir === 'bear' ? -0.25 : 0
      if (!Array.isArray((w as any).__SP1_VECTORS)) (w as any).__SP1_VECTORS = []
      const buf = (w as any).__SP1_VECTORS
      buf.push({
        input: { conf, ofi, probN, regimeN, liqDangerN, sigDirBonus },
        output: { dir: out.dir, decision: out.decision, confidence: out.confidence, score: out.score },
      })
      if (buf.length > 2000) buf.splice(0, buf.length - 2000)
    }
  } catch (_) { /* capture must never affect the decision */ }
```

- [ ] **Step 2: Build the client**

Run: `cd client && npm run build 2>&1 | tail -5`
Expected: build succeeds, `public/app` updated.

- [ ] **Step 3: Manual collection note (operator step — documented, not automated)**

Document in the commit body: operator opens the app, runs `window.__SP1_CAPTURE = true` in devtools on the live chart for ≥ a few hundred ticks across varied conditions, then `copy(JSON.stringify(window.__SP1_VECTORS))` and saves to `tests/fixtures/sp1-fusion-vectors.json`. (KillSwitch-vetoed and stale ticks are naturally excluded.)

- [ ] **Step 4: Commit**

```bash
git add client/src/trading/autotrade.ts public/app
git commit -m "feat(sp1): client golden-vector capture (debug-gated, read-only) for replay test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Replay equivalence test (server fusion == client output, bit-identical)

**Files:**
- Create: `tests/fixtures/sp1-fusion-vectors.sample.json` (hand-authored harness fixture)
- Create: `tests/unit/sp1-replay-equivalence.test.js`

- [ ] **Step 1: Write a small hand-authored fixture to prove the harness**

```json
// tests/fixtures/sp1-fusion-vectors.sample.json
[
  { "input": { "conf": 50, "ofi": 0, "probN": 0.5, "regimeN": 0.5, "liqDangerN": 0.2, "sigDirBonus": 0 },
    "output": { "dir": "neutral", "decision": "NO_TRADE", "confidence": 20, "score": 0 } }
]
```

(Compute the `output` values for this fixture by running `node -e "const b=require('./server/services/serverBrain'); console.log(b.__sp1.fuseDecision({conf:50,ofi:0,probN:0.5,regimeN:0.5,liqDangerN:0.2,sigDirBonus:0}))"` and pasting the exact result — the sample fixture asserts the harness wiring, not an independent oracle.)

- [ ] **Step 2: Write the replay test**

```javascript
// tests/unit/sp1-replay-equivalence.test.js
const fs = require('fs');
const path = require('path');
const brain = require('../../server/services/serverBrain');
const fuse = brain.__sp1.fuseDecision;

// Real client-captured vectors if present; otherwise the harness sample.
const realPath = path.join(__dirname, '../fixtures/sp1-fusion-vectors.json');
const samplePath = path.join(__dirname, '../fixtures/sp1-fusion-vectors.sample.json');
const vectorsPath = fs.existsSync(realPath) ? realPath : samplePath;
const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

describe('SP1 replay equivalence: server _fuseDecision == client output', () => {
  test(`fixture present and non-empty (${path.basename(vectorsPath)})`, () => {
    expect(Array.isArray(vectors)).toBe(true);
    expect(vectors.length).toBeGreaterThan(0);
  });

  test('every vector: dir + decision bit-identical; confidence/score exact', () => {
    const EPS = 0; // identical formula → exact
    const mismatches = [];
    for (let i = 0; i < vectors.length; i++) {
      const v = vectors[i];
      const got = fuse(v.input);
      const ok = got.dir === v.output.dir
        && got.decision === v.output.decision
        && Math.abs(got.confidence - v.output.confidence) <= EPS
        && Math.abs(got.score - v.output.score) <= EPS;
      if (!ok) mismatches.push({ i, input: v.input, expected: v.output, got });
    }
    if (mismatches.length) {
      console.error('SP1 replay mismatches:', JSON.stringify(mismatches.slice(0, 10), null, 2));
    }
    expect(mismatches).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test against the sample fixture**

Run: `npx jest tests/unit/sp1-replay-equivalence.test.js -v`
Expected: PASS (harness proven). When the operator drops the real `sp1-fusion-vectors.json`, the same test runs it automatically as the **soak-start gate**: a green run on real captured vectors is the Unit-4 proof.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/sp1-fusion-vectors.sample.json tests/unit/sp1-replay-equivalence.test.js
git commit -m "test(sp1): replay-equivalence harness (server fuse == client output)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Acceptance (SP1 done when ALL hold)

1. Live: `brain_parity_log` accumulates `source='server'` rows for uid=1 alongside the demo main cycle, execution-free (verified: no new orders, no telegram).
2. `node scripts/sp1-parity-gate.js 3` returns `gate.pass=true` — i.e. `primaryAgreementPct ≥ 98` AND `primaryPairs ≥ 500` AND `unpairedRatio ≤ 0.05`, sustained over `M ≥ 3` days.
3. `tests/unit/sp1-replay-equivalence.test.js` is GREEN on **real client-captured** vectors (`tests/fixtures/sp1-fusion-vectors.json`) — fusion formula proven bit-identical.
4. Full server jest suite shows no new regressions vs the known baseline.

SP1 green + SP1.5 (sizing parity) green together gate the SP2 cutover (separate specs).

## Notes / deviations recorded

- **Operator note #1 (heartbeat timeout):** belongs to SP2 (SP1 has no heartbeat). Recorded in the spec's SP2 out-of-scope as a pre-fixed safety parameter (like N/P/U/M), never a code default. No SP1 task.
- **Operator note #2 (join integrity):** the cross-table `brain_parity_log × dsl_parity_log` join does NOT exist on code (different keys, no shared `cycle`, shadow opens no position). Reshaped correctly to the real risk: **intra-table** client↔server pairing in `brain_parity_log` (±15s window) where `queryParityReport` excludes `unpaired` from the denominator. Task 4's pairing-integrity floor (`P`, `U`) is exactly the false-high guard the note asked for, and Task 4's tests assert it.
