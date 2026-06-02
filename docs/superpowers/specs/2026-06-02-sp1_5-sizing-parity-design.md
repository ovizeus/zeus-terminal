# SP1.5 — Sizing Parity (measure-only) Design

**Date:** 2026-06-02
**Status:** DESIGN ONLY — implementation timing operator-decided (see §9)
**Author:** Claude (Opus) + operator (Ovi)
**Predecessor:** [SP1 server shadow testnet](2026-05-31-sp1-server-shadow-testnet-design.md) (soak in progress)
**Successor:** [SP2 server cutover testnet](2026-06-01-sp2-server-cutover-testnet-design.md) (gated on this)

---

## 1. Goal

SP1 proved **direction** parity (long/short + decision tier NO_TRADE/SMALL/MEDIUM/LARGE)
between the client brain and the server shadow brain. SP1.5 proves **sizing** parity: at the
moment of a trade decision, does the server compute the same **position size (qty/notional)**,
**stop-loss price**, **take-profit price**, and **leverage** the client would?

SP1.5 is **measure-only**. It executes nothing and changes no traded behavior — pure
instrumentation, exactly like SP1's shadow. Its deliverable is the **divergence data** that
lets us choose, informed, how the server should size when it opens on the user's behalf in
SP2 (the "model A vs B" decision, deferred until we see the numbers).

## 2. Why this is needed (the divergence finding)

Reconnaissance (2026-06-02) found the client and server sizing formulas **genuinely diverge**,
not just at rounding:

| | Client (`autotrade.ts:1016-1090`) | Server (`_executeDecision`, `serverAT.js:1118-1189`) |
|---|---|---|
| base size | `(balance × riskPct%) / slPct%` — **risk-based, from balance** | `stc.size × tier_mult` — **fixed config size** |
| multipliers | `fusionMult × convictionMult × adaptiveMult` + a 2nd adaptive `sizeMult` layer | **tier mult only** (SMALL=1.0 / MEDIUM=1.35 / LARGE=1.75) |
| clamp | `[0.5×, 1.6×]` of `riskSizeCapped` | cap to `userIntent`, floor `MIN_TRADE_USD=10` |
| exchange rounding | **none** (sends raw float qty) | **LOT_SIZE + PRICE_FILTER** align (`_alignQtyToLotSize`, can reject) |

Consequences:
- The client **up-sizes on high-conviction setups** via multipliers the server ignores. Two
  different sizing models → the server's executed size today (e.g. uid=2 wife demo trades) is
  **already** different from what the client would have sized.
- **SL/TP are already structurally identical** on both sides: `slDist = entry × slPct/100`,
  `tp = slDist × rr`, with the **same `slPct` and `rr`** from shared config. Only **tick
  rounding** (server-only) can differ them.
- The server **shadow** cycle (`_computeFusionParity`, `serverBrain.js:1795`) currently
  computes **direction/tier only — no sizing at all**. SP1.5 must add shadow sizing.

So SP1.5's hard target narrows to **SIZE**; SL/TP is a cheap verification.

## 3. Scope

**In scope (measure-only):**
- New capture table for sizing samples, logged on **actionable cycles only** (decision≠NO_TRADE).
- Extract client + server sizing into **pure functions** (bit-identical to current behavior).
- Client emits its would-be sizing each actionable cycle.
- Server shadow computes + logs its would-be sizing each actionable cycle (no execution).
- Pairing + report: per-field divergence (qty, size, SL, TP, leverage).
- **SL/TP gated** (must match within 1 tick); **SIZE report-only** (measure the band).

**Out of scope (deferred):**
- **Closing the size gap** (model A "full client sizing port" vs model B "conservative
  canonical") — decided AFTER seeing SP1.5 data, folded into SP2. SP1.5 does NOT change any
  sizing formula.
- Any execution / money-path behavior change.

## 4. Architecture (mirrors SP1)

### 4.1 Pure sizing functions (the foundation)

Extract the sizing math out of the two execution paths into pure, testable functions. This is
also the groundwork SP2 needs (SP2's server-opens path will call the same server function).

- **Client:** extract `autotrade.ts:1016-1090` → `computeSizing(snap) → { size, qty, sl, tp,
  lev, slPct, rr, riskPct, riskSize, fusionMult, convictionMult, adaptiveMult }`. Both the real
  `placeAutoTrade` AND the parity emit call it (DRY).
- **Server:** extract `serverAT.js:1118-1189` → `computeServerSizing(stc, decision, price) →
  { size, qty, sl, tp, lev, slPct, rr, fusionMult, alignedQty, alignedSize, rejected? }`. Both
  `_executeDecision` AND the shadow cycle call it.

**Refactor safety (operator-approved):** each extraction ships behind a **characterization
test** proving the function's output is **bit-identical** to the current inline code for a
battery of inputs (RED→GREEN→equivalence). Zero behavior change on the money path — the refactor
is provably a no-op.

### 4.2 Capture table

New table `sizing_parity_log`, joinable to `brain_parity_log` by `(user_id, symbol, cycle)`,
written **only on actionable cycles**:

```sql
CREATE TABLE IF NOT EXISTS sizing_parity_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    symbol          TEXT NOT NULL,
    source          TEXT NOT NULL CHECK(source IN ('client','server')),
    cycle           INTEGER,
    side            TEXT,                 -- 'long' | 'short'
    tier            TEXT,                 -- 'SMALL' | 'MEDIUM' | 'LARGE'
    entry_price     REAL,
    qty             REAL,                 -- position quantity (notional/price)
    size            REAL,                 -- margin / notional-margin (USD)
    sl              REAL,                 -- stop-loss price
    tp              REAL,                 -- take-profit price
    lev             INTEGER,
    sl_pct          REAL,
    rr              REAL,
    -- inputs, to attribute divergence (formula vs inputs):
    balance         REAL,
    risk_pct        REAL,
    fusion_mult     REAL,
    conviction_mult REAL,                 -- client-only; null on server rows
    adaptive_mult   REAL,                 -- client-only; null on server rows
    created_at      INTEGER NOT NULL,
    exchange        TEXT NOT NULL DEFAULT 'binance'
);
```

A separate table (not extending `brain_parity_log`) because sizing exists only on actionable
cycles; mixing would bloat the per-cycle direction log. JOIN on `(user_id, symbol, cycle)`
recovers the full picture.

### 4.3 Client emit

Alongside the existing SP1 emit (`autotrade.ts:736`): on an actionable cycle, the client calls
`computeSizing(snap)` and POSTs the sizing snapshot to a new route
`POST /api/brain/sizing-parity/client` → `sizing_parity_log` source='client'. Emit fires even
if the trade is ultimately gated/skipped downstream — we measure what the client **would** size.

### 4.4 Server shadow

The shadow cycle (`_runShadowCycle` / `_runTestnetShadowCycle`), which today logs dir/tier only,
additionally: when its decision is actionable, calls `computeServerSizing(stc, decision, price)`
in **shadow mode** (no order, no DB position) and logs the result to `sizing_parity_log`
source='server'. The same `_isTestnetShadowTarget` gating as SP1 applies.

### 4.5 Report + metric

`querySizingParityReport(userId, window)`:
- Pairs client/server rows by `(user_id, symbol, cycle)` (fallback `created_at ± window`, same
  pairing approach as SP1's `queryParityReport`).
- Per paired actionable cycle, computes:
  - `qtyPctDiff = |qty_s − qty_c| / qty_c`
  - `sizePctDiff = |size_s − size_c| / size_c`
  - `slTickDiff`, `tpTickDiff` — price diff in **tick units** (uses `exchangeInfo` tickSize)
  - `levMatch` — exact boolean
- Returns distributions: median / p90 / max of qty & size %diff; counts of SL/TP within-1-tick;
  leverage match rate; `actionablePairs`, `unpaired`.

**Gate (`sizingParityGate.js`):**
- **SL:** ≥ 99% of actionable pairs within 1 tick. **Real pass/fail.**
- **TP:** ≥ 99% of actionable pairs within 1 tick. **Real pass/fail.**
- **Leverage:** 100% exact match. **Real pass/fail.**
- **Size:** **report-only** — no pass/fail threshold (the formulas are known to diverge; the
  number is the deliverable). The report prints the band; the A/B decision uses it.
- Floors (reuse SP1 pattern): `actionablePairs ≥ A`, `unpaired ≤ U`, soak `≥ M` days.

> **Timid-client starvation (2026-06-02, same class as the SP2 gate #1 deadlock):** paired
> sizing comparison needs the client to be **actionable** (it only computes sizing on a trade
> decision). With a conservative uid=1 client, `actionablePairs` can stay near 0 → the SL/TP
> gate cannot accumulate samples, same dynamic the SP2 entry gate hit. Mitigations, in order:
> (1) the **server shadow rows accumulate regardless** (the server brain is actionable even when
> the client is timid) — so the *size-divergence band* (the actual deliverable) can be measured
> against any client rows that DO appear, and the server-side distribution is informative on its
> own; (2) if paired samples stay starved, apply the **same treatment as SP2 gate #1**: SL/TP
> parity becomes **advisory** on whatever pairs exist (no blocking floor), and the data source
> shifts toward users who actually trade. This is a known risk to confirm during the soak, not a
> blocker to designing the harness.

## 5. Data flow

```
actionable cycle (decision ≠ NO_TRADE)
  client: computeSizing(snap) ──POST /api/brain/sizing-parity/client──▶ sizing_parity_log (client)
  server shadow: computeServerSizing(stc, dec, price) ──db.logSizingParityRow──▶ sizing_parity_log (server)
                                          │
   querySizingParityReport pairs by (user, symbol, cycle) ──▶ per-field divergence
                                          │
   sizingParityGate: SL/TP/lev pass-fail ; SIZE report-only band
```

## 6. Soak

Runs on the **same actionable cycles as SP1** → **concurrent with the SP1 soak**, no separate
window needed (the same trading activity generates both datasets). A daily check mirrors SP1:
`scripts/sp1_5-sizing-check.js` → log `data/logs/sp1_5-sizing.log`. Window measured from the SP1
soak-start marker (`data/logs/sp1-soak-start.txt`) so backlog is excluded.

## 7. Component / file map

| Unit | Responsibility | Location |
|---|---|---|
| `computeSizing(snap)` | pure client sizing (extracted) | `client/src/trading/autotrade.ts` |
| `computeServerSizing(stc, dec, price)` | pure server sizing (extracted) | `server/services/serverAT.js` (or new `sizing.js`) |
| `sizing_parity_log` table + migration | capture schema | `server/services/database.js` (migration) |
| `logSizingParityRow(...)` | server-side insert | `server/services/database.js` |
| `POST /api/brain/sizing-parity/client` | client emit ingest | `server/routes/brainParity.js` (or sibling) |
| client emit call | emit on actionable cycle | `client/src/trading/autotrade.ts` (near :736) |
| server shadow sizing call | compute + log in shadow | `server/services/serverBrain.js` shadow cycle |
| `querySizingParityReport(...)` | pairing + per-field divergence | `server/services/database.js` |
| `sizingParityGate.js` | SL/TP/lev gate + size band report | `server/services/sizingParityGate.js` |
| `scripts/sp1_5-sizing-check.js` | daily soak check | `scripts/` |

## 8. Testing strategy

- **Characterization (equivalence) — client:** `computeSizing` output bit-identical to the
  current inline `placeAutoTrade` math across a battery of snapshots (RED→GREEN). Proves the
  refactor is a no-op on the money path.
- **Characterization (equivalence) — server:** `computeServerSizing` bit-identical to the
  current inline `_executeDecision` math, including `_alignQtyToLotSize` + `roundOrderParams`.
- **Unit — pairing:** `querySizingParityReport` pairs by `(user, symbol, cycle)`, computes
  qty/size %diff and SL/TP tick-diff correctly on fixtures.
- **Unit — gate:** SL/TP/lev pass-fail thresholds; size is report-only (no fail on divergence).
- **Unit — actionable-only:** no sizing row is logged on NO_TRADE cycles.
- **Integration — shadow logging:** a shadow actionable cycle writes one server sizing row;
  client emit writes one client row; they pair.
- Server suite: `jest --forceExit --runInBand`, output redirected to file (project rule).

## 9. Implementation timing (operator-decided)

SP1.5 is **measure-only** (no execution, no traded-behavior change), so it is technically safe
to deploy during the ongoing SP1 soak — it would start gathering size-divergence data
immediately, in parallel. **However**, the operator's rule is "don't touch code during soak
windows." Therefore the **WHEN** is the operator's call:
- **(a)** implement concurrently with the SP1 soak (instrumentation-only, additive), or
- **(b)** implement after the SP1 soak completes.

This document does not assume either. It is design-only; implementation begins on operator GO.

## 10. Decision log (operator-approved 2026-06-02)

- Sizing model when server opens: **C — capture & measure first**, decide A (full client sizing
  port) vs B (conservative canonical) after seeing the divergence data. SP1.5 changes no
  formula. ✅
- Architecture (pure sizing functions both sides + `sizing_parity_log` + client emit + server
  shadow + report/gate) approved. ✅
- Pure extraction ships with **bit-identity characterization tests** (provable no-op on the
  money path). ✅
- SL/TP/leverage gated (within 1 tick / exact); **SIZE report-only**. ✅
