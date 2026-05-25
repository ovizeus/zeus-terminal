# Gateway Phase 2+3 — Unified Fetch + Smart Rate Control

> **Status:** APPROVED 2026-05-25
> **Builds on:** Phase 1 (marketCache + proxy + client kill)

## Goal

Replace duplicate `_telemFetch` wrappers in marketFeed + marketRadar with a single `gateway.fetch()` that integrates rateLimiter pre-flight gate + circuitBreaker per-endpoint + real header parsing on response. Every REST call to Binance goes through ONE function.

## Architecture

```
BEFORE (Phase 1):
  marketFeed._telemFetch()  → binanceTelemetry.wrapFetch → fetch
  marketRadar._telemFetch() → binanceTelemetry.wrapFetch → fetch
  serverLiquidity           → binanceTelemetry.wrapFetch → fetch
  (3 independent wrappers, no rate/circuit awareness)

AFTER (Phase 2+3):
  ALL modules → gateway.fetch(url, opts)
    ├─ rateLimiter.canFetch(pool, weight) pre-flight
    ├─ circuitBreaker.canRequest(exchange, endpoint) pre-flight
    ├─ binanceTelemetry.wrapFetch (existing quota tracking)
    ├─ rateLimiter.parseHeaders(exchange, res.headers) on response
    ├─ circuitBreaker.record(exchange, endpoint, status) on response
    └─ stale-while-revalidate: if blocked, return cache + stale flag
```

## Components

### binanceGateway.js (NEW — single fetch entry point)

```javascript
exports:
  fetch(url, opts)     — rate-limited + circuit-broken REST call
  getStatus()          — combined rateLimiter + circuitBreaker diagnostic
```

**fetch() flow:**
1. Extract exchange + endpoint from URL
2. `circuitBreaker.canRequest(exchange, endpoint)` → if OPEN, return stale from cache
3. `rateLimiter.canFetch(pool, weight)` → if halted, return stale from cache
4. `binanceTelemetry.wrapFetch(fetch, url, opts)` — actual HTTP call
5. `rateLimiter.parseHeaders(exchange, res.headers)` — update real weight
6. `circuitBreaker.record(exchange, endpoint, res.status)` — update circuit state
7. Return response

**Stale fallback:** When rate-limited or circuit-open, gateway returns `{ status: 503, _stale: true, _reason: 'rate_limit' | 'circuit_open' }` — callers check `_stale` flag.

### Migration (surgical edits)

**marketFeed.js:** Replace `_telemFetch(url, opts)` body → `gateway.fetch(url, opts)`
**marketRadar.js:** Replace `_telemFetch(url, opts)` body → `gateway.fetch(url, opts)`
**serverLiquidity.js:** Replace inline telemetry wrap → `gateway.fetch(url, opts)`

3 surgical edits, same behavior, unified rate control.

## File Map

| File | Action | Phase |
|------|--------|-------|
| `server/services/binanceGateway.js` | CREATE | 2 |
| `server/services/marketFeed.js` | MODIFY (_telemFetch → gateway) | 2 |
| `server/services/marketRadar.js` | MODIFY (_telemFetch → gateway) | 2 |
| `server/services/serverLiquidity.js` | MODIFY (inline → gateway) | 2 |
| `tests/unit/binanceGateway.test.js` | CREATE | 2 |

## Constraints

- Zero behavior change for callers — same response shape
- Existing binanceTelemetry.wrapFetch stays (gateway wraps it, not replaces)
- circuitBreaker + rateLimiter already tested (87 tests from S1)
- Stale fallback = graceful degradation, not error
