# SOURCE OF TRUTH MAP — Zeus Terminal Market Data

> **Created:** 2026-05-25
> **Rule:** NEVER add a new Binance caller without updating this map.
> **Violation = duplicate = ban cycle.**

## Data Ownership

| Data | Owner (SOLE fetcher) | Cache Key | TTL | Consumers (READ ONLY) |
|------|---------------------|-----------|-----|-----------------------|
| klines | marketFeed (ALT REST polls) | `{exch}:{sym}:{tf}` | 60s | serverState, serverBrain, chart (proxy), indicators, radar tfMetrics |
| ticker24h | marketRadar (`_pollTick`) | `{exch}:{sym}` | 60s | radar events, client watchlist (proxy), /api/market/top |
| funding | marketRadar (`_pollFunding`) | `{exch}:{sym}` | 300s | marketFeed, serverSentiment, basisRate (proxy), radar |
| oi | marketRadar (`_pollOI`) | `{exch}:{sym}` | 120s | marketFeed, radar OI events, client (proxy) |
| depth | serverLiquidity (`_pollDepth`) | `{exch}:{sym}` | 60s | serverBrain (liquidity), client (proxy) |
| sentiment | serverSentiment (`_pollAll`) | `{exch}:{sym}` | 300s | serverBrain (confluence), client (proxy) |
| time | SERVER (`Date.now()`) | — | — | client timeSync (proxy), timeSyncAssert |
| price | marketFeed (WS stream) | in-memory serverState | live | serverBrain, AT, DSL, client (WS) |
| trades | marketFeed (WS stream) | in-memory serverState | live | orderflow, CVD, client (WS) |

## NEVER Call Binance Directly

| Module | Status |
|--------|--------|
| marketFeed.fetchFunding | READS from cache (owner: marketRadar) |
| marketFeed.fetchOI | READS from cache (owner: marketRadar) |
| serverSentiment.funding | READS from cache (owner: marketRadar) |
| ALL client/src/*.ts | READS from /api/market/* proxy |

## Allowed Binance Callers (exhaustive)

| # | Module | What | Frequency |
|---|--------|------|-----------|
| 1 | marketFeed.js | WS combined stream + REST kline polls | WS live + REST 60s |
| 2 | marketRadar.js | ticker24h + premiumIndex + OI top 10 | 60s |
| 3 | serverLiquidity.js | depth 4 symbols | 60s |
| 4 | serverSentiment.js | LS ratios 4 symbols (NOT funding) | 5min |
| 5 | timeSyncAssert.js | /time | 5min |
| 6 | binanceSigner.js | Signed ops (orders, balance) | on-demand |
| 7 | exchange.js | Key verify | daily |

**TOTAL: 7 callers. No exceptions. Client = ZERO.**

## Request Budget

| Caller | Requests/min | Weight/min |
|--------|-------------|------------|
| marketFeed klines | 12 | 12 |
| marketRadar ticker | 1 | 40 |
| marketRadar OI | ~2 | 2 |
| marketRadar funding | 0.2 | 0.2 |
| serverLiquidity depth | 4 | 8 |
| serverSentiment LS | ~1.6 | ~2 |
| timeSyncAssert | 0.2 | 0.2 |
| **TOTAL** | **~21** | **~65** |
| Client direct | **0** | **0** |
