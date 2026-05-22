# serverBrain.js Loop Swap Audit — 2026-05-22

**Status:** READ-ONLY — no production code changes yet.
**Purpose:** Inventory all per-symbol vs per-user references in `serverBrain.js _runCycle` before Phase 4 loop swap. Per cerința A from Bybit Phase 1A+1B spec.
**Branch:** `bybit-phase-1ab`
**Tests at audit time:** 189/189 PASS

---

## Methodology

Current loop structure (line 661): `for symbol → for user → decide`.
Target structure: `for user → resolve exchange → for symbol → decide`.

For each code reference, classify:
- **SAFE_PER_SYMBOL** — symbol-scoped, doesn't depend on user; can stay outside user loop
- **PER_USER_PER_SYMBOL** — must execute per (user, symbol) pair; needs swap
- **PER_USER_OUTSIDE_SYMBOL** — per-user but symbol-independent; pull above symbol loop

---

## File Overview

- `serverBrain.js`: **2192 LOC**
- `_runCycle` function: lines **632–1298**
- `_runShadowCycle` function: lines **1310–1376** (parallel audit for completeness)
- `serverState` references in file: **16 distinct call sites** (6 in `_runCycle`, 5 in shadow cycle / helpers, 5 in external helpers)
- `_stcMap` references in file: **15 places** (6 in `_runCycle`, multiple in persist/restore helpers)
- `_prevRegimes` references: **7 places**
- `_lastRegime` references: **3 places** (all inside `_runCycle` per-user block)

---

## Module-Level State Declarations (Pre-cycle, relevant to swap)

| # | Line | Declaration | Notes |
|---|---|---|---|
| S1 | 211 | `const _stcMap = new Map(); // userId → STC config` | Outer user iterator — loop swap iterates this first |
| S2 | 217 | `const _stcLastSeen = new Map(); // userId → ms timestamp` | Not read in cycle; updated only on config change |
| S3 | 233 | `const _prevRegimes = new Map(); // symbol → last regime` | **CRITICAL**: key=`symbol` only — must become `${symbol}\|${exchange}` post-swap |
| S4 | 237 | `const _cooldowns = new Map(); // 'userId:symbol' → deadlineMs` | Already per-(user, symbol) keyed — safe after swap |
| S5 | 239 | `const _regimeTgLastTs = new Map(); // userId → timestamp` | Per-user, symbol-independent — safe |
| S6 | 157 | `const _lastThoughtTs = new Map(); // key="userId:symbol:kind" → lastMs` | Per-(user, symbol, kind) keyed — safe after swap |
| S7 | 158 | `const _lastRegime = new Map(); // key="userId:symbol" → last regime` | Per-(user, symbol) keyed — safe after swap; distinct from `_prevRegimes` |

---

## Reference Inventory — `_runCycle` (lines 632–1298)

| # | Line | Code excerpt | Classification | Action for loop swap |
|---|---|---|---|---|
| 1 | 647 | `const readySymbols = serverState.getReadySymbols()` | **PER_USER_PER_SYMBOL** | Move inside user loop → `userState.getReadySymbols()` per exchange; each user gets their exchange's ready symbols |
| 2 | 648–651 | `if (readySymbols.length === 0) { _logDecision('SKIP'... }` | **PER_USER_OUTSIDE_SYMBOL** | Guard moves inside user loop (or aggregate-skip if all users have 0 ready) |
| 3 | 653–656 | `if (_stcMap.size === 0) { _logDecision('SKIP'... }` | **PER_USER_OUTSIDE_SYMBOL** | Pre-loop guard stays OUTSIDE user loop (still valid: skip if no users at all) |
| 4 | 657 | `const users = _stcMap` | **PER_USER_OUTSIDE_SYMBOL** | Becomes the OUTER loop iterator (`for (const [userId, stc] of _stcMap)`) |
| 5 | 661 | `for (const symbol of readySymbols)` | **symbol outer loop** | Move INSIDE user loop — becomes inner loop |
| 6 | 662 | `const snap = serverState.getSnapshotForSymbol(symbol)` | **PER_USER_PER_SYMBOL** | Replace with `userState.getSnapshotForSymbol(symbol)` — each exchange has its own snapshot |
| 7 | 663 | `if (!snap \|\| !snap.indicators) continue` | **SAFE_PER_SYMBOL** (post-swap: per user's exchange) | Keep immediately after snap fetch |
| 8 | 666 | `if (snap.stale \|\| (Date.now() - snap.priceTs) > STALE_DATA_MS) continue` | **SAFE_PER_SYMBOL** | Keep immediately after snap fetch |
| 9 | 669 | `serverCalibration.trackPrice(symbol, snap.price)` | **PER_USER_PER_SYMBOL** | Now exchange-aware: price may differ per exchange. Must move inside user loop OR accept that calibration tracks per-exchange price. **ACTION:** call with `(symbol, snap.price, exchange)` — needs serverCalibration update or accept global-price approximation (audit decision point, see §Decision Points) |
| 10 | 670 | `serverCalibration.trackRegime(symbol, snap.indicators.regime...)` | **PER_USER_PER_SYMBOL** | Same as above — regime from each exchange's indicator set |
| 11 | 672–674 | `for (const [_uid] of users) { serverReflection.evaluateSkipped(symbol, snap.price, _uid) }` | **PER_USER_PER_SYMBOL** | After loop swap: `evaluateSkipped(symbol, snap.price, userId)` — already inside user iteration naturally |
| 12 | 679 | `const confluence = _calcConfluence(snap, ind)` | **SAFE_PER_SYMBOL** (per exchange's snap) | Keep per-symbol after snap is exchange-resolved |
| 13 | 682–688 | `const regime = { regime: ind.regime... }` | **SAFE_PER_SYMBOL** | Keep per-symbol |
| 14 | 691 | `const prevRegimeForSym = _prevRegimes.get(symbol)` | **CRITICAL — PER_USER_PER_SYMBOL** | Key must become `${symbol}\|${exchange}` — different exchanges can produce different regimes; see §Regime Broadcast section |
| 15 | 692–718 | `if (prevRegimeForSym !== regime.regime) { ... broadcast ... }` | **CRITICAL block** | See §Regime Broadcast section below |
| 16 | 719 | `_prevRegimes.set(symbol, regime.regime)` | **CRITICAL — PER_USER_PER_SYMBOL** | Key must become `${symbol}\|${exchange}` — post-swap |
| 17 | 722 | `_persistRegimeBaseline()` | **PER_USER_OUTSIDE_SYMBOL** | Still called once per symbol per cycle; consider throttling to once per cycle total |
| 18 | 729–735 | `_writeThought({ userId: 1, ... neutral_watch ... })` | **SAFE_PER_SYMBOL** | Uses hardcoded userId=1; acceptable, but userId should come from context |
| 19 | 737 | `for (const [userId, stc] of users)` | **inner user loop** | Becomes OUTER loop post-swap |
| 20 | 739 | `if (!serverAT.isATActive(userId)) continue` | **PER_USER_OUTSIDE_SYMBOL** | Move above symbol loop — skip entire user if AT inactive (performance win) |
| 21 | 752 | `if (!_isServerAuthoritativeForUser(userId)) continue` | **PER_USER_OUTSIDE_SYMBOL** | Move above symbol loop — skip entire user if not authoritative |
| 22 | 754 | `if (Array.isArray(stc.symbols) && !stc.symbols.includes(symbol)) continue` | **PER_USER_PER_SYMBOL** | Keep inside (user, symbol) iteration |
| 23 | 757–784 | `const pendingResult = serverPendingEntry.checkPending(symbol, snap.price, userId)` | **PER_USER_PER_SYMBOL** | No exchange context needed (pending keyed by userId+symbol) — safe |
| 24 | 763 | `const _userIntentPending = Number((_stcMap.get(userId) \|\| DEFAULT_STC).size)` | **PER_USER_PER_SYMBOL** | Safe — `_stcMap` already keyed by userId |
| 25 | 788–813 | Scale-in block: `serverAT.getOpenPositions(userId)`, `serverMultiEntry.checkScaleIn(...)` | **PER_USER_PER_SYMBOL** | Safe — already per-user |
| 26 | 800 | `const _userIntentSI = Number((_stcMap.get(userId) \|\| DEFAULT_STC).size)` | **PER_USER_PER_SYMBOL** | Safe |
| 27 | 817–826 | `const sessionBlock = serverSessionProfile.checkSessionBlock(userId)` | **PER_USER_OUTSIDE_SYMBOL** | Move above symbol loop — session block applies to all symbols for a user |
| 28 | 829 | `const us = serverAT.getUserState ? serverAT.getUserState(userId) : null` | **PER_USER_OUTSIDE_SYMBOL** | Move above symbol loop — user state is exchange-and-symbol-independent |
| 29 | 832 | `const ddAssess = _r7AssessDD(dailyPnL, refBalance)` | **PER_USER_OUTSIDE_SYMBOL** | Move above symbol loop — DD computed per user, not per symbol |
| 30 | 852 | `const adaptedStc = serverRegimeParams.getAdaptedParams(regime.regime, stc)` | **PER_USER_PER_SYMBOL** | regime is now exchange-specific; keep inside (user, symbol) |
| 31 | 855 | `const bars = serverState.getBarsForSymbol(symbol)` | **PER_USER_PER_SYMBOL** | Replace with `userState.getBarsForSymbol(symbol)` — each exchange has its own bars |
| 32 | 856 | `const volProfile = serverVolatilityEngine.assessVolatility(snap, bars)` | **SAFE_PER_SYMBOL** (per exchange snap) | Keep after exchange-resolved snap/bars |
| 33 | 864 | `const gates = _checkGates(snap, ind, confluence, volAdjustedStc, userId)` | **PER_USER_PER_SYMBOL** | Keep — snap is now exchange-resolved |
| 34 | 865 | `const fusion = _computeFusion(snap, ind, confluence, regime, gates, bars, userId)` | **PER_USER_PER_SYMBOL** | Keep — exchange-resolved inputs |
| 35 | 952–961 | `_lastRegime.get/set(\`${userId}:${snap.symbol}\`)` | **PER_USER_PER_SYMBOL** | Key already includes userId — but NOT exchange. Post-swap: change key to `${userId}:${symbol}:${exchange}` to detect exchange-specific regime shifts |
| 36 | 974 | `const _ring5MarketCtx = _buildMarketContext(snap, bars, userId)` | **PER_USER_PER_SYMBOL** | Keep — exchange-resolved snap/bars |
| 37 | 976–1008 | Ring5 wrap block: `serverAT._resolveExecutionEnv(userId)`, `ring5LearningService.wrap(...)` | **PER_USER_PER_SYMBOL** | Keep — already per-user; `_resolveExecutionEnv` must be exchange-aware (see §Decision Points) |
| 38 | 1080 | `const openPos = serverAT.getOpenPositions(userId)` | **PER_USER_PER_SYMBOL** | Keep — can move before symbol loop if needed for perf; currently per (user, symbol) context |
| 39 | 1124–1130 | `serverAdaptiveSizing.calcSizeMultiplier(userId, ...)` | **PER_USER_PER_SYMBOL** | Keep |
| 40 | 1163–1172 | `db.prepare(... FROM at_closed WHERE user_id = ?)` | **PER_USER_OUTSIDE_SYMBOL** | Move above symbol loop — fetches last 3 closes, symbol-independent |
| 41 | 1213 | `serverPendingEntry.createPending(decision, sizingStc, userId, marketCtx)` | **PER_USER_PER_SYMBOL** | Keep |
| 42 | 1218 | `_setCooldownDeadline(userId, decision.symbol, ...)` | **PER_USER_PER_SYMBOL** | Keep |
| 43 | 1230 | `const _userIntent = Number((_stcMap.get(userId) \|\| DEFAULT_STC).size)` | **PER_USER_PER_SYMBOL** | Safe |
| 44 | 1231 | `serverAT.processBrainDecision(decision, sizingStc, userId, _userIntent)` | **PER_USER_PER_SYMBOL** | Must be exchange-aware — see §Decision Points |
| 45 | 1257–1265 | `logger.info('BRAIN', \`[C${_cycleCount}] ${symbol}...\`)` (every 10 cycles) | **SAFE_PER_SYMBOL** | Keep outside user loop — summary log |
| 46 | 1263 | `serverState.getBarsForSymbol(symbol)` (in log string) | **PER_USER_PER_SYMBOL** | Replace with exchange-resolved bars reference (already computed as `bars` at line 855) — avoid second lookup |

---

## Per-Symbol Broadcasts (Critical Decisions)

### Regime Change Broadcast (lines 692–719)

**Current behavior:** A single `_prevRegimes` map keyed by `symbol` tracks the last seen regime globally. When `prevRegimeForSym !== regime.regime`:
1. Lines 695–699: DB `saveRegimeChange` called per active user
2. Lines 700–704: Telegram message composed
3. Lines 708–715: `telegram.sendToUser(_uid, _regimeMsg)` for each user in `_stcMap`, subject to per-user 15-min cooldown
4. Line 719: `_prevRegimes.set(symbol, regime.regime)` — stored globally

**Problem after loop swap:** With `for user → for symbol`, if User A (Binance) and User B (Bybit) both trade BTCUSDT:
- User A's Binance feed may yield regime = TREND_BULL
- User B's Bybit feed may yield regime = RANGE (different price/liquidity microstructure)
- Both feeds write to same `_prevRegimes.get('BTCUSDT')` — race condition: last writer wins
- User A may get Telegram notification of User B's exchange's regime, which doesn't apply to their feed

**Per operator spec pillar 3-cerința B:** Regime broadcasts must be keyed per `(symbol, exchange)`.

**Required change:**
```js
// BEFORE:
const prevRegimeForSym = _prevRegimes.get(symbol);
// ...
_prevRegimes.set(symbol, regime.regime);

// AFTER:
const _regimeKey = `${symbol}|${exchange}`;
const prevRegimeForSym = _prevRegimes.get(_regimeKey);
// ...
_prevRegimes.set(_regimeKey, regime.regime);
```

**Impact on persist/restore:** `_persistRegimeBaseline()` (line 475–484) iterates `_prevRegimes` and stores the map under `brain:prevRegimes:${uid}`. After keying change, the format changes from `{ 'BTCUSDT': 'TREND' }` to `{ 'BTCUSDT|binance': 'TREND', 'BTCUSDT|bybit': 'RANGE' }`. **The persistence and restore functions both need updating** (lines 475–504).

### TheVoice `_lastRegime` (lines 952–961)

A second regime-tracking map `_lastRegime` uses key `${userId}:${snap.symbol}`. This is already user-scoped but NOT exchange-scoped. Post-swap this should become `${userId}:${symbol}:${exchange}` to fire per-exchange regime shift thoughts separately for users on different exchanges.

### Per-symbol summary log (lines 1257–1265)

Currently outside the user loop — executed once per symbol per cycle regardless of users. Post-swap: still one call per symbol (outermost), but the `bars` fetch at line 1263 should use the already-computed `bars` variable rather than a fresh `serverState.getBarsForSymbol(symbol)`.

---

## `serverState` Call Sites (All 16)

| # | Line | Method | Context | Action for loop swap |
|---|---|---|---|---|
| 1 | 337 | `serverState.getConfiguredSymbols()` | `start()` — liquidity polling init | NOT in cycle; no change |
| 2 | 340 | `serverState.getConfiguredSymbols()` | `start()` — sentiment init | NOT in cycle; no change |
| 3 | 647 | `serverState.getReadySymbols()` | `_runCycle` main gate | **SWAP**: move inside user loop → `userState.getReadySymbols()` |
| 4 | 662 | `serverState.getSnapshotForSymbol(symbol)` | `_runCycle` per-symbol snap | **SWAP**: `userState.getSnapshotForSymbol(symbol)` |
| 5 | 855 | `serverState.getBarsForSymbol(symbol)` | `_runCycle` per-(user, symbol) | **SWAP**: `userState.getBarsForSymbol(symbol)` |
| 6 | 1263 | `serverState.getBarsForSymbol(symbol)` | `_runCycle` summary log (every 10 cycles) | **OPTIMIZE**: use already-resolved `bars` variable from line 855; avoid second call |
| 7 | 1321 | `serverState.getReadySymbols()` | `_runShadowCycle` | Shadow cycle: same pattern; swap deferred (shadow not Bybit-aware yet) |
| 8 | 1326 | `serverState.getSnapshotForSymbol(symbol)` | `_runShadowCycle` | Shadow cycle: deferred |
| 9 | 1344 | `serverState.getBarsForSymbol(symbol)` | `_runShadowCycle` | Shadow cycle: deferred |
| 10 | 1999 | `serverState.getConfiguredSymbols()` | `updateConfig()` — symbol validation | NOT in cycle; no change needed |
| 11 | 2029 | `serverState.getReadySymbols()` | `getBrainVision()` | NOT in cycle; UI vision stays Binance-keyed for now (per spec: Bybit vision deferred to Phase 4+) |
| 12 | 2033 | `serverState.getSnapshotForSymbol(symbol)` | `getBrainVision()` | NOT in cycle; deferred |
| 13 | 2036 | `serverState.getBarsForSymbol(symbol)` | `getBrainVision()` | NOT in cycle; deferred |
| 14 | 2126 | `serverState.getSnapshotForSymbol(symbol)` | `getBrainVision()` inner loop | NOT in cycle; deferred |
| 15 | 2128 | `serverState.getBarsForSymbol(symbol)` | `getBrainVision()` inner loop | NOT in cycle; deferred |
| 16 | (implicit) | `serverState` passed to `serverStructure.getStructure(symbol, bars)` | Via already-resolved `bars` | Safe — no direct serverState call |

**Summary:** 4 call sites in `_runCycle` require swap (`getReadySymbols` x1, `getSnapshotForSymbol` x1, `getBarsForSymbol` x2). 1 is optimizable (line 1263). Rest are outside the cycle.

---

## `_stcMap` Iteration Sites (All 15)

| # | Line | Pattern | Context | Action |
|---|---|---|---|---|
| 1 | 211 | `const _stcMap = new Map()` | Declaration | N/A — becomes outer loop |
| 2 | 250–253 | `for (const [uid, lastTs] of _stcLastSeen)` | Hourly cleanup | Not `_stcMap` — fine |
| 3 | 378 | `_stcMap.set(userId, ...)` | `_restoreStcFromDb()` | Not in cycle — fine |
| 4 | 405 | `for (const [uid, obj] of byUser)` | `_persistCooldowns()` | Not `_stcMap` — fine |
| 5 | 479 | `for (const _uid of _stcMap.keys())` | `_persistRegimeBaseline()` | Not in cycle directly; called from cycle — fine |
| 6 | 511 | `for (const [uid, ts] of _regimeTgLastTs)` | `_persistRegimeTgThrottle()` | Not `_stcMap` — fine |
| 7 | 653 | `if (_stcMap.size === 0)` | `_runCycle` guard | **KEEP** outside both loops |
| 8 | 657 | `const users = _stcMap` | `_runCycle` — outer iterator ref | Becomes outer loop iterator |
| 9 | 695 | `for (const _uid of _stcMap.keys())` | Regime change DB persist | **MOVE** inside user loop (or refactor: call `db.saveRegimeChange` once for the current userId) |
| 10 | 708 | `for (const _uid of _stcMap.keys())` | Regime change TG send | **MOVE** inside user loop (merge with per-user execution flow) |
| 11 | 763 | `_stcMap.get(userId)` | Pending entry intent read | **SAFE** — keyed by userId |
| 12 | 800 | `_stcMap.get(userId)` | Scale-in intent read | **SAFE** |
| 13 | 1230 | `_stcMap.get(userId)` | Direct entry intent read | **SAFE** |
| 14 | 1323 | `_stcMap.size === 0` | `_runShadowCycle` guard | Shadow cycle — deferred |
| 15 | 1347 | `for (const [userId, stc] of _stcMap)` | `_runShadowCycle` inner loop | Shadow cycle — deferred |

**Critical observations:** Lines 695 and 708 iterate ALL `_stcMap.keys()` inside the per-symbol block (for DB persist and TG send). After the loop swap (where we're already inside a per-user iteration), these inner all-user iterations become redundant/incorrect — they should operate on the current `userId` only and the DB persist / TG send should happen in the user's own iteration.

---

## Performance Considerations (Optimization Opportunities)

After the loop swap, several per-user computations currently re-run for every symbol. These can be hoisted above the symbol loop (computed once per user per cycle):

| Computation | Current Line | Cost | Action |
|---|---|---|---|
| `serverAT.isATActive(userId)` | 739 | DB or in-memory read | Hoist above symbol loop |
| `_isServerAuthoritativeForUser(userId)` | 752 | Pure flag read | Hoist above symbol loop |
| `serverAT.getUserState(userId)` | 829 | in-memory | Hoist above symbol loop |
| `dailyPnL`, `refBalance` extraction | 830–831 | Pure computation | Hoist above symbol loop |
| `_r7AssessDD(dailyPnL, refBalance)` | 832 | Pure computation | Hoist above symbol loop |
| `serverSessionProfile.checkSessionBlock(userId)` | 817 | in-memory | Hoist above symbol loop |
| `db.prepare(...at_closed WHERE user_id=?)` | 1163–1172 | SQLite read | **MUST** hoist — DB query in inner loop is expensive |
| `serverAT.getOpenPositions(userId)` | 1080 | in-memory | Hoist above symbol loop |
| `_stcMap.get(userId)` intent reads | 763, 800, 1230 | Map.get() | Minor — fine as-is |

**Impact estimate:** Currently: O(users × symbols) for all above. Post-hoist: O(users) for above + O(users × symbols) only for truly per-(user, symbol) operations. With 4 symbols and 2 users, the DB query at line 1163 currently fires 4× per user per cycle; post-hoist: 1× per user.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `_prevRegimes` keying broken — same symbol, different regimes per exchange | **HIGH** | Change key to `${symbol}\|${exchange}` at lines 691, 719, 478, 495 + update persist/restore |
| `_lastRegime` keying — per-user regime shift thoughts wrong exchange | **MEDIUM** | Change key to `${userId}:${symbol}:${exchange}` at lines 952, 953, 961 |
| Lines 695, 708: inner `_stcMap` loops inside per-user outer loop — will fire N² | **HIGH** | Refactor: operate on current `userId` only; remove inner all-user iterations |
| `serverCalibration.trackPrice/trackRegime` called per exchange per cycle | **MEDIUM** | Determine if calibration should be exchange-specific or global-average; needs operator decision |
| `serverAT.processBrainDecision` not exchange-aware | **HIGH** | Task 22 must wire exchange context through to AT execution |
| DB query at line 1163 fires in inner (user × symbol) loop | **MEDIUM** | Hoist above symbol loop in Task 23 |
| Per-user iteration adds overhead | **LOW** | Map.entries() ~50ns/iter; 4 symbols × 2 users × 30s cycle = negligible |
| Brain cycle latency increases | **LOW** | Post-hoist optimizations cancel any overhead; measure via `telemetryCollector.recordInvocation` |
| `brain_decisions` table missing exchange column | **LOW** | Migration 393 already adds it (per Tasks 1-19); just populate at INSERT |
| `_persistRegimeBaseline` format change (key shape change) | **MEDIUM** | On restore, old keys `'BTCUSDT'` won't match new keys `'BTCUSDT\|binance'` — first cycle after deploy will re-broadcast all regime changes. Acceptable one-time noise. |
| Shadow cycle (`_runShadowCycle`) not updated | **LOW** | Shadow cycle is intentionally read-only parity harness; Bybit shadow deferred to later task |

---

## Decision Points for Operator

### 1. Exchange Resolution per User (`_userExchangeCache`)

**Question:** How does `_runCycle` know which exchange each user is on?

**Options:**
- (A) **In-memory Map** (`_userExchangeCache: Map<userId, exchangeName>`) populated from DB at boot, invalidated on `/api/exchange/save` and `/api/exchange/disconnect`. O(1) per lookup.
- (B) **DB query per cycle** (`SELECT exchange FROM user_exchanges WHERE user_id = ? AND active = 1`). Safe but ~0.1ms per user per cycle.

**RECOMMENDATION:** Option A. Cache lives in-memory, is populated by `start()` using `db.listUsers()` + exchange state, and is invalidated via API hook. Acceptable: 4 symbols × 2 users × 30s = negligible query cost even for Option B, but in-memory is cleaner.

### 2. `serverState.forExchange(name)` Router Design

**Question:** Return a proxy object or a separate `serverStateBybit` import?

**Options:**
- (A) **Proxy/Router object**: `serverState.forExchange('binance')` returns object with same API (`getReadySymbols()`, `getSnapshotForSymbol()`, `getBarsForSymbol()`), backed by existing Binance data. `serverState.forExchange('bybit')` returns same interface backed by Bybit state. Minimal brain code changes: just add `const userState = serverState.forExchange(exchange)` before symbol loop.
- (B) **Namespace-based**: `serverState.getReadySymbols('binance')` vs `serverState.getReadySymbols('bybit')` — adds exchange param to every call. More invasive but explicit.

**RECOMMENDATION:** Option A (Task 21). The proxy/router pattern lets `_runCycle` lines 662, 855, 1263 be changed uniformly to `userState.X(...)` — 4 search-replace changes.

### 3. `serverCalibration.trackPrice/trackRegime` Exchange Handling

**Question:** Should calibration be per-exchange or global?

**Options:**
- (A) **Global** (current): Average across exchanges. `trackPrice` and `trackRegime` unchanged, called once per symbol with first user's snap. Slightly inaccurate in multi-exchange world.
- (B) **Exchange-specific**: Pass `(symbol, price, exchange)` to calibration. Requires calibration module update.
- (C) **Per user**: Call `trackPrice(symbol, snap.price, userId)` — each user's exchange contributes independently.

**RECOMMENDATION:** Option A for Task 23 (accept global average), Option C as post-Phase-4 improvement. Calibration is advisory, not trading-critical.

### 4. Regime Change Telegram Notification Under Loop Swap

**Current:** One Telegram notification per regime change per symbol (per 15min cooldown per user). All users see the same notification because `_prevRegimes` is global.

**After swap:** With key `${symbol}|${exchange}`, User A (Binance) and User B (Bybit) get independent regime notifications based on their own exchange's feed. This is CORRECT behavior per spec.

**Edge case:** If both exchanges show the same regime change simultaneously, both users get notified (correct — they're on different exchanges). If only one exchange changes, only that user's notification fires.

### 5. `brain_decisions` Exchange Column Population

**Schema:** Migration 393 already adds `exchange TEXT` column (per Tasks 1-19 audit).

**Action in Task 23:** Update all `brainLogger.logDecision(_buildSnapshot(...))` call sites (lines 804, 821, 843, 1055, 1098, 1114, 1219, 1226, 1248) to include `exchange` in the snapshot extra object. The `_buildSnapshot` helper (not shown but referenced) needs an `exchange` parameter.

---

## Required Phase 4 Tasks (Post-Audit)

Based on this audit, the following tasks are required in strict order:

### Task 21: `serverState.forExchange(name)` Router + Bi-namespaced `_sdMap`

**Files:** `server/services/serverState.js`
**Changes:**
- Add `forExchange(exchangeName)` method returning a view object with `getReadySymbols()`, `getSnapshotForSymbol(symbol)`, `getBarsForSymbol(symbol)` backed by appropriate namespaced state.
- Additive change — does not modify existing API.
- Test: unit test that `forExchange('binance').getReadySymbols()` returns Binance symbols, `forExchange('bybit')` returns Bybit symbols when both registered.

### Task 22: bybitFeed Events → `serverState` Wiring

**Files:** `server/services/bybitFeed.js`, `server/services/serverState.js`
**Changes:**
- Wire bybitFeed price/indicator/bars events to `serverState`'s Bybit namespace.
- Event handlers should populate the same shape as Binance (`price`, `indicators`, `bars`, `priceTs`, `stale`).
- Additive change — Binance feed unchanged.
- Test: bybitFeed emits → serverState Bybit namespace has data.

### Task 23: `_runCycle` LOOP SWAP per this audit (~18 code blocks)

**Files:** `server/services/serverBrain.js`
**Changes (in order, all referencing this audit doc):**

1. Add `_userExchangeCache: Map<userId, string>` (line ~211 area)
2. Add cache population in `start()` (line ~337 area)
3. Move outer loop to users: `for (const [userId, stc] of _stcMap)`
4. Resolve exchange: `const exchange = _userExchangeCache.get(userId) || 'binance'`
5. Resolve state: `const userState = serverState.forExchange(exchange)`
6. Hoist per-user-once computations above symbol loop (items 20, 21, 27, 28, 29 from §Reference Inventory)
7. Hoist DB query line 1163 above symbol loop
8. Change `readySymbols = userState.getReadySymbols()` (line 647)
9. Inner loop: `for (const symbol of readySymbols)` (line 661 — now inner)
10. Change `snap = userState.getSnapshotForSymbol(symbol)` (line 662)
11. Change `bars = userState.getBarsForSymbol(symbol)` (line 855)
12. Fix summary log bars fetch (line 1263): use `bars` variable already in scope
13. Fix `_prevRegimes` key: `${symbol}|${exchange}` (lines 691, 719)
14. Fix `_persistRegimeBaseline` / `_restoreRegimeBaseline` for new key format (lines 478, 495)
15. Fix inner `_stcMap` loops at lines 695 and 708 — replace with current `userId` only
16. Fix `_lastRegime` key: `${userId}:${symbol}:${exchange}` (lines 952, 953, 961)
17. Add `exchange` to `_buildSnapshot` calls and to `brainLogger.logDecision` (9 call sites)
18. Add exchange context to `serverAT.processBrainDecision` call (line 1231)

**Total: 18 code-block modifications.** All must be applied atomically in a single commit with tests passing.

---

## Code Block Count Summary

| Category | Count |
|---|---|
| SAFE_PER_SYMBOL (no change needed) | 8 |
| PER_USER_PER_SYMBOL (must be inside swapped loop) | 22 |
| PER_USER_OUTSIDE_SYMBOL (can hoist above symbol loop) | 8 |
| CRITICAL (keying/structural changes required) | 6 |
| **Total referenced blocks** | **44** |
| **Blocks requiring code modification in Task 23** | **18** |

---

## Conclusion

This audit identifies **18 code blocks** requiring modification for the `_runCycle` loop swap, with **6 critical structural changes** (regime keying, inner `_stcMap` iterations, exchange wiring).

**Highest risk areas:**
1. **Line 691/719** — `_prevRegimes` keying (CRITICAL): must become `${symbol}|${exchange}` per spec pillar 3-cerința B. Wrong keying causes cross-exchange regime notifications.
2. **Lines 695/708** — Inner `_stcMap.keys()` loops inside per-symbol block: post-swap these become nested loops firing for ALL users inside EACH user's iteration — N² DB writes and Telegram sends per cycle. Must be refactored to operate on current `userId` only.
3. **Line 1163** — DB query (`at_closed WHERE user_id = ?`) in current inner loop (per symbol) — must hoist above symbol loop; currently fires 4× per user per cycle.

**Recommended Phase 4 execution order:**
1. **Task 21** (serverState extension) — safe, purely additive
2. **Task 22** (bybitFeed → serverState wiring) — safe, just listeners  
3. **Task 23** (LOOP SWAP) — requires all 18 changes from this audit applied atomically

**Verify-twice rule applied:** This audit IS the cross-file verification before any production code change in Phase 4. Any Phase 4 Task 23 commit MUST reference this audit doc (`_review/audit/SERVERBRAIN_LOOP_SWAP_AUDIT_20260522.md`).

---

*Audit generated: 2026-05-22 | Branch: bybit-phase-1ab | serverBrain.js MD5 at audit time: see git log*
