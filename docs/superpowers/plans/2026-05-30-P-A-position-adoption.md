# P-A Position Adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, money-path, with live Bybit-demo validation). Steps use `- [ ]`.

**Goal:** Adopt untracked exchange positions into Zeus tracking so they persist, display with live price/PnL, and are manually closeable/SL-settable — with 8 defensive layers (defense-in-depth) and zero new execution path.

**Architecture:** A new `serverAT._adoptExternalPosition` mutates the in-memory `_positions` (the display source) + persists via the existing `_persistPosition`/`db.atSavePosition`. A `serverAT._reconcileAndAdopt(uid, exchange, env)` wraps it with the 8 layers (mutex, write-freeze, sanity, double-read, circuit-breaker) and is called from `recoveryBoot` step 3c + `_runReconciliation`. Protective SL is placed BEFORE the atomic insert so a row never exists without an SL id. Adopted rows carry `source:'external', autoTrade:0, dslParams:null` so autonomous logic ignores them (Option-1).

**Tech Stack:** Node + Express, better-sqlite3 (**synchronous** transactions), Jest (`npx jest --forceExit`). Spec: `docs/superpowers/specs/2026-05-30-P-A-position-adoption-design.md` (v2).

**Standing protocol:** backup `.bak.pre-<task>-20260530` → TDD RED→GREEN → swap-back → show diff → await "commit" → deploy (`pm2 reload zeus`, server-only) at phase end. serverAT tests mock `database/logger/audit/telegram/credentialStore/binanceSigner/exchangeOps` (pattern: `tests/unit/at-toggle-per-mode.test.js` + `tests/unit/pretrade-balance-check.test.js`).

**Verified anchors:** `getLivePositions` reads `_positions.filter(p=>p.userId===userId && p.mode==='live')` (serverAT.js:3034). `_persistPosition(pos)`→`db.atSavePosition(pos)`+`_broadcastPositions` (serverAT.js:438). `_uState(userId)`→`us` with `us.seq` (serverAT.js:204). `setGlobalHalt(active, byUserId, reason)` (serverAT.js:328). `_tryPlaceStopLoss(uid,symbol,side,mark,exchange,qty)`→`{ok, stopPrice, slOrderId}` (recoveryBoot.js). recon hook: `recoveryBoot.js:287` loop over `exchangeBySymbol`; `_runReconciliation` held-map at serverAT.js:~4665. UNIQUE backstop: `idx_at_pos_user_sym_side_mode_open` on `(user_id, symbol, side, mode) WHERE status='OPEN'`.

---

## File Structure

| File | Change |
|---|---|
| `server/services/serverAT.js` | ADD `_adoptExternalPosition`, `_reconcileAndAdopt`, `_unadoptPosition`, module-level `_adoptionDebounceCache`/`_activeReconLocks`; export them. Fix `registerManualPosition` mode labeling (Unit 3). |
| `server/services/recoveryBoot.js` | step 3c → call `serverAT._reconcileAndAdopt` (after auto-SL), thread `slOrderId`. |
| `tests/unit/position-adoption.test.js` | NEW — all TDD for adoption + 8 layers. |

---

## Task 1 — `_adoptExternalPosition`: create tracked row + in-memory + idempotency + Telegram

**Files:** Modify `server/services/serverAT.js`; Test `tests/unit/position-adoption.test.js` (new).

- [ ] **Step 1 — backup**

```bash
cp server/services/serverAT.js server/services/serverAT.js.bak.pre-adoption-20260530
```

- [ ] **Step 2 — RED test** (`tests/unit/position-adoption.test.js`, model deps on `at-toggle-per-mode.test.js`):

```js
'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');
const TEST_DB = '/tmp/zeus-adopt-' + Date.now() + '.db';
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
const mockDb = new Database(TEST_DB);
mockDb.exec(`CREATE TABLE at_positions (seq INTEGER PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), user_id INTEGER, exchange TEXT DEFAULT 'binance');
  CREATE UNIQUE INDEX idx_at_pos_user_sym_side_mode_open ON at_positions(user_id, json_extract(data,'$.symbol'), json_extract(data,'$.side'), json_extract(data,'$.mode')) WHERE status='OPEN';
  CREATE TABLE at_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, user_id INTEGER);
  CREATE TABLE at_closed (seq INTEGER PRIMARY KEY, data TEXT NOT NULL, closed_at TEXT DEFAULT (datetime('now')), user_id INTEGER, exchange TEXT DEFAULT 'binance');
  CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now')));`);
const _atState = {};
const dbMock = {
  atSavePosition: (pos) => mockDb.prepare("INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (?,?,?,?,?) ON CONFLICT(seq) DO UPDATE SET data=excluded.data, status=excluded.status").run(pos.seq, JSON.stringify(pos), pos.status||'OPEN', pos.userId||null, pos.exchange||'binance'),
  atLoadOpenPositions: () => [],
  atSetState: (k,v,uid)=>{ _atState[k]=v; },
  atGetState: (k)=> _atState[k],
  prepare: (...a)=>mockDb.prepare(...a),
  atGetOpenUserIds: ()=>[],
};
const tgMock = { sendToUser: jest.fn(()=>Promise.resolve()), alertCritical: jest.fn(()=>Promise.resolve()), alertOrderFilled: jest.fn(), sendToAll: jest.fn() };
jest.mock('../../server/services/database', () => ({ db: dbMock }));
jest.mock('../../server/services/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../server/services/audit', () => ({ record: jest.fn() }));
jest.mock('../../server/services/telegram', () => tgMock);
jest.mock('../../server/services/credentialStore', () => ({ getExchangeCreds: () => ({ exchange:'bybit', mode:'testnet' }), getExchangeCredsFor: () => ({ exchange:'bybit', mode:'testnet' }) }));

const serverAT = require('../../server/services/serverAT');

describe('[P-A] _adoptExternalPosition', () => {
  it('creates a tracked OPEN row that getLivePositions returns', () => {
    const pos = { symbol:'BTCUSDT', side:'SHORT', qty:'0.054', entryPrice:'73559.4', markPrice:'73500', slOrderId:'sl-x' };
    const r = serverAT._adoptExternalPosition(1, 'bybit', 'TESTNET', pos);
    expect(r.ok).toBe(true);
    const live = serverAT.getLivePositions(1);
    const found = live.find(p => p.symbol==='BTCUSDT' && p.side==='SHORT');
    expect(found).toBeTruthy();
    expect(found.source).toBe('external');
    expect(tgMock.sendToUser).toHaveBeenCalled();
  });
  it('is idempotent — adopting the same position twice yields one tracked row', () => {
    const pos = { symbol:'ETHUSDT', side:'LONG', qty:'1', entryPrice:'3000', markPrice:'3000', slOrderId:'sl-y' };
    serverAT._adoptExternalPosition(1, 'bybit', 'TESTNET', pos);
    serverAT._adoptExternalPosition(1, 'bybit', 'TESTNET', pos);
    const live = serverAT.getLivePositions(1).filter(p => p.symbol==='ETHUSDT' && p.side==='LONG');
    expect(live.length).toBe(1);
  });
});
```

- [ ] **Step 3 — Run RED:** `npx jest tests/unit/position-adoption.test.js -t "_adoptExternalPosition" --forceExit` → FAIL (`_adoptExternalPosition is not a function`).

- [ ] **Step 4 — GREEN:** add to `serverAT.js` (near `registerManualPosition`), export `_adoptExternalPosition`:

```js
// [P-A] Adopt an exchange position that has no tracked row. Mutates the in-memory
// _positions (the getLivePositions source) + persists. Layer-4 idempotency: skip if
// already tracked OPEN for (userId, symbol, side, mode='live'). Layer-2 Telegram.
// SL is placed by the caller (recon) BEFORE this insert; slOrderId passed in pos.slOrderId.
function _adoptExternalPosition(userId, exchange, env, pos) {
    const symbol = pos.symbol, side = pos.side;
    const already = _positions.find(p => p.userId === userId && p.symbol === symbol && p.side === side && p.mode === 'live');
    if (already) return { ok: true, idempotent: true, seq: already.seq };
    const us = _uState(userId);
    const seq = ++us.seq;
    const entry = {
        seq, userId, symbol, side,
        qty: Number(pos.qty), price: Number(pos.entryPrice), entry: Number(pos.entryPrice),
        mode: 'live', env, exchange,
        source: 'external', externalSync: true, autoTrade: 0, sourceMode: 'manual',
        dslParams: null,
        status: 'OPEN',
        live: { status: 'LIVE', mainOrderId: null, slOrderId: pos.slOrderId || null, tpOrderId: null, avgPrice: Number(pos.entryPrice), executedQty: Number(pos.qty) },
        ts: Date.now(),
    };
    try {
        _positions.push(entry);
        _persistPosition(entry); // db.atSavePosition (throws on UNIQUE backstop) + broadcast
    } catch (e) {
        // Layer-4 DB backstop: UNIQUE partial index already has this OPEN (user,symbol,side,mode).
        const i = _positions.indexOf(entry); if (i >= 0) _positions.splice(i, 1);
        if (String(e.message || '').includes('UNIQUE')) return { ok: true, idempotent: true };
        logger.error('AT_ADOPT', `adopt persist failed ${symbol}: ${e.message}`);
        return { ok: false, error: e.message };
    }
    try { audit.record('POSITION_ADOPTED', { userId, seq, symbol, side, qty: entry.qty, exchange, env }, 'SERVER_AT'); } catch (_) {}
    try { telegram.sendToUser(userId, `🪙 *Position Adopted* (${exchange} ${env})\n${side} ${symbol}\nqty ${entry.qty} @ ${entry.price}\nSL: ${entry.live.slOrderId ? 'placed' : 'NONE'}`); } catch (_) {}
    logger.info('AT_ADOPT', `adopted ${symbol} ${side} seq=${seq} (${exchange}/${env})`);
    return { ok: true, seq };
}
```

- [ ] **Step 5 — Run GREEN** → PASS. **Swap-back** (backup lacks the fn → FAIL). **Show diff. Commit on "commit".**

---

## Task 2 — SL-then-insert: place protective SL first, halt-on-fail, no orphan row

**Files:** Modify `server/services/serverAT.js`; Test `tests/unit/position-adoption.test.js`.

Adoption that places a protective SL when the exchange position has none. Order: place SL (async, OUTSIDE any txn) → on success insert row with slOrderId; on SL fail → `setGlobalHalt` + alert + DO NOT insert (no unprotected tracked row).

- [ ] **Step 1 — RED:** add a test: `_adoptWithProtection(uid, exchange, env, pos, slPlacer)` where `slPlacer` returns `{ok:false}` → asserts `setGlobalHalt` semantics (global:halt set) AND no row created; with `{ok:true, slOrderId:'s1'}` → row created with `live.slOrderId==='s1'`. (Inject `slPlacer` to avoid real exchange calls.)

```js
it('SL-fail → halt armed + no tracked row', async () => {
  const pos = { symbol:'SOLUSDT', side:'LONG', qty:'2', entryPrice:'150', markPrice:'150' };
  const r = await serverAT._adoptWithProtection(1, 'bybit', 'TESTNET', pos, async () => ({ ok:false, error:'sl down' }));
  expect(r.ok).toBe(false);
  expect(serverAT.getLivePositions(1).some(p=>p.symbol==='SOLUSDT')).toBe(false);
});
it('SL-ok → row adopted with slOrderId', async () => {
  const pos = { symbol:'XRPUSDT', side:'SHORT', qty:'10', entryPrice:'0.5', markPrice:'0.5' };
  const r = await serverAT._adoptWithProtection(1, 'bybit', 'TESTNET', pos, async () => ({ ok:true, slOrderId:'s1' }));
  expect(r.ok).toBe(true);
  const f = serverAT.getLivePositions(1).find(p=>p.symbol==='XRPUSDT');
  expect(f.live.slOrderId).toBe('s1');
});
```

- [ ] **Step 2 — Run RED** → FAIL.
- [ ] **Step 3 — GREEN:** add `_adoptWithProtection`:

```js
// [P-A] Place protective SL first (so the adopted row never exists without an SL id),
// then adopt. SL placement is the ONLY exchange write; failure → halt + alert, no row.
async function _adoptWithProtection(userId, exchange, env, pos, slPlacer) {
    let slOrderId = pos.slOrderId || null;
    if (!slOrderId) {
        let sl;
        try { sl = await slPlacer(pos); } catch (e) { sl = { ok: false, error: e.message }; }
        if (!sl || !sl.ok) {
            try { setGlobalHalt(true, userId, `ADOPT_SL_FAILED ${pos.symbol} ${exchange}/${env}`); } catch (_) {}
            try { telegram.alertCritical && telegram.alertCritical(`🚨 ADOPT SL FAILED — ${pos.side} ${pos.symbol} on ${exchange} UNPROTECTED. Halt armed.`); } catch (_) {}
            logger.error('AT_ADOPT', `SL place failed for ${pos.symbol} — halt armed, no adoption`);
            return { ok: false, unprotected: true, error: (sl && sl.error) || 'sl failed' };
        }
        slOrderId = sl.slOrderId || null;
    }
    return _adoptExternalPosition(userId, exchange, env, { ...pos, slOrderId });
}
```

- [ ] **Step 4 — Run GREEN** → PASS. **Swap-back. Commit.**

---

## Task 3 — `_reconcileAndAdopt`: the 8 defensive layers

**Files:** Modify `server/services/serverAT.js` (module-level caches + the wrapper); Test `tests/unit/position-adoption.test.js`.

- [ ] **Step 1 — RED:** tests for the layers (mutex bail, halt skip, sanity-reject, double-read waits-then-adopts, circuit-breaker halts):

```js
describe('[P-A] _reconcileAndAdopt layers', () => {
  beforeEach(() => { serverAT._resetAdoptionState && serverAT._resetAdoptionState(); _atState['global:halt']=undefined; });
  const held = (arr) => async () => arr; // fetcher
  it('double-read: first call caches, second adopts', async () => {
    const arr = [{ symbol:'BTCUSDT', side:'SHORT', qty:'0.05', entryPrice:'73000', markPrice:'73000' }];
    await serverAT._reconcileAndAdopt(1,'bybit','TESTNET', held(arr), async()=>({ok:true,slOrderId:'s'}));
    expect(serverAT.getLivePositions(1).some(p=>p.symbol==='BTCUSDT')).toBe(false); // 1st = cache only
    await serverAT._reconcileAndAdopt(1,'bybit','TESTNET', held(arr), async()=>({ok:true,slOrderId:'s'}));
    expect(serverAT.getLivePositions(1).some(p=>p.symbol==='BTCUSDT')).toBe(true);  // 2nd = adopt
  });
  it('sanity-reject: qty<=0 / NaN never adopted', async () => {
    const arr = [{ symbol:'ETHUSDT', side:'LONG', qty:'0', entryPrice:'3000' }, { symbol:'ADAUSDT', side:'LONG', qty:'x', entryPrice:'1' }];
    await serverAT._reconcileAndAdopt(1,'bybit','TESTNET', held(arr), async()=>({ok:true,slOrderId:'s'}));
    await serverAT._reconcileAndAdopt(1,'bybit','TESTNET', held(arr), async()=>({ok:true,slOrderId:'s'}));
    expect(serverAT.getLivePositions(1).length).toBe(0);
  });
  it('circuit-breaker: >3 external → halt, no adoption', async () => {
    const arr = ['A','B','C','D','E'].map(s=>({ symbol:s+'USDT', side:'LONG', qty:'1', entryPrice:'1', markPrice:'1' }));
    await serverAT._reconcileAndAdopt(2,'bybit','TESTNET', held(arr), async()=>({ok:true,slOrderId:'s'}));
    await serverAT._reconcileAndAdopt(2,'bybit','TESTNET', held(arr), async()=>({ok:true,slOrderId:'s'}));
    expect(serverAT.getLivePositions(2).length).toBe(0);
    expect(_atState['global:halt'] && _atState['global:halt'].active).toBe(true);
  });
  it('write-freeze: globalHalt armed → skip', async () => {
    _atState['global:halt'] = { active:true, by:1 };
    const arr = [{ symbol:'BNBUSDT', side:'LONG', qty:'1', entryPrice:'500', markPrice:'500' }];
    await serverAT._reconcileAndAdopt(1,'bybit','TESTNET', held(arr), async()=>({ok:true,slOrderId:'s'}));
    await serverAT._reconcileAndAdopt(1,'bybit','TESTNET', held(arr), async()=>({ok:true,slOrderId:'s'}));
    expect(serverAT.getLivePositions(1).some(p=>p.symbol==='BNBUSDT')).toBe(false);
  });
});
```

- [ ] **Step 2 — Run RED** → FAIL.
- [ ] **Step 3 — GREEN:** add module-level caches + the wrapper + `_resetAdoptionState`:

```js
// [P-A] Defensive recon caches. _adoptionDebounceCache: key→snapshot for double-read.
// _activeReconLocks: per-account mutex coordinating recoveryBoot + _runReconciliation.
const _adoptionDebounceCache = new Map();
const _activeReconLocks = new Set();
const ADOPT_MAX_EXTERNAL = 3; // circuit-breaker threshold per (user,exchange,env)
function _resetAdoptionState() { _adoptionDebounceCache.clear(); _activeReconLocks.clear(); }

async function _reconcileAndAdopt(userId, exchange, env, fetchHeld, slPlacer) {
    const key = `${userId}:${exchange}:${env}`;
    if (_activeReconLocks.has(key)) { logger.warn('AT_ADOPT', `recon busy ${key} — skip`); return; }       // L8 mutex
    const halt = db.atGetState && db.atGetState('global:halt');
    if (halt && halt.active) { logger.info('AT_ADOPT', `write-freeze (halt) — skip ${key}`); return; }       // L3 write-freeze
    try {
        _activeReconLocks.add(key);
        let raw;
        try { raw = await fetchHeld(); } catch (e) { logger.warn('AT_ADOPT', `held read failed ${key}: ${e.message}`); return; } // fail-closed
        if (!Array.isArray(raw)) return;
        const valid = raw.filter(p => {                                                                      // L5 sanity-reject
            const q = parseFloat(p.qty), en = parseFloat(p.entryPrice != null ? p.entryPrice : p.entry);
            return Number.isFinite(q) && q > 0 && Number.isFinite(en) && en > 0 && p.symbol && p.side;
        });
        const external = valid.filter(ep => !_positions.some(tp => tp.userId === userId && tp.symbol === ep.symbol && tp.side === ep.side && tp.mode === 'live'));
        if (external.length === 0) { _adoptionDebounceCache.delete(key); return; }
        const snap = JSON.stringify(external.map(p => `${p.symbol}:${p.side}:${p.qty}`));                     // L1 double-read
        if (_adoptionDebounceCache.get(key) !== snap) { _adoptionDebounceCache.set(key, snap); logger.info('AT_ADOPT', `first sighting ${key} — await confirm`); return; }
        if (external.length > ADOPT_MAX_EXTERNAL) {                                                           // L6 circuit-breaker
            try { setGlobalHalt(true, userId, `MASS_EXTERNAL ${external.length} on ${exchange}/${env}`); } catch (_) {}
            try { telegram.alertCritical && telegram.alertCritical(`🚨 MASS-EXTERNAL on ${exchange} ${env}: ${external.length} untracked positions. Halt armed, adoption blocked.`); } catch (_) {}
            logger.error('AT_ADOPT', `circuit-breaker tripped ${key}: ${external.length}`);
            return;
        }
        for (const pos of external) {
            await _adoptWithProtection(userId, exchange, env, pos, slPlacer);
        }
        _adoptionDebounceCache.delete(key);
    } finally { _activeReconLocks.delete(key); }
}
```
Export `_reconcileAndAdopt`, `_adoptWithProtection`, `_adoptExternalPosition`, `_unadoptPosition` (Task 6), `_resetAdoptionState`.

- [ ] **Step 4 — Run GREEN** → PASS (all layer tests). **Swap-back. Commit.**

---

## Task 4 — Wire into recoveryBoot step 3c + `_runReconciliation`

**Files:** Modify `server/services/recoveryBoot.js`; Modify `server/services/serverAT.js` (`_runReconciliation`).

- [ ] **Step 1 — backup** `cp server/services/recoveryBoot.js server/services/recoveryBoot.js.bak.pre-adoption-20260530`
- [ ] **Step 2 — RED:** an integration test (extend `tests/unit/position-adoption.test.js`) asserting that calling the recon entry with a held exchange position (after 2 reads) results in a tracked row. (Reuse `_reconcileAndAdopt` directly — recoveryBoot just calls it.)
- [ ] **Step 3 — GREEN (recoveryBoot step 3c):** replace the body of the `for (const [symbol, exchPos] of exchangeBySymbol.entries())` loop (recoveryBoot.js:287) — keep the forensic audit + the auto-SL, then call adoption with a `slPlacer` that reuses `_tryPlaceStopLoss`, and a `fetchHeld` returning the current `exchangeBySymbol` values. (Boot path adopts after the existing SL logic; the slPlacer is `(p)=>_tryPlaceStopLoss(uid, p.symbol, p.side, Number(p.markPrice)||Number(p.entryPrice), exchange, Math.abs(Number(p.qty))).then(r=>({ok:r.ok, slOrderId:r.slOrderId})) `.) Pass `env` from creds.
- [ ] **Step 4 — GREEN (`_runReconciliation`):** at the per-(user,exchange) held-map point (serverAT.js:~4665, after `held = await exchangeOps.getPositions(...)`), call `await _reconcileAndAdopt(userId, exchange, env, () => Promise.resolve(held), slPlacer)` so mid-session externals are adopted. `slPlacer` reuses the recon SL path.
- [ ] **Step 5 — Run** the adoption suite + `tests/unit/at-toggle-per-mode.test.js` (no serverAT regression) → green. **Commit.**

---

## Task 5 — Duplicate fix (Unit 3): mode reflects execution env

**Files:** Modify `server/services/serverAT.js` (`_registerManualPositionLegacy` ~3915); Test.

- [ ] **Step 1 — RED:** test that a manual registration with creds env TESTNET (real exchange round-trip) yields `mode:'live'` and appears only in `getLivePositions`, not `getDemoPositions`.
- [ ] **Step 2 — Run RED** → FAIL (currently mode follows engineMode).
- [ ] **Step 3 — GREEN:** at serverAT.js:3915, change `mode: data.mode || us.engineMode` → derive: a real-exchange order (`_manualExecEnv.env` ∈ {TESTNET, REAL}) ⇒ `mode:'live'`; paper/demo (`env==='DEMO'` or no creds) ⇒ `mode:'demo'`. Keep `env` stamp. Verify the client `liveApi.ts` merge doesn't re-add (read-only check; no client change unless the test of a follow-up reveals a dup).
- [ ] **Step 4 — Run GREEN** → PASS. **Commit.**

---

## Task 6 — Un-adopt (manual reversal, local-only)

**Files:** Modify `server/services/serverAT.js`; Test.

- [ ] **Step 1 — RED:** `_unadoptPosition(uid, seq)` → the row's status becomes CLOSED, `externalSync:false`, removed from `_positions`, NO exchange call.
- [ ] **Step 2 — Run RED** → FAIL.
- [ ] **Step 3 — GREEN:**

```js
// [P-A] Manual reversal of a wrong adoption — local-only (no destructive exchange call).
function _unadoptPosition(userId, seq) {
    const i = _positions.findIndex(p => p.userId === userId && p.seq === seq && p.source === 'external');
    if (i < 0) return { ok: false, error: 'not an adopted position' };
    const pos = _positions[i];
    pos.status = 'CLOSED'; pos.externalSync = false;
    try { db.atSavePosition(pos); } catch (e) { return { ok: false, error: e.message }; }
    _positions.splice(i, 1);
    try { audit.record('POSITION_UNADOPTED', { userId, seq, symbol: pos.symbol }, 'SERVER_AT'); } catch (_) {}
    _broadcastPositions(userId);
    return { ok: true };
}
```

- [ ] **Step 4 — Run GREEN** → PASS. **Commit.**

---

## Task 7 — Full verification + deploy + live validation

- [ ] **Step 1:** `npx jest tests/unit/position-adoption.test.js tests/unit/at-toggle-per-mode.test.js tests/unit/pretrade-balance-check.test.js --forceExit` → green (no serverAT regressions).
- [ ] **Step 2:** broad regression `npx jest tests/unit --forceExit` → only the known pre-existing failures remain.
- [ ] **Step 3:** Deploy `pm2 reload zeus`; confirm clean boot.
- [ ] **Step 4 — Live validation (operator-supervised):** operator opens a Bybit-demo position; within ≤2 recon cycles it should appear in Zeus and **persist across refreshes** (no vanish). Confirm via a throwaway diagnostic that `getLivePositions(1)` includes it. Operator confirms it's visible + closeable; no duplicate paper.
- [ ] **Step 5:** `git push origin main`. Update memory: P-A SHIPPED; P-B next (carve-out incremental).

---

## Self-Review

**Spec coverage:** adoption (T1) ✓, in-memory display fix (T1 `_positions.push`) ✓, SL-then-insert + halt (T2) ✓, 8 layers — double-read/sanity/CB/halt/mutex (T3) ✓, idempotency in-mem+DB (T1) ✓, Telegram-per-adoption (T1) ✓, watchdog (T2 halt path; note: `_watchdogLiveNoSL` already alerts on `live.slOrderId==null` — adopted rows inherit it, no extra code) ✓, wiring boot+recon (T4) ✓, duplicate fix (T5) ✓, un-adopt (T6) ✓, verify+deploy+live (T7) ✓.

**Placeholder scan:** concrete code throughout; the recon `slPlacer`/`fetchHeld` closures in T4 are described with exact call shapes — finalize against the live `_runReconciliation`/recoveryBoot variables during execution (both call sites already hold `exchange`, `held`/`exchPos`, and creds for env).

**Type consistency:** `_adoptExternalPosition(userId,exchange,env,pos)` / `_adoptWithProtection(...,slPlacer)` / `_reconcileAndAdopt(userId,exchange,env,fetchHeld,slPlacer)` / `_unadoptPosition(userId,seq)` — names + signatures consistent across tasks. Entry shape (`source:'external'`, `mode:'live'`, `live.slOrderId`) consistent. `getLivePositions` filter (`mode==='live'`) matches the adopted `mode`.
