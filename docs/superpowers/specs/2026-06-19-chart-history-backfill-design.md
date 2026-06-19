# Chart Historical Backfill-on-Scroll — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review → implementation plan)
**Type:** Feature (client chart UX + additive server route param). NOT money-path.

## Goal

Let the user scroll the chart back through far more history than the current ~1000-bar
limit. When the user drags the chart toward its left edge, lazily fetch older candles
from the exchange, prepend them, and keep the view exactly where it was (no jump) — up
to a bounded depth of **5000 bars** per (symbol × timeframe).

## Background — current state (from audit 2026-06-19)

- `fetchKlines` (client/src/data/marketDataChart.ts) does ONE REST fetch with `limit=1000`,
  no pagination, no backfill. Depth = 1000 × timeframe (e.g. 1h → ~42 days; 1d → ~2.7y).
- `lightweight-charts ^4.1.3` (v4): `setData()` replaces the whole dataset (no native
  prepend); `update()` only touches the last bar. Prepend = `setData(older + current)`.
  v4 exposes `timeScale().getVisibleLogicalRange()` / `setVisibleLogicalRange()`.
- The scroll hook **already exists**: `w.mainChart.timeScale().subscribeVisibleLogicalRangeChange(...)`
  at marketDataChart.ts:~91 (currently only syncs the CVD sub-chart + sub-charts).
- Trade markers are keyed by **absolute time** (marketDataOverlays.ts renderTradeMarkers),
  NOT by index → prepending older bars does not break them.
- The ~45 indicators recompute from `w.S.klines` on every `renderChart` (`_indRenderHook`,
  indicators.ts:~3370). Prepend + re-render recomputes them over the longer array
  automatically; cost scales with bar count → the 5000-bar cap bounds it.
- **Cap conflict:** the 3 live-kline append paths trim with
  `if (w.S.klines.length > 1500) w.S.klines = w.S.klines.slice(-1200)` (marketDataChart.ts
  139/159/190). `slice(-1200)` keeps the newest 1200 and drops the oldest — it would
  discard backfilled history on the next live tick. Must be reconciled.
- Server route `GET /api/market/klines` (server/routes/marketProxy.js:88) accepts only
  `symbol`, `interval`, `limit` (capped at 1500); caches by `{symbol,interval,limit}`.
  No `startTime`/`endTime`. Binance Futures `/fapi/v1/klines` DOES support `endTime`
  (max limit 1500). Backfill goes through the rate-limited Binance gateway/scheduler.
- No existing backfill scaffolding — clean slate.

## Decisions (locked with operator)

- **Max depth:** ~5000 bars per (symbol × timeframe). Covers 1d→~13y, 4h→~2.3y,
  1h→~7mo, 15m→~52d, 5m→~17d. Backfill stops at the cap.
- **Loading indicator:** discrete — a small "⟳ loading…" near the left edge while a
  fetch is in flight, hidden otherwise.
- **Approach:** lazy backfill on scroll, reusing the existing scroll hook and the existing
  `/klines` route (extended with `endTime`). Not pre-fetch.

## Architecture

A single isolated client module `chartBackfill.ts` owns all backfill state and logic. It
hooks the existing visible-range subscription, detects left-edge proximity, fetches one
older window at a time, merges + re-renders, and restores the visible range. A shared
`MAX_BARS` constant reconciles the live-append cap. The server route gains an additive,
backward-compatible `endTime` parameter. The whole feature is gated behind one flag for
instant rollback.

## Components

### 1. `client/src/data/chartBackfill.ts` (new, isolated unit)

**Purpose:** Own backfill state + the load-older flow.

**State** (module-level, reset per symbol/tf switch):
- `_oldestTime: number` — time (sec) of the oldest currently-loaded bar.
- `_inFlight: boolean` — one fetch at a time.
- `_exhausted: boolean` — exchange returned no more history for this symbol/tf.
- `_gen: number` — snapshot of `w.__wsGen` captured at fetch start; on response, if
  `w.__wsGen !== _gen` or `w.S.symbol`/`chartTf` changed → drop the response (stale).

**Public functions:**
- `initBackfill(): void` — idempotent; wires backfill into the existing
  `subscribeVisibleLogicalRangeChange` callback. On each range event, if
  `_shouldTriggerBackfill(...)` is true → `loadOlder()`.
- `resetBackfill(): void` — clears all state (called by setSymbol + setTF).
- `loadOlder(): Promise<void>` — the core flow (below).

**`loadOlder()` flow:**
1. Guard: return if `!CHART_BACKFILL_ENABLED` || `_inFlight` || `_exhausted` ||
   `w.S.klines.length >= MAX_BARS` || `!w.cSeries` || `!w.S.klines.length`.
2. Set `_inFlight = true`; show the discrete loading indicator; snapshot `_gen`,
   `prevRange = getVisibleLogicalRange()`, `oldest = w.S.klines[0].time`.
3. `fetch('/api/market/klines?symbol=&interval=&endTime=' + _nextEndTime(oldest) +
   '&limit=1000&bg=1', { signal: 10s timeout })`.
4. On response: if stale (gen/symbol/tf changed) → abort silently (no state mutation
   beyond clearing `_inFlight`/indicator). Parse, map to bars, filter with
   `_isHistoricalBarSane` (reuse existing helper).
5. `merged = _mergeOlderKlines(olderBars, w.S.klines)` — dedups the boundary bar, strict
   ascending. If `merged.length === w.S.klines.length` (nothing new) → `_exhausted = true`.
6. If `olderBars.length < 1000` (exchange gave a short page) → `_exhausted = true` (reached
   listing date).
7. `w.S.klines = merged`; `w.cSeries.setData(w.S.klines)`; rebuild candle series if needed
   (`rebuildCandleSeriesFromKlines`); `_indRenderHook()`; `renderTradeMarkers()`.
8. Restore view: `setVisibleLogicalRange(_computeRestoredRange(prevRange, prependedCount))`
   so the same bars stay on screen (logical indices shift by +prependedCount).
9. `_oldestTime = w.S.klines[0].time`.
10. `finally`: hide indicator; `_inFlight = false`.

**Fail-safe:** the entire flow is wrapped so ANY error → hide indicator, clear `_inFlight`,
and **never mutate `w.S.klines` / never call `setData` with partial/empty data**. On error
the chart stays exactly as it was (the blank-chart lesson from the 2026-06-19 price-sanity
bug). A failed/blocked backfill is a no-op, never a regression.

### 2. Pure helpers (in chartBackfill.ts, exported for unit tests)

- `_shouldTriggerBackfill({ from, klinesLen, inFlight, exhausted, enabled, maxBars, edgeThreshold }): boolean`
  — true iff enabled && !inFlight && !exhausted && klinesLen < maxBars && klinesLen > 0 &&
  from != null && from < edgeThreshold.
- `_mergeOlderKlines(older: Bar[], current: Bar[]): Bar[]` — concatenate older + current,
  drop any older bar whose time >= current[0].time (boundary overlap), guarantee strictly
  ascending unique times. Empty `older` → returns `current` unchanged (same reference ok).
- `_computeRestoredRange(prev: {from,to}, prependedCount: number): {from,to}` — returns
  `{ from: prev.from + prependedCount, to: prev.to + prependedCount }`. Null prev → null.
- `_nextEndTime(oldestBarTimeSec: number): number` — `oldestBarTimeSec * 1000 - 1`
  (exclusive upper bound in ms for the next older window).

Constants: `MAX_BARS = 5000`, `EDGE_THRESHOLD = 12`, `FETCH_LIMIT = 1000`.

### 3. Cap reconciliation (marketDataChart.ts)

Replace the three `if (w.S.klines.length > 1500) w.S.klines = w.S.klines.slice(-1200)`
sites with a shared bound: when the feature flag is ON, trim at `MAX_BARS + buffer`
(e.g. `> 5200 → slice(-5000)`) — a sliding 5000-bar window that does not discard
backfilled history on every tick. When the flag is OFF, the original `> 1500 → slice(-1200)`
behavior is preserved exactly (so the cap change itself is fully reversible by flag).
Extract a tiny pure `_capKlines(arr, enabled)` helper for this (unit-tested).

### 4. Discrete loading indicator

A small absolutely-positioned element near the chart's left edge (e.g. `#chartBackfillLoading`),
hidden by default, shown during `_inFlight`. Minimal CSS in app.css (spinner/text), matching
existing chart-overlay styling. Pure DOM toggle (show/hide) — no React coupling required
(the chart is the legacy/bridge surface).

### 5. Reset wiring

- `setSymbol` (marketDataWS.ts) → call `resetBackfill()` (symbol change invalidates depth).
- `setTF` (marketDataFeeds.ts) → call `resetBackfill()` (timeframe change changes bar size).
Both already clear `w.S.klines` and re-fetch; adding `resetBackfill()` keeps backfill state
consistent with the fresh window.

### 6. Server route — additive `endTime` (server/routes/marketProxy.js)

- Accept optional `endTime` (and ignore unknown `bg` flag, or map it to a low scheduler lane).
- Validate `endTime` is a positive integer; if present, append `&endTime=<n>` to the Binance URL.
- Include `endTime` in the cache key: `_cacheKey('klines', { symbol, interval, limit, endTime })`.
- TTL: when `endTime` is present the window is a CLOSED historical range (immutable) → use a
  long TTL (e.g. `klines_history = 3600_000` / 1h) instead of `klines_init` (60s).
- Rate-limit lane: backfill requests carry `&bg=1`; ensure they map to a LOW-priority lane in
  binanceScheduler (P4/P5) so they never starve order/live-data flows. (If the scheduler keys
  by URL pattern, add a rule for `bg=1`; otherwise document that backfill shares the klines lane.)
- **Backward compatible:** no `endTime` → behavior is byte-identical to today. Zero risk to
  existing live/init fetches.

## Data flow

```
user drags chart left
  → subscribeVisibleLogicalRangeChange fires (range.from small)
  → _shouldTriggerBackfill? yes
  → loadOlder(): show indicator, fetch /klines?endTime=<oldest-1ms>&limit=1000&bg=1
  → server: cache-check (endTime keyed) → Binance /fapi/v1/klines (low lane) → JSON
  → client: sanity-filter → _mergeOlderKlines → setData(merged) → _indRenderHook → markers
  → setVisibleLogicalRange(shifted) [no jump] → hide indicator
  (repeat as user keeps scrolling, until klines==5000 or exchange exhausted)
```

## Rollback / revertibility (operator requirement)

Primary mechanism = **one feature flag**, no code revert needed:
- Client flag `CHART_BACKFILL_ENABLED` (via `w.__MF` migration-flag surface, default **ON**
  after deploy since the operator wants the feature). When OFF:
  - `initBackfill` becomes a no-op (scroll hook keeps only its existing CVD-sync behavior),
  - `_capKlines` falls back to the original `>1500 → slice(-1200)`,
  - the server `endTime` param is simply never sent by the client.
  → Flipping the flag OFF instantly restores 100% of today's behavior with no redeploy.
- Secondary: each implementation task is an isolated commit with a `.bak` backup before edits,
  so any single piece can be `git revert`ed cleanly.
- Server change is additive/backward-compatible → nothing to revert there even if client is off.

## Error handling / fail-safe

- Backfill never blanks or partially-writes the chart: on any fetch/parse/render error the
  existing `w.S.klines` is untouched; indicator hidden; `_inFlight` cleared; next scroll may retry.
- Stale-response guard via `_gen` + symbol/tf check (rapid symbol/tf switching during a fetch).
- `_exhausted` prevents hammering the exchange at the listing-date boundary.
- One fetch in flight (`_inFlight`) + edge-threshold debounce prevents request storms.

## Performance

- `MAX_BARS = 5000` bounds both memory and the per-render indicator recompute.
- Backfill is user-driven (only on left-edge scroll), one request at a time, low-priority lane.
- Historical windows cache long server-side (immutable), so re-scrolling is cheap.

## Testing strategy (TDD)

Unit (vitest, pure helpers — written test-first):
- `_shouldTriggerBackfill`: triggers near edge; blocked when inFlight / exhausted / at-cap /
  disabled / empty / from null.
- `_mergeOlderKlines`: boundary dedup, strict ascending, empty-older no-op, no duplicate times.
- `_computeRestoredRange`: shift by prependedCount; null-safe.
- `_nextEndTime`: oldest*1000 − 1.
- `_capKlines`: enabled → 5000 window; disabled → 1200 window (original).

Server (jest, run as `sudo -u zeus`):
- `/klines` with `endTime` appends it to the Binance URL + cache key; without `endTime` →
  identical to current (regression pin).

Integration (headless playwright, like the prior chart verifications):
- Scroll to left edge with indicators active → klines grows beyond 1000, view does not jump,
  stops at 5000, 0 page/console errors; symbol switch mid-backfill drops stale response.

## Files touched

- **New:** `client/src/data/chartBackfill.ts`, `client/src/data/__tests__/chartBackfill.test.ts`
- **Modify:** `client/src/data/marketDataChart.ts` (wire initBackfill into the existing scroll
  hook; `_capKlines` at the 3 sites), `client/src/data/marketDataWS.ts` (setSymbol →
  resetBackfill), `client/src/data/marketDataFeeds.ts` (setTF → resetBackfill),
  `server/routes/marketProxy.js` (endTime + cache key + TTL + lane), `client/src/app.css`
  (discrete indicator), the `__MF` flag registry (CHART_BACKFILL_ENABLED), `server/version.js` (bump).
- **Server test:** `server/routes/__tests__` (or existing marketProxy test location).

## Out of scope (YAGNI)

- Persisting backfilled history across reloads (re-fetch on demand instead).
- Backfill for sub-chart-only data not derived from klines (all indicators derive from klines).
- Bybit/OKX historical pagination (backfill uses Binance via the existing route; if Binance is
  unavailable the existing live-fetch Bybit fallback still serves the initial window — backfill
  simply doesn't extend, gracefully).
- A user-facing depth slider / settings (fixed 5000).

## Resolved questions

- Depth: 5000 bars (operator). Indicator: discrete (operator). Rollback: feature flag (operator).
