# WS Proxy Phase B — Enterprise Design Spec

**Author:** Claude Code (Termius) + Mobile Claude additions + Operator approval
**Date:** 2026-05-28
**Status:** APPROVED — awaiting implementation plan

---

## 1. Overview & Goals

Zeus Terminal receives live market data from Binance via WebSocket. Currently, the **browser** connects directly to `fstream.binance.com` — blocked by Hetzner DC firewall. Workaround `ALT_WS_FEEDS` polls via REST every 10-30s (delayed, wasteful).

**Goal:** Route ALL client Binance WS through the Zeus server. One server→Binance connection shared across all users and tabs. Enterprise-grade resilience for real-money trading.

**Non-goals:** Binary protocol (MessagePack), SharedWorker multi-tab, fuzz testing — deferred to Phase C.

---

## 2. Architecture

```
Browser tabs              Zeus Server                     Binance
     │                         │                             │
     │──/ws/sync (compressed)─→│                             │
     │  {subscribe:'BTCUSDT'}  │                             │
     │                   ┌─────┴──────┐                      │
     │                   │wsMarketProxy│                     │
     │                   │ ├─HealthMon │                     │
     │                   │ ├─CircuitBrk│                     │
     │                   │ ├─Backpress │                     │
     │                   │ ├─StaleTrade│                     │
     │                   │ ├─Metrics   │                     │
     │                   │ └─Fallback  │                     │
     │                   └─────┬──────┘                      │
     │                         │──wss://fstream.binance.com──│
     │                         │  (1 combined conn, shared)  │
     │                         │←───market data──────────────│
     │←─{seq,type,data}───────│                             │
```

**Key decisions:**
- Extend existing `/ws/sync` endpoint (no new WS endpoint)
- Shared streams: 1 Binance WS per symbol, broadcast to all subscribers
- Ref-counting: last subscriber leaves → unsubscribe from Binance
- permessage-deflate compression enabled
- `depth20@500ms` = full snapshot (NOT delta), cache last value

---

## 3. Message Protocol

### Client → Server

| Type | Payload | Notes |
|------|---------|-------|
| `market.subscribe` | `{symbol, streams?}` | Streams default: all (price, depth, kline, aggTrade, liq) |
| `market.unsubscribe` | `{symbol}` | Ref-count decrement |
| `market.subscribe.wl` | `{symbols: [...]}` | Watchlist (8 fixed symbols, miniTicker only) |

### Server → Client

| Type | Payload | Rate | Seq |
|------|---------|------|-----|
| `market.price` | `{symbol, price, fr, frCd, ts}` | ~1/s per sym | no |
| `market.depth` | `{symbol, bids, asks, ts}` | ~2/s per sym | no |
| `market.kline` | `{symbol, tf, bar:{time,o,h,l,c,v}, closed}` | ~1/s per sym/tf | yes |
| `market.aggTrade` | `{symbol, p, q, m, T}` | high freq | yes |
| `market.liq` | `{symbol, side, qty, price, exchange}` | event-driven | no |
| `market.wl` | `{symbol, price, chg}` | ~1/s per sym | no |
| `market.health` | `{symbol, status, lastEventTs}` | on change | no |
| `market.degraded` | `{symbol, mode:'REST', reason}` | on change | no |
| `market.recovered` | `{symbol, mode:'WS'}` | on change | no |
| `server.shutdown` | `{graceMs}` | once | no |
| `market.stale` | `{symbol, staleness_ms}` | on change | no |

**Sequence numbers:** Only on `market.kline` and `market.aggTrade` (ordering matters for chart/CVD). Counter per symbol×stream, monotonic. Client detects gap → triggers REST re-fetch.

---

## 4. Server Components

### 4.1 wsMarketProxy.js (core)

New module `server/services/wsMarketProxy.js`:

- **Binance connection manager:** 1 combined WS per active symbol group. Uses `?streams=` combined stream URL (like marketFeed.js pattern).
- **Subscription registry:** `Map<symbol, Set<wsClient>>` — ref-counted.
- **Watchlist:** Always-on stream for 8 watchlist symbols (miniTicker/bookTicker).
- **Broadcast:** Iterate subscribers per symbol, send JSON frame.
- **Last value cache:** `Map<streamKey, lastEvent>` — sent immediately on subscribe (no $0 gap).
- **Reconnect:** Exponential backoff 3s→60s with jitter. Ping every 3min (Binance timeout 5min).

### 4.2 Health Monitor (integrated in wsMarketProxy)

- `lastEventTs` + `lastChangeTs` per symbol per stream type
- Status: `LIVE` (event <10s) / `DEGRADED` (10-60s) / `OFFLINE` (>60s)
- **Stuck detection:** `lastChangeTs` unchanged >30s = STUCK (same price repeating)
- Broadcasts `market.health` on status change
- Endpoint: `GET /api/ws/health`

### 4.3 Circuit Breaker (reuse existing)

- Key: `ws:binance:<symbol>` per stream
- Trip: 5 reconnect failures in 60s → OPEN (pause 30s)
- Extended: 10 failures in 5min → OPEN (pause 5min)
- Half-open: 1 retry attempt after pause
- Log transitions to `ml_diagnostic_events`

### 4.4 Backpressure

- Per-client send buffer: max 100 messages
- 80% full: skip `market.depth` (least critical, highest freq)
- 100% full: drop oldest depth/aggTrade, keep price/health/stale
- Overflow >10s: disconnect with code 4001 `BACKPRESSURE_OVERFLOW`
- Metric: `ws.messages.dropped` per client

### 4.5 Stale Data Trade Blocker (ADD #15 — CRITICAL)

- Per-symbol staleness: `now - lastEventTs` tracked in wsMarketProxy
- Threshold: markPrice >10s old = STALE
- **Server enforcement:** `/api/order/place` returns HTTP 423 LOCKED if symbol STALE
  - Response: `{error: 'STALE_DATA', symbol, staleness_ms, threshold_ms: 10000}`
- **Client enforcement:** Disable submit button + red banner when `market.stale` received
- **Audit:** `STALE_TRADE_BLOCKED` event logged with symbol, staleness, uid
- **Bypass:** Never. Real money safety = absolute.

### 4.6 Graceful Shutdown (ADD #13)

- `SIGTERM` handler with 5s grace period
- Broadcast `{type:'server.shutdown', graceMs:5000}` to all clients
- Drain in-flight writes (pending message flush)
- Close Binance WS connections
- Client: on `server.shutdown`, wait `graceMs + random(0-3s)` then reconnect
- Logs: `WS_PROXY_SHUTDOWN_INITIATED`, `WS_PROXY_SHUTDOWN_COMPLETE`

### 4.7 Forced Reconcile on Recovery (ADD #18)

- On `market.recovered` event for any symbol:
  1. Brain PAUSED for affected symbol (correlationGuard temporary)
  2. Force REST sync: positions + balance + open orders
  3. Verify parity: Binance state matches Zeus DB
  4. Resume brain only after parity check pass
- Audit: `WS_RECOVERY_RECONCILE_START`, `WS_RECOVERY_RECONCILE_COMPLETE`
- Pattern mirrors existing `cac3a35` balance cache approach

### 4.8 Fallback REST

- If server→Binance WS down >60s for a stream:
  - Auto-switch to REST polling: klines 5s, ticker 5s, depth 5s
  - Broadcast `market.degraded` to clients
- On WS recovery:
  - Stop REST pollers
  - Broadcast `market.recovered`
  - Trigger forced reconcile (#18)

### 4.9 Metrics (wsMetrics.js)

New module `server/services/wsMetrics.js`:

**Counters:** streams.opened, streams.closed, messages.sent (per type), messages.dropped, reconnects, subscribes
**Gauges:** streams.active, subscribers.total, binance.uptime_ms
**Histograms:** event.latency_ms (Binance ts → broadcast ts)

Endpoint: `GET /api/ws/metrics` — JSON format. Telemetry log every 60s.

### 4.10 Auth & Rate Limits

- JWT already verified on `/ws/sync` connection — reused
- Subscribe rate limit: max 10/sec per client (reject with error frame)
- Symbol whitelist: validate against cached `exchangeInfo` symbols
- Max 20 concurrent symbol subscriptions per client
- Max 5 WS connections per user (existing limit)
- Pre-auth IP limit: max 10 pending connections per IP, handshake timeout 5s
- Auto-cleanup all subscriptions on client disconnect

---

## 5. Client Refactor

### 5.1 marketDataWS.ts

`connectBNB()` → subscribe `market.subscribe` on `/ws/sync`. Listen for:
- `market.price` → `w.ingestPrice()`, update `w.S.fr`, `w.S.frCd`
- `market.depth` → `w.S.bids`, `w.S.asks`, `renderOB()`
- `market.liq` → `procLiq()` (Binance liquidations)

Bybit WS stays direct (not blocked by Hetzner, different exchange).

### 5.2 marketDataChart.ts

`fetchKlines()` kline WS → listen `market.kline`. Apply bar update to chart.
REST init fetch (`/api/market/klines?limit=1000`) stays as-is for historical data.

### 5.3 orderflow.ts

`_initOrderflowP1()` aggTrade WS → listen `market.aggTrade`. Feed into `w.RAW_FLOW.buf[]`.

### 5.4 WatchlistBar.tsx + symbols.ts

Both → listen `market.wl` events. Remove dual-WS connection pattern.
`connectWatchlist()` becomes no-op (server handles watchlist stream).

### 5.5 Symbol switch

On `setSymbol(newSym)`:
1. Send `market.unsubscribe` for old symbol
2. Send `market.subscribe` for new symbol
3. Server ref-count handles Binance WS lifecycle

### 5.6 UI Components

- **WsHealthIndicator** in header: 🟢 LIVE / 🟡 DEGRADED / 🔴 OFFLINE
- **Stale banner** on Manual Trade: "⚠️ STALE DATA — trading paused"
- **Degraded toast** notification on fallback

---

## 6. Implementation Phases

### VAL 1 — Production Ready (real money safe)

| Phase | Scope | Est. | TDD |
|-------|-------|------|-----|
| B.1 | Core wsMarketProxy: Binance connect, subscribe/unsubscribe, ref-count, broadcast | 3h | ref-counting, subscribe protocol |
| B.2 | Resilience: circuit breaker, backpressure, reconnect, last value cache | 2h | circuit breaker, backpressure buffer |
| B.3 | Health monitor + stuck detection + /api/ws/health | 1.5h | staleness thresholds |
| B.4 | Auth, rate limits, symbol whitelist, per-user quotas | 1h | rate limit, quota |
| B.5 | Fallback REST auto-switch + recovery | 1.5h | fallback trigger, recovery flow |
| B.6 | Client refactor: 5 files migrate to server WS | 2h | — |
| B.7 | UI: WsHealthIndicator, stale banner, degraded toast | 1h | — |
| B.8 | ADD #15: Stale data trade blocker (server 423 + client disable) | 1.5h | stale detection, 423 response |
| B.9 | ADD #18: Forced reconcile on WS recovery | 1h | reconcile flow |
| B.10 | ADD #13: Graceful shutdown + reconnect stagger | 1h | shutdown broadcast, stagger timing |
| B.11 | Compression (permessage-deflate) + sequence numbers (kline/aggTrade) | 0.5h | — |
| B.12 | Testing: integration + chaos + load + Playwright | 2h | — |
| | **VAL 1 TOTAL** | **~18h** | |

### VAL 2 — Enterprise Scale (outlined, not specced)

| Phase | Scope | Est. |
|-------|-------|------|
| B.13 | Shadow validation: 1% client sample dual-stream XOR check, log divergence_ms/pct, 48h clean → deprecate old path | 1h |
| B.14 | Cross-exchange sanity: Binance vs Bybit markPrice divergence (>0.5% warn, >2% STALE+trade block). Feasible post-Val1 because Bybit WS now proxied too | 1.5h |
| B.15 | Replay buffer (100 events/stream for reconnect gap fill, kline+aggTrade only) | 2h |
| B.16 | Protocol versioning + structured correlation IDs | 1.5h |
| B.17 | Per-IP pre-auth limits + message size enforcement | 0.5h |
| | **VAL 2 TOTAL** | **~6.5h** |

---

## 7. Failure Modes & Recovery Matrix

| Failure | Detection | Response | Recovery |
|---------|-----------|----------|----------|
| Binance WS silent >10s | Health monitor | `market.health` DEGRADED | Auto-reconnect |
| Binance WS silent >60s | Health monitor | Fallback REST + `market.degraded` | Auto-recover on WS up |
| Binance WS close | `onclose` handler | Circuit breaker + reconnect | Exponential backoff |
| 5+ reconnect fails/60s | Circuit breaker | OPEN state, pause 30s | Half-open retry |
| Slow client | Buffer >80% | Drop depth/aggTrade | Client catches up |
| Client overflow >10s | Buffer 100% sustained | Disconnect 4001 | Client reconnects |
| Stale price >10s | Staleness tracker | Trade blocked (423) + banner | Auto-unblock on fresh data |
| PM2 reload | SIGTERM | Graceful shutdown broadcast | Staggered reconnect |
| Server crash | No SIGTERM | Clients detect close | Reconnect with jitter |

---

## 8. Testing Strategy

- **Unit:** ref-counting, circuit breaker states, backpressure buffer, staleness calculation, rate limiting
- **Integration:** 2 clients subscribe same symbol → both receive data; 1 disconnects → other still works; symbol switch → clean unsubscribe
- **Chaos:** Kill Binance WS mid-stream → fallback activates → recover → reconcile
- **Load:** 20 concurrent subscribers on 8 symbols (simulated)
- **Playwright:** UI health indicator, stale banner, degraded toast, chart updates live
- **Regression:** All existing tests (131 rate-limit + others) still pass

---

## 9. Rollback Plan

- Feature flag: `WS_PROXY_ENABLED` (default true after deploy)
- Rollback: set `WS_PROXY_ENABLED=false` + `ALT_WS_FEEDS=true` → PM2 reload
- Client detects flag via `/api/state` → falls back to direct Binance WS (old path)
- Rollback time: <30s

---

## 10. Migration Plan (ALT_WS_FEEDS Deprecation)

1. Deploy WS proxy (Val 1)
2. Soak 48h with `WS_PROXY_ENABLED=true`
3. If clean: set `ALT_WS_FEEDS=false` (no longer needed)
4. After 7d clean: remove ALT_WS_FEEDS code paths (cleanup)

---

## 11. Discipline Rules

- 1 commit per phase with tag `ws-proxy-B{N}-{date}`
- Backup DB before each phase
- TDD mandatory for: circuit breaker, backpressure, ref-counting, stale detector, trade blocker
- GO/NO-GO before each commit:
  - [ ] Tests green
  - [ ] Zero new ERROR in logs (5min)
  - [ ] Rate state clean (0/0/0)
  - [ ] Doctor HEALTHY
  - [ ] Playwright UI verified
- Wait operator approval between phases
