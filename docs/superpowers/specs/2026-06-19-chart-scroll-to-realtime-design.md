# Chart "Scroll to Realtime" Button (TradingView-style) — Design

**Date:** 2026-06-19
**Status:** Approved (operator GO) → plan → implement
**Type:** Small client chart UI feature. NOT money-path.

## Goal

A TradingView-style round arrow button at the chart's bottom-right that is HIDDEN when the
chart is at realtime (latest bar visible), APPEARS only when the user has scrolled back into
history, and on click jumps the chart instantly back to the latest bar (realtime), then hides.

## Background (from context check)

- `lightweight-charts ^4.1.3` exposes `timeScale().scrollToRealTime()` — already used at
  `client/src/data/marketDataChart.ts:214` (so renderChart returns to realtime on new data).
- The visible-range hook `subscribeVisibleLogicalRangeChange` is already used (CVD sync +
  history backfill). We add our own subscription for this button (multiple subscribers are fine).
- `#csec` (chart section) already has `position: relative` (added for the backfill loading hint),
  so an absolutely-positioned button anchors to it.
- No existing realtime/jump button.

## Behavior

- At realtime (latest bar visible, incl. the rightOffset gap) → button hidden.
- Scrolled back (latest bar is off the right edge) → button shown, bottom-right of the chart.
- Click → `timeScale().scrollToRealTime()` → chart returns to the latest bar → button hides.
- Symbol/timeframe switch → renderChart calls `scrollToRealTime()` on fresh data → at realtime
  → button hidden automatically. No extra reset needed.

## Components

### 1. `client/src/ui/chartScrollToRealtime.ts` (new, isolated)
- `_isAtRealtime(rangeTo: number | null, barCount: number): boolean` — pure, unit-tested.
  Returns `true` (treat as realtime → hide) when `rangeTo == null`; otherwise
  `rangeTo >= barCount - 2` (last bar index `barCount-1` visible, with a 1-bar margin to avoid
  flicker; the realtime rightOffset makes `to` extend past the last bar, so this is robust).
- `initScrollToRealtime(): void` — idempotent (guarded by a `_installed` flag + `w.mainChart`):
  - Creates `#chartScrollRtBtn` (a small round button, bottom-right of `#csec`, right-chevron
    "»" glyph), hidden by default, appended once.
  - Click handler → `try { w.mainChart.timeScale().scrollToRealTime() } catch {}` then hide.
  - Installs its OWN `subscribeVisibleLogicalRangeChange((r) => ...)`: compute
    `_isAtRealtime(r ? r.to : null, w.S.klines.length)`; toggle button display accordingly.
  - On install error → reset `_installed=false` so a later call can retry.

### 2. CSS (`client/src/app.css`)
- `#chartScrollRtBtn`: absolute, bottom-right (e.g. `bottom: 48px; right: 16px`), round, discrete
  dark background matching the chart theme, `display: none` default, `z-index` above chart,
  `pointer-events: auto`, hover affordance. Anchors to `#csec` (already `position: relative`).

### 3. Wiring (`client/src/data/marketDataChart.ts`)
- Call `initScrollToRealtime()` right after `initBackfill()` in the chart-setup function.

## Data flow

```
user scrolls chart back → visibleLogicalRangeChange fires
  → _isAtRealtime(to, barCount) false → show #chartScrollRtBtn
user clicks button → scrollToRealTime() → range jumps to latest
  → visibleLogicalRangeChange fires → _isAtRealtime true → hide button
```

## Error handling

- All chart calls wrapped in try/catch; button is pure UI and never touches klines/data.
- If `w.mainChart` absent at init → no-op (ret* on next call via `_installed=false`).

## Rollback

Trivial: the button is additive and self-contained. Revert the commit, or (if we want a runtime
switch later) it can be flag-gated — but YAGNI for a hidden, zero-data-risk button. Operator can
ask for a flag if desired.

## Testing

- Unit (vitest): `_isAtRealtime` — null→true; `to >= barCount-2`→true; `to < barCount-2`→false;
  boundary cases.
- Headless integration: scroll back → button visible; click → chart at realtime + button hidden;
  at realtime initially → hidden; 0 errors; layout intact.

## Files

- Create: `client/src/ui/chartScrollToRealtime.ts`, `client/src/ui/__tests__/chartScrollToRealtime.test.ts`
- Modify: `client/src/data/marketDataChart.ts` (one `initScrollToRealtime()` call), `client/src/app.css`,
  `server/version.js` (bump).

## Out of scope (YAGNI)

- Animated/smooth scroll easing beyond what `scrollToRealTime()` provides.
- A configurable position/style setting (fixed bottom-right; look tweakable later per operator).
- Flag gating (additive zero-risk UI; revert is the rollback).
