# DOLOS — SMC "Liquidity Trap" Indicator — Design

**Date:** 2026-06-20
**Status:** Approved (operator: build it, all 6 elements, overlay, name DOLOS). New main-chart overlay indicator. Client-only; never touches brain/trading.

## Goal

A new Zeus indicator **DOLOS** (Greek spirit of trickery/deception — the "liquidity trap") that auto-detects the Smart-Money-Concepts liquidity-trap sequence from the operator's reference screenshot and draws it as an **overlay on the main price chart**: **BOS · SWEEP · MSS · Order Block · Breaker Block · Target**.

Like OLYMPUS (which shows the nearest unfilled FVG), DOLOS draws the **single most-recent complete setup** (not every historical occurrence) — clean, one clear annotated structure, matching the screenshot.

## Building blocks that already exist (compose, don't rebuild)

- `marketStructure(highs, lows, closes, lookback)` (MOIRA) → `{ pivots: [{index,value,type:'H'|'L',trend}], breaks: [...] }` — swing highs/lows + Break of Structure.
- `liquidityPool(...)` → pools with `{ level, side, index, swept, sweepIndex }` — liquidity grabs / sweeps.
- Rendering pattern (OLYMPUS, indicators.ts:2830-2862): a transparent **carrier line series** hosts `setMarkers()` for labels; a **band** = two thin line series (top + bottom) each fed `[{time:t0,value},{time:t1,value}]` draws a zone box from its origin bar to "now"; `createPriceLine()` draws a horizontal level. DOLOS reuses exactly this.

## The detection (pure `dolos()` in indicatorCalc.ts)

`dolos(highs, lows, opens, closes, lookback=5, sweepPct=0.05)` → returns the most-recent setup:

```
{
  bias: 'bear' | 'bull' | null,          // setup direction (bear = sweep-high → drop)
  bos:    { index, level } | null,        // the structure break that set the prior trend
  sweep:  { index, level } | null,        // the liquidity grab (false push past a swing) that springs the trap
  mss:    { index, level } | null,        // Market Structure Shift — first break the OTHER way after the sweep
  ob:     { index, top, bottom } | null,  // Order Block — last opposite candle before the MSS move (supply/demand)
  bb:     { index, top, bottom } | null,  // Breaker Block — a prior OB that price broke and returned to
  target: { level } | null,               // opposing liquidity the move aims for
}
```

Algorithm (bear example — symmetric for bull):
1. **Swings + BOS** from `marketStructure`. The last confirmed BOS = `bos` (prior trend).
2. **SWEEP**: scan recent pivots for a swing **high** whose level was pierced by a later wick (high > pivot.level by ≥ `sweepPct` of ATR-ish range) but the candle **closed back below** it → liquidity grab → `sweep`. (Reuse `liquidityPool.swept`/`sweepIndex` where available; fall back to the wick test.)
3. **MSS**: after `sweep.index`, the first close **below** the most recent swing **low** (opposite to the swept side) → `mss`. This confirms the reversal; sets `bias='bear'`.
4. **Order Block**: the last **up** candle (close>open) at/before the MSS down-move start → `ob = {index, top:max(open,close)|high, bottom:min(open,close)}` (the supply zone, red).
5. **Breaker Block**: the most recent **prior OB on the opposite side** that price broke through on the way to the sweep, now flipped → `bb` (blue). If none qualifies, `bb=null` (drawn only when present).
6. **Target**: the nearest **opposing** liquidity below (last swing low / pool level beyond the MSS) → `target.level`.

All indices reference kline positions; pure + deterministic; null-safe (returns nulls when no clean setup exists).

## Rendering (overlay, indicators.ts — `initDolosSeries` + `updateDolos`)

Mirror OLYMPUS:
- **Carrier series** (transparent line over closes) hosts `setMarkers()` for the three labels: `BOS` (at bos.index), `SWEEP` (at sweep.index), `MSS` (at mss.index) — arrow + text, colored by bias.
- **Order Block box** (red): two line series (top+bottom) `[{time:ob.start,value:top},{time:now,value:top}]` / bottom, color `rgba(255,59,48,…)`, from `ob.index` to the latest bar.
- **Breaker Block box** (blue): same band technique, color `rgba(91,141,239,…)`, from `bb.index` to now (only if `bb`).
- **Target**: a horizontal `createPriceLine({price:target.level, …, title:'TARGET'})` on the carrier series (dashed).
- A bias tint is optional; keep it minimal/clean (match the screenshot's boxes + labels).
- Toggle OFF → clear all series data + remove price lines (like other overlays).

## Registration (follow the overlay pattern)

- `INDICATORS` (client/src/core/config.ts): add `{ id:'dolos', ico:_ZI.<bolt/eye>, name:'DOLOS', desc:'SMC liquidity trap — BOS / sweep / MSS / order & breaker blocks', cat:'structure', isOverlay:true }`.
- `indicatorCalc.ts`: `export function dolos(...)` + its interface.
- `indicators.ts`: import `dolos as _calcDOLOS`; `initDolosSeries`/`updateDolos`; add to `_indRenderHook` (call `updateDolos()` when active) + `applyIndVisibility` case 'dolos' (overlay show/hide); add to `_syncSubChartsToMain`? No — it's an overlay on the main chart, not a sub-pane (no sub-chart).
- `IND_SETTINGS` defaults + the settings-label map (lookback, sweepPct).
- Server `server/services/indicatorIds.js`: add `'dolos'` (so the usage badge counts it).

## Error handling
- `dolos()` returns nulls on insufficient data / no clean setup → renderer draws nothing (no throw).
- All `setData`/`setMarkers`/`createPriceLine` wrapped in try/catch (OLYMPUS pattern).
- Overlay; never touches brain/trading/signals.

## Testing
- Unit (vitest) on `dolos()` with hand-built synthetic candle arrays:
  - a clean bear setup (uptrend BOS → sweep above a swing high → close back under → MSS below swing low) → asserts bias='bear', and bos/sweep/mss/ob/target indices+levels at the expected bars; ob is the last up-candle before the drop.
  - symmetric bull setup → bias='bull'.
  - choppy/no-setup data → all nulls (no false setup).
  - the OB zone math (top/bottom from the right candle).
- Headless: enable DOLOS overlay on the chart → carrier markers (BOS/SWEEP/MSS) render, OB/BB boxes + TARGET line appear when a setup exists, 0 errors; toggle off clears them.

## Files
- Modify: `client/src/engine/indicatorCalc.ts` (+ `dolos()` + interface) + `client/src/engine/__tests__/dolos.test.ts`.
- Modify: `client/src/engine/indicators.ts` (init/update/render + hook + visibility case + import).
- Modify: `client/src/core/config.ts` (INDICATORS entry + IND_SETTINGS default), the settings-label map in indicators.ts.
- Modify: `server/services/indicatorIds.js` (+ 'dolos').
- Bump `server/version.js`.

## Out of scope (YAGNI / v2 candidates)
- Drawing every historical setup (v1 = most-recent only).
- Multi-timeframe SMC / HTF order blocks.
- Alerts/signals into the brain (pure visual overlay).
- Premium/discount (OTE) zones, FVG inside the OB (could layer later).

## Decisions (operator)
Name **DOLOS**; all 6 elements (BOS/SWEEP/MSS/OB/BB/Target); **overlay on the main chart**; build it well even if complex.
