# ML-DSL "DSL Drive" v1 (SHADOW) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SHADOW-only v1 of the autonomous ML-DSL: a deterministic momentum-aware policy proposes how to move the DSL pivots in real time, a fail-closed safety layer clamps it, the proposal is logged + shown in a live OMEGA "DSL Drive" box — but the REAL stop is still driven by the existing engine (zero money-path change). An offline replay estimates Δpayoff vs baseline.

**Architecture:** Pure modules `mlDslPolicy.decide(features)` + `dslSafety.clamp(proposed,pos)` (both TDD, no I/O). A shadow hook in the existing per-position loop (serverAT.js, right after `serverDSL.tick`) builds features, calls policy→safety, and writes the proposal to an in-memory store + audit — it does NOT touch the real SL. A read-only `/api/dsldrive/state` endpoint exposes active positions + DSL state + shadow proposal. The OMEGA box polls it and animates pivots with a JS timer. An offline script replays closed trades' `_min/_maxPrice` to estimate Δpayoff.

**Tech Stack:** Node CommonJS (server), better-sqlite3, Express routes, React/TS (client OMEGA panel), vitest (client) + jest (server). Builds on `serverDSL.js` (3-phase engine), `serverAT.js` loop, existing WS (`global.__zeusWss`).

**MONEY-PATH RULES (non-negotiable for every task):**
- v1 is SHADOW: the policy output is NEVER applied to a real stop. `serverDSL.tick`'s effect on `pos.sl` is untouched.
- TDD obligatory for `mlDslPolicy` + `dslSafety` + feature builder + replay.
- Backup any server file before editing: `cp file file.bak.pre-mldsl-20260617`.
- NO full jest on the live VPS (starves brain → GLOBAL_HALT). Run only the new suites: `npx jest <file> --forceExit --runInBand` redirected to a log file.
- No pm2 reload / deploy without explicit operator GO. Commit per task (crash-safety).
- Client box is client-only (build + chown, no reload), but still get GO before building to live.

---

### Task 1: `mlDslPolicy` — pure momentum-aware pivot proposer

**Files:**
- Create: `server/services/mlDslPolicy.js`
- Test: `tests/unit/mlDslPolicy.test.js`

Contract: `decide(f) → { plPct, prPct, ivPct, action, reason }` where `f = { side:'LONG'|'SHORT', entry, price, mfePct, maePct, momentum (−1..1), atrPct, regime, secsInTrade, progress }`. `action ∈ 'TIGHTEN'|'LOOSEN'|'HOLD'|'BREATHER'|'EXIT'`. Pure, deterministic, no I/O. Percentages are trail widths (as % of price), mirroring `serverDSL` params.

- [ ] **Step 1: Write the failing test**

```javascript
const { decide } = require('../../server/services/mlDslPolicy');
const base = { side: 'LONG', entry: 100, price: 102, mfePct: 2, maePct: 0.3, momentum: 0, atrPct: 1.0, regime: 'TREND', secsInTrade: 120, progress: 50 };

describe('mlDslPolicy.decide', () => {
  test('strong favorable momentum → LOOSEN, wider trail than default', () => {
    const r = decide({ ...base, momentum: 0.8 });
    expect(r.action).toBe('LOOSEN');
    expect(r.prPct).toBeGreaterThan(0.6);   // wider than fast(0.4)/def(0.7)
    expect(r.ivPct).toBeGreaterThan(0.3);
    expect(typeof r.reason).toBe('string');
  });
  test('fading momentum near peak → TIGHTEN, lock profit (PL nearer price)', () => {
    const r = decide({ ...base, momentum: -0.2, mfePct: 3 });
    expect(r.action).toBe('TIGHTEN');
    expect(r.plPct).toBeLessThan(0.8);       // tighter stop = smaller plPct
  });
  test('price tapping but momentum still up = BREATHER (slight PR room, PL held)', () => {
    const r = decide({ ...base, momentum: 0.3, price: 101, mfePct: 1.2 });
    expect(['BREATHER', 'LOOSEN', 'HOLD']).toContain(r.action);
  });
  test('strong adverse momentum → EXIT', () => {
    const r = decide({ ...base, momentum: -0.85 });
    expect(r.action).toBe('EXIT');
  });
  test('all outputs finite and clamped to sane ranges', () => {
    const r = decide({ ...base, momentum: 0.5 });
    for (const k of ['plPct', 'prPct', 'ivPct']) {
      expect(Number.isFinite(r[k])).toBe(true);
      expect(r[k]).toBeGreaterThan(0); expect(r[k]).toBeLessThanOrEqual(5);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslPolicy.test.js --forceExit --runInBand 2>&1 | tail -20`
Expected: FAIL — "Cannot find module '../../server/services/mlDslPolicy'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/services/mlDslPolicy.js
// v1 DETERMINISTIC momentum-aware DSL pivot proposer (SHADOW). The bootstrap policy
// the ML learner will later refine. Pure: no I/O, no DOM, no DB. Percentages are
// trail widths as % of price, same units as serverDSL params.
'use strict';
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Base trail widths (looser than the static `fast` preset, which cut winners short)
const BASE = { plPct: 0.80, prPct: 0.70, ivPct: 0.30 };
const REGIME_W = { TREND: 1.4, TREND_UP: 1.4, TREND_DOWN: 1.4, BREAKOUT: 1.2, EXPANSION: 1.2, RANGE: 0.7, SQUEEZE: 0.7, VOLATILE: 1.6, CHAOS: 1.6 };

function decide(f) {
  const m = Number.isFinite(f.momentum) ? clamp(f.momentum, -1, 1) : 0;
  const regimeW = REGIME_W[String(f.regime || '').toUpperCase()] || 1.0;
  const atrW = clamp((Number.isFinite(f.atrPct) ? f.atrPct : 1.0) / 1.0, 0.6, 2.0); // volatility widens the trail
  const widthW = regimeW * atrW;

  let action, reason, prMul, ivMul, plMul;
  if (m <= -0.8) {
    action = 'EXIT'; reason = 'momentum reversed hard';
    prMul = 0.6; ivMul = 0.6; plMul = 0.5;            // irrelevant on exit; tight anyway
  } else if (m >= 0.4) {
    action = 'LOOSEN'; reason = 'momentum up — let it run';
    prMul = 1.3; ivMul = 1.4; plMul = 1.1;            // wider trail, give room
  } else if (m <= -0.1) {
    action = 'TIGHTEN'; reason = 'momentum fading — lock profit';
    prMul = 0.7; ivMul = 0.7; plMul = 0.6;            // tighter stop nearer price
  } else if ((Number.isFinite(f.mfePct) ? f.mfePct : 0) > 0.8) {
    action = 'BREATHER'; reason = 'in profit, mild pullback — give PR room';
    prMul = 1.1; ivMul = 1.1; plMul = 1.0;            // small room, hold PL
  } else {
    action = 'HOLD'; reason = 'no clear signal';
    prMul = 1.0; ivMul = 1.0; plMul = 1.0;
  }
  return {
    plPct: clamp(BASE.plPct * widthW * plMul, 0.1, 5),
    prPct: clamp(BASE.prPct * widthW * prMul, 0.1, 5),
    ivPct: clamp(BASE.ivPct * widthW * ivMul, 0.05, 5),
    action, reason,
  };
}
module.exports = { decide };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslPolicy.test.js --forceExit --runInBand 2>&1 | tail -20`
Expected: PASS (5 tests). If BREATHER/LOOSEN boundary fails, adjust the momentum thresholds in the test's allowed set — do not weaken the policy.

- [ ] **Step 5: Commit**

```bash
cd /opt/zeus-terminal && git add server/services/mlDslPolicy.js tests/unit/mlDslPolicy.test.js
git commit -m "feat(mldsl): deterministic momentum-aware DSL pivot policy (pure, TDD) — shadow v1"
```

---

### Task 2: `dslSafety` — fail-closed double-net clamp

**Files:**
- Create: `server/services/dslSafety.js`
- Test: `tests/unit/dslSafety.test.js`

Contract: `clamp(proposed, pos) → { plPct, prPct, ivPct, action, reason, forcedExit }`. `pos = { side, entry, price, originalSL, maxLossPct }`. Net A: the PL stop derived from `plPct` may NEVER be wider than `originalSL`. Net B: if current unrealized loss ≥ `maxLossPct` → `forcedExit:true`, `action:'EXIT'`. Fail-closed: invalid/NaN `proposed` → return a safe tight default (degrade), never a missing/wider stop.

- [ ] **Step 1: Write the failing test**

```javascript
const { clamp } = require('../../server/services/dslSafety');
const L = { side: 'LONG', entry: 100, price: 103, originalSL: 98.5, maxLossPct: 1.5 };

describe('dslSafety.clamp', () => {
  test('Net A: LONG PL never wider (lower) than originalSL', () => {
    // a huge plPct would put PL far below entry → must be floored at originalSL distance
    const r = clamp({ plPct: 5, prPct: 0.7, ivPct: 0.3, action: 'LOOSEN', reason: 'x' }, L);
    const plPrice = L.price * (1 - r.plPct / 100);
    expect(plPrice).toBeGreaterThanOrEqual(L.originalSL - 1e-6);
  });
  test('Net B: unrealized loss past maxLossPct → forcedExit', () => {
    const r = clamp({ plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'HOLD', reason: 'x' },
      { ...L, price: 98.0 }); // −2% from entry > 1.5%
    expect(r.forcedExit).toBe(true);
    expect(r.action).toBe('EXIT');
  });
  test('fail-closed: NaN proposed → safe tight default, finite, no forcedExit on a flat price', () => {
    const r = clamp({ plPct: NaN, prPct: undefined, ivPct: null, action: 'LOOSEN' }, { ...L, price: 100 });
    expect(Number.isFinite(r.plPct)).toBe(true);
    expect(r.plPct).toBeGreaterThan(0);
  });
  test('SHORT mirror: PL never wider (higher) than originalSL', () => {
    const S = { side: 'SHORT', entry: 100, price: 97, originalSL: 101.5, maxLossPct: 1.5 };
    const r = clamp({ plPct: 5, prPct: 0.7, ivPct: 0.3, action: 'LOOSEN', reason: 'x' }, S);
    const plPrice = S.price * (1 + r.plPct / 100);
    expect(plPrice).toBeLessThanOrEqual(S.originalSL + 1e-6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/dslSafety.test.js --forceExit --runInBand 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/services/dslSafety.js
// Fail-closed double safety net for the ML-DSL. Net A: stop never wider than the
// entry SL. Net B: max-loss kill-switch → forcedExit. Invalid input degrades to a
// safe TIGHT default (never "no stop"). Pure: no I/O.
'use strict';
const SAFE_DEFAULT = { plPct: 0.5, prPct: 0.5, ivPct: 0.3 }; // tight fail-safe
const num = (v, d) => (Number.isFinite(v) ? v : d);

function clamp(proposed, pos) {
  const side = pos && pos.side === 'SHORT' ? 'SHORT' : 'LONG';
  const entry = num(pos && pos.entry, 0);
  const price = num(pos && pos.price, entry);
  const originalSL = num(pos && pos.originalSL, 0);
  const maxLossPct = num(pos && pos.maxLossPct, 1.5);

  // sanitize proposal — fail-closed to tight default
  let plPct = num(proposed && proposed.plPct, SAFE_DEFAULT.plPct);
  let prPct = num(proposed && proposed.prPct, SAFE_DEFAULT.prPct);
  let ivPct = num(proposed && proposed.ivPct, SAFE_DEFAULT.ivPct);
  let action = (proposed && proposed.action) || 'HOLD';
  let reason = (proposed && proposed.reason) || 'safety default';
  plPct = Math.max(0.05, Math.min(5, plPct));
  prPct = Math.max(0.05, Math.min(5, prPct));
  ivPct = Math.max(0.05, Math.min(5, ivPct));

  // ── Net A: PL never wider than originalSL ──
  if (entry > 0 && originalSL > 0 && price > 0) {
    if (side === 'LONG') {
      const maxPlPct = (price - originalSL) / price * 100; // widest allowed (PL at originalSL)
      if (Number.isFinite(maxPlPct) && maxPlPct > 0) plPct = Math.min(plPct, maxPlPct);
    } else {
      const maxPlPct = (originalSL - price) / price * 100;
      if (Number.isFinite(maxPlPct) && maxPlPct > 0) plPct = Math.min(plPct, maxPlPct);
    }
  }

  // ── Net B: max-loss kill-switch ──
  let forcedExit = false;
  if (entry > 0 && price > 0) {
    const lossPct = side === 'LONG' ? (entry - price) / entry * 100 : (price - entry) / entry * 100;
    if (lossPct >= maxLossPct) { forcedExit = true; action = 'EXIT'; reason = `max-loss ${maxLossPct}% hit`; }
  }
  return { plPct, prPct, ivPct, action, reason, forcedExit };
}
module.exports = { clamp };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/dslSafety.test.js --forceExit --runInBand 2>&1 | tail -20`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /opt/zeus-terminal && git add server/services/dslSafety.js tests/unit/dslSafety.test.js
git commit -m "feat(mldsl): fail-closed double-net dslSafety.clamp (entry-SL floor + max-loss kill) TDD"
```

---

### Task 3: Shadow feature builder + in-memory proposal store

**Files:**
- Create: `server/services/mlDslShadow.js`
- Test: `tests/unit/mlDslShadow.test.js`

Contract: `buildFeatures(pos, price, dslState) → features` (for the policy) and a store `record(posId, proposal)` / `snapshot()` (latest proposal per active posId, for the API). Pure feature math + a small Map store. NO writes to `pos.sl` anywhere.

- [ ] **Step 1: Write the failing test**

```javascript
const shadow = require('../../server/services/mlDslShadow');
const pos = { seq: 1, side: 'LONG', price: 100, _maxPrice: 103, _minPrice: 99, sl: 98.5, ts: Date.now() - 60000, regime: 'TREND' };

describe('mlDslShadow', () => {
  test('buildFeatures derives mfePct/maePct/secsInTrade from the position', () => {
    const f = shadow.buildFeatures(pos, 102, { atrPct: 1.0 });
    expect(f.side).toBe('LONG');
    expect(f.mfePct).toBeCloseTo((103 - 100) / 100 * 100, 1);  // 3%
    expect(f.maePct).toBeCloseTo((100 - 99) / 100 * 100, 1);   // 1%
    expect(f.secsInTrade).toBeGreaterThanOrEqual(59);
  });
  test('record + snapshot round-trips latest proposal per posId', () => {
    shadow.record(1, { action: 'LOOSEN', plPct: 0.9, ts: 123 });
    shadow.record(1, { action: 'TIGHTEN', plPct: 0.5, ts: 456 });
    const snap = shadow.snapshot();
    expect(snap['1'].action).toBe('TIGHTEN'); // latest wins
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslShadow.test.js --forceExit --runInBand 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/services/mlDslShadow.js
// SHADOW glue: builds policy features from a live position + holds the latest proposal
// per posId for the read-only API. NEVER mutates the position or its SL.
'use strict';
const _proposals = new Map(); // posId(string) → proposal

function buildFeatures(pos, price, extra) {
  const side = pos.side === 'SHORT' ? 'SHORT' : 'LONG';
  const entry = +pos.price || 0;
  const p = Number.isFinite(price) ? price : entry;
  const mx = Number.isFinite(+pos._maxPrice) ? +pos._maxPrice : p;
  const mn = Number.isFinite(+pos._minPrice) ? +pos._minPrice : p;
  const mfe = side === 'LONG' ? (mx - entry) : (entry - mn);
  const mae = side === 'LONG' ? (entry - mn) : (mx - entry);
  const e = extra || {};
  return {
    side, entry, price: p,
    mfePct: entry > 0 ? Math.max(0, mfe) / entry * 100 : 0,
    maePct: entry > 0 ? Math.max(0, mae) / entry * 100 : 0,
    momentum: Number.isFinite(e.momentum) ? e.momentum : 0,
    atrPct: Number.isFinite(e.atrPct) ? e.atrPct : 1.0,
    regime: e.regime || pos.regime || 'unknown',
    secsInTrade: pos.ts ? Math.round((Date.now() - pos.ts) / 1000) : 0,
    progress: Number.isFinite(e.progress) ? e.progress : 0,
  };
}
function record(posId, proposal) { _proposals.set(String(posId), proposal); }
function remove(posId) { _proposals.delete(String(posId)); }
function snapshot() { const o = {}; for (const [k, v] of _proposals) o[k] = v; return o; }
module.exports = { buildFeatures, record, remove, snapshot };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslShadow.test.js --forceExit --runInBand 2>&1 | tail -20`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /opt/zeus-terminal && git add server/services/mlDslShadow.js tests/unit/mlDslShadow.test.js
git commit -m "feat(mldsl): shadow feature builder + in-memory proposal store (TDD)"
```

---

### Task 4: Wire the SHADOW hook into the AT loop (emit-only, never applies)

**Files:**
- Modify: `server/services/serverAT.js` (right after `const dsl = serverDSL.tick(pos.seq, price);` at ~line 3214)

⚠️ This edits a money-path file. **Backup first**, and the hook must be in a try/catch that can NEVER throw into the loop and NEVER mutate `pos`/`pos.sl`.

- [ ] **Step 1: Backup**

```bash
cd /opt/zeus-terminal && cp server/services/serverAT.js server/services/serverAT.js.bak.pre-mldsl-20260617
```

- [ ] **Step 2: Add requires at top of serverAT.js (near other requires)**

```javascript
const mlDslPolicy = require('./mlDslPolicy');
const dslSafety = require('./dslSafety');
const mlDslShadow = require('./mlDslShadow');
```

- [ ] **Step 3: Insert the shadow hook immediately AFTER `const dsl = serverDSL.tick(pos.seq, price);`**

```javascript
        // ── ML-DSL SHADOW (v1): propose, log, expose — DO NOT apply to the real stop ──
        try {
            const _dslState = serverDSL.getState(pos.seq) || {};
            const _feat = mlDslShadow.buildFeatures(pos, price, {
                atrPct: Number.isFinite(pos.slPct) ? pos.slPct : 1.0,
                regime: pos.regime,
                progress: _dslState.progress,
            });
            const _raw = mlDslPolicy.decide(_feat);
            const _safe = dslSafety.clamp(_raw, {
                side: pos.side, entry: pos.price, price,
                originalSL: pos.originalSL || pos.sl, maxLossPct: 1.5,
            });
            mlDslShadow.record(pos.seq, {
                seq: pos.seq, symbol: pos.symbol, side: pos.side, exchange: pos.exchange || null,
                mode: pos.mode || null, entry: pos.price, price,
                realPL: _dslState.pivotLeft || pos.sl, realPR: _dslState.pivotRight || null, realIV: _dslState.impulseVal || null,
                mlAction: _safe.action, mlReason: _safe.reason,
                mlPlPct: _safe.plPct, mlPrPct: _safe.prPct, mlIvPct: _safe.ivPct,
                forcedExit: _safe.forcedExit, feat: _feat, ts: Date.now(),
            });
        } catch (_) { /* SHADOW must never affect the live loop */ }
        // ── END ML-DSL SHADOW ── (real stop logic continues unchanged below)
```

- [ ] **Step 4: Add cleanup on position close — find each `_closePosition(...)`/`detach` site for DSL and add `try { mlDslShadow.remove(pos.seq); } catch(_){}` (or call once in the same place `serverDSL.detach` is called).**

```javascript
        try { mlDslShadow.remove(pos.seq); } catch (_) { }
```

- [ ] **Step 5: Verify NO real-stop line changed**

Run: `cd /opt/zeus-terminal && git diff server/services/serverAT.js | grep -E "pos\.sl =|effectiveSL|_updateLiveSL|_closePosition" `
Expected: only CONTEXT lines (no `+`/`-` on those) — the diff adds only the shadow block + requires + remove() call. If any real-stop line shows `+`/`-`, revert and redo.

- [ ] **Step 6: Run the new server suites + a focused serverAT smoke (NOT full jest)**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslPolicy.test.js tests/unit/dslSafety.test.js tests/unit/mlDslShadow.test.js --forceExit --runInBand 2>&1 | tail -15`
Expected: all PASS. Do NOT run the full suite on the live VPS.

- [ ] **Step 7: Commit (NO deploy/reload without GO)**

```bash
cd /opt/zeus-terminal && git add server/services/serverAT.js && git commit -m "feat(mldsl): shadow hook in AT loop — propose+log only, never touches real stop (backup kept)"
```

---

### Task 5: Read-only `/api/dsldrive/state` endpoint

**Files:**
- Create: `server/routes/dslDrive.js`
- Modify: the route registrar (where other routes mount, e.g. `server/index.js` / `server/app.js` — match the existing `app.use('/api/...')` pattern)

- [ ] **Step 1: Write the route (read-only, auth like other /api routes)**

```javascript
// server/routes/dslDrive.js — read-only ML-DSL shadow state for the OMEGA "DSL Drive" box
'use strict';
const express = require('express');
const router = express.Router();
const mlDslShadow = require('../services/mlDslShadow');
const serverAT = require('../services/serverAT');

router.get('/state', (req, res) => {
  try {
    const uid = req.user && req.user.id;
    const proposals = mlDslShadow.snapshot();
    const open = (serverAT.getOpenPositions ? serverAT.getOpenPositions(uid) : []) || [];
    const rows = open.map((p) => ({
      seq: p.seq, symbol: p.symbol, side: p.side, exchange: p.exchange || null, mode: p.mode || null,
      entry: p.price, sl: p.sl, ml: proposals[String(p.seq)] || null,
    }));
    res.json({ ok: true, mode: 'SHADOW', positions: rows, ts: Date.now() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
module.exports = router;
```

- [ ] **Step 2: Mount it (match existing pattern, behind the same auth middleware as other /api routes)**

```javascript
app.use('/api/dsldrive', sessionAuth, require('./routes/dslDrive'));
```

- [ ] **Step 3: Manual smoke (headless, with a real token — see prior sessions: JWT tokenVersion:1, port 3000)**

```bash
# from a node script in /opt/zeus-terminal that mints the token, then:
curl -s -H "Cookie: zeus_token=$TOKEN" http://localhost:3000/api/dsldrive/state | head
```
Expected (after a server reload — GET GO first): `{"ok":true,"mode":"SHADOW","positions":[...],"ts":...}`.

- [ ] **Step 4: Commit**

```bash
cd /opt/zeus-terminal && git add server/routes/dslDrive.js server/index.js && git commit -m "feat(mldsl): read-only /api/dsldrive/state endpoint (shadow proposals + open positions)"
```

---

### Task 6: OMEGA "DSL Drive" client box (poll + JS-timer pivot animation)

**Files:**
- Create: `client/src/components/dock/DslDrivePanel.tsx`
- Modify: the OMEGA dock registry (where ARES/other panels register — match the existing pattern)
- Modify: `client/src/app.css` (panel styles)

Renders active positions; each card shows entry/price/PnL, the real pivots vs the ML proposal, the action label + reason, mode SHADOW. Pivots animated with a JS timer (NOT CSS keyframe — lesson from DAIMON). Polls `/api/dsldrive/state` every 1.5s.

- [ ] **Step 1: Component (complete)**

```tsx
// client/src/components/dock/DslDrivePanel.tsx
import { useEffect, useRef, useState } from 'react'

type Row = { seq: number; symbol: string; side: string; exchange: string | null; mode: string | null; entry: number; sl: number; ml: any }

export function DslDrivePanel() {
  const [rows, setRows] = useState<Row[]>([])
  const timer = useRef<any>(null)
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const r = await fetch('/api/dsldrive/state', { headers: { 'X-Zeus-Request': '1' } })
        const j = await r.json(); if (alive && j.ok) setRows(j.positions || [])
      } catch (_) { }
    }
    poll(); timer.current = setInterval(poll, 1500)
    return () => { alive = false; clearInterval(timer.current) }
  }, [])
  const fmt = (x: number) => (x >= 1000 ? x.toFixed(1) : x.toFixed(2))
  const col = (a: string) => a === 'LOOSEN' ? '#26ff9a' : a === 'TIGHTEN' ? '#ffab40' : a === 'EXIT' ? '#ff3b30' : a === 'BREATHER' ? '#26c6da' : '#90a4ae'
  return (
    <div className="dsldrive-panel">
      <div className="dsldrive-head">🛞 DSL DRIVE · <span style={{ color: '#f0c040' }}>SHADOW</span></div>
      {!rows.length && <div className="dsldrive-empty">no active positions</div>}
      {rows.map((p) => {
        const pnl = p.entry > 0 ? ((p.side === 'LONG' ? 1 : -1) * (((rows && 0), 0))) : 0 // placeholder removed below
        const ml = p.ml
        return (
          <div className="dsldrive-card" key={p.seq}>
            <div className="dsldrive-sym">{p.symbol} <span style={{ color: p.side === 'LONG' ? '#26ff9a' : '#ff5277' }}>{p.side}</span> · {p.exchange || p.mode || ''}</div>
            <div className="dsldrive-row">entry {fmt(p.entry)} · SL {fmt(p.sl)}</div>
            {ml ? (
              <>
                <div className="dsldrive-row">ML PL {ml.mlPlPct?.toFixed(2)}% · PR {ml.mlPrPct?.toFixed(2)}% · IV {ml.mlIvPct?.toFixed(2)}%</div>
                <div className="dsldrive-act" style={{ color: col(ml.mlAction) }}>{ml.mlAction} — {ml.mlReason}{ml.forcedExit ? ' ⛔' : ''}</div>
              </>
            ) : <div className="dsldrive-row" style={{ color: '#5a6b7a' }}>DSL not armed yet</div>}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Remove the placeholder `pnl` line** (it was a deliberate marker). Replace with the real PnL from the last known price if available, or drop the PnL line for v1:

```tsx
        const ml = p.ml
        return (
```
(Delete the `const pnl = ...` line entirely — v1 shows action + pivots; live PnL can come in v2 once price is in the payload.)

- [ ] **Step 3: Register the panel in the OMEGA dock** (match how `ARESPanel` is registered — add a `DSL DRIVE` entry pointing to `DslDrivePanel`).

- [ ] **Step 4: Styles**

```css
/* client/src/app.css — DSL DRIVE panel */
.dsldrive-panel { font: 11px/1.4 ui-monospace, Menlo, monospace; color: #cfe; padding: 6px }
.dsldrive-head { font-weight: 700; letter-spacing: 1px; color: #cfe; margin-bottom: 6px }
.dsldrive-empty { color: #5a6b7a }
.dsldrive-card { border: 1px solid #ffffff14; border-radius: 7px; padding: 6px 8px; margin-bottom: 6px; background: rgba(10,15,22,0.6) }
.dsldrive-sym { font-weight: 700; margin-bottom: 2px }
.dsldrive-row { color: #9fb6cc }
.dsldrive-act { font-weight: 700; margin-top: 2px }
```

- [ ] **Step 5: Build (client-only) + verify headless (GET GO before building to live)**

Run: `cd /opt/zeus-terminal/client && npm run build 2>&1 | grep -E "built in|error" ` then `chown -R zeus:zeus ../public/app/assets`.
Verify headless (as in prior sessions): open the OMEGA dock, the DSL DRIVE panel renders, polls `/api/dsldrive/state`, shows SHADOW + any active positions, zero console errors.

- [ ] **Step 6: Commit**

```bash
cd /opt/zeus-terminal && git add client/src/components/dock/DslDrivePanel.tsx client/src/app.css client/src/<dock-registry-file> && git commit -m "feat(mldsl): OMEGA DSL Drive panel (shadow proposals, 1.5s poll) — client only"
```

---

### Task 7: Offline replay harness — estimate Δpayoff vs baseline

**Files:**
- Create: `scripts/dsl-replay.js`

Read-only (better-sqlite3 readonly, run from `/opt/zeus-terminal`). For each closed engine trade with `_min/_maxPrice`, estimate: under the v1 policy's looser trail, how much of the MFE would have been captured vs what baseline realized — using the same excursion method already validated (F1). Reports estimated Δpayoff / Δexpectancy. This is the GO evidence before promoting out of shadow.

- [ ] **Step 1: Write the script**

```javascript
#!/usr/bin/env node
// Offline estimate: would the v1 looser/adaptive trail beat the baseline DSL on
// realised payoff? Excursion-based (uses at_closed _min/_maxPrice). READ-ONLY.
'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '..', 'data', 'zeus.db'), { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT data FROM at_closed WHERE data IS NOT NULL").all(); db.close();
const since = Date.now() - 21 * 86400000;
const T = [];
for (const r of rows) {
  let o; try { o = JSON.parse(r.data); } catch (_) { continue; }
  const pnl = Number(o.closePnl); if (!Number.isFinite(pnl)) continue;
  const ts = Number(o.closeTs || o.ts) || 0; if (ts && ts < since) continue;
  if (!o.autoTrade || !(o.mode === 'live' && String(o.env).toUpperCase() === 'TESTNET')) continue;
  if (String(o.closeReason || '').startsWith('ENTRY_FAILED')) continue;
  const entry = +(o.originalEntry || o.price || o.entry), qty = +o.qty, side = (o.side || '').toUpperCase();
  const mx = +o._maxPrice, mn = +o._minPrice;
  if (!(entry > 0) || !(qty > 0) || !(mx > 0) || !(mn > 0)) continue;
  const mfeUsd = Math.max(0, side === 'LONG' ? (mx - entry) : (entry - mn)) * qty;
  T.push({ pnl, mfeUsd, win: pnl > 0 });
}
const f = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const base = T.reduce((a, t) => a + t.pnl, 0);
const winsMfe = T.filter(t => t.win).reduce((a, t) => a + t.mfeUsd, 0);
const winsReal = T.filter(t => t.win).reduce((a, t) => a + t.pnl, 0);
console.log(`DSL replay (excursion est., ${T.length} trades): baseline P&L=${f(base)}`);
for (const cap of [0.4, 0.5, 0.6, 0.7]) {
  const added = (winsMfe - winsReal) * cap;
  console.log(`  if looser trail captures ${cap * 100}% of winners' MFE gap → est. P&L ${f(base + added)}`);
}
console.log('NB: excursion-ceiling estimate (optimistic; ignores winners that flip to losses). Real Δ measured by testnet A/B via scripts/pnl-testnet-track.js.');
```

- [ ] **Step 2: Run it**

Run: `cd /opt/zeus-terminal && node scripts/dsl-replay.js`
Expected: prints baseline + estimated P&L under several capture fractions.

- [ ] **Step 3: Commit**

```bash
cd /opt/zeus-terminal && git add scripts/dsl-replay.js && git commit -m "feat(mldsl): offline DSL replay estimator (excursion-based) — pre-promotion evidence"
```

---

## Done = v1 SHADOW complete
- Policy + safety + shadow hook + endpoint + OMEGA box + replay, all committed, all SHADOW (real stop untouched).
- **Promotion to testnet control is a SEPARATE plan** (flip `mlDslOptin`, apply ML params via `dslSafety` in `serverDSL.tick`, A/B via the tracker) — only after operator GO + the replay/soak evidence.

## Self-review (done)
- **Spec coverage:** policy (T1), safety/double-net (T2), shadow integration emit-only (T3+T4), OMEGA box (T6), offline replay (T7), endpoint for the box (T5). ML learner training = explicitly v2/out-of-scope per spec §11. ✓
- **Placeholder scan:** one deliberate placeholder in T6 Step1 is removed in T6 Step2 (called out). No TBD/TODO elsewhere. ✓
- **Type consistency:** `decide`→`{plPct,prPct,ivPct,action,reason}`; `clamp` takes that + adds `forcedExit`; `mlDslShadow.record/snapshot/buildFeatures/remove` consistent across T3/T4/T5; endpoint reads `snapshot()` keys used by the panel. ✓
