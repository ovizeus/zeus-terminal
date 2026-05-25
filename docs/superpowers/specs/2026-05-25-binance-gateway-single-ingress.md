# Binance Gateway — Single Ingress Architecture

> **Status:** APPROVED 2026-05-25
> **Operator:** Ovi (wsov2@protonmail.com)
> **Priority:** CRITICAL — 418 IP ban cycle active, 5 bans in 24h

## Problem

Zeus Terminal has **16+ independent Binance callers** (server + client) creating:
- 9+ duplicate data fetches (same data fetched by multiple modules)
- ~80 req/min server-side + untracked client-side calls
- Reconnect cascade on WS drop (multiple modules reconnect independently)
- 418 IP bans from Binance (escalating from 429 to hard IP ban)

## Target Architecture

```
BINANCE (single TCP point of contact)
    ↓
binanceGateway.js (Layer 1 — SOLE caller)
    ├─ 1 combined WS connection (existing)
    ├─ 1 REST scheduler (rate-aware, token bucket)
    └─ reconnect manager (single, backoff + jitter)
    ↓
marketCache.js (Layer 2 — shared cache)
    ├─ klines[symbol][tf] — TTL 60s
    ├─ ticker24h[symbol] — TTL 60s (all 300 from 1 call)
    ├─ oi[symbol] — TTL 120s
    ├─ funding[symbol] — TTL 300s
    ├─ depth[symbol] — TTL 60s
    ├─ sentiment[symbol] — TTL 300s
    └─ time — TTL 300s
    ↓
ALL CONSUMERS (Layer 3 — read from cache only)
    ├─ marketFeed → klines, price (WS fanout)
    ├─ marketRadar → ticker24h, oi, funding (cache reads)
    ├─ serverLiquidity → depth (cache reads)
    ├─ serverSentiment → sentiment, funding (cache reads)
    ├─ serverBrain → indicators from serverState (unchanged)
    ├─ serverAT → positions, orders (signed — stays direct)
    └─ CLIENT → ZERO direct Binance calls, reads via Zeus API/WS
```

## Phase 1: Emergency — Kill Client Direct Calls + Merge Server Duplicates

### 1A. Client: Remove ALL direct Binance REST calls

**Files to modify:**
- `client/src/data/marketDataChart.ts` — klines fetch → use server WS kline events
- `client/src/data/marketDataFeeds.ts` — RSI/ATR/OI/LS fetch → use server API
- `client/src/data/klines.ts` — scanner klines → use server API
- `client/src/data/basisRate.ts` — premiumIndex → use server API
- `client/src/data/onChainMetrics.ts` — weekly/daily klines → proxy through server
- `client/src/utils/guards.ts` — time sync → use server time from WS
- `client/src/services/symbols.ts` — ticker24hr → use radar broadcast data
- `client/src/hooks/useMarketData.ts` — klines → already from server WS

**Pattern:** Replace `fetch('https://fapi.binance.com/...')` with `fetch('/api/market/...')` (server proxy) or use existing WS data.

### 1B. Server: Merge duplicate pollers

**Funding rate:** marketRadar + marketFeed + serverSentiment all fetch independently.
→ Single fetch in marketRadar (already fetches all), cache result, others read from cache.

**Open Interest:** marketRadar + marketFeed both fetch.
→ Single fetch in marketRadar, cache result.

**Implementation:** `marketCache.js` — simple in-memory Map with TTL.

### 1C. Server: Add proxy endpoints for client

New routes at `/api/market/`:
- `GET /api/market/klines?symbol=X&tf=Y&limit=Z` — reads from serverState or fetches once
- `GET /api/market/ticker` — returns cached radar ticker24hr data
- `GET /api/market/oi?symbol=X` — returns cached OI
- `GET /api/market/sentiment?symbol=X` — returns cached L/S ratios
- `GET /api/market/time` — returns server time (no Binance call)

## Phase 2: Market Data Bus — Gateway + Cache

### binanceGateway.js (NEW)

Single module that owns ALL Binance communication:
- **WS:** Manages the combined stream (existing `_combinedWs` in marketFeed — moved here)
- **REST:** All REST calls go through gateway's token bucket rate limiter
- **Reconnect:** Single reconnect manager with exponential backoff + jitter
- **Deduplication:** If 7 modules request BTCUSDT klines simultaneously, 1 request serves all 7

**Exports:**
- `subscribe(streams[])` — WS subscription
- `fetchREST(url, opts)` — rate-limited REST with dedup
- `onData(streamName, handler)` — WS data fanout

### marketCache.js (NEW)

Central cache with TTL per data type:

```javascript
const CACHE = {
    klines: new Map(),      // key: `${symbol}:${tf}` → { bars, ts, ttl: 60s }
    ticker24h: new Map(),   // key: symbol → { data, ts, ttl: 60s }
    oi: new Map(),          // key: symbol → { value, ts, ttl: 120s }
    funding: new Map(),     // key: symbol → { rate, ts, ttl: 300s }
    depth: new Map(),       // key: symbol → { bids, asks, ts, ttl: 60s }
    sentiment: new Map(),   // key: symbol → { ls, topLs, taker, ts, ttl: 300s }
    time: { serverTime: 0, ts: 0, ttl: 300s },
}

// Smart getter: returns cache if fresh, else schedules ONE fetch via gateway
function get(type, key) { ... }
function set(type, key, data) { ... }
function subscribe(type, key, handler) { ... } // pub/sub for real-time updates
```

**Request deduplication:** If `get('oi', 'BTCUSDT')` is called while a fetch is in-flight, the second caller gets a Promise that resolves with the same result. No duplicate request.

### Consumer migration

Each module changes from:
```javascript
// BEFORE: direct Binance call
const res = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT')
```
to:
```javascript
// AFTER: cache read
const oi = marketCache.get('oi', 'BTCUSDT')
```

## Phase 3: Smart Rate Control

- **Token bucket:** 2400 weight/min budget, distributed across request types
- **Priority lanes:** P0 (orders) > P1 (recon) > P2 (market data) > P3 (analytics)
- **Stale-while-revalidate:** Return cached data immediately, refresh in background
- **Circuit breaker:** On 429/418, stop ALL non-P0 requests for cooldown period
- **Adaptive backoff:** Reduce polling frequency proportional to error rate

## Request Budget (Post-Migration)

| Source | Requests/min | Weight/min |
|--------|-------------|------------|
| Gateway WS (1 connection) | 0 REST | 0 |
| ticker24hr (1 call, all 300) | 1 | 40 |
| OI top 10 (cached, stale-while-revalidate) | ~2 | 2 |
| Funding (cached 5min) | 0.2 | 0.2 |
| Depth 4 symbols | 4 | 8 |
| Kline polls 4×3 (60s) | 12 | 12 |
| Sentiment (5min) | ~1 | 1 |
| Time sync (5min) | 0.2 | 0.2 |
| **TOTAL** | **~20** | **~63** |
| Client direct | **0** | **0** |

vs current: ~80+ server + untracked client = **75%+ reduction**

## File Map

| File | Action | Phase |
|------|--------|-------|
| `server/services/marketCache.js` | CREATE | 1B |
| `server/routes/market.js` | CREATE (proxy endpoints) | 1C |
| `server/services/marketRadar.js` | MODIFY (write to cache) | 1B |
| `server/services/marketFeed.js` | MODIFY (read funding/OI from cache) | 1B |
| `server/services/serverLiquidity.js` | MODIFY (write depth to cache) | 1B |
| `server/services/serverSentiment.js` | MODIFY (read funding from cache) | 1B |
| `client/src/data/marketDataChart.ts` | MODIFY (use server API) | 1A |
| `client/src/data/marketDataFeeds.ts` | MODIFY (use server API) | 1A |
| `client/src/data/basisRate.ts` | MODIFY (use server API) | 1A |
| `client/src/utils/guards.ts` | MODIFY (use server time) | 1A |
| `server/services/binanceGateway.js` | CREATE | 2 |
| `server.js` | MODIFY (mount market routes) | 1C |

## Constraints

- Signed requests (orders, balance, positions) stay direct — NOT through cache
- WS combined stream stays in marketFeed for now (Phase 2 moves to gateway)
- Zero behavior change for consumers — same data, different source
- Each phase deploys independently
- Rollback: revert to direct calls if cache has bugs

## Testing

- Rate state stays 0|0|0 for 24h+ (no bans)
- All market data still flowing (indicators, radar, brain decisions)
- Client UI shows same data (no regressions)
- Latency: cache reads < 1ms vs REST 50-200ms (improvement)
