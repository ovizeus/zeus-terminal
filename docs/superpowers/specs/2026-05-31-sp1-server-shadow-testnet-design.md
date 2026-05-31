# SP1 — Server Shadow for Testnet (uid=1) — Design Spec

**Date:** 2026-05-31 · **Sub-project:** SP1 of the server-side AT execution migration (P-B).
**Status:** design approved (operator + Termius validation of mobile-Claude review). Awaiting spec review → writing-plans.

## Goal

The server brain must **shadow-compute** the testnet user's (uid=1) trade decisions — log them, **execute nothing** — so we can prove the server would decide the same as the client **before** ever cutting execution over. SP1 produces the *evidence* (parity data + a passing equivalence test) that gates SP2 (the actual cutover). SP1 carries **zero money-path risk**: nothing is executed, no orders, no Telegram, no live side-effects.

This is the safe, prerequisite half of the operator's original goal ("close the phone, trading continues"). SP2 (cutover: ENG-1 fix + server execution + client lockout) is a separate spec, gated on SP1's evidence.

## Problem (verified on the live VPS)

For uid=1 (testnet, `engineMode='live'`, Bybit demo creds):
1. The AT + brain run **client-side** (`CLIENT_AT=true`, `CLIENT_BRAIN=true`; `SERVER_AT=false`, `SERVER_BRAIN=false`). App closed → no trading.
2. The server brain runs a **demo main cycle** (`SERVER_BRAIN_DEMO=true`) that processes demo users (uid=2) and **executes**. The parity **shadow** cycle (`_runShadowCycle`, serverBrain.js:1511) is **suppressed whenever the demo main cycle is active** (`_shouldRunMainCycle()` true → early `return` at :1519; comment [S6-B1]).
3. Therefore **no `source='server'` rows exist for uid=1** in `brain_parity_log` (verified: 0 server rows, 16590 client rows / 7d). The server never shadow-decides for uid=1 → we have no evidence the server matches the client → we cannot safely cut over.

## Design

### Unit 1 — Testnet shadow path (server, shadow-only)
A **dedicated testnet-shadow** that computes uid=1's decisions and logs them, **coexisting** with the demo main cycle (it is NOT suppressed for testnet users). Reuses the existing shadow-pure fusion (`_computeFusionParity`, which by construction mirrors the client's `computeFusionDecision` — but that mirroring is **proven by Unit 4, not assumed**).

For each ready symbol × each testnet user in `_stcMap`:
- Compute the **full shadow decision**: direction (`LONG`/`SHORT`/`NO_TRADE`), confidence, score, **and the execution params the AT would derive** — entry zone, qty/size, SL, TP (mirroring the client AT/DSL sizing + SL logic).
- Write a `source='server'` row to `brain_parity_log` for the direction decision, and the execution params to `dsl_parity_log` (or an extended shadow record — see Unit 2).
- **Hard no-side-effects** (same guarantee as `_runShadowCycle`, serverBrain.js:1506-1510): never call `serverAT.processBrainDecision`, never send Telegram, never persist regime, never size/execute, never re-enter. Wrapped so a shadow failure never contaminates the runtime.

**Isolation:** a distinct path/timer for testnet shadow — NOT a global "un-suppress" of `_runShadowCycle` (which would risk double-processing the demo main cycle). One clear responsibility: produce comparable testnet shadow rows.

### Unit 2 — Full-decision capture (parity completeness) — [Review adjustment #1]
Direction-match alone is too weak a gate: the money is in entry/qty/SL/TP. The shadow must capture the **complete decision** so SP2's gate can compare it:
- **Direction** — `brain_parity_log` (`dir`, `decision`) — already present.
- **Execution params** — entry zone, qty, SL, TP — `brain_parity_log` lacks these columns; they come from the AT/DSL layer (covered today by `dsl_parity_log`). SP1 captures the server-shadow execution params alongside the direction so the gate spans **both** the brain decision **and** the derived order shape.

### Unit 3 — Parity report (measurement)
A query/report that, per `(symbol, cycle)` paired server-vs-client rows for uid=1, computes the **full-decision agreement** (all four within tolerance):
- direction: exact match
- entry zone: within ±X ticks
- qty/size: within ±X%
- SL/TP: within ±X ticks

Gate condition (SP2 prerequisite): **all four within tolerance on ≥ N% of paired cycles, sustained over M days.** The thresholds (X, N, M) are **fixed in this spec BEFORE the soak starts** — never tuned post-hoc to pass. Proposed defaults to confirm with operator: direction 100% required; entry ±2 ticks; qty ±2%; SL/TP ±2 ticks; **N ≥ 98%**; **M ≥ 3 days** with a minimum paired-sample floor (e.g. ≥ 500 paired cycles) so the % is statistically meaningful.

### Unit 4 — Replay equivalence test (proof, not assumption) — [Review adjustment #2]
The entire SP1 rests on "server-fusion == client-brain". That is an **assumption** until proven. Before any soak starts:
- A **replay equivalence test**: feed N historical cycles' identical inputs (snapshot indicators, regime, bars, STC config) to **both** the server fusion path and the client brain logic, and assert the outputs are **identical** — direction/decision **bit-identical**; confidence/score within a float epsilon small enough that it **cannot flip any threshold** (if the formula is literally the same, they are bit-identical and the epsilon is 0).
- If they diverge → **find the source** (code version, flag, indicator/feed difference) and fix it **before** soaking. **No green equivalence test → soak does not start.**

### Unit 5 — SP2 pre-condition, named now: client lockout is FAILSAFE-CLOSED — [Review adjustment #3, refined]
SP2 will design the mechanism, but SP1's spec fixes the **non-negotiable contract** so the architecture is built toward it:

> The server's testnet execution is gated to **prevent double-execution**. The fail-safe direction is **anti-double**, keyed on the **client's presence (heartbeat), not on a withdrawal handshake**:
> - client heartbeat **present** → server **does NOT execute** (the client is authoritative; app is open).
> - client heartbeat **absent** (timed out past threshold) → server **takes over and executes** (this is the app-closed goal).
> - **ambiguous** window (heartbeat just stopped, within the timeout) → **neither executes** — a brief no-trade gap, accepted as strictly safer than a double-entry.

The "no-confirm → no-exec" rule applies to the **ambiguous handover window**, not to the steady app-closed state. (Refinement over the original review wording, which — taken literally as "execute only on confirmed withdrawal" — would forbid app-closed trading, since a closed app has no client to confirm a withdrawal. Verified against the goal + the existing client-lockout model `serverDrivesAT = SERVER_AT && SERVER_BRAIN`.)

## Data flow

`serverState (fresh indicators)` → testnet-shadow path → `_computeFusionParity` + shadow AT-param derivation → write `source='server'` rows (direction + exec params). The client independently writes `source='client'` rows (unchanged). The parity report joins them per `(symbol, cycle)` → full-decision agreement → SP2 gate.

## Error handling / edge cases

- Shadow compute throws → caught, row skipped, runtime untouched (never rethrow).
- Stale snapshot (`snap.stale` / priceTs age > `STALE_DATA_MS`) → skip the symbol (mirrors `_runShadowCycle`).
- No paired client row for a cycle → excluded from the agreement %; the minimum-sample floor guards against a tiny-N false "100%".
- Demo main cycle must remain **untouched** (uid=2 execution unchanged); the testnet shadow only ADDS rows, never alters the demo path.
- Flags off (`PARITY_SHADOW_ENABLED=false`) → testnet shadow also off (defense-in-depth gate).

## Testing (TDD)

1. Testnet shadow produces `source='server'` rows for uid=1 with direction == `_computeFusionParity` output.
2. The shadow captures the full decision (direction + entry/qty/SL/TP), not just direction.
3. **Zero side-effects**: assert the shadow path never calls `processBrainDecision` / telegram / persist / size-execute (spies asserted not-called).
4. Parity report computes full-decision agreement correctly (all-four-within-tolerance on a fixture).
5. Replay equivalence test (Unit 4): server-fusion == client-brain on N historical cycles, decision bit-identical.
6. Demo main cycle unaffected (uid=2 path unchanged).

## Out of scope (SP2)

- ENG-1 gate fix (`serverAT.js:951` testnet-aware).
- Server **execution** for uid=1 testnet.
- The client **lockout mechanism** (heartbeat/ACK) — only its fail-closed *contract* is fixed here.
- Real-money (`_SRV_POS_REAL_ENABLED`) — a separate, later, more-gated project.

## Risk summary

SP1 executes nothing → no money-path risk. The only runtime cost is extra shadow CPU + parity-log writes (bounded, like the existing shadow). The value: it converts "the server probably matches the client" into **proven evidence** (replay equivalence + soaked full-decision parity) that gates the risky SP2 cutover.
