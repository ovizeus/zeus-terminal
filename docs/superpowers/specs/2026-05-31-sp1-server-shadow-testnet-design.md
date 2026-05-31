# SP1 — Server Shadow for Testnet (uid=1) — Design Spec

**Date:** 2026-05-31 · **Sub-project:** SP1 of the server-side AT execution migration (P-B).
**Status:** design approved (operator + Termius validation of mobile-Claude review). **Scope locked 2026-05-31 (Option A):** SP1 proves **direction parity** (`brain_parity_log`, exists today) + **replay equivalence** (the strong proof of fusion identity). Full-decision **sizing** parity (entry/qty/SL/TP) is deferred to **SP1.5** — see code-grounded rationale in Unit 2. Writing-plans next.

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
- Compute the shadow **direction decision** via `_computeFusionParity` (the existing shadow-pure fusion): direction (`LONG`/`SHORT`/`NO_TRADE`), decision tier, confidence, score, reasons.
- Write a `source='server'` row to `brain_parity_log` via `db.logParityRow(userId, symbol, 'server', fusion, cycle)`.
- **Hard no-side-effects** (same guarantee as `_runShadowCycle`, serverBrain.js:1506-1510): never call `serverAT.processBrainDecision`, never send Telegram, never persist regime, never size/execute, never re-enter. Wrapped so a shadow failure never contaminates the runtime.

**Isolation:** a distinct path for testnet shadow — NOT a global "un-suppress" of `_runShadowCycle` (which would risk double-processing the demo main cycle). The constraint: today `start()` is XOR — if `_shouldRunMainCycle()` is true (it is, `SERVER_BRAIN_DEMO=true`), the shadow branch never starts, so uid=1 gets zero server rows. SP1 adds a path that runs the testnet shadow **alongside** the demo main cycle, scoped to testnet-authoritative users only, with one clear responsibility: produce comparable testnet shadow rows.

### Unit 2 — Direction-only parity in SP1; sizing parity deferred to SP1.5 — [Review adjustment #1, re-scoped on code 2026-05-31]
Adjustment #1 asked the gate to span the **full decision** (direction + entry/qty/SL/TP). Verified against the live schema, that is **not implementable in SP1** as a shadow:
- `brain_parity_log` carries direction only (dir/decision/confidence/score/reasons) — no entry/qty/SL/TP.
- `dsl_parity_log` is **not** the order-shape-at-decision; it is the **dynamic-stop-loss lifecycle of an already-open position** (phase, current_sl, pivot, impulse, entry_price, tick_price). It has **no qty, no TP, no `cycle`**, is keyed on `pos_id`, and only exists once a position is open. SP1 is shadow — it **opens nothing** server-side → zero server `dsl_parity_log` rows → nothing to compare.
- The **client** does not log decision-time qty/SL/TP anywhere either. So sizing parity is missing evidence on **both** sides, not just the server.

Therefore SP1's gate is **direction parity** (what exists) **plus** the replay-equivalence proof (Unit 4), which proves the **decision engine** is bit-identical — the highest-value half. The **sizing layer** (entry/qty/SL/TP) gets its own sub-project **SP1.5**: a new decision-time capture table + client emission + server-shadow emission + its own soak. SP2 (cutover) is gated on **both** SP1 (direction + replay) and SP1.5 (sizing) being green. This keeps SP1 honestly shadow-only and avoids bolting sizing data onto a table that structurally cannot hold it.

### Unit 3 — Parity report (measurement)
Reuse the existing `db.queryParityReport({ userId: 1, since })` (database.js:10950), which pairs each `source='client'` row with the nearest `source='server'` row for the same `(user, symbol)` within a ±15s window and returns `paired`, `unpaired`, `matched`, `mismatched`, `primaryAgreementPct` (PRIMARY track only — coverage rows excluded). SP1 adds a thin gate-evaluation wrapper over this report for uid=1.

Gate condition (SP2 prerequisite), thresholds **fixed in this spec BEFORE the soak starts** — never tuned post-hoc to pass:
- **direction+tier agreement** `primary.agreementPct ≥ N` — proposed **N ≥ 98%**.
- **pairing-integrity floor** (review adjustment #2 / operator note): `primary.paired ≥ P` AND `unpaired / (paired + unpaired) ≤ U`. Pairing is **intra-table** (client↔server within `brain_parity_log`, ±15s), and `queryParityReport` **excludes `unpaired` from the agreement denominator** — so without this floor a handful of paired rows could read 100% while most cycles never paired. Proposed **P ≥ 500 paired cycles**, **U ≤ 5%**.
- **sustained** over **M ≥ 3 days**.

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

`serverState (fresh indicators)` → testnet-shadow path → `_computeFusionParity` → `db.logParityRow(userId, symbol, 'server', fusion, cycle)`. The client independently POSTs its decision to `/api/brain/parity/client` → `source='client'` rows (unchanged). `queryParityReport({userId:1})` pairs client↔server within ±15s → direction+tier agreement + pairing-integrity → SP2 gate. (Sizing parity is SP1.5, separate flow.)

## Error handling / edge cases

- Shadow compute throws → caught, row skipped, runtime untouched (never rethrow).
- Stale snapshot (`snap.stale` / priceTs age > `STALE_DATA_MS`) → skip the symbol (mirrors `_runShadowCycle`).
- No paired client row for a cycle → excluded from the agreement %; the minimum-sample floor guards against a tiny-N false "100%".
- Demo main cycle must remain **untouched** (uid=2 execution unchanged); the testnet shadow only ADDS rows, never alters the demo path.
- Flags off (`PARITY_SHADOW_ENABLED=false`) → testnet shadow also off (defense-in-depth gate).

## Testing (TDD)

1. Testnet shadow produces `source='server'` rows for uid=1 with direction/decision == `_computeFusionParity` output.
2. **Zero side-effects**: assert the shadow path never calls `processBrainDecision` / telegram / persist-regime / size-execute (spies asserted not-called).
3. **Pairing integrity** (operator note #2, reshaped): on a fixture of client+server rows, the gate-evaluation wrapper reports `paired`/`unpaired` correctly and **fails the gate when `paired < P` or unpaired-ratio > U even if agreementPct is 100%** (the false-high guard).
4. Replay equivalence test (Unit 4): server-fusion == client-brain on N historical cycles, decision bit-identical (confidence/score within threshold-safe epsilon).
5. Demo main cycle unaffected (uid=2 path unchanged) — the testnet shadow only ADDS rows.
6. Shadow runs for testnet-authoritative users only (uid=1) and is skipped for non-testnet users.

## Out of scope

**SP1.5 (sizing parity — prerequisite for SP2 alongside SP1):**
- New decision-time capture table (dir + entry + qty + SL + TP per user×symbol×cycle).
- **Client emission** of decision-time sizing (the client is the authoritative executor; today it logs direction only).
- Server-shadow sizing emission + a sizing-agreement report + its own soak.

**SP2 (cutover):**
- ENG-1 gate fix (`serverAT.js:951` testnet-aware).
- Server **execution** for uid=1 testnet.
- The client **lockout mechanism** (heartbeat) — only its fail-closed *contract* is fixed here (Unit 5). **The heartbeat-timeout value is a critical safety parameter fixed pre-soak like X/N/M — never a code default** (operator note #1): too short → a phone net hiccup reads as "app closed" → server wrongly takes over; too long → a large no-trade gap at real cutover. (No SP1 task — SP1 has no heartbeat — recorded here so SP2 builds it in.)
- Real-money (`_SRV_POS_REAL_ENABLED`) — a separate, later, more-gated project.

## Risk summary

SP1 executes nothing → no money-path risk. The only runtime cost is extra shadow CPU + parity-log writes (bounded, like the existing shadow). The value: it converts "the server probably matches the client" into **proven evidence** (replay equivalence proving the fusion engine is bit-identical + soaked direction parity) that — together with SP1.5 sizing parity — gates the risky SP2 cutover.
