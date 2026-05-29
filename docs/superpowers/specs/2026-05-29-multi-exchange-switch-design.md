# Multi-Exchange One-Click Switch — Design Spec

**Date:** 2026-05-29
**Status:** Design approved (operator), spec for review → writing-plans next session
**Operator principle:** "Trade on whatever exchange I want, when I want — ban Binance, trade Bybit, all the same. Pull profit regardless of venue."

## Goal

Per-user **one-click switch of the active exchange**, uniform across **demo / testnet / real**. New decisions (brain + AT + manual) route to the active exchange. Existing open positions on OTHER exchanges **persist and stay DSL-managed on their own exchange**, with a per-exchange label on every order. Extensible to N exchanges (Binance + Bybit today; MEXC / OKX / Hyperliquid future — model only, no integrations now).

Replaces the current hard block ("Bybit cannot be activated because Binance is currently connected. Disconnect Binance first.") with a **switch + confirm** flow.

## Core model: active vs managed

- **`activeExchange`** (per user) — where NEW orders go (brain/AT/manual entries).
- **`managedExchanges`** (per user) — set = `activeExchange` ∪ {any exchange with open positions}. Feeds + creds kept ALIVE for every managed exchange so DSL keeps trailing their positions.
- An exchange leaves `managedExchanges` when its LAST open position closes (and it's not the active one).

This decouples "where new orders go" from "which exchanges we still manage." feedManager already refcounts feeds per exchange — extend it to track active vs managed.

## Switch flow (one click)

1. Operator clicks "Switch to Bybit" (or any exchange).
2. If the CURRENT active exchange has open positions → confirm dialog:
   > "Switch to BYBIT? BINANCE has X open position(s) — they stay active and DSL keeps managing them on Binance. New orders go to Bybit."
   If no open positions → switch immediately (no dialog).
3. On confirm: `activeExchange = Bybit`. Binance:
   - **Blocked for NEW orders** (brain/AT/manual entries refused on Binance).
   - **NOT disconnected** — creds + feed kept alive (Binance stays in `managedExchanges`) so DSL keeps trailing the open Binance positions until they close.
4. New entries (brain/AT/manual) now route to Bybit. Manual API keys for Bybit usable.
5. Reverse + N-exchange symmetric: same flow for Binance↔Bybit↔(future MEXC/OKX/Hyperliquid).

**"Block" = stop NEW orders, NOT full disconnect.** Full disconnect of an exchange is only allowed when it has zero open positions (else its positions would lose DSL management).

## Order routing

- **New entry** (brain / AT / manual /order/place) → `activeExchange`.
- **Close / reduceOnly / SL / TP / DSL trail** → the **position's own exchange** (`position.exchange`), regardless of which is active.

## Positions panel (client)

- Shows ALL positions across ALL managed exchanges in one panel.
- Each row carries a per-exchange label/badge: `🟡 BINANCE` / `🟣 BYBIT` / (future venues).
- Manual close works for ANY position from ANY exchange, even while active on another (close routes to `position.exchange`).

## DSL

- Every order/position carries its exchange tag (DSL state already keyed `symbol|exchange`).
- DSL UI shows the exchange label per order.
- DSL trail/PL takeover runs **cross-exchange concurrently** — Binance positions trail on Binance while new Bybit positions trail on Bybit.
- Native SL stays on each position's exchange until DSL activation, then PL takes over (per operator's SL→DSL→PL lifecycle).

## Modes: uniform (demo / testnet / real)

"se acabó con la rabia" — eliminate the special-case at the root. The switch behaves identically in all modes:
- **demo** — execution stays SIMULATED (no real exchange), but follows `activeExchange` for market data source + symbols + label, so the UX/behavior is uniform. No real orders.
- **testnet / real** — real exchange execution on the active exchange's creds.

**Revise the `SERVER_AT_DEMO && BYBIT_TESTNET_ENABLED` mutex** (migrationFlags:238): demo (simulated) and a real exchange env do not actually conflict at the exchange level. Make modes uniform so demo can coexist with any real exchange env. (Re-audit ALL the SERVER_AT_DEMO/BYBIT mutex rules in migrationFlags:203-246 for this uniform model.)

## Flags / activation (related, separate decision)

The switch is the ROUTING layer. To actually trade an exchange, its execution must be enabled:
- Bybit: `BYBIT_TESTNET_ENABLED=true` (or live) + `BYBIT_DRY_RUN_ONLY=false`.
- bybitOps Phase 1E (real testnet send) is less battle-tested (was dry-run) → first live Bybit testnet order needs a CANARY watch.

## Components touched

**Server:**
- `server/services/feedManager.js` — `activeExchange` + `managedExchanges` model (extend the refcount); keep creds+feed alive for managed.
- `server/routes/exchange.js` — switch route: replace 409-on-positions block with confirm-flow; "block new / keep managed" semantics.
- `server/services/serverAT.js` — entry routing to activeExchange; close/SL/TP route to position.exchange; brain/AT dispatch per active.
- `server/services/serverDSL.js` — cross-exchange concurrent management + per-order exchange tag.
- `server/migrationFlags.js` — revise demo/bybit mutex for uniform modes.
- `server/services/serverBrain.js` — dispatch new decisions to activeExchange only.

**Client:**
- Positions panel — cross-exchange aggregation + per-exchange label + close routing.
- DSL UI — per-order exchange label.
- Exchange UI — replace "disconnect first" block with one-click Switch button + confirm dialog (open-position count).

## Constraints / discipline

- Per-user (each user has own activeExchange + managedExchanges).
- Money-path → TDD strict, backups, staged flag flips, show-code-before-commit.
- bybitOps Phase 1E less-tested → canary the first real Bybit testnet order.
- **Implement as a fresh, focused multi-task effort** (not at the tail of a marathon session) — large multi-subsystem money-path feature.

## Non-goals (YAGNI)

- No MEXC/OKX/Hyperliquid integrations now — only make the model N-exchange-extensible.
- No real-money flip (separate gate; demo edge currently negative).

## Open question for operator review

- Confirm "block = stop new orders but keep creds+feed alive for managing open positions" (NOT full disconnect) — implied by the design; flag if you want full disconnect instead (would drop DSL on old positions).
