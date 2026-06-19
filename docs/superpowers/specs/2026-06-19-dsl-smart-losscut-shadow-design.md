# DSL Drive — Smart Loss-Side Cut (Shadow) + Visual — Design

**Date:** 2026-06-19
**Status:** Approved (operator GO) → plan → implement. Money-path-adjacent (runs in the live DSL loop, SHADOW-only). Realizes the shadow path of [[2026-06-19-dsl-rr-exit-design]].

## Goal

Add a **smart, context-aware loss-side early-exit** to DSL Drive, running in **SHADOW** (no live execution change), that cuts a losing trade early **only when it is adverse AND still falling** (not when it dipped and is recovering) — and surface what it accumulates **visually** in the DSL Drive panel (numbers + a sparkline of cumulative advantage), so the operator can watch it prove (or disprove) itself before any live flip.

## Why "smart" (from the offline proof, cac57ae0)

A blind uniform cut halves the long bleed (expectancy −10.8 → −5.7) but sacrifices winners that **dipped then recovered** (WR 34% → 25%). The discriminator that spares those: cut only when the position is adverse **and not recovering** — derivable from the price path alone (which the shadow already records). This is the ML/logic edge the blind cut lacks.

## What already exists (build on, don't rebuild)

- `serverDSL.tick(posId, price)` + a price-path replay (`_simulate`-style fn, returns `{exitReason, exitPrice, pnlPct}`) — the counterfactual engine.
- `serverAT` already, under `MF.ML_DSL_SHADOW_ENABLED`: records the per-position price trace (`priceTrace.record`) + per-tick `mlDslPolicy.decide`, and on close runs `mlDslLearner.learn(...)` → writes `ml_dsl_outcome` (cols: pos_id,user_id,env,symbol,regime,arm,**cohort**,ml_pnl_pct,baseline_pnl_pct,advantage,win,ts).
- `DslDrivePanel.tsx` fetches `/api/dsldrive/state` + `/api/dsldrive/scoreboard`.

## Components

### 1. `_shouldEarlyExit(o)` — pure decision (TDD)
`_shouldEarlyExit({ adversePct, recovering, threshold })` → boolean.
- `true` (cut) iff `adversePct >= threshold && recovering === false`.
- `false` (hold) when not yet adverse, or adverse but `recovering === true` (price improving from its worst — the dip-then-recover winner we must spare).
Pure, no I/O. Lives in `server/services/dslRrSim.js` (alongside the proven `_cappedPnl`/`_rrStats`).

### 2. `_recovering(pricePath, side, idx)` — pure (TDD)
From the recorded price path up to the current point: is the position improving from its worst adverse point? For a LONG: `recovering = currentPrice > min(pathSoFar) * (1 + RECOVER_EPS)` (price has bounced off the low by a small epsilon). SHORT symmetric on the high. Pure.

### 3. Smart-cut counterfactual (shadow)
Extend the existing close-time shadow path: replay the recorded price trace through a smart-cut sim — at each step compute `adversePct` + `_recovering(...)` → `_shouldEarlyExit`; if it fires, the counterfactual exits there at that PnL%; else the trade keeps the baseline DSL outcome. Record the result as a **new `ml_dsl_outcome` row with `cohort='lossside'`** (`ml_pnl_pct` = smart-cut PnL%, `baseline_pnl_pct` = baseline DSL PnL%, `advantage` = delta, `win` = advantage>0). **No schema migration** (reuses cohort). Gated by a new flag `ML_DSL_LOSSSIDE_SHADOW` (default OFF; operator GO to enable).

### 4. Scoreboard endpoint (extend `/api/dsldrive/scoreboard`)
Add a `lossSide` block computed from `ml_dsl_outcome WHERE cohort='lossside'`: `n`, `rr` (smart) vs `rrBaseline`, `expectancy` delta, `avgLoss` reduction, winner give-back (WR delta), and a small **time-series of cumulative advantage** (bucketed) for the sparkline. Reuses `_rrStats`. Read-only.

### 5. DSL Drive visual (DslDrivePanel)
A new card "🛡️ Smart Loss-Cut (shadow)": the numbers (R:R smart vs baseline, Δexpectancy, N, avgLoss↓, give-back) + an inline SVG **sparkline of cumulative advantage** over time. A one-line verdict (e.g. "shadow: R:R 1.6 vs 1.1 · +Δexp · N=120 · not yet live"). Read-only; clearly labeled SHADOW.

## Data flow (shadow)

```
open position → live DSL controls the real stop (UNCHANGED)
  → serverAT records price trace (existing)
on close (flag ML_DSL_LOSSSIDE_SHADOW on):
  → replay trace through _shouldEarlyExit → smart-cut PnL%
  → write ml_dsl_outcome row cohort='lossside' {ml_pnl_pct, baseline_pnl_pct, advantage}
panel polls /api/dsldrive/scoreboard → lossSide stats + sparkline series → renders card
```

## Safety / discipline
- **Shadow-only:** never touches the real stop or close. Flag default OFF → zero behavior. Fail-closed (any error in the counterfactual is swallowed; the live DSL is untouched).
- **Promotion to LIVE = separate decision**, gated on accumulated shadow evidence (R:R up without WR collapse, beats baseline, soak window) — like the brain flip-gate. Not in this spec.
- No full jest on live VPS; run as `sudo -u zeus`. No money-path execution change.

## Testing
- Unit (jest): `_shouldEarlyExit` (cut on adverse+falling, hold on adverse+recovering, hold on not-adverse, threshold boundary); `_recovering` (bounce off low for long / off high for short, epsilon boundary, short path). Reuse `_rrStats` (already tested).
- Integration: a replay test — feed a synthetic price trace (dip-then-recover winner vs adverse-and-falling loser) and assert the smart-cut spares the winner + cuts the loser.
- Headless: open DSL Drive panel → the Smart Loss-Cut card renders (numbers + sparkline), 0 errors. With the flag OFF, the card shows "no shadow data yet" gracefully.

## Files
- Modify: `server/services/dslRrSim.js` (+ `_shouldEarlyExit`, `_recovering`) + tests.
- Modify: `server/services/serverAT.js` (close-time: compute + record cohort='lossside' under the new flag) — minimal, beside the existing ML-DSL shadow block.
- Modify: the `/api/dsldrive/scoreboard` route (add `lossSide` block + sparkline series).
- Modify: `client/src/components/dock/DslDrivePanel.tsx` (+ the Smart Loss-Cut card + sparkline) + a little CSS.
- Add flag `ML_DSL_LOSSSIDE_SHADOW` (default OFF) in `server/migrationFlags.js`.
- Bump `server/version.js`.

## Out of scope (YAGNI)
- Live control of the real stop (separate, gated on this shadow's evidence).
- Per-cell ML tuning of the threshold (v1 uses a fixed threshold derived from the offline sweep, ≈0.75–1.0%; tuning later).
- Entry-side changes (proven not the cause).

## Decisions (operator)
Confirmed: smart context-aware cut, SHADOW; visual in DSL Drive = numbers + sparkline of cumulative advantage.
