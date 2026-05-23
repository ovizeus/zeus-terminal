# Bybit Migration — Phase 1A + 1B Design Spec

**Date:** 2026-05-21
**Status:** PROPOSED (awaiting operator GO)
**Branch:** `bybit-phase-1ab` (separate, no touch master)
**Locked Decisions:** 32 pillars (26 must-have for ship + 6 deferred Phase 1F)
**Estimated Effort:** ~50-60h focused work, 3-5 weeks realistic delivery, +1-2 weeks burn-in, +1 separate spec for Phase 1E live flip

---

## 1. Executive Summary

Zeus currently trades only Binance USDM futures. This spec defines the first real second exchange (Bybit V5) as fully operational alongside Binance. Two scope phases:

- **Phase 1A — Data feeds (read-side):** When user X is active on Bybit, brain reads klines/trades/markPrice/funding from Bybit WS instead of Binance. Brain decisions stamped with exchange used.
- **Phase 1B — Order routes (write-side):** When user X places an order, signed REST calls go to Bybit V5 endpoints with Bybit-specific request shape (stopLoss/takeProfit in order body, not separate algo orders).

**OUT OF SCOPE** (deferred to separate specs):
- Phase 1C: Live flip of BYBIT_DRY_RUN_ONLY (criteria TBD post burn-in)
- Phase 1D: Switching UX polish (advanced operator flows)
- Phase 1E: 3rd+ exchanges (OKX/MEXC/HTX/Hyperliquid)

**Core principle:** Brain decides on the SAME exchange where it executes. No mixing of Binance prices with Bybit orders. Per-user routing — Mirela can be on Binance while Ovi is on Bybit, fully isolated.

**Server-truth invariant (Rule 0):** All state per `req.user.id`. No fake balances. No localStorage authoritative state. Audit trail criminal-level via `position_events` append-only journal.

---

## 2. Decisions Locked (32 pillars)

### Must-have for ship (26)

| # | Pillar | Source |
|---|---|---|
| 1 | Scope: 1A+1B only | Phone Q1 |
| 2 | Duck-typed JS modules + shared contract test (no TS conversion) | Phone Q2 |
| 3 | Routing: per-user lazy refcounted (B) + 6 audit cerințe A-F | Phone Q3 |
| 4 | Symbols: same 4 (BTC/ETH/SOL/BNB) | Phone Q4 |
| 5 | Testnet/Real: feed=real WS always; mode affects only signed REST | Phone Q5 |
| 6 | exchangeOps router + 5 ajustări (hard SL guard, simplified emergency queue, decisionKey regex, cache TTL 5min, Position canonical) | Phone Q6 |
| 7 | Switch transition: explicit barrier via `_pendingSwitch` + brainLock pre-cycle check | Phone Q7 |
| 8 | Feed degraded: silent skip→Telegram warn 2min→PANIC halt 10min (simplified) | Phone Q8 |
| 9 | WS subscribe: batched by topic-type (3 messages) + heartbeat 20s + per-topic retry | Phone Q9 |
| 10 | Close path: separate `closePosition()` + cancelProtection logic + race detection | Phone Q10 |
| 11 | Schema: `exchange` column on at_positions, at_closed, brain_decisions, feature_proposals, brain_parity_log. SWITCH with open positions = 409 BLOCKED | Phone Q11 |
| 12 | Bybit defaults: CROSSED + one-way hardcoded (identical Binance) | Phone Q12 |
| 13 | Order lock: hold entire flow + 10s timeout + ErrLockTimeout + emergency bypass re-entrant | Phone Q13 |
| 14 | Bybit creds verification real-time on save (ping + getBalance test) | Termius |
| 15 | Initial recon on Bybit activation (sync external positions) | Termius |
| 16 | Multi-user cleanup test (disconnect with other users active → feed stays) | Termius |
| 17 | bybitRateState DB-persistent rate limit tracking | Termius |
| 18 | Permanent shadow logging EARLY (activate at 1A ship, NOT only at flip) | Termius |
| 19 | `at_positions_orphaned` table (disconnect with open positions = move, NOT delete) | Termius |
| 20 | Position state machine strict (8 states) — eliminates race conditions | Operator |
| 21 | `position_events` append-only journal — replay any incident | Operator |
| 22 | Recovery boot deterministic (scan exchange → reconcile DB → verify SL → lift halt) | Operator |
| 23 | Idempotency principle peste tot (clientOrderId/orderLinkId everywhere) | Operator |
| 24 | Server SSoT absolut (no localStorage authoritative state) | Operator |
| 25 | Permanent cross-exchange shadow + divergence tracking | Operator |
| 26 | Auto-adopt orphans on reconnect/switch | Operator |
| 28 | Time sync assertion + NTP drift alert | Termius-2nd |
| 30 | Daily PnL reconciliation cron (Zeus DB vs exchange userTrades) | Termius-2nd |
| 32 | Migration rollback drills + RTO <5min | Termius-2nd |

### Deferred Phase 1F (6)

| # | Pillar | Why deferred |
|---|---|---|
| 27 | Dashboards per-user-per-exchange UI tab | UI work substantial; data endpoint must-have (in pillar 25/30), UI tab can wait |
| 29 | Operational tiers GREEN/YELLOW/ORANGE/RED auto-transitions | Concept must-have (defined in spec), automated transitions = polish |
| 31 | Per-symbol kill switch granular UI | Backend infrastructure (DB column simple) deferred; manual halt sufficient for ship |
| Extra-1 | Auto-retry worker for `emergency_close_queue` | Persistence must-have (logged), auto-retry = Phase 1F (operator manual close sufficient) |
| Extra-2 | Per-topic WS staleness thresholds detailed | Simplified to global 60s silent threshold |
| Extra-3 | Operational tiers FULL auto-degradation | Manual operator trigger sufficient for ship |

---

## 3. Architecture Diagram

### Current State (before Phase 1A+1B)

```
                    ┌─────────────────────────┐
                    │   Binance fapi          │
                    │   /fstream/fapi/testnet │
                    └────────────┬────────────┘
                                 │ (WS + REST)
                                 ▼
              ┌──────────────────────────────────┐
              │  marketFeed.js                   │
              │  (Binance-only, process-global)  │
              └────────────┬─────────────────────┘
                           │ events: kline/price/funding/oi
                           ▼
              ┌──────────────────────────────────┐
              │  serverState.js                  │
              │  _sdMap[symbol] = { price, ... } │
              └────────────┬─────────────────────┘
                           │ getSnapshotForSymbol
                           ▼
              ┌──────────────────────────────────┐
              │  serverBrain.js _runCycle        │
              │  for sym: for user: decide       │
              └────────────┬─────────────────────┘
                           │ processBrainDecision
                           ▼
              ┌──────────────────────────────────┐
              │  serverAT.js → binanceSigner    │
              │  POST /fapi/v1/order ...         │
              └──────────────────────────────────┘
```

### Target State (after Phase 1A+1B)

```
       ┌──────────────────────┐   ┌──────────────────────┐
       │  Binance fapi/fstream │   │  Bybit V5 stream/api │
       └──────────┬───────────┘   └────────────┬─────────┘
                  │                            │
                  ▼                            ▼
       ┌──────────────────────┐   ┌──────────────────────┐
       │  binanceFeed.js      │   │  bybitFeed.js        │
       │  (duck-typed contract)│   │  (duck-typed contract)│
       └──────────┬───────────┘   └────────────┬─────────┘
                  │                            │
                  └──────────┬─────────────────┘
                             ▼
                    ┌─────────────────┐
                    │ feedManager.js  │
                    │ (refcount +     │
                    │  per-user route)│
                    └────────┬────────┘
                             │ active feed per user
                             ▼
              ┌──────────────────────────────────┐
              │  serverState.js                  │
              │  _sdMap_binance[symbol]          │
              │  _sdMap_bybit[symbol]            │
              │  forExchange(name)               │
              └────────────┬─────────────────────┘
                           │
                           ▼
              ┌──────────────────────────────────┐
              │  serverBrain.js _runCycle        │
              │  for user: read pendingSwitch    │
              │    activeEx = _userExchangeCache │
              │    state = serverState.forEx()   │
              │    for sym: decide               │
              └────────────┬─────────────────────┘
                           │ processBrainDecision
                           ▼
              ┌──────────────────────────────────┐
              │  exchangeOps.js (router)         │
              │   ├─ binanceOps.js               │
              │   └─ bybitOps.js                 │
              │  hard SL guard, idempotency,     │
              │  emergency_close, cache 5min     │
              └──────────────────────────────────┘
```

### Key Module Map

| Module | Path | LOC est. | Responsibility |
|---|---|---|---|
| `feedManager.js` | `server/services/feedManager.js` | ~200 | Per-user route + refcount + activate/deactivate per exchange |
| `bybitFeed.js` | `server/services/bybitFeed.js` | ~600 | Bybit V5 WS subscribe/dispatch, mirror binanceFeed |
| `binanceFeed.js` | `server/services/marketFeed.js` (renamed) | unchanged | Existing Binance feed wrapped in contract |
| `exchangeOps.js` | `server/services/exchangeOps.js` | ~350 | Per-user routing, hard SL guard, ensureSymbolReady cache, decisionKey enforcement |
| `binanceOps.js` | `server/services/binanceOps.js` | ~450 | Wrap existing Binance order logic into canonical API |
| `bybitOps.js` | `server/services/bybitOps.js` | ~450 | Wrap bybitSigner + translator + HTTP send |
| `bybitRateState.js` | `server/services/bybitRateState.js` | ~180 | DB-persistent IP-level rate limit tracking (mirror binanceRateState) |
| `positionStateMachine.js` | `server/services/positionStateMachine.js` | ~250 | 8-state machine + transition rules + event emission |
| `positionEvents.js` | `server/services/positionEvents.js` | ~150 | Append-only event journal helper (insert + query) |
| `recoveryBoot.js` | `server/services/recoveryBoot.js` | ~300 | PM2 startup: scan exchange → reconcile → verify SL → lift halt |
| `timeSyncAssert.js` | `server/services/timeSyncAssert.js` | ~100 | NTP drift check every 5min + alert |
| `pnlReconCron.js` | `server/cron/pnlReconCron.js` | ~200 | Daily PnL reconciliation 02:00 UTC |
| Migration | `server/migrations/0XX_bybit_exchange_columns.js` | ~150 | Schema additions + backfill |
| Migration | `server/migrations/0XX_position_events_table.js` | ~80 | New table |
| Migration | `server/migrations/0XX_at_positions_orphaned_table.js` | ~80 | New table |

**Total new LOC estimate:** ~3500 LOC code + ~3000 LOC tests = ~6500 LOC.

---

## 4. Critical Code Patterns

### 4.1 Position State Machine

States:
```
PENDING      → entry order sent, awaiting fill
OPENING      → entry filled, SL/TP placement in progress
OPEN         → entry + SL fully placed and verified
CLOSING      → close order sent, awaiting fill
CLOSED       → fully closed, PnL realized
ORPHANED     → user disconnected exchange while position open; Zeus no longer manages
RECOVERING   → boot scan: state being reconciled with exchange real state
EMERGENCY    → emergency close triggered (SL placement catastrophic failure)
```

Transition rules (valid edges only):
```
PENDING    → OPENING | CANCELLED   (entry fill or reject)
OPENING    → OPEN | EMERGENCY      (SL placed or SL retry exhausted)
OPEN       → CLOSING | EMERGENCY   (operator close, SL trigger, brain close)
CLOSING    → CLOSED                (close fill)
RECOVERING → OPEN | EMERGENCY | ORPHANED  (post-boot reconciliation)
EMERGENCY  → CLOSING | CLOSED      (operator manual resolve)
ORPHANED   → CLOSED                (operator manually closed on exchange, recon detects)
```

Implementation: `at_positions.status` column extended with new states. State change calls `positionStateMachine.transition(seq, from, to, eventPayload)` which:
1. Validates transition is in allowed edge set
2. Updates `at_positions.status` atomically
3. Appends `position_events` row with from/to/payload/ts/cycle_no

### 4.2 exchangeOps placeEntry flow (Binance case)

```js
// Pseudocode — actual implementation in binanceOps.placeEntry
async function placeEntry_Binance(uid, params) {
  // 1. Hard SL guard (also in exchangeOps.placeEntry wrapper but defense in depth)
  if (creds.mode === 'live' && !validateSL(params.sl)) {
    throw new CanonicalError({ code: 'ErrInvalidParams', message: 'SL required on LIVE' })
  }

  // 2. Order lock acquire (10s timeout)
  const lockKey = `${uid}|${params.symbol}`
  const lock = await orderLock.acquire(lockKey, 10_000)
  if (!lock) throw new CanonicalError({ code: 'ErrLockTimeout' })

  // 3. Create PENDING row + position_events
  const seq = db.insertAtPosition({
    user_id: uid, symbol: params.symbol, side: params.side, qty: params.qty,
    exchange: 'binance', status: 'PENDING', data: {...}
  })
  positionEvents.append(seq, null, 'PENDING', { decisionKey: params.decisionKey, source: params.source })

  try {
    // 4. ensureSymbolReady (cached 5min)
    await exchangeOps.ensureSymbolReady(uid, { symbol: params.symbol, leverage: params.leverage, marginMode: 'CROSSED' })

    // 5. Entry order
    const entryResp = await sendSignedRequest('POST', '/fapi/v1/order', {
      symbol: params.symbol, side: sideToBinance(params.side),
      type: params.entryType, quantity: params.qty,
      newClientOrderId: params.decisionKey, ...
    }, creds)

    if (entryResp.status !== 'FILLED') {
      positionStateMachine.transition(seq, 'PENDING', 'CANCELLED', { reason: entryResp })
      return { ok: false, error: translateError(entryResp) }
    }

    positionStateMachine.transition(seq, 'PENDING', 'OPENING', { entryOrderId: entryResp.orderId, fillPrice: entryResp.avgPrice })

    // 6. SL placement with retry (3 attempts)
    let slOrderId = null
    for (let i = 0; i < 3; i++) {
      try {
        const slResp = await sendSignedRequest('POST', '/fapi/v1/order', {
          symbol: params.symbol, side: oppositeSide(params.side),
          type: 'STOP_MARKET', stopPrice: params.sl.price,
          closePosition: 'true', reduceOnly: 'true',
          newClientOrderId: `sl_${params.decisionKey}_${i}`
        }, creds)
        slOrderId = slResp.orderId
        break
      } catch (err) {
        if (i === 2) {
          // EMERGENCY close path
          const closeResult = await _emergencyClose(uid, params.symbol, params.qty, params.decisionKey, params.side)
          positionStateMachine.transition(seq, 'OPENING', 'EMERGENCY', { reason: 'SL_PLACEMENT_FAILED', closeResult })
          if (!closeResult.ok) {
            // Catastrophic — persist to emergency_close_queue + PANIC halt + Telegram CRITICAL
            db.insertEmergencyCloseTask({ uid, symbol: params.symbol, qty: params.qty, decisionKey: params.decisionKey, exchange: 'binance' })
            serverAT.setGlobalHalt(uid, true, 'EMERGENCY_CLOSE_CATASTROPHIC')
            telegram.alertCritical(uid, `🚨 CATASTROPHIC: ${params.symbol} position cannot close. Manual intervention NOW.`)
          }
          return { ok: false, error: { code: 'ErrSlPlacementFailed' }, catastrophic: !closeResult.ok }
        }
        await sleep([200, 1000, 3000][i])
      }
    }

    // 7. TP placement (optional, 1 retry)
    let tpOrderId = null
    if (params.tp) {
      try {
        const tpResp = await sendSignedRequest('POST', '/fapi/v1/order', { ...tp params... }, creds)
        tpOrderId = tpResp.orderId
      } catch (err) { /* TP failure is warning, not blocking */ }
    }

    // 8. Transition to OPEN
    positionStateMachine.transition(seq, 'OPENING', 'OPEN', { slOrderId, tpOrderId })

    return {
      ok: true, orderId: entryResp.orderId, clientOrderId: params.decisionKey,
      status: 'FILLED', filledQty: entryResp.executedQty, avgFillPrice: entryResp.avgPrice,
      slOrderId, tpOrderId, ts: Date.now(), rawExchange: 'binance'
    }

  } finally {
    orderLock.release(lockKey)
  }
}
```

### 4.3 exchangeOps placeEntry (Bybit case — atomic)

```js
async function placeEntry_Bybit(uid, params) {
  // Same hard SL guard, order lock acquire, PENDING row create...

  try {
    await exchangeOps.ensureSymbolReady(uid, { symbol: params.symbol, leverage: params.leverage, marginMode: 'CROSSED' })

    // SINGLE atomic call — entry + SL + TP in order body
    const resp = await bybitSigner.sendSignedRequest('POST', '/v5/order/create', {
      category: 'linear',
      symbol: params.symbol,
      side: sideToBybit(params.side), // 'Buy' or 'Sell'
      orderType: bybitOrderType(params.entryType), // 'Market' or 'Limit'
      qty: params.qty,
      stopLoss: params.sl.price,
      slTriggerBy: 'LastPrice',
      takeProfit: params.tp?.price,
      tpTriggerBy: params.tp ? 'LastPrice' : undefined,
      orderLinkId: params.decisionKey,
      ...
    }, creds)

    if (resp.retCode !== 0) {
      positionStateMachine.transition(seq, 'PENDING', 'CANCELLED', { reason: resp })
      return { ok: false, error: translateBybitError(resp) }
    }

    // Atomically: entry placed, SL+TP attached to position
    positionStateMachine.transition(seq, 'PENDING', 'OPEN', {
      entryOrderId: resp.result.orderId,
      slOrderId: resp.result.stopOrderId, // Bybit returns this in result
      tpOrderId: resp.result.tpOrderId,
    })

    return { ok: true, orderId: resp.result.orderId, ..., rawExchange: 'bybit' }
  } finally {
    orderLock.release(lockKey)
  }
}
```

### 4.4 Switch transition (explicit barrier)

```js
// In routes/exchange.js POST /api/exchange/save
async function saveExchangeHandler(req, res) {
  const uid = req.user.id
  const newExchange = req.body.exchange // 'binance' | 'bybit'
  const currentActive = await getActiveExchange(uid)

  // Block switch with open positions
  if (currentActive && currentActive !== newExchange) {
    const openCount = db.prepare(`SELECT COUNT(*) FROM at_positions WHERE user_id=? AND exchange=? AND status IN ('PENDING','OPENING','OPEN','CLOSING','EMERGENCY')`).get(uid, currentActive)
    if (openCount.count > 0) {
      return res.status(409).json({ error: 'POSITIONS_OPEN', message: `Cannot switch — ${openCount.count} positions open on ${currentActive}. Close them first.` })
    }
  }

  // Save creds (verify first — pillar 14)
  const verifyResult = await verifyBybitCreds(req.body.apiKey, req.body.apiSecret, req.body.mode)
  if (!verifyResult.ok) {
    return res.status(401).json({ error: verifyResult.error, message: verifyResult.message })
  }
  await credentialStore.saveExchangeCreds(uid, newExchange, { ... })

  // SET pending switch (explicit barrier — NOT lazy invalidation)
  _pendingSwitch.set(uid, { from: currentActive, to: newExchange, requestedAt: Date.now() })

  return res.json({ ok: true, status: 'pending', willApplyWithinMs: CYCLE_INTERVAL_MS })
}

// In serverBrain.js _runCycle
function _runCycle() {
  if (_running) return
  if (!brainLock.acquire('brainCycle')) return
  _running = true

  // Apply pending switches BEFORE iterating users (explicit barrier)
  for (const [uid, switchInfo] of _pendingSwitch.entries()) {
    _userExchangeCache.set(uid, switchInfo.to)
    feedManager.deactivateForUser(uid, switchInfo.from)
    feedManager.activateForUser(uid, switchInfo.to)
    db.auditLog('EXCHANGE_SWITCH_APPLIED', { uid, from: switchInfo.from, to: switchInfo.to, requestedAt: switchInfo.requestedAt, appliedAt: Date.now(), cycleNo: _cycleCount })
    _pendingSwitch.delete(uid)
  }

  // Now iterate users with fresh routing
  for (const [uid, stc] of _stcMap) {
    const userExchange = _userExchangeCache.get(uid) || _refreshUserExchange(uid)
    const userState = serverState.forExchange(userExchange)
    for (const symbol of userState.getReadySymbols()) {
      const snap = userState.getSnapshotForSymbol(symbol)
      // ... brain decision logic
      db.insertBrainDecision({ ..., exchange: userExchange, cycleNo: _cycleCount })
    }
  }
}
```

### 4.5 Recovery boot deterministic

```js
// In server/index.js (boot sequence)
async function bootRecovery() {
  serverAT.setGlobalHalt(null, true, 'BOOT_RECOVERY_IN_PROGRESS') // halt all

  const activeAccounts = db.prepare(`SELECT user_id, exchange, mode FROM exchange_accounts WHERE is_active=1`).all()

  for (const acc of activeAccounts) {
    // 1. Get real positions from exchange
    const livePositions = await exchangeOps.getPositions(acc.user_id, { exchangeOverride: acc.exchange })

    // 2. Get DB positions for this user/exchange
    const dbPositions = db.prepare(`SELECT * FROM at_positions WHERE user_id=? AND exchange=? AND status NOT IN ('CLOSED','ORPHANED','CANCELLED')`).all(acc.user_id, acc.exchange)

    // 3. Reconcile each DB position
    for (const dbPos of dbPositions) {
      positionStateMachine.transition(dbPos.seq, dbPos.status, 'RECOVERING', { reason: 'boot_scan' })

      const symbol = JSON.parse(dbPos.data).symbol
      const livePos = livePositions.find(p => p.symbol === symbol && p.side === JSON.parse(dbPos.data).side)

      if (!livePos || livePos.side === 'FLAT') {
        // DB says open but exchange says closed — was closed externally
        positionStateMachine.transition(dbPos.seq, 'RECOVERING', 'CLOSED', { reason: 'closed_externally_pre_boot' })
        continue
      }

      // Position exists — verify SL
      const openOrders = await exchangeOps.getOpenOrders(acc.user_id, { symbol, exchangeOverride: acc.exchange })
      const slPresent = openOrders.some(o => o.isStopLoss && o.symbol === symbol)

      if (!slPresent && JSON.parse(dbPos.data).mode === 'live') {
        // CATASTROPHIC: live position without SL post-restart
        const placeResult = await exchangeOps.placeStopLoss(acc.user_id, { symbol, side: dbPos.side, qty: livePos.qty, slPrice: JSON.parse(dbPos.data).sl })
        if (!placeResult.ok) {
          positionStateMachine.transition(dbPos.seq, 'RECOVERING', 'EMERGENCY', { reason: 'SL_MISSING_POST_BOOT' })
          telegram.alertCritical(acc.user_id, `🚨 Position ${symbol} found on exchange without SL after restart. Emergency placement failed. Manual intervention NOW.`)
        } else {
          positionStateMachine.transition(dbPos.seq, 'RECOVERING', 'OPEN', { slOrderId: placeResult.slOrderId })
        }
      } else {
        positionStateMachine.transition(dbPos.seq, 'RECOVERING', 'OPEN', { slPresent: true })
      }
    }

    // 4. Adopt any external positions
    for (const livePos of livePositions) {
      const symbol = livePos.symbol
      const existing = dbPositions.find(p => JSON.parse(p.data).symbol === symbol)
      if (!existing && livePos.side !== 'FLAT') {
        // External position — adopt
        await exchangeOps._syncExternalPosition({ user_id: acc.user_id, exchange: acc.exchange, ...livePos })
      }
    }
  }

  serverAT.setGlobalHalt(null, false, 'BOOT_RECOVERY_COMPLETE')
  db.auditLog('BOOT_RECOVERY_COMPLETE', { ts: Date.now() })
  logger.info('BOOT', 'Recovery complete — trading resumed')
}
```

---

## 5. Migration Strategy

### 5.1 Schema migrations (additive only)

```sql
-- Migration 1: Exchange columns on existing tables
ALTER TABLE at_positions ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance';
ALTER TABLE at_closed ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance';
ALTER TABLE brain_decisions ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance';
ALTER TABLE feature_proposals ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance';
ALTER TABLE brain_parity_log ADD COLUMN exchange TEXT NOT NULL DEFAULT 'binance';

CREATE INDEX idx_at_positions_user_exchange_status ON at_positions(user_id, exchange, status);
CREATE INDEX idx_at_closed_user_exchange_ts ON at_closed(user_id, exchange, closed_at);
CREATE INDEX idx_brain_decisions_user_exchange_ts ON brain_decisions(user_id, exchange, ts);

-- Defensive backfill (DEFAULT covers but explicit anyway)
UPDATE at_positions SET exchange='binance' WHERE exchange IS NULL OR exchange='';
UPDATE at_closed SET exchange='binance' WHERE exchange IS NULL OR exchange='';
UPDATE brain_decisions SET exchange='binance' WHERE exchange IS NULL OR exchange='';

-- Migration 2: Position state machine column (extended status enum)
-- at_positions.status TEXT already exists; just expand allowed values
-- Existing rows OPEN/CLOSED remain unchanged; new rows use new states

-- Migration 3: position_events journal
CREATE TABLE position_events (
  id INTEGER PRIMARY KEY,
  position_seq INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  exchange TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  cycle_no INTEGER,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_position_events_position ON position_events(position_seq, ts);
CREATE INDEX idx_position_events_user_ts ON position_events(user_id, ts);

-- Migration 4: at_positions_orphaned
CREATE TABLE at_positions_orphaned (
  seq INTEGER PRIMARY KEY,
  original_at_positions_seq INTEGER,
  user_id INTEGER NOT NULL,
  exchange TEXT NOT NULL,
  data TEXT NOT NULL,
  disconnected_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT
);
CREATE INDEX idx_orphaned_user_exchange ON at_positions_orphaned(user_id, exchange, disconnected_at);

-- Migration 5: emergency_close_queue (persistence only, no auto-worker per simplified Phase 1A)
CREATE TABLE emergency_close_queue (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  qty TEXT NOT NULL,
  decisionKey TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT
);

-- Migration 6: bybit_rate_state
CREATE TABLE bybit_rate_state (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  used_weight INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL,
  banned_until INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT,
  last_request_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_bybit_rate_state_user ON bybit_rate_state(user_id);
```

### 5.2 Backup discipline

Before any migration is applied in production:
```bash
# 1. Stop PM2
pm2 stop zeus

# 2. Backup DB (file copy)
cp /root/zeus-terminal/data/zeus.db /root/zeus-terminal/data/zeus.db.pre-bybit-migration-$(date +%Y%m%d-%H%M)

# 3. Apply migration via node
cd /root/zeus-terminal && node -e "require('./server/migrations/run').run()"

# 4. Verify
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM at_positions WHERE exchange IS NULL"  # expect 0
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT exchange, COUNT(*) FROM at_positions GROUP BY exchange"  # expect binance:N, no nulls

# 5. Restart PM2
pm2 start zeus
```

### 5.3 Rollback plan

Each migration has a DOWN script. Target RTO: <5 minutes.

```bash
# Rollback procedure:
pm2 stop zeus
cp /root/zeus-terminal/data/zeus.db /root/zeus-terminal/data/zeus.db.failed-rollback-$(date +%Y%m%d-%H%M)
cp /root/zeus-terminal/data/zeus.db.pre-bybit-migration-YYYYMMDD-HHMM /root/zeus-terminal/data/zeus.db
git checkout <commit-before-1A>
cd /root/zeus-terminal/client && npm run build
pm2 start zeus
# Verify: pm2 logs zeus --lines 30 | grep -i error  → should be clean
```

Rollback drilled 3 times on staging before production deploy. Chronometer measured.

---

## 6. Rollout Phases

### Phase 1A: Data feeds (~25-30h work)

1. Migration 1+3+4 (schema)
2. `feedManager.js` + `bybitFeed.js` modules
3. `serverState.js` extended with `forExchange(name)` router
4. `serverBrain.js _runCycle` loop swap (user outer, symbol inner) + explicit barrier switch
5. `positionStateMachine.js` + `positionEvents.js`
6. Tests: contract test, feed normalization, per-user routing, multi-user cleanup

Acceptance:
- Bybit WS feed connects + receives messages for 4 symbols
- User on Bybit: brain reads from bybitFeed, not Binance
- User on Binance: unchanged behavior
- Brain decisions stamped with exchange
- 100% contract test pass on both feeds
- Multi-user test: user X disconnect Binance, user Y still active Binance → Binance feed stays alive
- Soak test 24h on testnet: zero feed crashes

### Phase 1B: Order routes (~25-30h work)

1. Migration 2+5+6 (schema)
2. `exchangeOps.js` + `binanceOps.js` + `bybitOps.js`
3. `bybitRateState.js`
4. `recoveryBoot.js`
5. `timeSyncAssert.js`
6. `pnlReconCron.js`
7. Refactor existing call sites (~30 in routes/serverAT) from `sendSignedRequest('/fapi/v1/order')` to `exchangeOps.placeEntry()`
8. Tests: shared contract for exchangeOps, per-adapter unit tests, parity tests on testnet live

Acceptance:
- Bybit testnet trade: place entry + SL + close + verify all states transitions
- Binance flow: regression — identical to pre-1A behavior
- Hard SL guard tested: brain attempt entry without SL on LIVE → exchangeOps throws
- Emergency close path tested: simulated SL retry exhaustion → emergency close triggers + queue inserted + PANIC halt
- Recovery boot tested: kill PM2 mid-position, restart, verify SL detected/placed correctly
- Time sync test: simulate 1s drift → alert fires
- PnL recon test: known divergence → alert + audit

### Phase 1C (deferred): UI polish, switching UX advanced

### Phase 1D (deferred): Burn-in monitoring + observability dashboards

### Phase 1E (deferred separate spec): BYBIT_DRY_RUN_ONLY → false (live flip)

Criteria TBD (~7 days testnet burn-in, zero safety violations, 50+ trades, parity divergence <0.5%).

---

## 7. Risk Register

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Brain `_runCycle` loop swap (user outer) breaks existing per-symbol logic | Medium | High | Audit `serverBrain.js` exhaustively (cerința A) before loop swap. Test 24h soak. Branch-isolated. |
| R2 | Bybit WS data shape divergence from translator assumptions | Medium | Medium | Shadow logging EARLY surfaces divergences pre-flip. Contract tests assert canonical shape. |
| R3 | DB migration corrupts existing data | Low | High | Backup before migration (mandatory). Verify queries post-migration. Rollback drill 3x on staging. |
| R4 | Position state machine transition gap (forgotten edge) | Medium | High | TDD strict — every transition tested. position_events journal allows post-mortem. Initial deploy with extra-conservative state checks. |
| R5 | Bybit V5 API quirks not anticipated (e.g., position mode change with open positions) | High | Medium | Test on testnet first with full edge case suite. translator + signer already exist (S4-B0-B4). ensureSymbolReady handles "already set" errors gracefully. |
| R6 | Recovery boot misclassifies position state | Low | Critical | Multi-step verification: scan exchange → match DB → verify SL → only then OPEN state. Catch-all = ORPHANED + alert. |
| R7 | NTP drift causes signed request failures | Low | Medium | timeSyncAssert detects + alerts. Test by manually skewing clock. |

---

## 8. Server-Truth Invariants (Rule 0)

Enforced throughout this design:

1. All exchange state is per `req.user.id` — never global, never hardcoded for a user.
2. Display data ALWAYS comes from server via `exchangeOps.*` endpoints — no client-side faked balance/status/maskedKey/lastVerified.
3. The mutual-exclusion policy (one active exchange max per user) is enforced server-side via 409 EXCHANGE_CONFLICT.
4. localStorage stores ONLY UX preferences (theme, font size, layout collapse state). Never authoritative state (engine mode, AT armed, positions).
5. brain_decisions and position_events are the SOURCE OF TRUTH for what happened. Recon validates against these.
6. position_events append-only — never UPDATE or DELETE. Insert-only ledger.

---

## 9. Appendix: Canonical API

### exchangeOps public methods

```typescript
exchangeOps.placeEntry(uid: number, params: EntryParams): Promise<EntryResult>
exchangeOps.closePosition(uid: number, params: CloseParams): Promise<CloseResult>
exchangeOps.ensureSymbolReady(uid: number, params: { symbol, leverage, marginMode }): Promise<{ ok, leverage, marginMode }>
exchangeOps.getPositions(uid: number, params?: { symbol?, exchangeOverride? }): Promise<Position[]>
exchangeOps.getBalance(uid: number): Promise<Balance>
exchangeOps.getUserTrades(uid: number, params: { symbol, startTime?, limit? }): Promise<Trade[]>
exchangeOps.ping(uid: number): Promise<{ ok, latencyMs }>
exchangeOps.cancelOrder(uid: number, params: { symbol, orderId }): Promise<{ ok, status }>
exchangeOps.invalidateReady(uid: number, symbol: string): void
exchangeOps.placeStopLoss(uid: number, params: { symbol, side, qty, slPrice }): Promise<{ ok, slOrderId, error? }>  // for recovery boot
```

### CanonicalError enum

```typescript
type CanonicalErrorCode =
  | 'ErrInvalidParams'
  | 'ErrAuthFailed'
  | 'ErrInsufficientBalance'
  | 'ErrInvalidSymbol'
  | 'ErrLotSize'
  | 'ErrMinNotional'
  | 'ErrLeverageInvalid'
  | 'ErrPositionExists'
  | 'ErrOrderNotFound'
  | 'ErrRateLimit'
  | 'ErrIpBan'
  | 'ErrSlPlacementFailed'
  | 'ErrTpPlacementFailed'
  | 'ErrDuplicate'
  | 'ErrLockTimeout'
  | 'ErrNetwork'
  | 'ErrTimeSyncDrift'
  | 'ErrUnknown'

type CanonicalError = {
  code: CanonicalErrorCode
  message: string
  rawCode?: string | number
  rawMessage?: string
}
```

### Position canonical shape

```typescript
type Position = {
  symbol: string                    // 'BTCUSDT'
  side: 'LONG' | 'SHORT' | 'FLAT'
  qty: string                       // absolute value
  entryPrice: string
  markPrice: string
  unrealizedPnL: string
  liquidationPrice: string | null
  leverage: number
  marginMode: 'CROSSED' | 'ISOLATED'
  positionMode: 'one-way' | 'hedge'
  rawExchange: 'binance' | 'bybit'
}
```

### decisionKey canonical regex

`^[a-zA-Z0-9_-]{1,36}$` — intersection of Binance newClientOrderId and Bybit orderLinkId allowed characters.

### Audit log action labels (new)

- `EXCHANGE_SWITCH_REQUESTED` { uid, from, to }
- `EXCHANGE_SWITCH_APPLIED` { uid, from, to, requestedAt, appliedAt, cycleNo }
- `EXCHANGE_SWITCH_BLOCKED` { uid, attemptedExchange, reason: 'POSITIONS_OPEN', openCount }
- `BYBIT_CREDS_VERIFIED` { uid, mode, latencyMs }
- `BYBIT_CREDS_FAILED` { uid, mode, error }
- `POSITION_STATE_TRANSITION` { seq, uid, exchange, from, to, payload }
- `EMERGENCY_CLOSE_TRIGGERED` { uid, symbol, exchange, reason, attemptNo }
- `EMERGENCY_CLOSE_CATASTROPHIC` { uid, symbol, exchange, attempts }
- `BOOT_RECOVERY_STARTED` { ts }
- `BOOT_RECOVERY_COMPLETE` { ts, durationMs, positionsScanned, orphansAdopted, slPlacements }
- `BOOT_RECOVERY_FAILED` { ts, error, affectedUsers }
- `TIME_SYNC_DRIFT_DETECTED` { driftMs, severity }
- `PNL_RECON_DIVERGENCE` { uid, exchange, dbPnL, exchangePnL, divergence }
- `SHADOW_LOG_DIVERGENCE` { symbol, binanceDecision, bybitWouldHaveDone, divergencePct }

---

## End of Spec

**Next step:** Operator reviews this spec. If approved, transition to `superpowers:writing-plans` skill for implementation plan (~80-100 task-uri TDD bite-sized, branch `bybit-phase-1ab`). Backup discipline applied before any code touches DB.
