# Bybit Testnet Soak Plan — bring Bybit from "built" to "proven"

**Date:** 2026-06-19
**Type:** Operational soak runbook (NOT a code-implementation plan). No money-path code changes.
**Goal:** Accumulate real Bybit runtime evidence (orders + parity Bybit↔Binance + behavior) on **testnet**, WITHOUT disrupting the existing Binance testnet soak, before ever considering a live flip.

## Audit findings that drive this plan (verified 2026-06-19)

- Bybit is code-complete + fail-closed gated (dry-run gate, TESTNET⊕LIVE + LIVE⊕DRY_RUN mutex, signer verified) — BUT has produced **ZERO runtime data**: `brain_parity_log` (87,011 rows) and `dsl_parity_log` (1,276,718 rows) are **100% binance, zero bybit**. No Bybit order, decision, or parity row has ever existed.
- **uid=1 (operator) owns BOTH** `binance/testnet` (active=1) and `bybit/testnet` (verified, active=0). Only one exchange can be active per user (DB unique index + flag mutex).
- Flags now: `BYBIT_TESTNET_ENABLED=true`, `BYBIT_PARITY_ENABLED=true`, `BYBIT_DRY_RUN_ONLY=true`, `BYBIT_LIVE_ENABLED=false`.

## The core constraint (answers "do I need to do something?")

Making Bybit active on **uid=1 would STOP the Binance testnet soak** — the brain flip-gate evidence the operator is accumulating. Therefore the Bybit soak runs on a **separate test user**, in parallel, so the Binance soak on uid=1 is never touched.

## Operator inputs required (the "what you must do")

1. **Do NOT touch uid=1.** Binance testnet soak continues uninterrupted.
2. **Pick the Bybit soak user.** Use an existing test user (e.g. uid=2 `sirbumirela92`) or a fresh dedicated test account. (Not uid=1.)
3. **Provide a Bybit testnet (Demo Trading) API key + secret** for that user. The same Bybit demo key already verified on uid=1 can be reused — just added to the soak user via the in-app Exchange connect flow (or operator hands the key to be stored for that user).
4. **GO for the testnet-only flag flip** `BYBIT_DRY_RUN_ONLY=false` (LIVE stays OFF; the mutex blocks live; Binance dispatch is on a different code path and is unaffected).

Everything else below is operator-run or assistant-run with GO; no code.

## Phases

### Phase 0 — Pre-flight (assistant, read-only)
- Confirm `bybit_rate_state` table present (✓), circuit breaker wired (✓), recovery-boot reconciles Bybit (✓).
- Snapshot baseline parity counts (bybit=0) so growth is measurable.
- Confirm Binance soak on uid=1 is healthy and will be left alone.

### Phase 1 — Wire the Bybit soak user (operator + assistant, GO)
- Add/activate the Bybit **testnet** account on the chosen soak user; verify key (existing verify route — proven HMAC).
- Make Bybit the **active** exchange for that user only (uid=1 stays Binance).
- Enable the server engine (AT) for the soak user on Bybit, demo/testnet sizing, conservative confidence floor.
- Verify: the soak user shows Bybit as active; uid=1 still Binance-active (no disruption).

### Phase 2 — Lift the testnet dry-run latch (assistant, explicit GO)
- Flip `BYBIT_DRY_RUN_ONLY=false` (testnet only). LIVE stays false; mutex enforced.
- **Immediate verification (runtime, not spec):**
  - First Bybit testnet signed request succeeds (order or balance) — real HTTP to Bybit demo host.
  - A Bybit order actually places on testnet (canary: 1 small position) and closes cleanly (SL/TP path).
  - `brain_parity_log` / `dsl_parity_log` begin accumulating **bybit** rows (the evidence that was missing).
  - Binance soak on uid=1 still logging binance rows normally (no regression).
- If anything is off → flip `BYBIT_DRY_RUN_ONLY=true` back (instant fail-closed) + report.

### Phase 3 — Soak (2–3 weeks, observe)
Daily/periodic checks (assistant can script a read-only check):
- **Parity Bybit↔Binance:** decisions + DSL behavior match the Binance reference within tolerance (reuse the parity-shadow comparison; target ≥ the same floor used for brain, e.g. ≥80–85%).
- **Order correctness:** entries/closes/SL/TP fill as intended; no stuck orders; recon (book↔exchange) 0-mismatch.
- **Safety:** circuit breaker behavior sane under Bybit rate limits; no emergency-close storms; no orphans.
- **Stability:** no crashes, no Binance-soak regression, RSS stable.
- Accumulate a meaningful sample (enough Bybit decisions/trades, like the brain soak's trade-count gate).

### Phase 4 — Gate decision (operator)
- **Green** (parity solid + clean orders + clean recon + stable for the window) → Bybit is *proven on testnet*. Then a SEPARATE staged decision for `BYBIT_LIVE_ENABLED=true` (1 user first, mainnet creds, small size), mirroring the brain flip-gate philosophy.
- **Not green** → keep on testnet, fix what the data showed, re-soak. Never flip live on theory.

## Rollback
- `BYBIT_DRY_RUN_ONLY=true` + reload = instant fail-closed (no Bybit HTTP leaves the process).
- Soak user can be de-activated; uid=1 Binance soak is independent and untouched throughout.

## Explicit non-goals
- No live Bybit (`BYBIT_LIVE_ENABLED` stays false this whole plan).
- No 3rd exchange until Bybit is proven (don't run two unproven exchanges).
- No change to uid=1 / the Binance flip-gate soak.

## Decision pending from operator
Which soak user (existing test user vs fresh), and Bybit testnet creds for it → then GO for Phase 1.
