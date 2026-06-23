# Admin User Leaderboard — Design Spec

**Date:** 2026-06-23
**Status:** Approved (operator) — ready for implementation plan
**Scope:** A single admin-only feature: an aggregated, sortable leaderboard of all users with real, accumulating-and-decreasing PnL and live status. Read-only over existing data (plus one additive money-path capture for real commissions). No change to trading execution.

---

## Goal

Give the admin one screen to see, across ALL users: how much each has won, how much they are down, who is online/live, with a ranking — using REAL data that accumulates and decreases as trades actually close and as open positions move. Professional, honest, no faked numbers.

## Decisions (operator-confirmed)

- **Placement:** new "🏆 Leaderboard" tab inside the existing admin **Users** section. Row click → existing `UserDetailDrawer`.
- **Environment:** toggle **REAL / TESTNET / DEMO**, default to the current live mode. (REAL is empty until live trading is enabled — the toggle keeps the screen useful now on TESTNET and automatically on REAL later.)
- **Metric depth:** full pro set (below).
- **Compute:** on-the-fly server-side (8 users × ~3000 closed rows = trivial), cached ~5–10s.

## Architecture

```
client: AdminUsers → [Users | 🏆 Leaderboard] tab
          LeaderboardTab.tsx  ── GET /api/admin/leaderboard?env=&window=
                                  (poll ~10s) → sortable table + env toggle + window selector
                                  row click → UserDetailDrawer (existing)
server: routes/admin.js  GET /leaderboard  (admin-auth, thin)
          → services/leaderboard.js
              gatherLeaderboardData(env, window)   // impure: reads DB + open positions + balances + users
              computeLeaderboard(rows, opens, balances, users, {env, window, now})  // PURE — unit-tested
```

**Boundary:** `computeLeaderboard` is a PURE function (no I/O) — it receives already-fetched data and returns the ranked rows + meta. All testing targets it. `gatherLeaderboardData` is the thin impure adapter that pulls from the DB / runtime and calls the pure core.

## Data sources (verified to exist 2026-06-23)

| Datum | Source | Notes |
|---|---|---|
| Realized PnL per trade | `at_closed` blob `closePnl`, `user_id`, `env` | filter env; EXCLUDE non-trade reasons |
| Open time / close time | `at_closed` blob `ts` (open) + `closeTs` (close) | **both reliable epoch-ms** — use for duration AND windowing |
| Trade size / leverage | blob `qty`, `price`, `lev`, `margin`, `size` | for notional, exposure, fee estimate |
| Live unrealized PnL | open positions (serverAT.getOpenPositions(uid)) + markPriceCache | env-matched; the live "accumulates/decreases" part |
| Balance / equity | per-user wallet balance (exchange/cached) + unrealized | equity = balance + unrealizedPnl |
| Online | `users.last_active_at` (< 5 min ⇒ online) | plus engine-active flag |
| Engine on/off | serverAT/serverBrain active set for uid | is auto-trade running |
| Commission (REAL) | exchange fill `commission` (binanceOps maps `fee: t.commission`) | NOT currently persisted → see Commissions |

### ⚠️ Known gotcha (hit earlier this session)
`at_closed.closed_at` (the column) has **MIXED UNITS** (ms / seconds / 0). DO NOT window on it. Use the blob's `closeTs` (reliable epoch-ms) for time windows and `ts` for open time. For rows missing `closeTs` (legacy), fall back to `position_events.ts`; if neither, the row counts only in the "all-time" window.

### Noise exclusion
Real-trade close reasons only. EXCLUDE: `ENTRY_FAILED*`, `RECON_PHANTOM*`, `RESET`, `MANUAL_CLIENT`, `Close All Manual`, `TEST*`, `EXTERNAL_CLOSE` (no Zeus PnL). Include: `DSL_PL`, `DSL_TTP`, `HIT_SL`, `HIT_TP`, `LIQUIDATED`, `SMART_CUT`, `AUTO SL/TP`, `Manual`/`Manual close` (operator-closed real trades), `Emergency*`. (Final inclusion list pinned in the plan; the principle: count only rows that represent a real filled position that realized PnL.)

## Metrics per user (full pro set)

**Realized (windowed, env-filtered):**
- `netPnl` = Σ closePnl
- `grossProfit` = Σ closePnl>0 ; `grossLoss` = Σ closePnl<0 (abs)
- `profitFactor` = grossProfit / grossLoss (∞ guard when grossLoss=0)
- `trades`, `wins`, `winRate` = wins/trades
- `bestTrade`, `worstTrade`, `avgTrade`
- `maxDrawdown` = max peak-to-trough on the cumulative realized curve (ordered by closeTs)
- `currentStreak` = signed run length from the most recent trades
- **`avgTimeInTradeMin`** = mean of (closeTs − ts)/60000 over counted trades  ← new
- **`commissions`** = Σ real fee (stored) ; `commissionsEst` = Σ estimate for rows without a stored fee  ← new
- `netAfterFees` = netPnl − (commissions + commissionsEst)
- `pnlSpark` = downsampled cumulative-realized series (for an inline sparkline)

**Live (current, env-matched):**
- `unrealizedPnl`, `openCount`, `exposure` (Σ notional), `avgLeverage`, `liquidations` (count in window)
- `balance`, `equity` = balance + unrealizedPnl

**Status:** `online` (last_active_at < 5 min), `engineActive`, `lastActiveAt`, `lastTradeAt`.

Default sort: `netPnl` desc (the ranking). Every column sortable. Rows for users with zero activity in the selected env/window still listed (so the admin sees everyone), sorted to the bottom.

## Commissions (real, honest)

Real commission exists at the exchange (`binanceOps.getUserTrades` → `t.commission`) but is not persisted per position.

- **Going-forward (REAL/TESTNET live):** capture the summed fill commission when a live position closes and persist it as an additive `fee` field on the `at_closed` blob. (Source: the fill data the close path already has / a single getUserTrades the close flow can reuse. Exact capture point pinned in the plan; additive, fail-safe, never blocks the close.) The leaderboard sums real `fee`.
- **Historical / DEMO / missing `fee`:** show an **estimate** = notional × takerRate(0.04%) × 2 (round-trip), surfaced in a separate `commissionsEst` figure and rendered with a clear `≈` marker so real vs estimated is never conflated.

This honours "real data" going forward while being transparent about what is estimated.

## API

`GET /api/admin/leaderboard?env=REAL|TESTNET|DEMO&window=today|7d|30d|all`
- Admin-auth (same guard as other `/api/admin/*`).
- Returns `{ ok, env, window, generatedAt, users: [ {userId, email, role, ...allMetrics} ], totals: {...} }`.
- Server caches the computed result ~10s per (env, window) key to avoid recompute on every poll.
- Read-only.

## UI

- Tab switcher in the admin Users section: **Users** | **🏆 Leaderboard**.
- Controls: env toggle (REAL/TESTNET/DEMO), window selector (Today/7d/30d/All).
- Table: rank, user (email/id + online dot + engine dot), netPnl (green/red), profit, loss, winRate, profitFactor, trades, avgTimeInTrade, fees (`≈` if estimated), equity, unrealized (live), openCount, maxDD, streak, pnl sparkline. Sortable headers.
- Row click → existing `UserDetailDrawer`.
- Honest empty state: on REAL with no data → "No REAL trades yet — REAL trading not enabled" (not a blank/error).
- Reuse existing admin table styling.

## Testing (TDD — pure core)

Unit-test `computeLeaderboard` with synthetic rows:
- PnL sums, gross profit/loss split, profitFactor (+ grossLoss=0 ∞ guard)
- winRate, bestTrade/worstTrade/avgTrade
- maxDrawdown on a known curve
- currentStreak (win run, loss run, single)
- avgTimeInTrade from ts/closeTs (+ rows missing closeTs fall back / are excluded from the duration mean)
- commissions: real `fee` summed; missing-fee rows → estimate into `commissionsEst`; `≈` flag
- env filter (REAL vs TESTNET vs DEMO separation)
- window filter using closeTs (incl. the mixed-units guard: a `closed_at` in seconds must NOT mis-bucket; closeTs is authoritative)
- noise-reason exclusion (ENTRY_FAILED/RECON_PHANTOM/etc. not counted)
- online threshold (last_active_at boundary)
- ranking order + zero-activity users listed last

Thin endpoint + UI get light smoke coverage; the math lives in the tested pure function.

## File structure

- `server/services/leaderboard.js` — `computeLeaderboard` (pure) + `gatherLeaderboardData` (impure adapter).
- `server/routes/admin.js` — add `GET /leaderboard`.
- (commission capture) — additive `fee` persist at the live-close point + a pure `estimateFee(notional)` helper.
- `client/src/components/admin/sections/LeaderboardTab.tsx` — the tab view.
- `client/src/components/admin/sections/UsersSection.tsx` — add the tab switch.
- `tests/unit/leaderboard.test.js` — the pure-core suite.

## Non-goals (YAGNI)

- No precomputed/materialized stats table (8 users → on-the-fly is fine; revisit if user count explodes).
- No historical fee back-fill (real fees apply going forward; historical shown as `≈`).
- No cross-env merged totals (kept separate by design).
- No write/admin actions from this screen (read-only; existing user actions stay in the Users list).

## Reversibility / risk

Read-only aggregation; the only money-path touch is the additive `fee` capture at close (fail-safe, never blocks a close, behind the existing live-close path). The whole feature is removable by dropping the tab + route + service.
