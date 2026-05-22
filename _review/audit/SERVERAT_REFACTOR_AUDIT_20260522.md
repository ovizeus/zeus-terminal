# serverAT Refactor Audit — Tasks 40-41
## Phase: Bybit Phase 1A+1B — `_executeLiveEntry` + `_closePosition` → exchangeOps router

**Date:** 2026-05-22  
**Branch:** `bybit-phase-1ab`  
**Auditor:** Claude Code (read-only pass, no production code modified)  
**Files read:** `server/services/serverAT.js` (5087 LOC), `server/services/exchangeOps.js`, `server/services/binanceOps.js`  
**Tests at audit time:** 283 passing  

---

## Purpose

Tasks 40-41 refactor `serverAT.js` to route autonomous trading (AT) entry and close orders through the canonical `exchangeOps` router (Task 24) instead of calling `binanceSigner.sendSignedRequest` directly. Without this refactor, Bybit users in autonomous mode always hit Binance — a critical correctness bug.

This document is the **mandatory pre-code cross-file verification** per the Phase 4 audit pattern. Tasks 40 and 41 implementation commits must reference this document.

---

## Section 1: `_executeLiveEntry` (lines 1219–1787)

### Function Signature and Entry Point

```
async function _executeLiveEntry(entry, stc)
```

Called from line 1167 via `.catch()` wrapper in `processBrainDecision`:
```javascript
_executeLiveEntry(entry, stc).catch(err => { ... })
```

The `entry` object is constructed in `processBrainDecision` (around line 1060–1110). The `stc` argument is the strategy config (passed through from brain decision context).

### Parameter Sources

| Field | Source |
|---|---|
| `entry.userId` | `processBrainDecision` argument `userId` |
| `entry.seq` | `++us.seq` in processBrainDecision |
| `entry.symbol` | `decision.symbol` |
| `entry.side` | `decision.side` (LONG/SHORT) |
| `entry.qty` | LOT_SIZE-aligned qty (`_alignedQty`) |
| `entry.sl` | `decision.sl` |
| `entry.tp` | `decision.tp` |
| `entry.lev` | `decision.lev` |
| `entry.size` | `_alignedSize` (LOT_SIZE-adjusted) |
| `entry.price` | current market price at decision time |
| `entry.decisionId` | `_newDecisionId()` — 8-hex random (line 1068) |
| `entry.dslParams` | from decision, null = DSL OFF |
| `entry.mode` | `us.engineMode` (live/demo) |
| `entry._livePending` | initialized `false`, set `true` at line 1235 |
| `stc` | strategy config from brain loop — not directly used in entry HTTP calls |

### `decisionKey` / `clientOrderId` Generation

`_executeLiveEntry` does NOT use the `decisionKey` module. It constructs its own stable idempotency token at lines 1353-1356:

```javascript
const _decTok = (entry.decisionId && /^[0-9a-f]{8}$/.test(entry.decisionId))
    ? entry.decisionId
    : crypto.randomBytes(4).toString('hex');
const clientOrderId = `SAT_${entry.seq}_${_decTok}`;
```

`exchangeOps.placeEntry` expects a `decisionKey` param and enforces the regex `/^[a-zA-Z0-9_-]{1,36}$/` via `decisionKey.assert()`. The `SAT_${seq}_${8hex}` format is compatible but must be passed explicitly as `params.decisionKey`. **Refactor must map `clientOrderId` → `params.decisionKey`.**

### All `sendSignedRequest` Calls in `_executeLiveEntry`

| Line | Method | Path | Purpose | Blocking? |
|---|---|---|---|---|
| 1322 | GET | `/fapi/v2/balance` | Pre-trade margin check — blocks entry if insufficient | YES (returns on fail) |
| 1375 | (via helper) | `/fapi/v2/positionRisk` + `/fapi/v1/marginType` | `marginHelper.ensureCrossed` — ensures CROSSED margin, 2-retry loop | YES (returns on fail after 2 retries) |
| 1397 | POST | `/fapi/v1/leverage` | Set leverage — 2-retry loop | YES (returns on fail after 2 retries) |
| 1436 | POST | `/fapi/v1/order` | **MAIN MARKET ENTRY ORDER** | YES (ENTRY_FAILED on throw) |
| 1472 | GET | `/fapi/v1/order` | Fill verification poll — up to 3 polls × 1s | Best-effort |
| 1500 | GET | `/fapi/v2/positionRisk` | Reconcile exchange position on FILL_UNVERIFIED path | Best-effort |
| 1516 | POST | `/fapi/v1/order` | Force-close on FILL_UNVERIFIED with exchange position | Emergency path |
| 1573 | (via `_placeConditionalOrder`) | `/fapi/v1/order` or algoOrder | Safety SL @ 15% OTM | Best-effort (warn on fail) |
| 1589 | (via `_placeConditionalOrder`) | `/fapi/v1/order` or algoOrder | Real SL placement — 3-attempt loop | YES (emergency close on exhaustion) |
| 1626 | POST | `/fapi/v1/order` | **EMERGENCY MARKET CLOSE** (SL exhausted) — lines 1625-1630 | Emergency (calls `_closePosition` on success) |
| 1668 | (via `_placeConditionalOrder`) | `/fapi/v1/order` or algoOrder | TP placement — 3-attempt loop (only if `!entry.dslParams`) | Soft (emergency close on exhaustion) |
| 1693 | POST | `/fapi/v1/order` | **EMERGENCY MARKET CLOSE** (TP exhausted) — lines 1692-1697 | Emergency (calls `_closePosition` on success) |

**Total direct `sendSignedRequest` calls attributable to `_executeLiveEntry` scope:** 13 (some via helpers).

### Side Effects Inventory

#### State Writes (in-memory `entry` object)
- `entry._livePending = true` (line 1235) — lock flag, set in `finally` to `false` (line 1745)
- `entry.live = { status: 'LOCK_BLOCKED' }` on lock collision (line 1242)
- `entry.live = { status: 'MAIN_PLACED', ... }` immediately after MAIN order (line 1446)
- `entry.live = { status: 'ENTRY_FAILED', ... }` on MAIN failure (line 1454)
- `entry.live.entrySlippage / entrySlippagePct / fillPrice` on fill (lines 1549-1552)
- `entry.live = { status: 'EMERGENCY_CLOSED', ... }` on SL exhaustion emergency close (line 1636)
- `entry.live = { status: 'EMERGENCY_CLOSED', ... }` on TP exhaustion emergency close (line 1703)
- `entry.live = { status: 'LIVE' or 'LIVE_NO_SL', ... }` on successful placement (line 1717)
- `entry.closeReason / closePnl / closeTs` in zombie cleanup paths (lines 1247, 1271, etc.)

#### DB Writes
- `_persistPosition(entry)` — called at line 1452 (after MAIN placed), line 1742 (final success), line 1762 (FILL_UNVERIFIED), line 1784 (zombie cleanup in `finally`)
- `_persistClose(entry)` — called in zombie cleanup paths for failed statuses (line 1277, 1291, 1777)
- `_persistState(userId)` — called at line 1743 (final success), line 1252, line 1274, line 1291, line 1779

Note: `_persistPosition` writes to `at_positions` via the legacy DB module (`_persistPosition` is an internal serverAT function — NOT the same as binanceOps `INSERT INTO at_positions`). This creates a **dual-write risk** if binanceOps.placeEntry also inserts into at_positions (it does at line 92 of binanceOps.js).

#### Audit Log Inserts
- `audit.record('SAT_ENTRY_DEDUP_SKIP', ...)` — line 1429 (idempotency skip)
- `audit.record('SAT_ENTRY_FAILED', ...)` — line 1459 (MAIN order failure)
- `audit.record('SAT_FILL_UNVERIFIED_FORCE_CLOSED', ...)` — line 1522
- `audit.record('SAT_FILL_UNVERIFIED_FORCE_CLOSE_FAILED', ...)` — line 1528
- `audit.record('SAT_FILL_UNVERIFIED_NO_POS', ...)` — line 1535
- `audit.record('SAT_ENTRY_FILLED', ...)` — line 1555 (fill confirmed)
- `audit.record('SAT_EMERGENCY_CLOSE', ...)` — line 1639 (SL exhaustion)
- `audit.record('SAT_EMERGENCY_CLOSE', ...)` — line 1706 (TP exhaustion)

#### Telegram Alerts
- `telegram.alertRiskBlock(...)` — line 1315 (RISK_BLOCKED)
- `telegram.sendToUser(...)` — line 1330 (INSUFFICIENT_MARGIN)
- `telegram.sendToUser(...)` — line 1340 (MARGIN_CHECK_FAILED)
- `telegram.sendToUser(...)` — line 1387 (MARGIN_TYPE_FAILED)
- `telegram.sendToUser(...)` — line 1409 (LEVERAGE_FAILED)
- `telegram.alertOrderFailed(...)` — line 1458 (ENTRY_FAILED)
- `telegram.sendToUser(...)` — line 1488 (FILL_UNVERIFIED — no position)
- `telegram.sendToUser(...)` — line 1523 (FILL_UNVERIFIED force-close)
- `telegram.sendToUser(...)` — line 1529 (FILL_UNVERIFIED force-close FAILED)
- `telegram.sendToUser(...)` — line 1536 (FILL_UNVERIFIED no position)
- `telegram.alertOrderFilled(...)` — line 1561 (fill confirmed)
- `telegram.sendToUser(...)` — line 1600 (SL retry warning)
- `telegram.sendToUser(...)` — line 1621 (EMERGENCY CLOSE announcement)
- `telegram.sendToUser(...)` — line 1638 (emergency close executed)
- `telegram.sendToUser(...)` — line 1655 (emergency close failed — CRITICAL)
- `telegram.sendToUser(...)` — line 1679 (TP retry warning)
- `telegram.sendToUser(...)` — line 1689 (TP EMERGENCY CLOSE announcement)
- `telegram.sendToUser(...)` — line 1705 (TP emergency close executed)
- `telegram.sendToUser(...)` — line 1713 (TP emergency close failed)
- `telegram.sendToUser(...)` — line 1733 (CRITICAL: NO SL PROTECTION)
- `telegram.sendToUser(...)` — lines 1754-1762 (FILL_UNVERIFIED tracked)

#### ML/Metrics
- `metrics.recordOrder('failed')` — line 1460
- `metrics.recordOrder('filled')` — line 1560
- Sentry.captureException / Sentry.captureMessage — multiple paths (lines 1457, 1487, 1513, 1526, 1620, 1652, 1688, 1712)

#### State Machine Transitions
- NONE in `_executeLiveEntry`. All state transitions are direct writes to `entry.live.status`. The `positionStateMachine` module (used by `binanceOps`) is NOT referenced in the legacy `_executeLiveEntry` path.

#### Order Lock Acquire/Release
- `_liveEntryLocks.add(_lockKey)` — line 1258 (per-user:symbol lock)
- `_liveEntryLocks.delete(_lockKey)` — line 1748 in `finally` block

#### `_closePosition` Calls from within `_executeLiveEntry`
- Line 1648: `_closePosition(emgIdx, entry, 'EMERGENCY_CLOSED', emgPrice, emgPnl)` — after SL exhaustion emergency close succeeds
- Line 1708: `_closePosition(tpEmgIdx, entry, 'EMERGENCY_CLOSED', tpEmgPrice, tpEmgPnl)` — after TP exhaustion emergency close succeeds

### Exit Points

| Condition | Line | Exit State |
|---|---|---|
| `MF.SERVER_AT !== true` | ~1233 | throw `LIVE_ENTRY_REQUIRES_FULL_SERVER_AT` |
| Lock already held | ~1256 | `return` (zombie cleanup) |
| AT disabled for mode (re-entry check) | ~1276 | `return` (position aborted) |
| Global halt active | ~1294 | `return` (position aborted) |
| No creds | ~1303 | `return` (NO_CREDS) |
| Risk blocked | ~1317 | `return` (RISK_BLOCKED) |
| Insufficient margin | ~1332 | `return` (INSUFFICIENT_MARGIN) |
| Margin check failed | ~1342 | `return` (MARGIN_CHECK_FAILED) |
| Margin type set failed (2 retries) | ~1390 | `return` (MARGIN_TYPE_FAILED) |
| Leverage set failed (2 retries) | ~1411 | `return` (LEVERAGE_FAILED) |
| Idempotency skip (mainOrderId exists) | ~1430 | `return` |
| MAIN order failed | ~1462 | `return` (ENTRY_FAILED) |
| FILL_UNVERIFIED (no/force-close paths) | ~1538-1539 | `return` |
| Emergency close success (SL exhaustion) | ~1650 | `return` (EMERGENCY_CLOSED) |
| Emergency close failed (SL exhaustion) | ~1657 | `return` |
| TP emergency close success | ~1709 | `return` (EMERGENCY_CLOSED) |
| Normal completion | ~1787 | implicit — `entry.live.status = 'LIVE' or 'LIVE_NO_SL'` |

---

## Section 2: `_closePosition` (lines 1983–2307)

### Function Signature

```javascript
function _closePosition(idx, pos, exitType, price, pnl)
```

- `idx` — index into `_positions` array (for `_positions.splice(idx, 1)`)
- `pos` — the position object (same reference as `_positions[idx]`)
- `exitType` — string constant identifying the close reason
- `price` — exit price
- `pnl` — pre-calculated PnL (passed by caller)

**Critical observation:** `_closePosition` is **synchronous** (`function`, not `async`). The exchange-side close is NOT performed inside `_closePosition`. It delegates to `_handleLiveExit` (async, line 2233) via fire-and-forget `.catch()`:

```javascript
if (pos.live && (pos.live.status === 'LIVE' || pos.live.status === 'LIVE_NO_SL')) {
    _handleLiveExit(pos, exitType, price, pnl).catch(err => { ... });
}
```

### What `_closePosition` Actually Does vs `_handleLiveExit`

**`_closePosition` responsibilities (synchronous):**
1. Sets `pos.status`, `pos.closeTs`, `pos.closePnl`, `pos.closeReason`
2. Captures regime snapshot at close time
3. Ring5 ML outcome recording (`ring5.recordContribution`)
4. R5A attribution recording
5. TheVoice REACTION utterance
6. Chained audit trail append
7. MAE/MFE quality scoring
8. User stats update (`us.stats`, `us.demoStats`, `us.liveStats`)
9. Demo balance refund
10. Live `liveBalanceRef` adjustment
11. `_pushLog(userId, 'EXIT', ...)`
12. **Telegram exit alert** (line 2223)
13. **Fires `_handleLiveExit` async** (exchange close)
14. DSL detach
15. Daily PnL accumulator update
16. Kill switch check
17. Close cooldown deadline set
18. **DB: `_persistClose(pos)` + `_positions.splice(idx, 1)`** (line 2250)
19. `_persistState(userId)`
20. ML brainLogger outcome link
21. Reflection hook
22. `_notifyChange(userId)`
23. MarketFeed ref release

**`_handleLiveExit` responsibilities (async — exchange side):**
- For `HIT_SL`: cancel remaining TP order, query SL fill price for slippage correction
- For `HIT_TP`: cancel remaining SL order
- For all other exit types (MANUAL, DSL, RESET, RECON): **POST reduce-only MARKET CLOSE to Binance** (line 1873), retry 3× with backoff, cancel SL+TP, update PnL from real fill
- `audit.record('SAT_EXIT', ...)` — line 1923
- `_pushLog(userId, 'LIVE_EXIT', ...)` — line 1928
- Updates `us.liveStats.exits/pnl/wins/losses`

### All Callers of `_closePosition`

| Line | Caller Context | exitType | `idx` source | `pos` state | Sync/Async? | Notes |
|---|---|---|---|---|---|---|
| 1648 | `_executeLiveEntry` SL exhaustion | `EMERGENCY_CLOSED` | `_positions.findIndex(p => p.seq === entry.seq)` | `entry.live.status = 'EMERGENCY_CLOSED'` already set | sync call in async fn | Exchange close already happened (line 1626). `_closePosition` is DB cleanup only. |
| 1708 | `_executeLiveEntry` TP exhaustion | `EMERGENCY_CLOSED` | `_positions.findIndex(p => p.seq === entry.seq)` | `entry.live.status = 'EMERGENCY_CLOSED'` already set | sync call in async fn | Exchange close already happened (line 1693). DB cleanup only. |
| 2550 | `onPriceUpdate` DSL Pivot Left exit | `DSL_PL` | loop `i` | `pos.live.status = 'LIVE'` | sync call in sync `continue` loop | `_handleLiveExit` fires async close to exchange |
| 2608 | `onPriceUpdate` LONG SL hit | `HIT_SL` | loop `i` | `pos.live.status = 'LIVE'` | sync call | SL already filled on exchange — `_handleLiveExit` just cancels TP |
| 2612 | `onPriceUpdate` LONG TP hit | `HIT_TP` | loop `i` | `pos.live.status = 'LIVE'` | sync call | TP already filled on exchange — `_handleLiveExit` just cancels SL |
| 2620 | `onPriceUpdate` SHORT SL hit | `HIT_SL` | loop `i` | `pos.live.status = 'LIVE'` | sync call | Same as line 2608 |
| 2624 | `onPriceUpdate` SHORT TP hit | `HIT_TP` | loop `i` | `pos.live.status = 'LIVE'` | sync call | Same as line 2612 |
| 3054 | `reset(userId)` | `RESET` | loop `i` (reverse) | any | sync | Admin reset — no exchange close needed |
| 3915 | `closeBySeq` (MANUAL_CLIENT) | `MANUAL_CLIENT` | `_positions.findIndex(...)` | `pos.live.status = 'LIVE'` | sync call | `_handleLiveExit` fires async close to exchange |
| 4547 | recon phantom merged dup | `RECON_PHANTOM_MERGED_DUP` | `_positions.findIndex(...)` | phantom (no exchange pos) | sync | DB cleanup only, no exchange close needed |
| 4646 | recon phantom | `RECON_PHANTOM` | `_positions.findIndex(...)` | phantom (Binance says gone) | sync | DB cleanup only — position already gone on exchange |

### `_closePosition` Side Effects (Complete List)

#### In-memory pos writes
- `pos.status = exitType`
- `pos.closeTs = Date.now()`
- `pos.closePnl = pnl`
- `pos.closeReason = exitType`
- `pos.closeRegime / pos.closeRegimeConf` (regime snapshot)
- `pos.quality` (MAE/MFE scoring object)

#### User state writes
- `us.stats.exits++`, `us.stats.pnl += pnl`, `us.stats.wins/losses++`
- `us.demoStats.*` (if `pos.mode !== 'live'`)
- `us.demoBalance += pos.margin + pnl` (demo mode)
- `us.liveBalanceRef += pnl` (live mode)
- `us.dailyPnL += pnl`
- `us.dailyPnLLive` or `us.dailyPnLDemo += pnl`
- `us._firstProfitDayShown` (easter egg milestone)

#### DB writes
- `_persistClose(pos)` → archives to `at_closed`, deletes from `at_positions` (legacy path)
- `_positions.splice(idx, 1)` (in-memory removal)
- `_persistState(userId)`

#### Audit log
- `_pushLog(userId, 'EXIT', {...})`
- brainLogger.linkOutcomeBySeq (ML outcome link)
- chainedTrail.append (tamper-evident audit)
- ring5.recordContribution (ML bandit evidence)
- attrib.recordAttribution (R5A attribution)

#### Telegram alerts
- `telegram.sendToUser(userId, ...)` — unified exit alert (line 2223) for **all** exit types

#### Other
- `serverDSL.detach(pos.seq)` — DSL state cleanup
- `_checkKillSwitch(userId)` — daily DD check
- `_setCloseCooldownDeadline(userId, pos.symbol)` — re-entry gate
- `marketFeed.releaseRef(refKey)` — ref-count decrement for live positions
- `serverReflection.reflectOnTrade(...)` + `updateCalibration(...)` — post-trade analysis
- `_notifyChange(userId)` — WebSocket push

### Does `_closePosition` Send Exchange Orders?

**No.** `_closePosition` itself sends zero exchange orders. The exchange-side work is entirely in `_handleLiveExit` (async, fired at line 2233). This is the critical architectural boundary:

```
_closePosition (sync)  →  DB/stats/telegram/ML  →  fires _handleLiveExit.catch (async exchange)
```

`_handleLiveExit` is the function that currently calls `sendSignedRequest` for market close orders (line 1873). It is not `_closePosition`.

---

## Section 3: Refactor Strategy

### For `_executeLiveEntry` (Task 40)

**Short answer:** Cannot be wholesale replaced by `exchangeOps.placeEntry(uid, params)`. The function contains ~25 serverAT-specific side effects (audit records, Telegram alerts, fill verification polling, metrics, Sentry captures, zombie cleanup, `_livePending` lock management) that must remain in serverAT.

**Recommended approach:** Keep `_executeLiveEntry` as a wrapper; replace only the direct HTTP calls with router calls.

**Specifically:**

1. **Replace balance check (line 1322):** `sendSignedRequest('GET', '/fapi/v2/balance', ...)` → `await exchangeOps.getBalance(uid)` (already exists in Task 26).

2. **Replace margin+leverage setup (lines 1375–1414):** `marginHelper.ensureCrossed` + `sendSignedRequest('POST', '/fapi/v1/leverage', ...)` → `await exchangeOps.ensureSymbolReady(uid, { symbol, leverage: entry.lev, marginMode: 'CROSSED' })`. This call is **cached 5min per (uid, symbol)** in exchangeOps — idempotent and efficient.

3. **Replace MAIN entry + SL + TP + emergency close (lines 1436–1714):** This is the large block. Replace with `await exchangeOps.placeEntry(uid, params)` where:
   ```
   params = {
       symbol: entry.symbol,
       side: entry.side,            // LONG/SHORT (exchangeOps accepts this format)
       qty: fillQty,
       entryType: 'MARKET',
       sl: { price: entry.sl },
       tp: entry.tp ? { price: entry.tp } : null,
       leverage: entry.lev,
       decisionKey: clientOrderId,   // SAT_<seq>_<decTok>
       source: 'serverAT',
   }
   ```

4. **Keep in serverAT wrapper:**
   - All pre-exchange gates (SERVER_AT flag, lock, userId check, halt, risk, mode re-check)
   - `entry._livePending = true/false` (TL-04 lock flag)
   - `_liveEntryLocks.add/delete` (per-symbol lock)
   - All `audit.record(...)` calls
   - All `telegram.*` calls
   - All `metrics.recordOrder(...)` calls
   - All `Sentry.capture*` calls
   - `_persistPosition` / `_persistState` calls
   - Zombie cleanup in `finally` block

5. **Fill verification polling (lines 1467–1483):** `binanceOps.placeEntry` does NOT poll for fill — it uses the exchange response directly. The polling logic is serverAT-specific (ZT-AUD-002). For post-refactor: `exchangeOps.placeEntry` returns `{ avgFillPrice, filledQty }`. If `avgFillPrice` is missing/zero, serverAT wrapper can still call `exchangeOps.cancelOrder` + query — but this is optional complexity. Minimum viable: trust `avgFillPrice` from router result, flag FILL_UNVERIFIED only if result has no `avgFillPrice`.

6. **FILL_UNVERIFIED reconcile+force-close paths (lines 1494–1540):** These are serverAT-specific safety paths. Keep them, but replace the `sendSignedRequest('POST', ..., MARKET, reduceOnly)` force-close call with `exchangeOps.closePosition(uid, { seq, symbol, qty, side, closeType: 'MARKET', decisionKey: ... })`.

7. **decisionKey format:** Current format `SAT_${seq}_${8hex}` is 14-20 chars — passes `exchangeOps` regex validation. No change needed to the generation logic.

8. **After refactor: `binanceOps.placeEntry` inserts into `at_positions` with seq allocated by SQLite.** The serverAT wrapper's `_persistPosition(entry)` is a separate write path (legacy at_state JSON + at_positions upsert). Both will coexist temporarily. Full dedup requires follow-up (tracked as T40-deferred-db-unification).

### For `_closePosition` (Task 41)

The refactor splits into two distinct sub-paths:

#### Sub-path A: HIT_SL / HIT_TP (lines 2608-2624) — DB-only, NO exchangeOps call

The exchange already filled the SL or TP order when these exit types fire. `_handleLiveExit` for these paths only cancels the counterpart order (e.g., TP cancel on SL hit) — no new close order is sent.

**Post-refactor: `_closePosition` for HIT_SL and HIT_TP must remain exactly as-is.** Do NOT add an `exchangeOps.closePosition` call. The exchange-side work in `_handleLiveExit` is already correct for these paths (cancel TP on SL hit, cancel SL on TP hit).

**Bybit impact:** `_handleLiveExit` still calls `sendSignedRequest` for order cancellation (line 1805, 1859). Those cancel calls also need Bybit routing (tracked separately — `_handleLiveExit` is not Task 41 scope, but is a follow-on task).

#### Sub-path B: MANUAL_CLIENT / DSL_PL / RESET — Active close, exchangeOps.closePosition needed

For these exit types, `_handleLiveExit` fires a reduce-only MARKET close (line 1873). This is the only `sendSignedRequest` call in the close path that needs Bybit routing.

**Refactor `_handleLiveExit` not `_closePosition`:** The sendSignedRequest is in `_handleLiveExit` (lines 1873-1880), not `_closePosition` itself. Task 41 scope is correctly `_handleLiveExit`'s market close block:

```javascript
// CURRENT (line 1873):
closeResult = await sendSignedRequest('POST', '/fapi/v1/order', { ... reduceOnly: true ... }, creds);

// REPLACE WITH:
const closeResult = await exchangeOps.closePosition(uid, {
    seq: pos.seq,
    symbol: pos.symbol,
    side: pos.side,
    qty: String(rounded.quantity || pos.live.executedQty),
    closeType: 'MARKET',
    decisionKey: `SAT_EXIT_${pos.live.liveSeq}_${Date.now()}`.slice(0, 36),
    source: exitType,
});
```

#### Sub-path C: EMERGENCY_CLOSED (lines 1648, 1708) — Dead code post-Task 40

After Task 40 refactor, `binanceOps.placeEntry` handles emergency close internally (on SL exhaustion). `_closePosition` called with `EMERGENCY_CLOSED` from `_executeLiveEntry` becomes a pure DB cleanup — `pos.live.status` is already `'EMERGENCY_CLOSED'` when `_closePosition` fires, so `_handleLiveExit` skips the exchange call (guard at line 2232: `status !== 'LIVE' && status !== 'LIVE_NO_SL'`). **No action needed for EMERGENCY_CLOSED paths** — they are already correctly guarded.

#### Sub-path D: RECON paths — DB-only

`RECON_PHANTOM`, `RECON_PHANTOM_MERGED_DUP`: Exchange position is already gone. `_handleLiveExit` excludes these paths explicitly (line 1865: `exitType !== 'RECON_PHANTOM'`). No change needed.

#### Sub-path E: RESET — DB-only

`reset()` calls `_closePosition` with `pos.live` typically null or non-LIVE. `_handleLiveExit` guard at line 2232 ensures no exchange call for reset positions. No change needed.

---

## Section 4: Side-Effect Parity Matrix

### `_executeLiveEntry` (serverAT current) vs `binanceOps.placeEntry` (Task 25)

| Side Effect | `_executeLiveEntry` (current) | `binanceOps.placeEntry` | Gap / Action |
|---|---|---|---|
| Pre-trade balance check | YES — line 1322, blocks on insufficient | NO | MUST preserve in serverAT wrapper post-refactor |
| Margin type set (CROSSED) | YES — lines 1369–1392, 2-retry loop | YES (via `ensureSymbolReady` — separate call) | exchangeOps.ensureSymbolReady replaces both |
| Leverage set | YES — lines 1395–1414, 2-retry loop | YES (via `ensureSymbolReady`) | exchangeOps.ensureSymbolReady replaces both |
| at_positions INSERT | YES — via `_persistPosition` (line 1452) | YES — line 92 of binanceOps.js | DUAL WRITE: binanceOps inserts PENDING row; serverAT persists own format. Needs unification post-Task 40. |
| Safety SL @ 15% OTM | YES — line 1573 | YES — lines 3246-3258 | Both do this. binanceOps uses `closePosition:true` (no qty), serverAT uses `reduceOnly:true` with qty. binanceOps path is simpler. Post-refactor: binanceOps handles this, serverAT drops its safety SL code. |
| MAIN market order | YES — line 1436 | YES — line 124 of binanceOps.js | Replaced by exchangeOps.placeEntry |
| Fill verification poll | YES — lines 1469–1483 | NO | serverAT-specific ZT-AUD-002. MUST preserve in serverAT wrapper (use exchangeOps result; poll only if avgFillPrice missing). |
| SL placement (3-retry) | YES — lines 1587–1603 | YES — lines 140–167 of binanceOps.js | Replaced by exchangeOps.placeEntry |
| Emergency close on SL fail | YES — lines 1626–1648 | YES — `_emergencyClose` in binanceOps | Replaced. binanceOps also persists to `emergency_close_queue` on catastrophic fail — serverAT does not. Post-refactor: gain this resilience. |
| TP placement (3-retry) | YES — lines 1666–1683 | YES — lines 211–233 of binanceOps.js | Replaced by exchangeOps.placeEntry |
| positionStateMachine transitions | NO — direct `entry.live.status` writes | YES — PENDING→OPENING→OPEN (binanceOps lines 131, 244) | NEW in binanceOps. serverAT must NOT also write `live.status` after routing — would double-write. |
| positionEvents.append | NO | YES — CREATED, SL_PLACED, TP_PLACED events | NEW in binanceOps. Gained automatically post-refactor. |
| audit.record (SAT_ENTRY_FILLED) | YES — line 1555 | NO | MUST preserve in serverAT post-refactor |
| audit.record (SAT_ENTRY_FAILED) | YES — line 1459 | NO | MUST preserve in serverAT post-refactor |
| audit.record (SAT_EMERGENCY_CLOSE) | YES — lines 1639, 1706 | NO (uses positionEvents instead) | serverAT audit record is legacy. Post-refactor: binanceOps positionEvents provides the trail. Can dedup or keep both for transition period. |
| audit.record (SAT_ENTRY_DEDUP_SKIP) | YES — line 1429 | NO | MUST preserve in serverAT (idempotency skip log) |
| Telegram entry alert (alertOrderFilled) | YES — line 1561 | NO | MUST preserve in serverAT wrapper |
| Telegram order failed alert | YES — line 1458 | NO | MUST preserve in serverAT wrapper |
| Telegram emergency close alerts | YES — lines 1621, 1638, 1655, 1689, 1705, 1713 | NO (Telegram critical via alertCritical only on catastrophic) | MUST preserve in serverAT wrapper |
| Telegram FILL_UNVERIFIED alerts | YES — lines 1488, 1523, 1529, 1536 | NO | MUST preserve in serverAT wrapper |
| Telegram SL/TP retry warnings | YES — lines 1600, 1679 | NO | MUST preserve in serverAT wrapper |
| Sentry.captureException | YES — multiple paths | NO | MUST preserve in serverAT wrapper |
| metrics.recordOrder | YES — lines 1460, 1560 | NO | MUST preserve in serverAT wrapper |
| us.liveStats.entries++ | YES — line 1741 | NO | MUST preserve in serverAT wrapper |
| _livePending lock flag | YES — line 1235/1745 | NO | MUST preserve in serverAT wrapper |
| _liveEntryLocks Set | YES — line 1258/1748 | binanceOps uses orderLock module instead | Both locks should coexist: serverAT lock prevents double-fire, binanceOps lock prevents concurrent DB write |
| orderLock (new Task 25) | NO | YES — line 77 of binanceOps.js | New capability gained post-refactor |
| emergency_close_queue persist | NO | YES — line 187 of binanceOps.js (catastrophic path) | New resilience gained post-refactor |
| Global PANIC halt on catastrophic | NO | YES — line 190 of binanceOps.js | New resilience gained post-refactor |
| decisionId dedup (S6-B3) | YES — serverAT per-user dedup TTL | NO | serverAT dedup runs before _executeLiveEntry; preserved automatically |

### `_closePosition` / `_handleLiveExit` (serverAT current) vs `binanceOps.closePosition` (Task 26)

| Side Effect | `_closePosition` + `_handleLiveExit` | `binanceOps.closePosition` | Gap / Action |
|---|---|---|---|
| at_positions DELETE → at_closed INSERT | YES — `_persistClose` in _closePosition | YES — lines 388-393 of binanceOps.js | DUAL WRITE risk. binanceOps moves by seq; serverAT `_persistClose` uses legacy format. Unification deferred. |
| DB status transition (CLOSING→CLOSED) | NO — direct write via _persistClose | YES — positionStateMachine.transition | serverAT does not use state machine. Post-refactor: binanceOps provides OPEN→CLOSING→CLOSED. |
| Race check (already CLOSED) | NO — `_closingGuard` Set (serverAT) | YES — `row.status === 'CLOSED'` check (binanceOps line 297) | Both have race protection. Can coexist. |
| SL/TP cancel before close | YES — `_cancelOrderSafe` (line 1913) | YES — parallel cancel (lines 323–349) | binanceOps handles this. `_cancelOrderSafe` logic (algo order fallback) is more complete. Post-refactor: may need to preserve `_cancelOrderSafe` for algo orders not covered by binanceOps simple DELETE. |
| Reduce-only MARKET close order | YES — line 1873 (`_handleLiveExit`) | YES — line 366 of binanceOps.js | Replaced by exchangeOps.closePosition in `_handleLiveExit` |
| Close retry (3×) | YES — `CLOSE_RETRIES` loop (lines 1871–1893) | NO (single attempt) | REGRESSION RISK: binanceOps has no retry. Retry logic must be preserved in `_handleLiveExit` wrapper around `exchangeOps.closePosition`. |
| pendingLiveCloses queue on exhaustion | YES — line 1888 | NO | MUST preserve serverAT behavior |
| Real fill price correction (PnL) | YES — lines 1894–1906 | YES — `closeResp.avgPrice` returned | Compatible. serverAT uses result to update `pos.closePnl`; binanceOps result provides avgFillPrice. |
| positionEvents CLOSED append | NO | YES — line 399 of binanceOps.js | Gained post-refactor |
| audit.record('SAT_EXIT') | YES — line 1923 | NO | MUST preserve in `_handleLiveExit` post-refactor |
| _pushLog('LIVE_EXIT') | YES — line 1928 | NO | MUST preserve in `_handleLiveExit` |
| us.liveStats.exits/pnl/wins/losses | YES — lines 1933–1936 | NO | MUST preserve in `_handleLiveExit` |
| SL fill price query (HIT_SL path) | YES — lines 1812–1851 (algo order query) | NO | Not applicable — HIT_SL path skips binanceOps.closePosition entirely (see Strategy section) |
| Telegram market close failed alert | YES — line 1890 | NO | MUST preserve in `_handleLiveExit` |
| Slippage tracking (exitSlippage/Pct) | YES — line 1825-1828, 1903-1904 | NO | MUST preserve |
| _applyRoundTripFee | YES — lines 1837, 1902 | NO | MUST preserve (fee deduction on PnL) |
| recordClosedPnL | YES — line 1918 | NO | MUST preserve (PnL telemetry) |
| Milestone / easter egg utterances | YES — `_closePosition` lines 2151-2190 | NO | Preserved automatically (in `_closePosition`) |
| Ring5 outcome recording | YES — `_closePosition` lines 2007-2023 | NO | Preserved automatically |
| DSL detach | YES — `_closePosition` line 2238 | NO | Preserved automatically |
| Kill switch check | YES — `_closePosition` line 2242 | NO | Preserved automatically |
| MarketFeed ref release | YES — `_closePosition` lines 2296-2305 | NO | Preserved automatically |

---

## Section 5: Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Dual DB write (at_positions): binanceOps inserts PENDING row, serverAT `_persistPosition` also writes | HIGH | Defer unification to post-Task 40 followup. For Task 40 scope: ensure seq from binanceOps result is stored on `entry.live.seq` for cross-reference. Document as T40-deferred. |
| `_closePosition` (HIT_SL/HIT_TP) incorrectly gains an exchangeOps.closePosition call | HIGH | Enforcement: only modify `_handleLiveExit` market close block. `_closePosition` itself has no exchange call — do not add one. SL/TP paths in `_handleLiveExit` skip the close block already (line 1803-1859 branching). |
| State machine double-write: binanceOps writes PENDING→OPENING→OPEN; serverAT wrapper also writes `entry.live.status` | MEDIUM | After `exchangeOps.placeEntry` returns `{ok: true, ...}`, map result to `entry.live` object rather than re-writing status. Specifically: `entry.live.status = result.ok ? 'LIVE' : 'ENTRY_FAILED'` — single write from result. |
| Loss of fill verification polling (ZT-AUD-002) | MEDIUM | binanceOps returns `avgFillPrice` from exchange response. If `!avgFillPrice || avgFillPrice <= 0`, serverAT wrapper triggers FILL_UNVERIFIED path. Polling loop (lines 1469-1483) can be removed or simplified to one GET query. |
| Close retry regression (binanceOps.closePosition has no retry) | MEDIUM | Wrap `exchangeOps.closePosition` call in `_handleLiveExit` within existing CLOSE_RETRIES loop. The loop structure stays; only the inner `sendSignedRequest` call changes. |
| `_cancelOrderSafe` algo-order fallback lost on close cancel path | MEDIUM | binanceOps cancel uses plain `DELETE /fapi/v1/order`. serverAT `_cancelOrderSafe` also tries `/fapi/v1/algoOrder` first. For HIT_SL/HIT_TP cancel paths (lines 1805, 1859), `_cancelOrderSafe` should be kept as-is — it is not the market-close call being routed. |
| Telegram alerts lost on refactor | HIGH | All telegram calls are in serverAT wrapper context, not in exchange call blocks. They must be kept unconditionally. Verified in parity matrix above — none are in binanceOps. |
| audit.record entries lost on refactor | HIGH | Same as Telegram — all in serverAT context. Only `positionEvents.append` is new in binanceOps. Both can coexist as transition. |
| Bybit SL/TP order cancel (algo vs regular) format divergence | HIGH | `_cancelOrderSafe` tries algo endpoint first — Bybit does not have `/fapi/v1/algoOrder`. For Bybit users, `_cancelOrderSafe` must be replaced by `exchangeOps.cancelOrder`. This is a follow-on task for `_handleLiveExit` Bybit routing (not directly Task 41, but must be tracked). |
| `decisionKey` format collision (reuse of `clientOrderId` string) | LOW | `SAT_${seq}_${8hex}` is unique per entry, compatible with exchangeOps regex. No collision risk. |
| Hot path latency increase | LOW | exchangeOps router adds one function call + Map lookup (~0-1ms). Brain cycle is 30s. Negligible. |
| Lock double-acquisition: `_liveEntryLocks` + `orderLock` from binanceOps | LOW | `_liveEntryLocks` guards before `exchangeOps.placeEntry` call; `orderLock` guards inside binanceOps. Non-overlapping scopes. Both can coexist safely. |
| `_executeLiveEntryCore` (Cat B, line 3180) duplication: also calls sendSignedRequest directly | MEDIUM | `_executeLiveEntryCore` is the extracted Cat B version that also needs the same routing refactor. Task 40 should refactor both `_executeLiveEntry` and `_executeLiveEntryCore` in the same commit, or document the second as T40.1b. |

---

## Section 6: Refactor Task Breakdown

### Task 40: `_executeLiveEntry` Refactor

**40.1 — Balance check replacement**
- Lines 1321-1343
- Replace `sendSignedRequest('GET', '/fapi/v2/balance', {}, creds)` with `await exchangeOps.getBalance(userId)`
- Map result: `result.availableBalance` → `available`
- Preserve all blocking logic, telegram, audit, return paths exactly

**40.2 — Margin + leverage replacement**
- Lines 1369-1414 (margin) + line 1375 (marginHelper)
- Replace both blocks with: `await exchangeOps.ensureSymbolReady(userId, { symbol: entry.symbol, leverage: entry.lev, marginMode: 'CROSSED' })`
- Handle `result.ok === false` → block entry, same telegram/audit/return pattern
- Note: `ensureSymbolReady` in exchangeOps is cached 5min — idempotent. Remove the manual 2-retry loops.

**40.3 — Main entry + SL + TP + emergency close replacement (core block)**
- Lines 1433-1714 (excluding fill verification, slippage tracking, Telegram/audit calls)
- Build params object (see Strategy section above)
- Call `await exchangeOps.placeEntry(userId, params)`
- Map result fields to `entry.live` fields:
  - `result.orderId` → `entry.live.mainOrderId`
  - `result.avgFillPrice` → `avgPrice` / `entry.live.avgPrice`
  - `result.filledQty` → `executedQty`
  - `result.slOrderId` → `entry.live.slOrderId`
  - `result.tpOrderId` → `entry.live.tpOrderId`
  - `result.seq` → `entry.live.opsSeq` (new field — links to binanceOps at_positions row)
- Keep all `_persistPosition`, `audit.record`, `telegram.*` calls wrapping the exchangeOps call

**40.4 — Fill verification adapter**
- Post-`exchangeOps.placeEntry` call
- If `result.avgFillPrice` is missing/zero → FILL_UNVERIFIED path
- Keep existing FILL_UNVERIFIED DB/telegram/audit logic
- Force-close: replace `sendSignedRequest('POST', /fapi/v1/order, MARKET)` with `await exchangeOps.closePosition(userId, { seq: entry.live.opsSeq, symbol, qty, side, closeType: 'MARKET', decisionKey: SAT_FCUNVER_... })`

**40.5 — `_executeLiveEntryCore` (Cat B, line 3180) same refactor**
- Same pattern as 40.3 but for the extracted Cat B version
- Note: `_executeLiveEntryCore` does not have the pre-exchange gates (no balance check, no halt check at top) — those live in callers. Simpler replacement.

### Task 41: `_handleLiveExit` Market Close Replacement

**41.1 — Replace market close in `_handleLiveExit` for active close contexts (MANUAL/DSL/RESET)**
- Lines 1862-1909 (the `else` branch of `_handleLiveExit`)
- The condition `exitType !== 'RECON_PHANTOM' && ...` guard stays
- Replace the `sendSignedRequest('POST', ..., MARKET, reduceOnly)` call (line 1873) inside the CLOSE_RETRIES loop with `await exchangeOps.closePosition(userId, params)`
- Preserve the CLOSE_RETRIES retry loop structure (binanceOps has no retry)
- Preserve `_pendingLiveCloses` queueing on exhaustion
- Preserve real fill price correction from `closeResult`

**41.2 — HIT_SL / HIT_TP paths — no exchange call change needed**
- Lines 1803-1859
- `_cancelOrderSafe` calls remain as-is (separate routing concern)
- NO exchangeOps.closePosition added
- Flag as follow-on: cancel calls (`_cancelOrderSafe`) also need Bybit routing (tracked separately)

**41.3 — Verify EMERGENCY_CLOSED paths (lines 1648, 1708)**
- Confirm `pos.live.status === 'EMERGENCY_CLOSED'` before `_closePosition` fires
- `_handleLiveExit` guard at line 2232 (`status !== 'LIVE' && status !== 'LIVE_NO_SL'`) correctly skips exchange call for EMERGENCY_CLOSED
- **No code change needed** — verify via test that guard holds

---

## Section 7: Recommended Order

```
1. Task 40.1 — balance check (isolated, low risk, single sendSignedRequest)
2. Task 40.2 — margin+leverage (uses ensureSymbolReady cache — verify cache hit behavior)
3. Task 40.3 — core entry block (highest risk — most sendSignedRequest calls replaced)
4. Task 40.4 — fill verification adapter
5. Task 40.5 — executeLiveEntryCore (Cat B) — parallel with 40.3/40.4
6. Manual probe — trigger live entry in testnet mode, verify:
   - exchangeOps.placeEntry called with correct params
   - entry.live.status correctly set to LIVE
   - at_positions has both legacy row + binanceOps row (dual write acknowledged)
   - Telegram alerts fire
   - audit.record fires
7. Task 41.1 — _handleLiveExit market close replacement
8. Task 41.2 — verify HIT_SL/HIT_TP paths unchanged (read-only confirm)
9. Task 41.3 — verify EMERGENCY_CLOSED guard (unit test)
10. State machine integration tests — verify PENDING→OPENING→OPEN flow for Binance + Bybit
```

---

## Section 8: Critical Findings Summary

1. **`_closePosition` sends NO exchange orders.** The exchange-side close is entirely in `_handleLiveExit` (async, lines 1863-1915). Task 41 scope is `_handleLiveExit`, not `_closePosition` itself. The naming is misleading — correct mental model: `_closePosition` = DB+stats+telegram cleanup; `_handleLiveExit` = exchange-side.

2. **HIT_SL / HIT_TP must never receive an `exchangeOps.closePosition` call.** The exchange already filled these. `_handleLiveExit` correctly branches: SL→cancel TP only; TP→cancel SL only. No close order is sent for these paths and none should be added.

3. **`_executeLiveEntryCore` (Cat B, line 3180) is a SECOND function that also calls `sendSignedRequest` directly.** It appears to be the M1.2 extracted version used by `registerManualPosition`. Task 40 must refactor both `_executeLiveEntry` AND `_executeLiveEntryCore`, or only one will be routed through exchangeOps. Grep confirms `_executeLiveEntryCore` has its own `sendSignedRequest` calls at lines 3225, 3226, 3230, 3250, 3264, 3282, 3311, 3319, 3337, 3464, 3526.

4. **Dual DB write.** `binanceOps.placeEntry` inserts a new row into `at_positions` with PENDING status. `serverAT._persistPosition` also writes to `at_positions` (via legacy DB helper). After Task 40, there will be two rows per entry during the transition period. The `entry.live.opsSeq` field (new) links them. Full unification is deferred.

5. **`binanceOps.closePosition` has no retry loop.** serverAT `_handleLiveExit` has 4-attempt close retry (1s/3s/5s backoff + queue on exhaustion). This is production-critical. The retry loop in `_handleLiveExit` must be preserved as the outer wrapper around `exchangeOps.closePosition`. Do not assume exchangeOps handles retries — it does not.

---

## Self-Review Checklist

- [x] `_executeLiveEntry` inventoried with EVERY `sendSignedRequest` call mapped (13 calls, lines listed)
- [x] `_closePosition` function read fully — confirmed SYNC function, no exchange calls
- [x] `_handleLiveExit` identified as actual exchange-close location
- [x] All 11 callers of `_closePosition` identified and annotated
- [x] Side-effect parity matrix complete for both entry and close paths
- [x] Risk assessment table populated (11 risks)
- [x] Refactor strategy specific per sub-path (NOT generic)
- [x] Subtask breakdown granular enough to dispatch separately (Tasks 40.1-40.5, 41.1-41.3)
- [x] `_executeLiveEntryCore` (Cat B) identified as second function needing same refactor
- [x] NO production code modified — audit doc only
