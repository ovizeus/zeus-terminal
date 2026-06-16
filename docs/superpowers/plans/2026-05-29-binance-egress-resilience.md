# Binance Egress Resilience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Money-path-adjacent changes (price→SL/TP) require TDD + operator code-review before commit.

**Goal:** Make Zeus market data resilient to the Binance datacenter-IP block so the chart/radar never goes dark and server-side SL/TP never goes blind — without touching the order-execution path and without getting re-banned.

**Architecture:** Make Binance OPTIONAL rather than load-bearing. Three independent thrusts: (A) graceful degradation + stop self-harm (pure code, immediate); (B) non-Binance primary/fallback via the already-connected Bybit/OKX feeds (pure code, durable); (C) off-IP egress relay for the Binance-exclusive data + clean signed path (needs operator infra). Execution/signing path is never touched.

**Tech Stack:** Node.js, better-sqlite3, existing binanceGateway/rateState/scheduler/telemetry machinery, bybitFeed/liqFeedAggregator (Bybit+OKX WS), undici ProxyAgent (Phase C), Jest.

---

## ROOT CAUSE (from the 2026-05-29 mega-audit — 4 parallel audit agents)

**The Hetzner datacenter IP is IP-REPUTATION blocked by Binance — NOT weight-rate-limited.** Decisive evidence:
- 503s persist at the lowest possible request rate: a single weight-40 `/ticker/24hr` call once/60s still 503s 800-987×/day; impossible under a 2400/min weight cap.
- 503s persist when Zeus's own throttle is idle (2026-05-29: 0 synthetic-429, 0 backpressure, still 636 kline 503s).
- Binance **futures WS** (`fstream.binance.com`, zero REST weight) is silently blocked: `conn=true frames=0`, ~630×/day. Code already documents it (`liqFeedAggregator.js:294` "datacenter network appears to block fstream.binance.com WS data flow").
- Steady-state weight ≈ 110-150/min vs 2400/min cap — nowhere near.
- **Bybit + OKX WS work perfectly from the SAME IP** (thousands of frames) → Binance-specific edge block, not network-wide.

**Implication (non-negotiable):** throttling cannot restore Binance data. Either change the egress IP (relay) or use non-Binance sources. Both are in this plan.

**Secondary real issue:** genuine HTTP 418 *signed-path* bans (5-9/day) triggered mostly by the hourly **testnet key-health poller** + **restart churn** (recoveryBoot re-probing Binance on every one of ~30-52 restarts/day) + signed path bypassing the gateway. Fixable by throttling/consolidation — addressed in Phase A/C.

**Trading-safety status (verified — reassuring but single-threaded):**
- Execution-critical price = `marketFeed` `@bookTicker`/`@trade` combined stream (`/stream`, a DIFFERENT endpoint from the blocked `!forceOrder` firehose) → `serverState._onPrice` → `serverAT.onPriceUpdate` → SL/TP/DSL. This combined stream is currently ALIVE (brain logs live moving prices).
- Order placement/SL/TP/close go through `binanceSigner`/`binanceOps`/`exchangeOps` on the user's **authenticated trading API** — a SEPARATE path, unaffected by the market-data block. **This plan never touches it.**
- **The gap:** no non-Binance fallback is wired into the price emission. If `@bookTicker` is also blocked, server-side SL/TP for demo/testnet would freeze (live positions still protected by exchange-native SL/TP). Phase B closes this.

## GAPS the plan must close (audit-confirmed, with file:line)
1. **GAP-RAWFETCH:** raw `fetch()` pollers bypass ALL defenses → hammer banned IP, extend bans. `wsMarketProxy.js:422,465,485`, `serverSentiment.js:52`, `timeSyncAssert.js:38`.
2. **GAP-NOSTALE:** `marketProxy.js:44,67,81,96,110` hard-fails 502 to clients on error; cache purged on TTL (`:28`). No stale-on-error → chart blanks instead of showing last-good.
3. **GAP-TESTNET:** testnet host `binancefuture.com` invisible to gateway/rateLimiter (`binanceGateway.js:36` only matches `binance.com`) → key-health poller (`exchange.js:507`) trips untracked 418s.
4. **GAP-OFFIP:** every REST/WS path egresses the same blocked IP. No off-IP path anywhere.
5. **GAP-NOKLINEALT:** chart klines are Binance-only (`marketProxy.js:60`, `marketDataChart.ts:109`); no Bybit/OKX kline fallback → chart fully blanks. (Liquidations already degrade to Bybit/OKX.)
6. **GAP-SIGNERBYPASS:** `binanceSigner.js:251` uses `telem.wrapFetch` directly, NOT `binanceGateway` → signed traffic skips rateLimiter + circuitBreaker.

## What we REUSE (mature, do not duplicate)
`binanceRateState.js` (persistent NORMAL/WARM/SUPPRESSED), `binanceScheduler.js` (P0-P5 lanes + critical section), `binanceTelemetry.js` (header quota gate), `liqFeedAggregator.js`/`bybitFeed.js` (Bybit+OKX WS — proven working, already wired to serverState), `wsMarketProxy.js` health/fallback/replay machinery.

---

## PHASED STRATEGY (each phase delivers working software on its own)

| Phase | Delivers | Infra cost | Risk | Trading impact |
|---|---|---|---|---|
| **A — Stop bleeding + graceful degrade** | UI shows last-good (stale) data instead of blank; self-harm pollers stopped; testnet bans stopped | none (pure code) | low | none |
| **B — Non-Binance primary/fallback** | Chart klines/price/funding from Bybit/OKX when Binance down; SL/TP price fallback (defense-in-depth) | none (feeds already connected) | medium (touches price→SL/TP input — TDD+review) | additive safety only |
| **C — Off-IP egress relay** | Full Binance restored (300-sym radar ranking + OI, the Binance-only data) + clean signed/testnet path | small relay VPS (~$5/mo) | medium | none (data only) |
| **D — Hardening** | Reduce restart churn; source-health monitoring; exit-side stale-price guard | none | low | safety+ |

**Recommended order: A → B → C → D.** A+B fix the operator's pain (chart back via Bybit + never-blank UI) with ZERO infra and zero IP dependency, making Binance optional. C restores the Binance-exclusive remainder once a relay exists. D hardens.

**Trading-safety guardrails (ALL phases):**
- NEVER modify `binanceSigner.js` / `binanceOps.js` / `exchangeOps.js` execution/signing logic (Phase C only adds a proxy agent at the HTTP-egress layer, not order logic).
- Non-Binance price fallback (Phase B) is ADDITIVE — only activates when Binance price is stale; identical behavior when Binance works.
- TDD + operator code-review-before-commit for any change touching the price→SL/TP chain (Phase B) and the signer egress (Phase C).
- No flag flips outside staged discipline. No PM2 reload while IP in active ban window without weighing re-spike.

---

## PHASE A — Stop the bleeding + graceful degradation (pure code, do first)

### Task A1: Stale-serve in marketProxy (GAP-NOSTALE) — chart shows last-good instead of blank

**Files:**
- Modify: `server/routes/marketProxy.js` (`_getCached`/`_setCache`/`_proxyFetch` ~lines 24-66, route handlers 71-110)
- Test: `tests/unit/marketProxy-stale-serve.test.js` (create)

**Behavior:** keep a "last-good" copy per cache key that is NOT purged on TTL expiry. On a fresh fetch failure (or gateway synthetic 503), return the last-good payload with `{ _stale: true, _ageMs }` and HTTP 200, instead of throwing 502. Only 502 when there is NO last-good ever.

- [ ] **Step 1: Write failing test** — `_serveWithStale(key, fetchFn)` returns fresh on success; returns `{_stale:true}` last-good when fetchFn throws; throws only when no last-good exists. (Pure helper, dependency-injected fetchFn — testable without Binance.)
- [ ] **Step 2: Run test → FAIL** (`npx jest tests/unit/marketProxy-stale-serve.test.js --forceExit`)
- [ ] **Step 3: Implement** a `_lastGood` Map (separate from TTL `_cache`) + `_serveWithStale` wrapper; wire route handlers to use it; add `staleIfError` flag.
- [ ] **Step 4: Run test → PASS**; run `tests/unit/` subset for no regression.
- [ ] **Step 5: Commit** `feat(marketProxy): serve last-good stale data on Binance failure (no blank chart)`

### Task A2: Route raw-fetch pollers through gateway (GAP-RAWFETCH)

**Files:**
- Modify: `server/services/wsMarketProxy.js:422,465,485` (watchlist/quant pollers) → `require('./binanceGateway').fetch(url, {__src:'wsproxy-watchlist'|'wsproxy-quant'})`
- Modify: `server/services/serverSentiment.js:52`, `server/services/timeSyncAssert.js:38` → route via gateway with `__src` tags
- Test: `tests/unit/raw-fetch-routing.test.js` (create) — assert these modules call gateway.fetch, not global fetch (spy/mock gateway)

- [ ] Step 1: failing test (mock binanceGateway, assert pollers invoke it). Step 2: FAIL. Step 3: replace raw `fetch` with `gateway.fetch` + `__src`. Step 4: PASS + no regression. Step 5: commit `fix: route raw market pollers through binanceGateway (respect ban gate)`.

### Task A3: Testnet host recognition (GAP-TESTNET) — stop key-health 418s

**Files:**
- Modify: `server/services/binanceGateway.js:36` `_extractExchange` to recognize `binancefuture.com` (testnet) as a tracked exchange/pool (or dedicated `binance:testnet` pool in `rateLimiter.js`)
- Modify: `server/routes/exchange.js:507` key-health poller cadence (hourly → throttled/gated through gateway)
- Test: `tests/unit/testnet-host-tracking.test.js` (create)

- [ ] Step 1: failing test `_extractExchange('https://testnet.binancefuture.com/...')` returns a tracked pool, not 'unknown'. Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: commit `fix: track testnet host in rate-limiter (stop untracked 418 bans)`.

**Phase A deploy:** one PM2 reload after all 3 green + full `npm test`. Note: reload re-probes Binance once via recoveryBoot — acceptable; A2/A3 reduce the spike.

---

## PHASE B — Non-Binance primary/fallback via Bybit/OKX (pure code, durable) — DETAIL ON APPROVAL

Scope (to be expanded to bite-sized TDD once Phase A lands + Bybit kline shape confirmed):
- **B1:** Fix Bybit `subscribe ack FAILED` batching bug in `bybitFeed.js:86-107` (currently half-failing) so bybitFeed reliably delivers klines/price/funding for BTC/ETH/SOL/BNB.
- **B2:** Add a non-Binance **price fallback** into `marketFeed.js` price emission (`:595-670`) → `serverState._onPrice`: if Binance `@bookTicker` stale > N s, use Bybit markPrice. Protects `serverAT.onPriceUpdate` SL/TP/DSL. **Money-path-adjacent → TDD + review.**
- **B3:** Add Bybit/OKX **kline fallback** for the chart path (mirror liq-feed multi-exchange pattern) so `/api/market/klines` returns Bybit candles when Binance 503s. Closes GAP-NOKLINEALT.
- **B4:** Source-tag every datum (`source: 'binance'|'bybit'|'okx'|'stale'`) so UI/telemetry shows provenance.

- **B5 (NEW — makes Binance fully optional, FREE):** Bybit/OKX **bulk-ticker REST poller** to replace the Binance-only radar ranking + OI. `Bybit /v5/market/tickers?category=linear` returns ALL linear perps with `turnover24h` + `openInterest` + `fundingRate` in ONE call; `OKX /api/v5/market/tickers?instType=SWAP` similar. Bybit/OKX do NOT block our IP (their WS already flows) → these REST calls work from the Hetzner server, no relay needed. Feed into `marketRadar` ranking + OI. (Verify Bybit/OKX REST reachability from server with a single test fetch at B5 start — high confidence given WS works.)

Operator decision 2026-05-29: **NO paid subscription/VPS.** Therefore B5 sources radar-ranking + OI from Bybit/OKX (free) → **Phase C becomes OPTIONAL** (only for Binance-EXACT numbers / Binance-only symbols). Bybit klines are WS-incremental (no `limit=200` REST history warmup) → B3 needs a short warmup strategy (document on detail).

---

## PHASE C — Off-IP egress relay (OPTIONAL — only if Binance-exact data ever needed) — DETAIL ON APPROVAL

**Status: DEFERRED / likely unnecessary.** B5 sources radar-ranking + OI from Bybit/OKX (free), so Binance is fully optional. Only pursue C if the operator later wants Binance-EXACT volume numbers or Binance-only symbols. **No paid subscription** (operator constraint 2026-05-29). FREE options only:
- **Cloudflare WARP** (free) — trivial; test first, Binance may block WARP ranges.
- **Oracle Cloud Always-Free ARM VM** as relay (free forever) — test whether its datacenter IP is Binance-blocked.
- **Tailscale exit node on an operator-owned residential machine** (free) — residential IP almost certainly unblocked; depends on that machine being on.

Scope (only if pursued):
- **C1:** add an outbound proxy agent (undici `ProxyAgent`) to `binanceGateway.js` REST egress, gated by an env var `BINANCE_EGRESS_PROXY`. Fail-closed: if proxy configured but unreachable, fall back to Bybit/OKX (Phase B), NOT direct (which re-bans).
- **C2:** route `fstream` WS (`marketFeed`/`wsMarketProxy`/`liqFeedAggregator`) through the proxy too.
- **C3:** route the **signed** path (`binanceSigner`) through the proxy → clean IP for orders + testnet key-health → kills the 418 signed bans at the source. **Money-path egress → TDD + review; order LOGIC untouched.**
- Restores: 300-sym radar ranking, OI, full Binance futures. Keep Bybit/OKX as primary so Binance is redundant, not load-bearing.

---

## PHASE D — Hardening — DETAIL ON APPROVAL

- **D1:** Reduce restart churn — recoveryBoot backoff/cache so 30-52 reloads/day stop re-probing Binance; investigate batching deploys.
- **D2:** Source-health monitoring — per-datum source dashboard + alert on Binance blackout + staleness SLA (reuse `binanceTelemetry.getSnapshot` + `market.degraded`/`market.recovered` events already built).
- **D3:** Exit-side stale-price guard — audit found entries have a >10s stale guard (`serverAT.js:984`) but EXITS do not. Add a stale guard / fallback on the SL/TP exit path. **Money-path → TDD + review.**

---

## Self-review notes
- Spec coverage: every audit GAP maps to a task (NOSTALE→A1, RAWFETCH→A2, TESTNET→A3, NOKLINEALT→B3, OFFIP→C1/C2, SIGNERBYPASS→C3). ✅
- Trading safety: execution/signing logic untouched; all price→SL/TP changes are additive + TDD+review. ✅
- Decisions needed from operator before C: provision relay VPS (or WARP). Before B: confirm Bybit 4-symbol coverage is enough for chart, or expand symbol set.
