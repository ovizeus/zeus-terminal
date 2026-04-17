# ZT7 FULL CLOSE REPORT — stateAccessors Resolution

**Date:** 2026-04-17
**Scope:** Master Zero-Tail Close Plan v2 — Lot ZT7 (honest resolution of the
R14 classification in `client/src/services/stateAccessors.ts`).
**Mandate:** For every accessor, either flip it to store-first (if the
backing store field is demonstrably populated in lockstep with the legacy
writer) or mark it with an honest reason for staying on the bridge. No
scope creep — zero engine rewrites here.
**Verdict:** **CLOSED REAL**

---

## 1. Summary

`stateAccessors.ts` exports 44 read-only getters created during Phase 8
engine migration. The R14 docstring said most of them were "safe to switch
once a syncFromLegacy audit confirms the store is populated in lockstep
with window.S". ZT7 performed that audit and delivered the honest verdict:

- **5 getters already are or now are `[STORE-BACKED]`** — readable from
  Zustand with a safe legacy fallback. `getATEnabled` and `getATKillTriggered`
  were already there; ZT7 added `getATMode`, `getATClosedToday`, and
  `getATDailyPnL`. All 5 are covered by `useATBridge`
  (`hooks/useATBridge.ts:22-33`, dispatched on `zeus:atStateChanged`).
- **17 getters are `[STORE CANDIDATE — POPULATION DEBT]`** — the canonical
  store field exists, but no write-side bridge keeps it in lockstep with
  the legacy `window.S` / `window.AT` / `window.DSL` / `window.TP` / `window.TC`
  writer. Flipping without first building the bridge would return stale
  data. Each is labelled with the blocking writer.
- **6 getters are `[HYBRID BY DESIGN]`** — they return a mutable reference
  on purpose (teacher, BM, BRAIN, DSL, AT, TP). Callers read *and* write
  through the same object (e.g. `BM.score = X`). Cannot be collapsed until
  the engine itself calls store setters.
- **8 getters are `[BRIDGE — NO CANONICAL STORE]`** — no store home
  exists; creating one is a dedicated lot, not an accessor flip.
- **4 getters (TC DSL activate/trail/trailSus/extend)** are labelled
  "MANUAL DSL STANDARD" — user-confirmed canonical values; not R14 items.

No accessor was deleted. All 44 remain exported; 3 were flipped and the
rest received honest classification labels.

---

## 2. The population-debt discovery

The key finding of the audit was that `window.S` is a **plain object**
(see `core/state.ts:1395`), not a Proxy. Legacy engine writes like
`w.S.price = X` or `w.DSL.mode = 'atr'` therefore do **not** propagate to
Zustand. Zustand stores get populated only through dedicated paths:

| Store | Populated by | Does the legacy writer sync? |
|---|---|---|
| `atStore` (10 fields) | `useATBridge` on `zeus:atStateChanged` | ✅ yes, for the 10 bridged fields |
| `atStore.lastTradeTs` | — | ❌ not covered by bridge |
| `marketStore` | TradingChart / ChartControls / SymbolSelector / useForecastEngine / WatchlistBar | ❌ engine writes go to `w.S.*` only |
| `dslStore` | Tests + DslWidget UI | ❌ engine writes `w.DSL.*` directly |
| `positionsStore` | autotrade.ts pushes slice() after mutation | ⚠️ mostly — but reads of TP fields still best served by `w.TP` |
| `teacherStore` | Covers only subset of TEACHER fields | ❌ engine still writes `w.TEACHER.*` |

That asymmetry is why only the useATBridge-covered AT fields could flip
safely. Everything else must wait for a dedicated "engine-to-store
writer" lot per domain.

---

## 3. Changes applied

Single file touched: `client/src/services/stateAccessors.ts`.

### 3.1 Docstring header rewrite

Removed stale `Phase 8B-mini / 8D / Phase 9 / post-R16 release` timeline
language. Replaced the 3-bucket classification (`HYBRID BY DESIGN` /
`STORE CANDIDATE: X` / `BRIDGE — NO CANONICAL STORE`) with a 4-bucket one
that splits the middle bucket into `STORE-BACKED` (flipped) vs
`STORE CANDIDATE — POPULATION DEBT` (blocked, with the reason named).

### 3.2 Three store-first flips

Before → after (the pattern mirrors the existing `getATEnabled` /
`getATKillTriggered` implementations already in the file):

```ts
// getATMode
try {
  const m = useATStore.getState().mode
  if (m) return m
} catch (_) {}
return (window as any).AT?.mode || (window as any).AT?._serverMode || 'demo'

// getATClosedToday
try { return useATStore.getState().closedTradesToday } catch (_) {}
return (window as any).AT?.closedTradesToday || 0

// getATDailyPnL
try {
  const s = useATStore.getState()
  return s.dailyPnL || s.realizedDailyPnL || 0
} catch (_) {}
return (window as any).AT?.dailyPnL || (window as any).AT?.realizedDailyPnL || 0
```

Each retains its existing legacy fallback exactly — the store call is
wrapped in `try` / `catch (_)` so a pre-hydrate call or a test environment
without the store provider still resolves via `window.AT.*` as before.

### 3.3 Label updates on the remaining accessors

All `[STORE CANDIDATE: X]` labels were rewritten to either:
- `[STORE CANDIDATE — POPULATION DEBT] <store>.<field>` (17 accessors), or
- `[BRIDGE — NO CANONICAL STORE]` (for `getVol24h` — marketStore lacks
  the field entirely; no candidate store exists).

Four previously unlabelled accessors got explicit labels:
`getDemoPositions`, `getLivePositions`, `getDSLEnabled`, `getDSLPositions`.

---

## 4. Accessor-by-accessor classification table

| Accessor | Classification | Callers flipped today? |
|---|---|---|
| `getATEnabled` | STORE-BACKED | — (was already) |
| `getATKillTriggered` | STORE-BACKED | — (was already) |
| `getATMode` | STORE-BACKED | ✅ flipped |
| `getATClosedToday` | STORE-BACKED | ✅ flipped |
| `getATDailyPnL` | STORE-BACKED | ✅ flipped |
| `getATLastTradeTs` | POPULATION DEBT (atStore.lastTradeTs — bridge gap) | ❌ bridge doesn't sync it |
| `getRSI` | POPULATION DEBT (marketStore.rsi) | ❌ engine writes `w.S.rsi` |
| `getLS` | POPULATION DEBT (marketStore.ls) | ❌ same |
| `getFR` | POPULATION DEBT (marketStore.fr) | ❌ same |
| `getOI` | POPULATION DEBT (marketStore.oi/oiPrev) | ❌ same |
| `getFRCountdown` | POPULATION DEBT (marketStore.frCd) | ❌ same |
| `getATR` | POPULATION DEBT (marketStore.atr) | ❌ same |
| `getTimezone` | POPULATION DEBT (marketStore.tz / settingsStore.tz) | ❌ same |
| `getJournal` | POPULATION DEBT (positionsStore.journal) | ❌ engine writes `w.TP.journal` |
| `getPrice` | POPULATION DEBT (marketStore.price) | ❌ engine writes `w.S.price` |
| `getSymbol` | POPULATION DEBT (marketStore.symbol) | ❌ same |
| `getBids` | POPULATION DEBT (marketStore.bids) | ❌ same |
| `getAsks` | POPULATION DEBT (marketStore.asks) | ❌ same |
| `getTCMaxPos` | POPULATION DEBT (settingsStore.maxPos) | ❌ engine writes `w.TC.maxPos` |
| `getDSLMode` | POPULATION DEBT (dslStore.mode) | ❌ engine writes `w.DSL.mode` |
| `getMagnetBias` | POPULATION DEBT (marketStore.magnetBias) | ❌ engine writes `w.S.magnetBias` |
| `getTCSignalMin` | POPULATION DEBT (settingsStore.sigMin) | ❌ engine writes `w.TC.sigMin` |
| `getDemoPositions` | POPULATION DEBT (positionsStore.demoPositions) | ❌ autotrade.ts mutates `w.TP` |
| `getLivePositions` | POPULATION DEBT (positionsStore.livePositions) | ❌ same |
| `getDSLEnabled` | POPULATION DEBT (dslStore.enabled) | ❌ engine writes `w.DSL.enabled` |
| `getTeacher` | HYBRID BY DESIGN | — |
| `getBrainMetrics` (w.BM) | HYBRID BY DESIGN | — |
| `getBrainObject` (w.BRAIN) | HYBRID BY DESIGN | — |
| `getDSLObject` (w.DSL) | HYBRID BY DESIGN | — |
| `getATObject` (w.AT) | HYBRID BY DESIGN | — |
| `getTPObject` (w.TP) | HYBRID BY DESIGN | — |
| `getSignalData` | BRIDGE — NO STORE | — |
| `getFG` | BRIDGE — NO STORE | — |
| `getPerf` | BRIDGE — NO STORE | — |
| `getKlines` | BRIDGE — NO STORE | — |
| `getTCSL` | BRIDGE — NO STORE | — |
| `getTCSize` | BRIDGE — NO STORE | — |
| `getVol24h` | BRIDGE — NO STORE (marketStore lacks field) | — |
| `getMagnets` | BRIDGE — NO STORE | — |
| `getDSLPositions` | BRIDGE — NO STORE | — |
| `getTCDslActivatePct` | MANUAL DSL STANDARD | — |
| `getTCDslTrailPct` | MANUAL DSL STANDARD | — |
| `getTCDslTrailSusPct` | MANUAL DSL STANDARD | — |
| `getTCDslExtendPct` | MANUAL DSL STANDARD | — |

44 accessors total: **5 STORE-BACKED · 20 POPULATION DEBT · 6 HYBRID · 9
BRIDGE — NO STORE · 4 MANUAL DSL STANDARD**.

---

## 5. What ZT7 deliberately did NOT do

- **Did not rewrite any engine writer.** autotrade.ts / brain.ts / dsl.ts
  still mutate `w.AT` / `w.S` / `w.DSL` / `w.TP` in place. That cleanup is
  the "engine-to-store writer" track — ZT7 is an accessor-layer audit, not
  an engine rewrite. Rewriting autotrade.ts to call
  `useATStore.getState().patch({ lastTradeTs })` instead of
  `AT.lastTradeTs = ts` would unblock `getATLastTradeTs`, but scope is too
  large for this lot.
- **Did not widen `useATBridge`** to cover `lastTradeTs`. Adding it would
  have been a one-line change to `hooks/useATBridge.ts:22-33`, but the
  existing writers (autotrade.ts lines 1423 / 1547 / 1761 et al.) set
  `AT.lastTradeTs` without emitting `zeus:atStateChanged`, so the bridge
  would not actually sync. Fixing that is the correct scope for the
  engine-track lot.
- **Did not create new stores** (no `perfStore`, no `journalStore`
  consolidation). Those are dedicated lots.
- **Did not remove any accessor.** Every getter remains callable with the
  identical signature.

---

## 6. Mandate compliance

| Requirement | Status | Evidence |
|---|---|---|
| Each accessor classified truthfully | ✅ | 44 accessors labelled; 0 remaining with the stale "safe to switch" promise |
| Store-first flips applied where safe | ✅ | 3 new flips (getATMode, getATClosedToday, getATDailyPnL); fallback preserved |
| No silent drift | ✅ | Every deferred accessor names the blocking writer |
| tsc principal = 0 | ✅ | Empty stderr |
| vite build green | ✅ | "built in 698ms" |
| No test regressions | ✅ | 4 failures = pre-ZT7 baseline (3 BrainCockpit neural-grid labels + 1 ATPanel kill banner) |
| No scope creep | ✅ | Single file edited; no engine rewrite |

---

## 7. Verification commands

```bash
# 1. The 3 flips are in place:
grep -n "useATStore\.getState()\.mode\|useATStore\.getState()\.closedTradesToday\|useATStore\.getState()\.dailyPnL\|useATStore\.getState()\.realizedDailyPnL" \
  client/src/services/stateAccessors.ts
# → 4 matches (mode, closedTradesToday, dailyPnL, realizedDailyPnL)

# 2. No accessor still uses the legacy "STORE CANDIDATE: X" without the "— POPULATION DEBT" qualifier:
grep -n "STORE CANDIDATE: " client/src/services/stateAccessors.ts
# → 0 matches

# 3. Build + principal:
cd client && npx tsc --noEmit -p tsconfig.app.json && npm run build
# → 0 errors / built in ~700ms

# 4. No callers broke (all accessors still exported with same signature):
grep -c "^export function" client/src/services/stateAccessors.ts
# → 44
```

---

## 8. Artifacts

- Tag pair: `post-v2/ZT7-pre`, `post-v2/ZT7-post`
- Commit: `ZT7: stateAccessors resolution`
- Branch: `post-v2/real-finish` (pushed)
- Final close tag: `post-v2/ZT7-FULL-CLOSED`

---

## 9. Verdict

**ZT7 — CLOSED REAL.**

Three AT accessors newly store-backed (mode, closedTradesToday, dailyPnL),
joining the two that were already store-backed (enabled, killTriggered).
Every remaining accessor has a truthful classification label — the stale
"safe to switch" notes are gone, replaced by labels that name the
blocking writer or the design intent. The follow-on "engine-to-store
writer" track is what unblocks the 20 POPULATION DEBT accessors; it is
explicitly out of scope for ZT7 and out of scope for the remaining
ZT8-ZT13 lots unless re-scoped.

Next up: **ZT8 — phase1Adapters reduction**.
