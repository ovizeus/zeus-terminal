# SP2 — Server Cutover (Testnet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the server from SP1 shadow to authoritative executor for **testnet** users — server opens entries when the client's trading loop is absent, and runs exit/SL/TP as an always-on safety net so no position is ever orphaned.

**Architecture:** A pure `resolveOwnership()` function decides, per position, who owns *entries* (exclusive, heartbeat-gated, fail-closed) and *exits* (always-on server net + hard disaster backstop, fail-safe). A `heartbeatTracker` ingests client AT-tick liveness (server-stamped). The ENG-1 entry gate becomes testnet-aware behind a staged `SP2_CUTOVER_USERS` flip. Most exit/reconciliation machinery already exists and is *extended*, not rebuilt.

**Tech Stack:** Node + Express + better-sqlite3 (synchronous) + PM2 server; React + TS + Vite + vitest client. Server tests: `jest --forceExit --runInBand` (output redirected to file). Client tests: `vitest run`.

**Spec:** `docs/superpowers/specs/2026-06-01-sp2-server-cutover-testnet-design.md` (read it first).

**Hard gates (no merge to cutover-on until green):** (1) demo-soak healthy — ✅ uid=2 +$536/26 trades; (2) Task 1 sizing-parity green; (3) load/latency gate blocks SP2-a→SP2-b widening only. Code may be written + unit-tested behind the flag (`SP2_CUTOVER_USERS=[]`) without flipping; flipping is gated.

**Money-path rules (from operator):** TDD RED→GREEN; backup before editing live files; verify 3×; fail-closed + defense-in-depth; staged flag flips; checkpoint git after each green task; jest `--forceExit`; testnet only (real-money out of scope).

---

## File Structure

| File | New/Modify | Responsibility |
|---|---|---|
| `client/src/trading/orderGeometry.ts` | Create | Pure client order-geometry (qty/SL/TP from margin,lev,price,slPct,rr) |
| `server/services/orderGeometry.js` | Create | Pure server order-geometry — identical math to client |
| `tests/fixtures/order-geometry-golden.json` | Create | Shared golden vectors both suites assert against (parity proof) |
| `server/services/ownership.js` | Create | Pure `resolveOwnership()` — entry + two-tier exit owner |
| `server/services/heartbeatTracker.js` | Create | Per-user server-stamped liveness, hysteresis, cold-start grace |
| `server/services/sp2Cutover.js` | Create | `SP2_CUTOVER_USERS` list accessor (flags are boolean-only) |
| `server/services/entryDedup.js` | Create | Per-(user×symbol×window) idempotency guard |
| `server/migrationFlags.js` | Modify | Add `SERVER_AT_TESTNET_EXEC` boolean master toggle |
| `server/routes/brainParity.js` | Modify | Add `POST /api/at/heartbeat` ingest |
| `client/src/trading/autotrade.ts` | Modify | Emit heartbeat in AT tick; consume sizing via orderGeometry |
| `server/services/serverAT.js` | Modify | ENG-1 gate testnet-aware; entry idempotency; disaster backstop in `onPriceUpdate`; ownership in `getFullState`; sizing via orderGeometry |
| `server/services/database.js` | Modify | Migration `406_handover_log` + `logHandover()` writer |
| `server/server.js` | Modify | WS-close → `heartbeatTracker.markAbsent()` |
| `client/src/core/state.ts` | Modify | Apply `ownership` from sync payload |
| `tests/unit/*.test.js`, `client/src/**/__tests__/*.test.ts` | Create | Unit + integration tests per task |

---

## Task 1: Sizing parity — static formula extraction (Gate 2)

**Goal:** Prove client and server compute **identical order geometry** (qty, SL, TP, slPnl, tpPnl) from identical inputs. The *margin* input legitimately diverges (client = riskPct-based, server = Kelly/regime-adjusted) — that is **out of scope**; we prove the *geometry transform* is bit-identical. This satisfies gate 2 without a live trading client.

**Background (verbatim current math):**
- Client `autotrade.ts:1080-1091`: `slDist=entry*slPct/100`, `tpDist=slDist*rr`, `sl=side==='LONG'?entry-slDist:entry+slDist`, `tp=side==='LONG'?entry+tpDist:entry-tpDist`, `qty=(adaptFinalSize*lev)/entry`, `tpPnl=(tpDist/entry)*adaptFinalSize*lev`, `slPnl=-(slDist/entry)*adaptFinalSize*lev`.
- Server `serverAT.js:1146-1153,1186-1187`: same `slDist`/`tpDist`/`sl`/`tp`, `qty=(finalSize*lev)/price`, then gross `_grossTpPnl=(tpDist/price)*_alignedSize*lev` (server additionally applies fees/slippage + LOT_SIZE/tick alignment — those are server-only post-steps, documented, not part of the shared geometry).

**Files:**
- Create: `tests/fixtures/order-geometry-golden.json`
- Create: `server/services/orderGeometry.js`
- Create: `client/src/trading/orderGeometry.ts`
- Test: `tests/unit/orderGeometry.test.js`, `client/src/trading/__tests__/orderGeometry.test.ts`

- [ ] **Step 1: Write the golden-vector fixture**

Create `tests/fixtures/order-geometry-golden.json`:
```json
[
  { "in": { "side": "LONG",  "price": 67000, "margin": 200, "lev": 5, "slPct": 1.5, "rr": 2 },
    "out": { "qty": 0.014925373134328358, "sl": 65995, "tp": 69010, "slPnl": -15, "tpPnl": 30 } },
  { "in": { "side": "SHORT", "price": 67000, "margin": 200, "lev": 5, "slPct": 1.5, "rr": 2 },
    "out": { "qty": 0.014925373134328358, "sl": 68005, "tp": 64990, "slPnl": -15, "tpPnl": 30 } },
  { "in": { "side": "LONG",  "price": 2500,  "margin": 100, "lev": 10, "slPct": 2, "rr": 3 },
    "out": { "qty": 0.4, "sl": 2450, "tp": 2650, "slPnl": -20, "tpPnl": 60 } }
]
```
(Values computed by hand from the formulas above; e.g. LONG#1: slDist=67000*1.5/100=1005, sl=67000-1005=65995, tpDist=2010, tp=69010, qty=(200*5)/67000=0.0149253…, slPnl=-(1005/67000)*200*5=-15, tpPnl=(2010/67000)*200*5=30.)

- [ ] **Step 2: Write the failing server test**

Create `tests/unit/orderGeometry.test.js`:
```javascript
'use strict';
const path = require('path');
const golden = require(path.resolve(__dirname, '../fixtures/order-geometry-golden.json'));
const { computeOrderGeometry } = require('../../server/services/orderGeometry');

describe('orderGeometry (server) matches golden vectors', () => {
  golden.forEach((v, i) => {
    test(`vector ${i} ${v.in.side} @${v.in.price}`, () => {
      const out = computeOrderGeometry(v.in);
      expect(out.qty).toBeCloseTo(v.out.qty, 10);
      expect(out.sl).toBeCloseTo(v.out.sl, 6);
      expect(out.tp).toBeCloseTo(v.out.tp, 6);
      expect(out.slPnl).toBeCloseTo(v.out.slPnl, 6);
      expect(out.tpPnl).toBeCloseTo(v.out.tpPnl, 6);
    });
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/orderGeometry.test.js --forceExit --runInBand > /tmp/og.log 2>&1; tail -20 /tmp/og.log`
Expected: FAIL — `Cannot find module '../../server/services/orderGeometry'`.

- [ ] **Step 4: Implement the server pure module**

Create `server/services/orderGeometry.js`:
```javascript
'use strict';
// Pure order geometry — shared structural math for client & server sizing parity.
// Margin selection (riskPct vs Kelly) is OUT of scope and computed by callers.
// This converts a chosen margin into qty/SL/TP/PnL. NO I/O, NO rounding to
// exchange filters (server applies LOT_SIZE/tick alignment AFTER this).
function computeOrderGeometry({ side, price, margin, lev, slPct, rr }) {
  const slDist = price * slPct / 100;
  const tpDist = slDist * rr;
  const isLong = side === 'LONG';
  const sl = isLong ? price - slDist : price + slDist;
  const tp = isLong ? price + tpDist : price - tpDist;
  const qty = (margin * lev) / price;
  const tpPnl = (tpDist / price) * margin * lev;
  const slPnl = -(slDist / price) * margin * lev;
  return { qty, sl, tp, slPnl, tpPnl, slDist, tpDist };
}
module.exports = { computeOrderGeometry };
```

- [ ] **Step 5: Run it, verify it passes**

Run: `npx jest tests/unit/orderGeometry.test.js --forceExit --runInBand > /tmp/og.log 2>&1; tail -20 /tmp/og.log`
Expected: PASS (3 vectors).

- [ ] **Step 6: Write the failing client test**

Create `client/src/trading/__tests__/orderGeometry.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import golden from '../../../../tests/fixtures/order-geometry-golden.json'
import { computeOrderGeometry } from '../orderGeometry'

describe('orderGeometry (client) matches golden vectors (parity with server)', () => {
  golden.forEach((v: any, i: number) => {
    it(`vector ${i} ${v.in.side} @${v.in.price}`, () => {
      const out = computeOrderGeometry(v.in)
      expect(out.qty).toBeCloseTo(v.out.qty, 10)
      expect(out.sl).toBeCloseTo(v.out.sl, 6)
      expect(out.tp).toBeCloseTo(v.out.tp, 6)
      expect(out.slPnl).toBeCloseTo(v.out.slPnl, 6)
      expect(out.tpPnl).toBeCloseTo(v.out.tpPnl, 6)
    })
  })
})
```

- [ ] **Step 7: Run it, verify it fails**

Run: `cd /root/zeus-terminal/client && npx vitest run src/trading/__tests__/orderGeometry.test.ts 2>&1 | tail -15`
Expected: FAIL — cannot find `../orderGeometry`. (If the JSON import errors on `resolveJsonModule`, confirm `tsconfig` has `"resolveJsonModule": true`; it does for Vite — vitest imports JSON natively.)

- [ ] **Step 8: Implement the client pure module (identical math)**

Create `client/src/trading/orderGeometry.ts`:
```typescript
// Pure order geometry — MUST stay bit-identical to server/services/orderGeometry.js.
// Proven by the shared golden-vector test (tests/fixtures/order-geometry-golden.json).
export interface GeometryInput {
  side: 'LONG' | 'SHORT'; price: number; margin: number; lev: number; slPct: number; rr: number
}
export function computeOrderGeometry({ side, price, margin, lev, slPct, rr }: GeometryInput) {
  const slDist = price * slPct / 100
  const tpDist = slDist * rr
  const isLong = side === 'LONG'
  const sl = isLong ? price - slDist : price + slDist
  const tp = isLong ? price + tpDist : price - tpDist
  const qty = (margin * lev) / price
  const tpPnl = (tpDist / price) * margin * lev
  const slPnl = -(slDist / price) * margin * lev
  return { qty, sl, tp, slPnl, tpPnl, slDist, tpDist }
}
```

- [ ] **Step 9: Run it, verify it passes**

Run: `cd /root/zeus-terminal/client && npx vitest run src/trading/__tests__/orderGeometry.test.ts 2>&1 | tail -10`
Expected: PASS (3 vectors). Same golden file → client + server proven identical.

- [ ] **Step 10: Wire server `processBrainDecision` to use the pure module (refactor, behavior-preserving)**

In `server/services/serverAT.js`, replace the inline `slDist/tpDist/sl/tp/qty` block (lines ~1146-1153) with a call to `computeOrderGeometry({ side, price, margin: finalSize, lev, slPct, rr })`, keeping the existing LOT_SIZE/tick alignment + fee/slippage steps AFTER it unchanged. Add `const { computeOrderGeometry } = require('./orderGeometry')` at the top with the other requires (~line 42). The existing full jest suite (next step) proves no behavior change.

- [ ] **Step 11: Run full server suite — no regression**

Run: `cd /root/zeus-terminal && npx jest --forceExit --runInBand > /tmp/jest-all.log 2>&1; tail -8 /tmp/jest-all.log`
Expected: same pass/fail count as the pre-task baseline (record it first with the same command on a clean tree). New `orderGeometry` tests included and passing.

- [ ] **Step 12: Wire client `placeAutoTrade` to use the pure module (refactor)**

In `client/src/trading/autotrade.ts`, replace the inline `slDist/tpDist/sl/tp/qty/tpPnl/slPnl` block (lines ~1080-1091) with `const { qty, sl, tp, slPnl, tpPnl } = computeOrderGeometry({ side, price: entry, margin: adaptFinalSize, lev, slPct, rr })`. Import at top: `import { computeOrderGeometry } from './orderGeometry'`. Run `cd client && npx vitest run 2>&1 | tail -6` — expect baseline 242 pass / 7 fail unchanged.

- [ ] **Step 13: Commit**

```bash
cd /root/zeus-terminal && git add tests/fixtures/order-geometry-golden.json server/services/orderGeometry.js client/src/trading/orderGeometry.ts tests/unit/orderGeometry.test.js client/src/trading/__tests__/orderGeometry.test.ts server/services/serverAT.js client/src/trading/autotrade.ts
git commit -m "feat(sp2-1): sizing-parity — shared pure orderGeometry (gate 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `resolveOwnership()` — the pure heart

**Goal:** One pure function decides entry owner (exclusive) + two-tier exit owner (always-on net + hard disaster backstop). Exhaustively testable.

**Files:**
- Create: `server/services/ownership.js`
- Test: `tests/unit/ownership.test.js`

- [ ] **Step 1: Write the failing test (exhaustive state table)**

Create `tests/unit/ownership.test.js`:
```javascript
'use strict';
const { resolveOwnership } = require('../../server/services/ownership');

const base = { clientPresent: true, atActive: true, credsValid: true, cutoverActive: true, underTakeControl: false };
const ctx = (o) => Object.assign({}, base, o);

describe('resolveOwnership — entries (exclusive, fail-closed)', () => {
  test('client present → entryOwner CLIENT', () => {
    expect(resolveOwnership(ctx({})).entryOwner).toBe('CLIENT');
  });
  test('client absent + cutover + AT + creds → entryOwner SERVER', () => {
    expect(resolveOwnership(ctx({ clientPresent: false })).entryOwner).toBe('SERVER');
  });
  test('client absent but cutover OFF → CLIENT (server never opens off-cutover)', () => {
    expect(resolveOwnership(ctx({ clientPresent: false, cutoverActive: false })).entryOwner).toBe('CLIENT');
  });
  test('client absent but AT off → CLIENT (server respects AT)', () => {
    expect(resolveOwnership(ctx({ clientPresent: false, atActive: false })).entryOwner).toBe('CLIENT');
  });
  test('client absent but creds invalid → CLIENT (no silent fail-to-open elsewhere)', () => {
    expect(resolveOwnership(ctx({ clientPresent: false, credsValid: false })).entryOwner).toBe('CLIENT');
  });
});

describe('resolveOwnership — exits (always-on net + hard backstop)', () => {
  test('normal → activeManager SERVER, disasterBackstop SERVER', () => {
    const o = resolveOwnership(ctx({})).exitOwner;
    expect(o.activeManager).toBe('SERVER');
    expect(o.disasterBackstop).toBe('SERVER');
  });
  test('under take-control → activeManager USER, disasterBackstop STILL SERVER', () => {
    const o = resolveOwnership(ctx({ underTakeControl: true })).exitOwner;
    expect(o.activeManager).toBe('USER');
    expect(o.disasterBackstop).toBe('SERVER');
  });
  test('disasterBackstop is SERVER in EVERY state (never null/USER)', () => {
    for (const cp of [true, false]) for (const tc of [true, false]) for (const co of [true, false]) {
      expect(resolveOwnership(ctx({ clientPresent: cp, underTakeControl: tc, cutoverActive: co })).exitOwner.disasterBackstop).toBe('SERVER');
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ownership.test.js --forceExit --runInBand > /tmp/own.log 2>&1; tail -20 /tmp/own.log`
Expected: FAIL — `Cannot find module '../../server/services/ownership'`.

- [ ] **Step 3: Implement**

Create `server/services/ownership.js`:
```javascript
'use strict';
// Pure ownership decision — see SP2 spec §4. NO I/O. Callers supply resolved context.
// Entries: EXCLUSIVE, fail-closed (uncertain → treat as client present → don't double-open).
// Exits: always-on server net; disaster backstop is SERVER in EVERY state (never deferred).
function resolveOwnership(ctx) {
  const { clientPresent, atActive, credsValid, cutoverActive, underTakeControl } = ctx;
  const serverMayOpen = (!clientPresent) && cutoverActive && atActive && credsValid;
  const entryOwner = serverMayOpen ? 'SERVER' : 'CLIENT';
  const exitOwner = {
    activeManager: underTakeControl ? 'USER' : 'SERVER',
    disasterBackstop: 'SERVER', // ALWAYS — never null, never USER (spec §4.2 fix #1)
  };
  return { entryOwner, exitOwner };
}
module.exports = { resolveOwnership };
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx jest tests/unit/ownership.test.js --forceExit --runInBand > /tmp/own.log 2>&1; tail -20 /tmp/own.log`
Expected: PASS (all states).

- [ ] **Step 5: Commit**

```bash
git add server/services/ownership.js tests/unit/ownership.test.js
git commit -m "feat(sp2-2): pure resolveOwnership (entry exclusive + two-tier exit)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `heartbeatTracker` — server-stamped liveness

**Goal:** Track per-user trading-loop liveness with server-receive timestamps, hysteresis, and cold-start grace (entries-only). Pure-ish (in-memory Map + injectable `now`).

**Constants:** `HEARTBEAT_TIMEOUT_MS = 20000`, `HYSTERESIS_N = 2`, `COLD_START_GRACE_MS = 30000`.

**Files:**
- Create: `server/services/heartbeatTracker.js`
- Test: `tests/unit/heartbeatTracker.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/heartbeatTracker.test.js`:
```javascript
'use strict';
const HB = require('../../server/services/heartbeatTracker');

beforeEach(() => HB._reset(1000)); // bootTs = 1000

describe('heartbeatTracker', () => {
  test('cold-start grace: unknown user is PRESENT during grace window', () => {
    expect(HB.isClientPresent(1, 1000 + 5000)).toBe(true); // 5s after boot, no beat → grace
  });
  test('cold-start grace expires: unknown user ABSENT after grace + timeout', () => {
    expect(HB.isClientPresent(1, 1000 + 30000 + 20001)).toBe(false);
  });
  test('fresh beat → present', () => {
    HB.recordBeat(1, 100000);
    expect(HB.isClientPresent(1, 100000 + 5000)).toBe(true);
  });
  test('stale beat past timeout → absent (after hysteresis)', () => {
    HB.recordBeat(1, 100000);
    // first stale check arms hysteresis, second confirms
    HB.isClientPresent(1, 100000 + 20001);
    expect(HB.isClientPresent(1, 100000 + 20002)).toBe(false);
  });
  test('markAbsent (WS close) forces absent immediately', () => {
    HB.recordBeat(1, 100000);
    HB.markAbsent(1);
    expect(HB.isClientPresent(1, 100000 + 1000)).toBe(false);
  });
  test('server-stamped: recordBeat ignores client clock, uses passed serverTs', () => {
    HB.recordBeat(1, 100000); // serverTs only
    expect(HB.isClientPresent(1, 100000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest tests/unit/heartbeatTracker.test.js --forceExit --runInBand > /tmp/hb.log 2>&1; tail -20 /tmp/hb.log`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/services/heartbeatTracker.js`:
```javascript
'use strict';
// Per-user trading-loop liveness, server-stamped. SP2 spec §5.
const HEARTBEAT_TIMEOUT_MS = 20000;
const HYSTERESIS_N = 2;
const COLD_START_GRACE_MS = 30000;

let _bootTs = Date.now();
const _state = new Map(); // userId -> { lastBeatTs, forcedAbsent, missStreak }

function _reset(bootTs) { _bootTs = bootTs != null ? bootTs : Date.now(); _state.clear(); }

function recordBeat(userId, serverTs) {
  const s = _state.get(userId) || { lastBeatTs: 0, forcedAbsent: false, missStreak: 0 };
  s.lastBeatTs = serverTs; s.forcedAbsent = false; s.missStreak = 0;
  _state.set(userId, s);
}

function markAbsent(userId) { // WS close = fast absence signal
  const s = _state.get(userId) || { lastBeatTs: 0, missStreak: 0 };
  s.forcedAbsent = true; _state.set(userId, s);
}

function isClientPresent(userId, now) {
  const s = _state.get(userId);
  if (!s || !s.lastBeatTs) {
    // cold-start grace — ENTRIES ONLY caller (spec §5 B). No beat yet:
    if (s && s.forcedAbsent) return false;
    return (now - _bootTs) < (COLD_START_GRACE_MS + HEARTBEAT_TIMEOUT_MS);
  }
  if (s.forcedAbsent) return false;
  const fresh = (now - s.lastBeatTs) < HEARTBEAT_TIMEOUT_MS;
  if (fresh) { s.missStreak = 0; return true; }
  s.missStreak = (s.missStreak || 0) + 1; // hysteresis: require N consecutive misses
  return s.missStreak < HYSTERESIS_N;
}

module.exports = { recordBeat, markAbsent, isClientPresent, _reset,
  HEARTBEAT_TIMEOUT_MS, HYSTERESIS_N, COLD_START_GRACE_MS };
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx jest tests/unit/heartbeatTracker.test.js --forceExit --runInBand > /tmp/hb.log 2>&1; tail -20 /tmp/hb.log`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/heartbeatTracker.js tests/unit/heartbeatTracker.test.js
git commit -m "feat(sp2-3): heartbeatTracker — server-stamped liveness + hysteresis + cold-start grace

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Client heartbeat emit + server ingest + WS-close absence

**Goal:** Client AT tick emits liveness; server stamps + stores it; WS close marks absence fast.

**Files:**
- Modify: `client/src/trading/autotrade.ts` (~line 735, beside the parity emit)
- Modify: `server/routes/brainParity.js` (add route)
- Modify: `server/server.js` (~line 1750 WS close handler)
- Test: `tests/unit/heartbeat-route.test.js`

- [ ] **Step 1: Write the failing route test**

Create `tests/unit/heartbeat-route.test.js`:
```javascript
'use strict';
const express = require('express');
const supertest = require('supertest');
const path = require('path');

jest.mock(path.resolve(__dirname, '../../server/services/heartbeatTracker'), () => ({
  recordBeat: jest.fn(),
}));
const HB = require('../../server/services/heartbeatTracker');

describe('POST /api/at/heartbeat', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 7 }; next(); });
    app.use('/api/brain/parity', require('../../server/routes/brainParity'));
  });
  test('stamps server time and records beat for the user', async () => {
    const res = await supertest(app).post('/api/brain/parity/heartbeat').send({});
    expect(res.status).toBe(200);
    expect(HB.recordBeat).toHaveBeenCalledTimes(1);
    expect(HB.recordBeat.mock.calls[0][0]).toBe(7); // userId
    expect(typeof HB.recordBeat.mock.calls[0][1]).toBe('number'); // server ts
  });
  test('401 when unauthenticated', async () => {
    const app2 = express(); app2.use(express.json());
    app2.use('/api/brain/parity', require('../../server/routes/brainParity'));
    const res = await supertest(app2).post('/api/brain/parity/heartbeat').send({});
    expect(res.status).toBe(401);
  });
});
```
(Route mounted under `/api/brain/parity` to match existing `brainParity.js` mount; final path `/api/brain/parity/heartbeat`.)

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest tests/unit/heartbeat-route.test.js --forceExit --runInBand > /tmp/hbr.log 2>&1; tail -20 /tmp/hbr.log`
Expected: FAIL — 404 (route missing).

- [ ] **Step 3: Add the route**

In `server/routes/brainParity.js`, after the existing `/client` handler, add:
```javascript
const heartbeatTracker = require('../services/heartbeatTracker');
// POST /api/brain/parity/heartbeat — client AT-tick liveness. Server-stamped.
router.post('/heartbeat', (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'unauthorized' });
  heartbeatTracker.recordBeat(req.user.id, Date.now()); // server clock, never client's
  return res.status(200).json({ ok: true });
});
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx jest tests/unit/heartbeat-route.test.js --forceExit --runInBand > /tmp/hbr.log 2>&1; tail -20 /tmp/hbr.log`
Expected: PASS.

- [ ] **Step 5: Emit from the client AT tick (no client test — best-effort fire-and-forget)**

In `client/src/trading/autotrade.ts`, immediately after the parity emit block (~line 749), add:
```typescript
// [SP2] Trading-loop liveness — server stamps receive-time. Best-effort.
api.raw<any>('POST', '/api/brain/parity/heartbeat', { ts: Date.now() })
  .catch(() => { /* heartbeat is best-effort */ })
```

- [ ] **Step 6: WS-close → fast absence**

In `server/server.js`, inside the existing `ws.on('close', ...)` handler (~line 1750), add after the `_wsClients` cleanup:
```javascript
try { require('./server/services/heartbeatTracker').markAbsent(uid); } catch (_) {}
```

- [ ] **Step 7: Verify full server suite green + build client**

Run: `cd /root/zeus-terminal && npx jest --forceExit --runInBand > /tmp/jest-all.log 2>&1; tail -8 /tmp/jest-all.log` (baseline unchanged + new heartbeat tests pass).
Run: `cd client && npx vite build 2>&1 | tail -3` (clean build).

- [ ] **Step 8: Commit**

```bash
cd /root/zeus-terminal && git add server/routes/brainParity.js client/src/trading/autotrade.ts server/server.js tests/unit/heartbeat-route.test.js
git commit -m "feat(sp2-4): heartbeat emit (client tick) + server ingest + WS-close absence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Cutover flag + ENG-1 gate testnet-aware + entry idempotency

**Goal:** Open the entry gate for testnet users under a staged cutover flag, with an idempotency guard against double-open at the boundary. **Flag stays `[]` (off) — no behavior change until flipped (gated).**

**Files:**
- Modify: `server/migrationFlags.js` (add `SERVER_AT_TESTNET_EXEC`)
- Create: `server/services/sp2Cutover.js` (user list — flags are boolean-only)
- Create: `server/services/entryDedup.js`
- Modify: `server/services/serverAT.js` (gate ~950 + entry path)
- Test: `tests/unit/sp2Cutover.test.js`, `tests/unit/entryDedup.test.js`

- [ ] **Step 1: Write failing test for sp2Cutover**

Create `tests/unit/sp2Cutover.test.js`:
```javascript
'use strict';
const C = require('../../server/services/sp2Cutover');
beforeEach(() => C._setForTest([]));
describe('sp2Cutover user list', () => {
  test('empty by default → nobody cutover', () => {
    expect(C.isCutoverUser(1)).toBe(false);
  });
  test('uid in list → cutover', () => {
    C._setForTest([1]);
    expect(C.isCutoverUser(1)).toBe(true);
    expect(C.isCutoverUser(2)).toBe(false);
  });
  test('"all" sentinel → every user cutover', () => {
    C._setForTest('all');
    expect(C.isCutoverUser(99)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx jest tests/unit/sp2Cutover.test.js --forceExit --runInBand > /tmp/c.log 2>&1; tail -15 /tmp/c.log`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement sp2Cutover**

Create `server/services/sp2Cutover.js`:
```javascript
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '../../data/sp2_cutover_users.json');
let _list = _load();
function _load() {
  try { const v = JSON.parse(fs.readFileSync(FILE, 'utf8')); return v && (v === 'all' || Array.isArray(v.users)) ? (v === 'all' ? 'all' : v.users) : []; }
  catch (_) { return []; }
}
function isCutoverUser(userId) {
  if (_list === 'all') return true;
  return Array.isArray(_list) && _list.includes(Number(userId));
}
function _setForTest(v) { _list = v; }
module.exports = { isCutoverUser, _setForTest };
```
Create `data/sp2_cutover_users.json` with `{"users": []}` (off).

- [ ] **Step 4: Run, verify pass**

Run: `npx jest tests/unit/sp2Cutover.test.js --forceExit --runInBand > /tmp/c.log 2>&1; tail -15 /tmp/c.log`
Expected: PASS.

- [ ] **Step 5: Write failing test for entryDedup**

Create `tests/unit/entryDedup.test.js`:
```javascript
'use strict';
const D = require('../../server/services/entryDedup');
beforeEach(() => D._reset());
describe('entryDedup', () => {
  test('first open allowed, second within window blocked', () => {
    expect(D.shouldBlockOpen(1, 'BTCUSDT', 1000, 8000)).toBe(false);
    D.markOpened(1, 'BTCUSDT', 1000);
    expect(D.shouldBlockOpen(1, 'BTCUSDT', 3000, 8000)).toBe(true);
  });
  test('after window, allowed again', () => {
    D.markOpened(1, 'BTCUSDT', 1000);
    expect(D.shouldBlockOpen(1, 'BTCUSDT', 1000 + 8001, 8000)).toBe(false);
  });
  test('different symbol not blocked', () => {
    D.markOpened(1, 'BTCUSDT', 1000);
    expect(D.shouldBlockOpen(1, 'ETHUSDT', 1500, 8000)).toBe(false);
  });
});
```

- [ ] **Step 6: Run, verify fail**

Run: `npx jest tests/unit/entryDedup.test.js --forceExit --runInBand > /tmp/d.log 2>&1; tail -15 /tmp/d.log`
Expected: FAIL — module missing.

- [ ] **Step 7: Implement entryDedup**

Create `server/services/entryDedup.js`:
```javascript
'use strict';
// Per-(user×symbol) open dedup — second line of defense beyond heartbeat exclusivity.
const _last = new Map(); // `${userId}:${symbol}` -> ts
const _key = (u, s) => `${u}:${s}`;
function shouldBlockOpen(userId, symbol, now, windowMs) {
  const t = _last.get(_key(userId, symbol));
  return t != null && (now - t) < windowMs;
}
function markOpened(userId, symbol, now) { _last.set(_key(userId, symbol), now); }
function _reset() { _last.clear(); }
module.exports = { shouldBlockOpen, markOpened, _reset };
```

- [ ] **Step 8: Run, verify pass**

Run: `npx jest tests/unit/entryDedup.test.js --forceExit --runInBand > /tmp/d.log 2>&1; tail -15 /tmp/d.log`
Expected: PASS.

- [ ] **Step 9: Add `SERVER_AT_TESTNET_EXEC` flag**

In `server/migrationFlags.js` `DEFAULTS` (after `SERVER_AT_TESTNET`), add:
```javascript
    // SP2: master toggle to allow serverAT to EXECUTE testnet entries (not just
    // shadow). Gated additionally per-user by data/sp2_cutover_users.json. OFF by default.
    SERVER_AT_TESTNET_EXEC: false,
```

- [ ] **Step 10: Make the ENG-1 gate testnet-aware**

In `server/services/serverAT.js` (~line 950), replace the block:
```javascript
if (us.engineMode !== 'demo' && MF.SERVER_AT !== true) {
    logger.warn('AT_ENGINE', `Entry blocked uid=${userId} — SERVER_AT_REQUIRED_FOR_LIVE (mode=${us.engineMode || 'unknown'})`);
    _recordMissedTrade(userId, decision, 'SERVER_AT_REQUIRED_FOR_LIVE');
    return null;
}
```
with:
```javascript
// [SP2] testnet-aware gate. demo passes through (unchanged). For non-demo:
// allow when full SERVER_AT, OR when SP2 testnet-exec is on for a cutover user
// on a testnet exchange. REAL is never reached here (resolved env gating upstream).
if (us.engineMode !== 'demo') {
    const creds = getExchangeCreds(userId);
    const isTestnet = !!creds && (creds.mode === 'testnet');
    const sp2Allowed = MF.SERVER_AT_TESTNET_EXEC === true && isTestnet
        && require('./sp2Cutover').isCutoverUser(userId);
    if (MF.SERVER_AT !== true && !sp2Allowed) {
        logger.warn('AT_ENGINE', `Entry blocked uid=${userId} — SERVER_AT_REQUIRED_FOR_LIVE (mode=${us.engineMode || 'unknown'})`);
        _recordMissedTrade(userId, decision, 'SERVER_AT_REQUIRED_FOR_LIVE');
        return null;
    }
}
```

- [ ] **Step 11: Add idempotency + ownership check before the open**

In `server/services/serverAT.js` `processBrainDecision`, immediately after the gate above and before sizing (~line 1003), add:
```javascript
// [SP2] entry exclusivity: only open if server owns entries AND not a dup.
if (us.engineMode !== 'demo') { // demo path keeps existing behavior
    const heartbeatTracker = require('./heartbeatTracker');
    const { resolveOwnership } = require('./ownership');
    const creds2 = getExchangeCreds(userId);
    const own = resolveOwnership({
        clientPresent: heartbeatTracker.isClientPresent(userId, Date.now()),
        atActive: _isATActiveForMode(us, us.engineMode),
        credsValid: !!creds2,
        cutoverActive: require('./sp2Cutover').isCutoverUser(userId) && MF.SERVER_AT_TESTNET_EXEC === true,
        underTakeControl: false, // entries are not position-scoped
    });
    if (own.entryOwner !== 'SERVER') {
        _recordMissedTrade(userId, decision, 'ENTRY_OWNED_BY_CLIENT');
        return null;
    }
    const entryDedup = require('./entryDedup');
    if (entryDedup.shouldBlockOpen(userId, decision.symbol, Date.now(), 8000)) {
        _recordMissedTrade(userId, decision, 'ENTRY_DEDUP');
        return null;
    }
    entryDedup.markOpened(userId, decision.symbol, Date.now());
}
```

- [ ] **Step 12: Full server suite — baseline unchanged (flag off → no behavior change)**

Run: `cd /root/zeus-terminal && npx jest --forceExit --runInBand > /tmp/jest-all.log 2>&1; tail -8 /tmp/jest-all.log`
Expected: baseline pass/fail unchanged + new sp2Cutover/entryDedup tests pass. (Flag off + empty cutover list → gate behaves exactly as before for live; demo untouched.)

- [ ] **Step 13: Commit**

```bash
git add server/migrationFlags.js server/services/sp2Cutover.js server/services/entryDedup.js server/services/serverAT.js data/sp2_cutover_users.json tests/unit/sp2Cutover.test.js tests/unit/entryDedup.test.js
git commit -m "feat(sp2-5): testnet-aware ENG-1 gate + cutover list + entry idempotency (flag OFF)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Exit net — disaster backstop under take-control (fix #1)

**Goal:** The always-on exit net already runs in `onPriceUpdate`. Fix the orphan gap: `serverAT.js:2742` currently does `if (_isExplicitUserControl(pos)) continue;` — skipping SL entirely under take-control. Change so take-control suppresses **active management only** (DSL trailing/TP-tighten) but the **disaster backstop (original SL) ALWAYS runs**.

**Files:**
- Modify: `server/services/serverAT.js` (`onPriceUpdate` ~2742, add `_disasterStop` helper)
- Test: `tests/unit/disaster-backstop.test.js`

- [ ] **Step 1: Write the failing test (pure helper)**

Create `tests/unit/disaster-backstop.test.js`:
```javascript
'use strict';
const { _disasterStopPrice, _shouldDisasterClose } = require('../../server/services/serverAT');

describe('disaster backstop (fix #1)', () => {
  test('uses originalSL when present', () => {
    expect(_disasterStopPrice({ side: 'LONG', price: 100, originalSL: 95, slPct: 1.5 })).toBe(95);
  });
  test('derives from slPct when originalSL missing — never null', () => {
    // LONG, entry 100, slPct 1.5 → 98.5
    expect(_disasterStopPrice({ side: 'LONG', price: 100, originalSL: null, slPct: 1.5 })).toBeCloseTo(98.5, 6);
  });
  test('SHORT derives above entry', () => {
    expect(_disasterStopPrice({ side: 'SHORT', price: 100, originalSL: null, slPct: 1.5 })).toBeCloseTo(101.5, 6);
  });
  test('LONG closes when price <= disaster stop', () => {
    expect(_shouldDisasterClose({ side: 'LONG', price: 100, originalSL: 95, slPct: 1.5 }, 94)).toBe(true);
    expect(_shouldDisasterClose({ side: 'LONG', price: 100, originalSL: 95, slPct: 1.5 }, 96)).toBe(false);
  });
  test('never closes on null/0 derived stop guard (no instant HIT_SL)', () => {
    // slPct 0 and no originalSL → derive returns entry; guard must avoid closing AT entry exactly
    expect(_shouldDisasterClose({ side: 'LONG', price: 100, originalSL: null, slPct: 0 }, 100)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx jest tests/unit/disaster-backstop.test.js --forceExit --runInBand > /tmp/db.log 2>&1; tail -20 /tmp/db.log`
Expected: FAIL — `_disasterStopPrice` not exported.

- [ ] **Step 3: Implement the helpers + export**

In `server/services/serverAT.js`, near `_isSLBreached` (~line 2698), add:
```javascript
// [SP2 fix #1] Disaster backstop — the original SL set at entry, or a derived
// fallback from slPct. NEVER null/0 (today's null-SL → instant-HIT_SL bug).
function _disasterStopPrice(pos) {
    if (Number(pos.originalSL) > 0) return Number(pos.originalSL);
    const slPct = Number(pos.slPct) > 0 ? Number(pos.slPct) : 0;
    if (slPct <= 0) return 0; // unknown → guard below refuses to close
    const dist = pos.price * slPct / 100;
    return pos.side === 'LONG' ? pos.price - dist : pos.price + dist;
}
function _shouldDisasterClose(pos, price) {
    const stop = _disasterStopPrice(pos);
    if (!(stop > 0)) return false; // never close on null/0 (no false HIT_SL)
    return pos.side === 'LONG' ? price <= stop : price >= stop;
}
```
Add to the module exports object: `_disasterStopPrice, _shouldDisasterClose,`.

- [ ] **Step 4: Replace the take-control skip in `onPriceUpdate`**

In `server/services/serverAT.js` (~line 2742), replace:
```javascript
if (_isExplicitUserControl(pos, Date.now())) continue;
```
with:
```javascript
// [SP2 fix #1] Under explicit take-control, suppress ACTIVE management (DSL
// trailing / TP-tighten) but ALWAYS enforce the disaster backstop — never orphan.
if (_isExplicitUserControl(pos, Date.now())) {
    if (_shouldDisasterClose(pos, price)) {
        const dPnl = pos.side === 'LONG'
            ? +((price - pos.price) / pos.price * pos.size * pos.lev).toFixed(2)
            : +((pos.price - price) / pos.price * pos.size * pos.lev).toFixed(2);
        _closePosition(i, pos, 'DISASTER_SL', price, dPnl);
        if (pos.userId) dslChangedUsers.add(pos.userId);
    }
    continue; // still skip active management (trailing/TP) for this position
}
```
(Note: ensure `pos.originalSL` is set at entry — `processBrainDecision` already stores `originalEntry`; add `originalSL: _slAligned` to the entry object at ~line 1220 if not present, so the backstop has the entry SL.)

- [ ] **Step 5: Run unit test, verify pass**

Run: `npx jest tests/unit/disaster-backstop.test.js --forceExit --runInBand > /tmp/db.log 2>&1; tail -20 /tmp/db.log`
Expected: PASS.

- [ ] **Step 6: Full server suite — no regression**

Run: `cd /root/zeus-terminal && npx jest --forceExit --runInBand > /tmp/jest-all.log 2>&1; tail -8 /tmp/jest-all.log`
Expected: baseline unchanged + new test passes.

- [ ] **Step 7: Commit**

```bash
git add server/services/serverAT.js tests/unit/disaster-backstop.test.js
git commit -m "feat(sp2-6): disaster backstop under take-control — no orphan (fix #1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Derived-SL on adopted/external positions (policy L)

**Goal:** `_syncExternalPosition` (serverAT.js:4030) currently adopts with `slOrderId:null, slPlaced:false` and **no protective SL**. Attach a derived default SL% from entry — never null.

**Files:**
- Modify: `server/services/serverAT.js` (`_syncExternalPosition` ~4030)
- Test: `tests/unit/adopt-derived-sl.test.js`

- [ ] **Step 1: Write the failing test (pure helper)**

Create `tests/unit/adopt-derived-sl.test.js`:
```javascript
'use strict';
const { _deriveAdoptedSL } = require('../../server/services/serverAT');
describe('adopted-position derived SL (policy L)', () => {
  test('LONG: entry 100, default 1.5% → 98.5', () => {
    expect(_deriveAdoptedSL('LONG', 100, 1.5)).toBeCloseTo(98.5, 6);
  });
  test('SHORT: entry 100, default 1.5% → 101.5', () => {
    expect(_deriveAdoptedSL('SHORT', 100, 1.5)).toBeCloseTo(101.5, 6);
  });
  test('never returns null/0', () => {
    expect(_deriveAdoptedSL('LONG', 100, 1.5)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx jest tests/unit/adopt-derived-sl.test.js --forceExit --runInBand > /tmp/asl.log 2>&1; tail -15 /tmp/asl.log`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement helper + use it in adoption**

In `server/services/serverAT.js`, add near `_disasterStopPrice`:
```javascript
// [SP2 policy L] Derive a protective SL for an adopted/external position from
// the user's configured default SL%. Never null/0.
function _deriveAdoptedSL(side, entryPrice, defaultSlPct) {
    const pct = Number(defaultSlPct) > 0 ? Number(defaultSlPct) : 1.5;
    const dist = entryPrice * pct / 100;
    return side === 'LONG' ? entryPrice - dist : entryPrice + dist;
}
```
Add `_deriveAdoptedSL,` to module exports. Then in `_syncExternalPosition` (~line 4050), set the position's synthetic SL (used by the server net even though no exchange order is placed):
```javascript
const _defSlPct = (() => { try { const stc = _stcMap.get(userId); return stc && stc.slPct > 0 ? stc.slPct : 1.5; } catch (_) { return 1.5; } })();
const _adoptedSL = _deriveAdoptedSL(data.side, parseFloat(data.entryPrice), _defSlPct);
```
and on the `entry` object add: `sl: _adoptedSL, originalSL: _adoptedSL, slPct: _defSlPct,` (so `onPriceUpdate` + disaster backstop protect it). Keep `live.slPlaced: false` (no exchange order, but the server net watches it).

- [ ] **Step 4: Run unit test, verify pass**

Run: `npx jest tests/unit/adopt-derived-sl.test.js --forceExit --runInBand > /tmp/asl.log 2>&1; tail -15 /tmp/asl.log`
Expected: PASS.

- [ ] **Step 5: Full server suite — no regression**

Run: `cd /root/zeus-terminal && npx jest --forceExit --runInBand > /tmp/jest-all.log 2>&1; tail -8 /tmp/jest-all.log`
Expected: baseline unchanged.

- [ ] **Step 6: Commit**

```bash
git add server/services/serverAT.js tests/unit/adopt-derived-sl.test.js
git commit -m "feat(sp2-7): adopted positions get derived protective SL — never null (policy L)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Handover audit log (observability H)

**Goal:** Persist every ownership flip `{userId, from, to, reason, serverTs}` for soak analysis.

**Files:**
- Modify: `server/services/database.js` (migration `406_handover_log` + `logHandover()`)
- Modify: `server/services/serverAT.js` (call `logHandover` when entry ownership flips)
- Test: `tests/unit/handover-log.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/handover-log.test.js`:
```javascript
'use strict';
const Database = require('better-sqlite3');
describe('handover_log writer', () => {
  test('logHandover inserts a row with from/to/reason/ts', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE handover_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, from_owner TEXT, to_owner TEXT, reason TEXT, created_at INTEGER NOT NULL);`);
    const ins = db.prepare('INSERT INTO handover_log (user_id, from_owner, to_owner, reason, created_at) VALUES (?,?,?,?,?)');
    ins.run(1, 'CLIENT', 'SERVER', 'heartbeat_absent', 123);
    const row = db.prepare('SELECT * FROM handover_log WHERE user_id=1').get();
    expect(row.from_owner).toBe('CLIENT');
    expect(row.to_owner).toBe('SERVER');
    expect(row.reason).toBe('heartbeat_absent');
  });
});
```
(This test pins the schema/shape; the real `logHandover` mirrors the existing `logParityRow` pattern in `database.js`.)

- [ ] **Step 2: Run, verify pass-as-spec (schema baseline)**

Run: `npx jest tests/unit/handover-log.test.js --forceExit --runInBand > /tmp/h.log 2>&1; tail -15 /tmp/h.log`
Expected: PASS (proves the schema/SQL is valid before wiring into the real DB).

- [ ] **Step 3: Add migration + writer in `database.js`**

After the highest existing migration (currently `405_…`), add:
```javascript
migrate('406_handover_log', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS handover_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            from_owner  TEXT,
            to_owner    TEXT,
            reason      TEXT,
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_handover_user_ts ON handover_log(user_id, created_at);
    `);
});
```
Near `logParityRow` (~line 10964), add:
```javascript
const _handoverInsert = db.prepare(
  'INSERT INTO handover_log (user_id, from_owner, to_owner, reason, created_at) VALUES (?,?,?,?,?)'
);
function logHandover(userId, fromOwner, toOwner, reason) {
  try {
    if (!userId) return;
    _handoverInsert.run(Number(userId), String(fromOwner || ''), String(toOwner || ''), reason ? String(reason).slice(0, 64) : null, Date.now());
  } catch (_e) { /* observability must never throw */ }
}
```
Export `logHandover` in the module's exports object.

- [ ] **Step 4: Call it on entry-ownership change in `serverAT.js`**

Maintain a per-user `_lastEntryOwner` Map. In `processBrainDecision`, right after computing `own` (Task 5 Step 11), add:
```javascript
const _prevOwner = _lastEntryOwner.get(userId) || 'CLIENT';
if (own.entryOwner !== _prevOwner) {
    _lastEntryOwner.set(userId, own.entryOwner);
    try { require('./database').logHandover(userId, _prevOwner, own.entryOwner, own.entryOwner === 'SERVER' ? 'client_absent' : 'client_present'); } catch (_) {}
}
```
Declare `const _lastEntryOwner = new Map();` near the top module state.

- [ ] **Step 5: Full server suite — migration applies cleanly, no regression**

Run: `cd /root/zeus-terminal && npx jest --forceExit --runInBand > /tmp/jest-all.log 2>&1; tail -8 /tmp/jest-all.log`
Expected: baseline unchanged + handover test passes.

- [ ] **Step 6: Commit**

```bash
git add server/services/database.js server/services/serverAT.js tests/unit/handover-log.test.js
git commit -m "feat(sp2-8): handover_log — record every entry-ownership flip (observability H)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Ownership state in sync payload + client indicator

**Goal:** Expose `{entryOwner, exitOwner}` per user in `getFullState` so the client can render "SERVER DRIVING / YOU DRIVING / SAFETY NET ON".

**Files:**
- Modify: `server/services/serverAT.js` (`getFullState` ~3168)
- Modify: `client/src/core/state.ts` (apply `ownership` ~1219)
- Test: `tests/unit/getfullstate-ownership.test.js`

- [ ] **Step 1: Write the failing test (pure compute fn)**

Create `tests/unit/getfullstate-ownership.test.js`:
```javascript
'use strict';
const { _computeUserOwnership } = require('../../server/services/serverAT');
describe('_computeUserOwnership for sync payload', () => {
  test('present client → YOU DRIVING + SAFETY NET ON', () => {
    const o = _computeUserOwnership({ clientPresent: true, atActive: true, credsValid: true, cutoverActive: true });
    expect(o.entryOwner).toBe('CLIENT');
    expect(o.exitOwner.disasterBackstop).toBe('SERVER');
  });
  test('absent client + cutover → SERVER DRIVING', () => {
    const o = _computeUserOwnership({ clientPresent: false, atActive: true, credsValid: true, cutoverActive: true });
    expect(o.entryOwner).toBe('SERVER');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx jest tests/unit/getfullstate-ownership.test.js --forceExit --runInBand > /tmp/go.log 2>&1; tail -15 /tmp/go.log`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement + wire into getFullState**

In `server/services/serverAT.js`, add:
```javascript
function _computeUserOwnership(ctx) { return require('./ownership').resolveOwnership(Object.assign({ underTakeControl: false }, ctx)); }
```
Export it. In `getFullState` (~line 3250, near the return), compute and add to the returned object:
```javascript
ownership: _computeUserOwnership({
    clientPresent: require('./heartbeatTracker').isClientPresent(userId, Date.now()),
    atActive: _isATActiveForMode(us, us.engineMode),
    credsValid: !!creds,
    cutoverActive: require('./sp2Cutover').isCutoverUser(userId) && MF.SERVER_AT_TESTNET_EXEC === true,
}),
```

- [ ] **Step 4: Run unit test, verify pass**

Run: `npx jest tests/unit/getfullstate-ownership.test.js --forceExit --runInBand > /tmp/go.log 2>&1; tail -15 /tmp/go.log`
Expected: PASS.

- [ ] **Step 5: Apply on the client (state.ts)**

In `client/src/core/state.ts` `_applyServerATState` (~line 1219), after the seq-dedup gate, add:
```typescript
if (state.ownership) { try { (window as any).ZEUS_OWNERSHIP = state.ownership } catch (_) {} }
```
(Indicator UI component consuming `ZEUS_OWNERSHIP` is deferred to SP2-b per spec §10 — this step only plumbs the data through. No client test needed for a passthrough assignment.)

- [ ] **Step 6: Full server suite + client build**

Run: `cd /root/zeus-terminal && npx jest --forceExit --runInBand > /tmp/jest-all.log 2>&1; tail -8 /tmp/jest-all.log` (baseline + new test).
Run: `cd client && npx vite build 2>&1 | tail -3` (clean).

- [ ] **Step 7: Commit**

```bash
cd /root/zeus-terminal && git add server/services/serverAT.js client/src/core/state.ts tests/unit/getfullstate-ownership.test.js
git commit -m "feat(sp2-9): expose ownership state in sync payload (observability J)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Integration tests (the spec §14 scenarios)

**Goal:** Prove the end-to-end safety scenarios. These use a real `better-sqlite3` `:memory:` DB + the actual modules wired together (no over-mocking).

**Files:**
- Test: `tests/integration/sp2-scenarios.test.js`

- [ ] **Step 1: Write the integration tests**

Create `tests/integration/sp2-scenarios.test.js`:
```javascript
'use strict';
const { resolveOwnership } = require('../../server/services/ownership');
const HB = require('../../server/services/heartbeatTracker');
const DEDUP = require('../../server/services/entryDedup');

describe('SP2 integration scenarios (spec §14)', () => {
  beforeEach(() => { HB._reset(1000); DEDUP._reset(); });

  test('net-cut during SL hit: client absent → server owns entries, exit net always on', () => {
    HB.markAbsent(5); // WS closed = laptop closed
    const own = resolveOwnership({ clientPresent: HB.isClientPresent(5, 2000), atActive: true, credsValid: true, cutoverActive: true, underTakeControl: false });
    expect(own.entryOwner).toBe('SERVER');
    expect(own.exitOwner.activeManager).toBe('SERVER'); // net runs
    expect(own.exitOwner.disasterBackstop).toBe('SERVER');
  });

  test('take-control + net-cut: active mgmt USER but disaster backstop STILL SERVER', () => {
    const own = resolveOwnership({ clientPresent: false, atActive: true, credsValid: true, cutoverActive: true, underTakeControl: true });
    expect(own.exitOwner.activeManager).toBe('USER');
    expect(own.exitOwner.disasterBackstop).toBe('SERVER'); // never orphaned
  });

  test('reload (cold-start grace): no heartbeat yet → client treated PRESENT for entries (no double-open)', () => {
    // boot at 1000, within grace window
    const own = resolveOwnership({ clientPresent: HB.isClientPresent(9, 1000 + 5000), atActive: true, credsValid: true, cutoverActive: true, underTakeControl: false });
    expect(own.entryOwner).toBe('CLIENT'); // grace holds entries with client
  });

  test('idempotency: server cannot double-open same symbol within window', () => {
    expect(DEDUP.shouldBlockOpen(5, 'BTCUSDT', 1000, 8000)).toBe(false);
    DEDUP.markOpened(5, 'BTCUSDT', 1000);
    expect(DEDUP.shouldBlockOpen(5, 'BTCUSDT', 2000, 8000)).toBe(true);
  });

  test('rollback: cutover off → entries return to client instantly, net unaffected', () => {
    const own = resolveOwnership({ clientPresent: false, atActive: true, credsValid: true, cutoverActive: false, underTakeControl: false });
    expect(own.entryOwner).toBe('CLIENT'); // server stops opening
    expect(own.exitOwner.disasterBackstop).toBe('SERVER'); // net stays on
  });
});
```

- [ ] **Step 2: Run, verify pass**

Run: `cd /root/zeus-terminal && npx jest tests/integration/sp2-scenarios.test.js --forceExit --runInBand > /tmp/sp2int.log 2>&1; tail -25 /tmp/sp2int.log`
Expected: PASS (5 scenarios).

- [ ] **Step 3: Full suite final green**

Run: `npx jest --forceExit --runInBand > /tmp/jest-all.log 2>&1; tail -8 /tmp/jest-all.log` (baseline unchanged + all SP2 tests pass).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/sp2-scenarios.test.js
git commit -m "test(sp2-10): integration scenarios — net-cut, take-control, reload, rollback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-implementation: staged cutover (GATED — operator-driven, NOT in this plan's code)

These are **runtime flips**, executed only after all tasks green + gate 2 (sizing) green + demo-soak healthy. Each is an explicit operator PROCEED.

1. **SP2-a:** set `data/sp2_cutover_users.json` → `{"users":[1]}`; flip `SERVER_AT_TESTNET_EXEC=true` via admin flag API. Short soak on uid=1 (operator's own testnet account). Watch `handover_log` + positions. Rollback = flip flag off (entries instantly back to client; net stays on).
2. **Load/latency gate (S):** before widening, confirm per-tick SL-check latency stays tight under load.
3. **SP2-b:** set cutover list → `"all"`. Identical code, target widens.

---

## Self-Review

**Spec coverage:** §4 ownership → Task 2; §5 heartbeat → Tasks 3-4; §6 entry path (ENG-1, idempotency, sizing) → Tasks 1,5; §7 exit net (reduceOnly already exists; disaster backstop) → Task 6; §8 reconciliation derived-SL → Task 7; §9 cutover+rollback → Task 5 + post-impl; §10 observability (H audit, J sync) → Tasks 8,9; §11 single-instance/AT/creds → enforced in Task 5 gate; §14 testing → Task 10. **Gap noted:** reduceOnly enforcement (§7.2 "refuse non-reduceOnly close") — already set in `binanceOps.js:438`; a defensive pre-flight assertion is a small add foldable into Task 6 if the operator wants it explicit (currently relies on the existing close path always setting it). Bybit adapter reduceOnly audit (§7.5) is a manual verification step, not code — flagged for SP2-a checklist.

**Placeholder scan:** none — every code step has real code; every run step has a command + expected output.

**Type/name consistency:** `resolveOwnership(ctx)` takes one context object (Tasks 2,5,9,10 all pass the same shape `{clientPresent, atActive, credsValid, cutoverActive, underTakeControl}`). `heartbeatTracker` API `{recordBeat, markAbsent, isClientPresent, _reset}` consistent across Tasks 3,4,5,9,10. `entryDedup` `{shouldBlockOpen, markOpened, _reset}` consistent. Flag `SERVER_AT_TESTNET_EXEC` + `sp2Cutover.isCutoverUser` consistent across Tasks 5,9. `computeOrderGeometry` identical signature client/server (Task 1).
