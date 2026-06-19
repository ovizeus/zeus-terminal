# DSL Drive — R:R / Loss-Side Exit Management — Design (v1 SHADOW)

**Date:** 2026-06-19
**Status:** Approved direction (operator) → plan → implement. Money-path (brain exit) — v1 is SHADOW-ONLY.
**Builds on:** existing DSL Drive / ML-DSL infra (serverDSL.js 3-phase, mlDslPolicy, mlDslLearner, mlDslBandit, dslSafety, ml_dsl_outcome, pnl-testnet/ml-dsl track). See [[2026-06-17-ml-dsl-autonomous-design]].

## The proven problem (data-driven, not intuition)

Backtest on 568 linked entry→outcome pairs (brain_decisions.data context JOIN at_closed.closePnl):

| | WR | avgWin | avgLoss | **R:R** | **expectancy/trade** |
|---|---|---|---|---|---|
| LONG | 39% | +31.6 | **−46.2** | **0.68** | **−16.1** |
| SHORT | 43% | +39.2 | −30.2 | 1.30 | −0.4 |
| ALL | 41% | 36.7 | −36.0 | 1.02 | −5.9 |

Refuted hypotheses (saved by backtesting before coding):
- **Counter-trend entries are NOT the cause** — 97% of trades are already trend-aligned (550/568); counter-trend is 18 trades / −159.
- **Entry signals do NOT separate winners from losers** — winners avgRSI 62.3 / avgADX 33.6 vs losers 63.9 / 33.1 (identical). No entry filter can lift WR here.

Conclusion (the math): `expectancy = WR·avgWin − (1−WR)·avgLoss`. WR is not movable via entries → the **only lever is R:R (the exit/risk side)**. Longs bleed because **avgLoss (−46) is far bigger than avgWin (+31.6)** — a broken payoff ratio (R:R 0.68), driven by big HIT_SL/Emergency losses (HIT_SL = −1546 over 12 trades).

Root mechanism in code: **`serverDSL` only manages the PROFIT side** (Activation → Pivot Tracking → Impulse Validation = trail the stop UP once price moves in favor). A losing trade gets **no adaptive management** — it rides the static `originalSL` to a full HIT_SL loss. The left tail is unmanaged.

## Goal

Fix expectancy by fixing R:R, on the EXIT side — primarily **cut the left tail (avgLoss)** via smart, context-driven early-exit on failing trades, and secondarily **let winners run** (grow avgWin). v1 is **SHADOW ONLY**: simulate the new exit policy, measure its R:R/expectancy impact on real trades, control NOTHING live. Promote to live only when it provably improves R:R and beats baseline.

## Scope

- **v1 (this spec): SHADOW.** A counterfactual loss-side exit policy runs alongside the live deterministic DSL on real open positions, computing "what would this trade's PnL have been with smart early-exit", logging it, and feeding R:R/expectancy into the soak track. NO change to the real stop or close. Fail-safe by construction (it doesn't touch execution).
- **Out of scope (v1):** live control of the real stop (that is v2, gated on v1 shadow evidence), entry logic (proven not the cause), the winner-side let-run can be measured in shadow but live tuning is v2.

## The "smart cut" principle (why not just a tighter stop)

A uniform tighter stop would cut losses but ALSO get winners noise-stopped (winners and losers look identical at entry). The value of ML here is **discrimination**: cut a losing trade EARLY only when the *context deteriorates beyond noise* — momentum/structure/flow turning against the position while it is adverse — not on every wiggle. So the loss-side exit is **context-driven**, learned, not static.

## Components (build on existing, isolated units)

1. **`dslLossSideSim` (new, pure-ish, shadow):** given a position's tick path + the context signals already available (the same fusion inputs: stDir/regime/flow/structure/momentum + `_minPrice`/`_maxPrice`/adverse excursion), simulate when a smart early-exit WOULD have fired and at what PnL. Pure decision core `_shouldEarlyExit(ctx)` is unit-tested (TDD). Returns the counterfactual exit PnL for the trade.
2. **R:R / expectancy measurement (extend ml-dsl-track + ml_dsl_outcome):** the existing `mlDslLearner.reward = outcome.pnlPct − baseline.pnlPct` stays, but ADD an expectancy/R:R view: track avgWin, avgLoss, R:R, expectancy for (a) baseline DSL, (b) ML profit-side DSL, (c) +loss-side early-exit. The soak track reports R:R deltas, not just cum.advantage. This is the promotion gate metric.
3. **Objective alignment (mlDslLearner):** keep per-trade advantage for the bandit, but the SHADOW evaluation/gate is **expectancy/R:R improvement** (does loss-side cutting raise R:R toward ≥1.3 without crushing WR?). Document that the bandit reward and the promotion gate are distinct.
4. **Winner-side measurement:** in shadow, also measure whether a looser winner trail grows avgWin (the +31.6 is small; the profit-side policy already aims looser per mlDslPolicy comment). Report avgWin under each policy. Live tuning deferred to v2.
5. **Safety (reuse dslSafety):** even in v2, loss-side management may only exit EARLIER (smaller loss) — it can NEVER widen the stop into a bigger loss. The dslSafety double-net clamp + fail-closed-to-deterministic-DSL apply. Flag-gated (`ML_DSL_LOSSSIDE_SHADOW` for v1; a separate live flag for v2).

## Data flow (v1 shadow)

```
open position → live deterministic DSL controls the real stop (unchanged)
  → in parallel, dslLossSideSim observes the same tick path + context
  → _shouldEarlyExit(ctx) decides the counterfactual early-exit point (no real action)
on close → record {baselinePnl, mlProfitSidePnl, lossSideSimPnl} into ml_dsl_outcome (extended)
soak track (nightly, cron now fixed) → report R:R + expectancy for each policy + the delta
```

## Promotion gate (shadow → live, v2 — explicit, like the brain flip-gate)

Promote loss-side management to LIVE only when, on accumulated real shadow data:
1. R:R improves materially (longs from 0.68 toward ≥1.1–1.3) WITHOUT WR collapsing (the smart cut isn't just noise-stopping winners), AND
2. expectancy turns less-negative / positive, AND
3. it beats the deterministic baseline (the ML-DSL currently trails baseline by −0.7% — must close that AND show R:R gain), AND
4. a soak window (≈2 weeks) with no safety incidents.
Otherwise stay shadow, retune.

## Error handling

- Pure-sim + try/catch around every observation; a sim error never affects the live stop/close (v1 touches nothing live).
- Fail-closed: flag off → no shadow sim, zero behavior change. v2 live → any error degrades to the deterministic DSL.

## Testing

- Unit (TDD): `_shouldEarlyExit(ctx)` — fires on genuine context deterioration while adverse; does NOT fire on noise/normal pullback while context still favorable; never fires to widen.
- Unit: the R:R / expectancy aggregation (avgWin/avgLoss/RR/expectancy from a set of outcomes) — pure, matches the backtest math.
- Replay/backtest harness: run `dslLossSideSim` over the existing closed trades (the −2383 long damage) and confirm it would reduce avgLoss / raise R:R, and quantify winner-side give-back. This is the offline proof before any live flip.
- No full jest on the live VPS; run as `sudo -u zeus`.

## Files (anticipated)

- Create: `server/services/dslLossSideSim.js` (+ pure `_shouldEarlyExit`) + tests; an R:R/expectancy aggregator (pure) + tests.
- Modify: `mlDslLearner.js` / the ml-dsl shadow recording to log the loss-side counterfactual; `scripts/ml-dsl-track.js` to report R:R/expectancy; migration-flag `ML_DSL_LOSSSIDE_SHADOW` (default OFF, operator GO to enable shadow).
- No change to serverDSL live stop logic in v1.

## Out of scope / non-goals

- Entry-side changes (proven not the cause).
- Live stop control (v2, gated on this v1 shadow evidence).
- Touching uid=1's running Binance soak execution (v1 is shadow — zero execution change).

## Decision pending
Operator review of this spec, then writing-plans for v1 (shadow loss-side sim + R:R measurement + offline backtest proof).
