# SP2 — Server Cutover (Testnet) Design

**Date:** 2026-06-01
**Status:** DESIGN ONLY — no implementation until gates below are green
**Author:** Claude (Opus) + operator (Ovi)
**Predecessor:** [SP1 server shadow testnet](2026-05-31-sp1-server-shadow-testnet-design.md) (soak in progress)
**Reuses:** [P-A position adoption](2026-05-30-P-A-position-adoption-design.md)

---

## 1. Goal

Close the phone — trading continues server-side. SP2 promotes the server from **shadow**
(SP1: computes what it *would* do, executes nothing) to **authoritative executor** for
testnet users: the server opens entries when the client is absent, and runs exit/SL/TP
management as an always-on safety net so no position is ever orphaned.

End-state intent (operator): **all testnet users driven the same way** (uniform code, no
per-user special-casing). Reached via a **two-stage cutover flip**, not all-at-once code.

## 2. Hard gates (no code until ALL green)

1. **SP1 soak GREEN** — `parityGate.js` reports actionable agreement ≥ threshold over the
   full soak window (3 days + sufficient actionable/real-trade pairs).
2. **SP1.5 (sizing parity) GREEN** — server sizes entries (qty / SL / TP) identically to
   the client. SP2 server-opened entries depend on this; without it, parity breaks the
   instant the server opens its first real position.
3. **Load/latency gate (S)** — before widening to all users (SP2-b), confirm per-tick
   SL-check latency stays tight under all-users load (better-sqlite3 is synchronous; more
   active users = more synchronous DB writes per tick that could delay the SL check).

This document is design-only. Implementation is blocked behind gates 1–2; gate 3 blocks
the SP2-a → SP2-b widening specifically.

## 3. The two axes (the core insight)

The operator's question "shouldn't it be the same for all users?" conflated two
independent axes. They are kept separate:

| Axis | Bad | Chosen |
|---|---|---|
| **Code** | per-user logic | **Uniform** — one code path, identical for every user |
| **Cutover (flip)** | all users at once | **Staged** — `uid=1` first, then all testnet |

The code never branches on *which* user. Only one target variable changes:
`SP2_CUTOVER_USERS: [] → [1] → all-testnet`.

## 4. Ownership model — "one hand on the wheel"

A single pure function is the heart of SP2:

```
resolveOwnership(userId, position, now) → { entryOwner, exitOwner }
```

It separates the two asymmetric risks:

### 4.1 Entries (opens) — EXCLUSIVE, gated by heartbeat

```
clientPresent = (now − lastHeartbeatServerTs[userId]) < HEARTBEAT_TIMEOUT
                AND user's AT is active (Q)
                AND user has valid exchange creds (K)

  clientPresent → entryOwner = CLIENT   (server stays shadow, as in SP1)
  client absent → entryOwner = SERVER   (server executes the entry)
```

Double-open is catastrophic (two positions instead of one), so entry ownership is
exclusive: exactly one side opens.

### 4.2 Exits (SL / TP / trailing / liquidation) — ALWAYS-ON SAFETY NET (Variant A)

```
position under explicit take-control (≤30 min, _controlModeTs) → exitOwner = USER
                                                                  (server defers on THIS position)
otherwise → exitOwner = SERVER, ALWAYS
            (client also runs exits when present — redundant)
            ALL closes use reduceOnly → second close on a flat position is a no-op
```

Double-close is normally harmless (`reduceOnly` rejects the second), so exits are
redundant by design: the server is a permanent backstop. **The position is never orphaned
on SL, even during a net-cut transition window.** This is the operator's #1 pain
("net se taie des") solved directly.

**Exit net = FULL exit (M):** SL **and** TP **and** trailing **and** liquidation-proximity.
Closing the phone must still take profits, not just stop losses.

**Take-control is a human override, not a net blip:** `_isExplicitUserControl` (a deliberate
human action, ≤30 min) suppresses the server net on that specific position. A stale heartbeat
(net cut) does NOT — the net stays on. These two are distinct signals and must not be
conflated. After 30 min, take-control lapses and the net resumes.

### 4.3 Fail directions — opposite, both safe (defense-in-depth)

| Uncertainty | Entries | Exits |
|---|---|---|
| Unsure if client alive | treat as **client present** → **fail-closed** (do NOT double-open) | run anyway → **fail-safe** (never orphan SL) |

Entries fail toward *not acting* (no duplicate position); exits fail toward *acting*
(always protect). Both directions are safe. This is the operator's money-path rule
(fail-closed + defense-in-depth) made structural.

## 5. Heartbeat — liveness of the trading loop

- **Source (O):** emitted by the **client AT tick** (the trading loop itself), NOT mere
  socket connectivity. A frozen-but-connected tab (phone in pocket, socket alive, loop
  stalled) stops emitting → server correctly takes over entries. Heartbeat means "my
  trading loop is actively running," not "my socket is open."
- **Timestamp (A):** stamped with **server receive-time** on arrival, never the client's
  clock (clock-skew immune).
- **Fast absence signal (A):** a WS close is an *immediate* takeover candidate (catches
  "laptop closed" in <1s). The `HEARTBEAT_TIMEOUT` is the backstop for the half-open case
  (net cut, socket not yet closed — the wifi-switch scenario).
- **`HEARTBEAT_TIMEOUT`:** safety-critical parameter. Default **20s** (4 missed 5s beats),
  soak-tunable. Note: with Variant A the SL net is always on, so this timeout gates *only
  entry* ownership — the orphan-SL risk does not depend on it.
- **Hysteresis (C):** require **N consecutive** present/absent beats before flipping
  entry ownership, to stop control flapping at the timeout boundary.
- **Cold-start grace (B):** on server start/reload, `lastHeartbeat` is empty. Treat all
  users as **client-present** until a fresh heartbeat arrives (+ a short grace window).
  Without this, a PM2 reload makes every client look "absent" → server opens over live
  clients → duplicate positions. This is a classic reload-triggered bug; B prevents it.

## 6. Entry execution path (server-opens)

1. SP1's `_runTestnetShadowCycle` already computes the would-open decision per user.
2. **ENG-1 gate fix:** the gate at `serverAT.js:951` currently blocks server entries for
   testnet users. Make it testnet-aware so the server CAN execute when cutover is active
   for that user.
3. Before executing: check `resolveOwnership(...).entryOwner === SERVER` AND
   `SP2_CUTOVER_USERS` includes the user AND kill switch not active (G) AND creds valid (K)
   AND AT active (Q).
4. **Idempotency guard (D):** before opening, the server checks a per-`(user × symbol ×
   signal-window)` dedup key — refuse a second open on the same symbol within X seconds,
   regardless of whether client or server opened the first. This is the second line of
   defense beyond heartbeat exclusivity, for the race at the boundary.
5. Size via SP1.5-validated sizing (qty / SL / TP identical to client).

## 7. Exit execution path (always-on net)

1. Server runs exit checks on every position in `_positions` each tick: SL, TP, trailing,
   liquidation-proximity.
2. **reduceOnly enforcement (E):** the close path **refuses to send** a close order that is
   not `reduceOnly`. Pre-flight assertion. Variant A's safety depends entirely on this.
3. **Close-to-flat retry (E):** if a close partially fills, retry until the position is
   verified flat (not fire-and-forget).
4. **SL value & divergence (M):** the net uses the **latest synced SL**. When the client is
   actively trailing tighter, its SL updates must sync promptly to the server, so the server
   (backstop) never prematurely cuts a position the client is managing. The net is a
   backstop, not a competitor.
5. **Adapter audit (E):** verify the Binance and Bybit testnet adapters actually honor
   `reduceOnly` (a gating sub-task — the whole safety model rests on it).

## 8. Reconciliation — exchange truth (the real "never orphaned" guarantee)

Reuses [P-A position adoption](2026-05-30-P-A-position-adoption-design.md).

- **On takeover, IMMEDIATELY (N):** when the server takes entry ownership (client absent),
  it pulls actual open positions from the exchange (`getPositions`) and **adopts any it does
  not already know**, attaching exit management. Immediate (not periodic) closes the
  in-flight-order window: client sent an open, net cut before ack, order filled on the
  exchange, server never synced it.
- **Periodically thereafter:** re-reconcile to catch drift.
- **Derived-SL policy (L):** an adopted orphan gets the user's **configured default SL%**
  from its entry price — **never 0, never close-at-open** (exactly today's null-SL → instant
  HIT_SL bug). TP derived the same way. The server never adopts a position without a safe,
  non-zero SL.

## 9. Cutover flag & rollback

- **Flag:** `SP2_CUTOVER_USERS` — `[]` (off) → `[1]` (SP2-a) → all-testnet (SP2-b).
  Plus master `SERVER_AT_TESTNET_EXEC` toggle.
- **SP2-a:** flip on for `uid=1` only. Short soak on the operator's own account — prove the
  real cutover on ONE account, on his skin, not users'.
- **SP2-b:** after SP2-a is green AND the load/latency gate (S) passes, flip to all testnet
  users. Identical code — only the target widens. One explicit PROCEED.
- **Go/no-go (I):** reuse `parityGate.js` as the cutover semaphore. The SP2-a flip is
  permitted only when shadow actionable-agreement is green. Zero new code — just the link.
- **Rollback semantics (P):** flipping `SP2_CUTOVER_USERS` back to `[]` returns **entry**
  ownership to the client **instantly**. The always-on SL net is **independent of the cutover
  flag** and STAYS ON — so rollback never orphans a position. Fast, safe abort.

## 10. Observability

- **Handover audit log (H):** every ownership flip (client→server, server→client) is logged
  with `{userId, from, to, reason, serverTs}`, like the parity log — for soak analysis of
  when and why the server took over.
- **Ownership state in sync (J):** the current `{entryOwner, exitOwner}` is exposed via the
  sync payload so the client can render an indicator: **"SERVER DRIVING" / "YOU DRIVING" /
  "SAFETY NET ON"**. Ties into the kill-switch overlay shipped 2026-06-01. (Indicator UI may
  land with SP2-b; the server exposes the state from SP2-a.)

## 11. Assumptions & constraints

- **Single instance (R):** exactly ONE server process (PM2 `zeus`). No split-brain handling.
  If ever scaled to 2+ instances, this design breaks (two "server drivers") and must be
  revisited with distributed ownership. Documented explicitly as a guardrail.
- **Testnet only.** Real-money (non-testnet) cutover is OUT of scope — a later step after
  SP2 proves out on testnet.
- **AT-respecting (Q):** the server drives entries only for users whose AT is ON. AT off =
  server does not trade them at all.
- **Creds-respecting (K):** server claims entry ownership only with valid exchange creds;
  otherwise it stays shadow and surfaces "server can't drive: missing keys" — never a silent
  fail-to-open.

## 12. Out of scope (YAGNI)

- **"Background demo" feature** (demo trading in parallel while engine=live) — a natural
  follow-on once the server is the per-user brain, but a separate spec. See
  `feature_background_demo` memory.
- **Real-money cutover** — post-SP2.
- **Distributed / multi-instance ownership** — only if the deployment ever scales out.
- **Server-cycle watchdog (complex monitoring)** — noted as a residual risk (if the server
  brain freezes while sole driver, positions go unmanaged). PM2 restart is the current
  backstop; a lightweight staleness alarm is the minimum, not a full monitoring build.

## 13. Component / file map (for the plan)

| Unit | Responsibility | Likely location |
|---|---|---|
| `resolveOwnership(userId, pos, now)` | pure ownership decision (entry + exit owner) | new module, e.g. `server/services/ownership.js` |
| heartbeat ingest + store | server-stamped liveness per user, hysteresis, cold-start grace | `serverAT.js` / new `heartbeatTracker.js` |
| client AT-tick heartbeat emit | emit liveness from the trading loop | client AT loop |
| ENG-1 gate fix | testnet-aware entry gate | `serverAT.js:951` |
| entry idempotency guard | per-(user×symbol×window) dedup | `serverAT.js` entry path |
| exit net (SL/TP/trailing/liq) | always-on, reduceOnly, close-to-flat retry | `serverAT.js` exit path / `serverDSL.js` |
| reconciliation on takeover | adopt exchange-truth orphans + derived SL | reuse P-A adoption module |
| cutover flag + rollback | `SP2_CUTOVER_USERS`, `SERVER_AT_TESTNET_EXEC` | config + `serverAT.js` |
| handover audit log | record ownership flips | DB table + writer |
| ownership state in sync | expose `{entryOwner, exitOwner}` | sync payload + client indicator |

## 14. Testing strategy

- **Unit — `resolveOwnership`:** every state (client present/absent, take-control on/off,
  AT on/off, creds valid/invalid, cold-start grace, hysteresis boundary). Pure → exhaustive.
- **Unit — heartbeat:** server-stamping (clock-skew immunity), staleness, WS-close fast path,
  hysteresis debounce, cold-start grace.
- **Unit — entry exclusivity:** no double-open across client+server at the boundary
  (idempotency guard fires).
- **Unit — reduceOnly enforcement:** close without reduceOnly is refused; partial fill →
  retry-to-flat.
- **Unit — derived SL:** adopted orphan never gets SL 0 / close-at-open; gets configured
  default SL% from entry.
- **Integration — net-cut during SL hit:** the Section-4 scenario — server net closes at the
  planned SL while the client is frozen; no orphan, no double position.
- **Integration — reload:** PM2 reload mid-session does NOT trigger takeover over live
  clients (cold-start grace holds).
- **Integration — rollback:** flipping cutover off returns entries to client instantly while
  positions stay protected by the net.
- Server suite: `jest --forceExit --runInBand`, output redirected to file (per project rule).

## 15. Decision log (operator-approved 2026-06-01)

- Scope: all testnet users, **uniform code**, **staged flip** (uid=1 → all). ✅
- SL ownership: **Variant A** — server always SL safety net; `reduceOnly` is a hard
  requirement. ✅ (chosen after the concrete net-cut-during-SL-hit walkthrough)
- Upgrades A–J approved; second deep-pass K–S folded in (vetoable at spec review). ✅
