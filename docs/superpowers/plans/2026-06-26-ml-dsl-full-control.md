# ML-DSL Full Control ("DSL Drive owns the exit") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Each task is TDD (red→green→refactor) with a commit. Steps use checkbox (`- [ ]`) syntax.
>
> **MONEY-PATH — HARD RULES (updated per operator 2026-06-26):** ONE identical code path across DEMO + TESTNET + REAL, gated on the master flag `ML_DSL_FULL_CONTROL` (NOT on env). The plan is tuned on DEMO (fake money, fast iteration) + proven on TESTNET, and REAL inherits the same logic automatically. REAL money stays **INERT until the operator adds LIVE API keys + opts in** — and the new logic on REAL still sits **behind the existing real-money seatbelts** (real opt-in, 2%/5x caps, `_SRV_POS_REAL_ENABLED`) which are NOT removed. The exchange-side hard SL is NEVER removed (catastrophe net). The shadow counterfactual keeps running as control/measurement. **Caveat:** testnet ≠ real perfectly (slippage, fills, liquidity, funding) — the FIRST real trades after keys are added must be small + watched for a few days, not fire-and-forget.

**Goal:** Make ML-DSL Drive the single, live owner of every position's stop from the moment it opens — capping the downside intelligently instead of letting losers bleed to the wide hard SL — while keeping the proven DSL profit-trailing.

**Architecture:** DSL attaches and activates *at entry* (not after profit) with an ML-set initial loss cap (ATR×regime). ML continuously owns the pivots per-position/per-coin (heavy market read throttled per coin, light pivot application per tick), and makes the binary "this is a reversal — exit now" call with confirmation guards. The brain stops choosing DSL modes; the presets become ML priors. The exchange hard SL stays as the second net. The UI hides the now-obsolete DSL-mode + AUTO-DSL controls and surfaces a read-only ML-DSL cockpit in the existing DSL Drive panel, plus one master ON/OFF.

**Tech Stack:** Node CommonJS (`server/services/serverDSL.js`, `serverAT.js`, `serverBrain.js`, `migrationFlags.js`), better-sqlite3, jest (server) ; React + Vite + Zustand + legacy DOM bridge (`client/src/components/dock/DslDrivePanel.tsx`, `client/src/trading/dsl.ts`), vitest (client).

---

## Why (root cause, from live testnet data, 2026-06-26)

Exit-reason breakdown, TESTNET `at_closed` (751 closes):

| Bucket | n | Total P&L | WR | Meaning |
|---|---|---|---|---|
| **HIT_SL** (wide hard stop) | 66 | **−4857** | 0% | The bleed. Losers that never got DSL management. |
| **DSL_PL** (dynamic stop) | 129 | **+2757** | 65% | The profit engine. Only winners reach it. |

Confirmed in code: `serverDSL.tick()` only activates the DSL when price reaches `activationPrice` (= entry + `openDslPct`% **in profit**, presets 0.35–1.0%). A trade that goes straight down **never activates DSL** → rides the wide hard SL → bleeds. Lever B (`ML_DSL_LOSSSIDE_ACTIVE`, fixed 0.75%/K=2) fired **0 times** because a fixed threshold cannot tell a pullback from a reversal. The ML stop-policy *shadow* is **+5.89% cumulative ahead of baseline** (growing), but its win comes from the `ml:EXIT` decisions (+1.6%); the `fast` arm drags (−3.2%).

**Conclusion:** activate DSL at entry to own the loss side, let the ML (250+ modules) make the pullback-vs-reversal call, retire the blunt presets/AUTO, kill the `fast` arm. Measure in shadow throughout.

---

## File Structure

**Server**
- `server/migrationFlags.js` — add flag `ML_DSL_FULL_CONTROL` (default OFF). The single master gate.
- `server/services/serverDSL.js` — add an "active-from-entry" path: `attachActive(position, mlParams)` + an ML loss-cap + an ML reversal-exit hook in `tick()`. Keep the existing profit-gated path intact (used when the flag is OFF).
- `server/services/mlDslPolicy.js` *(new)* — pure, testable ML policy: given per-coin market read + per-position state → `{ initialCapPct, pivotParams, exitNow }`. The "brain over DSL mechanics." Reads regime/trend/vol/MTF features (passed in), returns numbers. NO side effects.
- `server/services/serverAT.js` — at entry (`~1559`, `~1603`), when flag ON + `env==='TESTNET'`: attach DSL *active* via `attachActive` with `mlDslPolicy` params instead of `getPreset(stc.dslMode)`. In the tick site (`~2508`), feed live ticks to the active DSL; route a confirmed `exitNow` through the existing `_handleLiveExit` as `DSL_ML_CUT`. Keep shadow recording.
- `server/services/serverBrain.js` (`~209`, `~2531`) — when flag ON, stop emitting `stc.dslMode` (the brain no longer chooses the DSL preset). Leave OFF-path unchanged.

**Client**
- `client/src/components/dock/DslDrivePanel.tsx` — add the read-only ML-DSL cockpit rows per position (posture TIGHT/NORMAL/WIDE, current pivots, live action HOLD/TIGHTEN/WATCH, why). Source from the position state the server already syncs.
- `client/src/trading/dsl.ts` — when flag ON, hide the DSL-mode selector + its AUTO option + Take-Control mode plumbing tied to brain DSL modes; show one master "ML-DSL Drive: ON/OFF".
- `client/src/trading/autotrade.ts` (`~1143`, `~1269`) — when flag ON, stop sending `dslModeAtOpen` from the client mode picker.
- A small client flag mirror (read `MF.ML_DSL_FULL_CONTROL` from the synced server state) to drive the UI swap.

---

## Phases (each independently shippable + reversible + measured)

### Phase 0 — Flag + scaffolding (no behaviour change)
- Add `ML_DSL_FULL_CONTROL` to `migrationFlags.js` (default OFF, getter), exposed in synced state, stripped from client→server payloads.
- Add `server/services/mlDslPolicy.js` skeleton + its jest test file. Pure functions only.
- **Ship + verify:** flag visible, OFF, zero behaviour change (TDD: flag default OFF; policy pure-function unit tests).

### Phase 1 — DSL active at entry with ML loss-cap (THE big lever)
The core fix for the HIT_SL bleed. When flag ON (all envs — DEMO/TESTNET/REAL identical; REAL inert until live keys + behind the existing real-money seatbelts):
- `serverDSL.attachActive(position, mlParams)`: DSL is `active:true` immediately; `pivotLeft` (the stop) = ML loss-cap (`mlDslPolicy.initialCapPct`, ATR×regime), **clamped to be tighter than (or equal to) the exchange hard SL, never looser** (reuse the existing originalSL clamp at `serverDSL.js:206-210`). Profit-side trailing logic unchanged.
- `serverAT.js` entry path uses `attachActive` instead of the profit-gated `attach` when the flag is ON.
- The exchange hard SL stays placed as the second net.
- **Test:** unit — a position that moves adverse triggers the ML cap (a managed `DSL_ML_CUT`) well before the wide hard SL would (no more −73 avg); a position that moves favourable still trails to `DSL_PL` exactly as today. Live testnet — confirm `DSL_ML_CUT` closes appear, the hard SL is untouched, DEMO/REAL unaffected (`env==='TESTNET'` gate).
- **Measure 1–2 weeks:** HIT_SL count must drop; managed-cut avg loss must be smaller than the old −73; net testnet P&L trend up. Shadow keeps comparing vs baseline.

### Phase 2 — ML continuous pivot control + reversal-exit + kill `fast`
- `mlDslPolicy` sets pivot params continuously per-position from the per-coin throttled market read (regime/trend/vol/MTF), modulating *around* the preset priors (presets kept as the starting palette, not deleted).
- `serverBrain.js` stops choosing `stc.dslMode` (flag ON).
- Live reversal-exit: `mlDslPolicy.exitNow` requires confirmation (≥2 sustained adverse ticks + ML conviction ≥ threshold + non-stale tick via `lastTickTs`). On confirm → `_handleLiveExit('DSL_ML_CUT')`.
- Remove the `fast` arm from the bandit's selectable set (or hard down-weight it) — it is −3.2% in shadow.
- **Test:** unit — `exitNow` fires on a sustained reversal but NOT on a single-tick dip or a stale/gap tick (anti-whipsaw); counter-trend trades get a tighter cap than with-trend (asymmetry). Live — `DSL_ML_CUT` rate sane, no whipsaw storm.
- **Measure 2 weeks:** the live ML control must beat the shadow baseline; whipsaw (many tiny premature cuts) must NOT replace the HIT_SL bleed.

### Phase 3 — UI cockpit (flag-gated, reversible)
- In `DslDrivePanel.tsx`: per-position read-only cockpit (posture, pivots, live action, why). Rich telemetry so the operator watches the AI work.
- In `dsl.ts` / `autotrade.ts`: hide the DSL-mode selector + its AUTO option + the brain-DSL Take-Control plumbing; keep one master **"ML-DSL Drive: ON/OFF"** + the existing kill switch.
- All gated behind the synced `ML_DSL_FULL_CONTROL` flag → flipping it OFF restores the old mode/AUTO UI (no code deleted, only hidden).
- **Test:** vitest/live — with flag ON the mode + AUTO controls are hidden and the cockpit shows live state; with flag OFF the old UI returns intact.

---

## Rollout & safety (non-negotiable)
1. **ONE master flag, all envs:** gate on `MF.ML_DSL_FULL_CONTROL` (DEMO/TESTNET/REAL identical). Tuned on DEMO, proven on TESTNET; REAL inherits automatically. REAL money is INERT until live keys + opt-in, and the new logic on REAL still sits behind the EXISTING real-money seatbelts (real opt-in, 2%/5x caps, `_SRV_POS_REAL_ENABLED`) — those are NOT removed.
2. **Hard SL on the exchange is never removed** — second net survives server/WS death.
3. **Shadow counterfactual keeps running** as the control + learning signal (must keep crediting "avoided a big loss" vs "cut a winner early" correctly).
4. **Reversible:** one flag OFF → instant revert to today's behaviour (server + UI).
5. **Staged:** Phase 1 → measure → Phase 2 → measure → Phase 3. Phases are tuned on DEMO + TESTNET data; no phase advances until its measurement is green.
6. **Fail-closed:** any error in the new path falls back to the existing DSL/hard-SL behaviour (try/catch around the active-DSL block).
7. **REAL go-live = the operator adds LIVE keys** once testnet is green 2–3 weeks. Because the code is identical across envs, no separate cutover is needed — but the FIRST real trades are small + watched (testnet ≠ real perfectly).

## Testing strategy
- **Pure logic (mlDslPolicy, serverDSL active path):** jest/vitest TDD, red→green, deterministic synthetic price paths (pullback-then-recover vs sustained-reversal vs gap/stale tick).
- **Integration:** `sudo -u zeus npx jest` targeted (never the full suite on the live VPS — starves brain). `tsc --noEmit` authoritative on client.
- **Live:** Playwright/DB — confirm `DSL_ML_CUT` closes, hard SL untouched, DEMO/REAL unaffected, UI swap correct; then 1–3 week soak comparison vs shadow baseline in `pnl-testnet-track.log`.

## Self-review notes
- Spec coverage: entry-active DSL (P1) ✓, ML continuous control (P2) ✓, presets→priors (P2) ✓, cut brain mode selection (P2) ✓, reversal-exit + guards (P2) ✓, kill `fast` (P2) ✓, hard-SL net (all) ✓, shadow control (all) ✓, UI cockpit + hide modes/AUTO + master toggle (P3) ✓, testnet-only + reversible (all) ✓.
- Open calibration questions to settle during P1/P2 (not blockers for approval): exact ATR×regime cap formula; conviction threshold for `exitNow`; sustained-tick count (start 2).
