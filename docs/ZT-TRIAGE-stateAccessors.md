# ZT1.a — stateAccessors.ts Triage (2026-04-17)

**File**: `client/src/services/stateAccessors.ts` (349 lines, 44 getters)
**Purpose**: Read-only leaf module; engines migrate from `w.S.price` → `getPrice()` with store fallback.

## Count reconciliation

Audit quantum claimed 36 transitions (7 HYBRID + 21 STORE CANDIDATE + 8 BRIDGE). Precise count post-read:

- 6 HYBRID BY DESIGN (audit said 7)
- 20 STORE CANDIDATE (audit said 21)
- 7 BRIDGE NO CANONICAL STORE (audit said 8)
- 2 store-backed canonical (already done)
- 4 MANUAL DSL STANDARD (user-confirmed, fixed defaults)
- 5 uncategorized (ATMode, DemoPositions, LivePositions, DSLEnabled, DSLPositions)

**Total real transitions**: 33 (not 36). Audit was conservative by 3 — still material.

## Full classification table

| Getter | Line | Category | Target store.field | Cutover cost | Disposition for ZT7 |
|---|---|---|---|---|---|
| `getATEnabled` | 42 | **CLOSED** (store-backed) | `atStore.enabled` | — | KEEP |
| `getATKillTriggered` | 180 | **CLOSED** (store-backed) | `atStore.killTriggered` | — | KEEP |
| `getSignalData` | 53 | BRIDGE | none | store creation | **FUTURE v3.0** (engine data) |
| `getRSI` | 60 | STORE CANDIDATE | `marketStore.rsi[tf]` | verify sync | **CUTOVER** |
| `getLS` | 66 | STORE CANDIDATE | `marketStore.ls` | verify sync | **CUTOVER** |
| `getFR` | 72 | STORE CANDIDATE | `marketStore.fr` | verify sync | **CUTOVER** |
| `getOI` | 80 | STORE CANDIDATE | `marketStore.oi/oiPrev` | oiTs missing field → widen | **CUTOVER with widen** |
| `getFRCountdown` | 86 | STORE CANDIDATE | `marketStore.frCd` | verify sync | **CUTOVER** |
| `getFG` | 92 | BRIDGE | none | store creation | **FUTURE v3.0** (Fear&Greed) |
| `getATR` | 97 | STORE CANDIDATE | `marketStore.atr` | verify sync | **CUTOVER** |
| `getTimezone` | 106 | STORE CANDIDATE | `settingsStore.tz` | user-pref should own | **CUTOVER → settingsStore** |
| `getPerf` | 113 | BRIDGE | none | perfStore exists (`engine/perfStore`) | **CUTOVER possible** (perfStore has `savePerfToStorage` et al.) |
| `getJournal` | 127 | STORE CANDIDATE | `positionsStore.journal` | already populated (R9) | **CUTOVER** |
| `getPrice` | 136 | STORE CANDIDATE | `marketStore.price` | verify sync | **CUTOVER** |
| `getSymbol` | 141 | STORE CANDIDATE | `marketStore.symbol` | verify sync | **CUTOVER** |
| `getKlines` | 148 | BRIDGE | none (not in marketStore) | store widening | **FUTURE v3.0** (engine data) |
| `getBids` | 154 | STORE CANDIDATE | `marketStore.bids` | verify sync | **CUTOVER** |
| `getAsks` | 160 | STORE CANDIDATE | `marketStore.asks` | verify sync | **CUTOVER** |
| `getTeacher` | 167 | **HYBRID BY DESIGN** | mutable ref; teacherStore partial | full teacher rewrite | **KEEP — engine rewrite v3.0** |
| `getATLastTradeTs` | 186 | STORE CANDIDATE | `atStore.lastTradeTs` | verify sync | **CUTOVER** |
| `getATClosedToday` | 191 | STORE CANDIDATE | `atStore.closedTradesToday` | verify sync | **CUTOVER** |
| `getATDailyPnL` | 196 | STORE CANDIDATE | `atStore.dailyPnL` | verify sync | **CUTOVER** |
| `getTCMaxPos` | 201 | STORE CANDIDATE | `settingsStore.maxPos` | verify sync | **CUTOVER** |
| `getTCSL` | 207 | BRIDGE | none; no TC slPct canonical | store field needed | **CUTOVER with settingsStore widen** |
| `getTCSize` | 213 | BRIDGE | none; no TC size canonical | store field needed | **CUTOVER with settingsStore widen** |
| `getDSLMode` | 219 | STORE CANDIDATE | `dslStore.mode` | verify sync | **CUTOVER** |
| `getVol24h` | 227 | STORE CANDIDATE | `marketStore.vol24h` (MISSING FIELD) | widen store | **CUTOVER with widen** |
| `getMagnetBias` | 232 | STORE CANDIDATE | `marketStore.magnetBias` | verify sync | **CUTOVER** |
| `getBrainMetrics` | 247 | **HYBRID BY DESIGN** | mutable ref BM; brainStore partial | brain.ts full rewrite | **KEEP — engine rewrite v3.0** |
| `getBrainObject` | 259 | **HYBRID BY DESIGN** | mutable ref BRAIN; brainStore partial | brain.ts full rewrite | **KEEP — engine rewrite v3.0** |
| `getDSLObject` | 269 | **HYBRID BY DESIGN** | mutable ref DSL; dslStore canonical read-side | dsl.ts full rewrite | **KEEP — engine rewrite v3.0** |
| `getTCDslActivatePct` | 274 | MANUAL DSL STANDARD | fixed default 0.50 | — | KEEP (user-confirmed constant) |
| `getTCDslTrailPct` | 279 | MANUAL DSL STANDARD | fixed default 0.60 | — | KEEP |
| `getTCDslTrailSusPct` | 284 | MANUAL DSL STANDARD | fixed default 0.50 | — | KEEP |
| `getTCDslExtendPct` | 289 | MANUAL DSL STANDARD | fixed default 0.25 | — | KEEP |
| `getMagnets` | 298 | BRIDGE | marketStore has `magnetBias` scalar only | store widen for arrays | **FUTURE v3.0** (engine calc) |
| `getATObject` | 311 | **HYBRID BY DESIGN** | mutable ref AT; atStore canonical read-side | autotrade.ts full rewrite | **KEEP — engine rewrite v3.0** |
| `getTCSignalMin` | 316 | STORE CANDIDATE | `settingsStore.sigMin` | verify sync | **CUTOVER** |
| `getTPObject` | 327 | **HYBRID BY DESIGN** | mutable ref TP; positionsStore canonical read-side | autotrade.ts full rewrite | **KEEP — engine rewrite v3.0** |
| `getATMode` | 331 | uncategorized | AT.mode / _serverMode | atStore.mode exists? | **CUTOVER or justify** |
| `getDemoPositions` | 335 | uncategorized | positionsStore.demoPositions | verify | **CUTOVER** |
| `getLivePositions` | 339 | uncategorized | positionsStore.livePositions | verify | **CUTOVER** |
| `getDSLEnabled` | 343 | uncategorized | dslStore.enabled (new) | store widen | **CUTOVER with widen** |
| `getDSLPositions` | 347 | uncategorized | dslStore.positions (new) | store widen | **CUTOVER with widen** |

## ZT7 plan

**CUTOVER real** (ZT7 scope): 22 getters — 20 STORE CANDIDATE + 2 BRIDGE (getPerf, getTCSL/getTCSize) + 5 uncategorized (after verify). Some require store widening (oiTs, vol24h, TC size/slPct, dslEnabled, dslPositions).

**KEEP BY-DESIGN**: 6 HYBRID BY DESIGN + 4 MANUAL DSL + 2 already-closed = 12 getters. Documented reason: engine rewrite v3.0, not migration tail.

**FUTURE v3.0 (documented out-of-scope)**: 3 BRIDGE without canonical home (getSignalData, getFG, getKlines, getMagnets) = 4 getters. Need new stores (signalStore, fearGreedStore, klinesStore, magnetsStore) — multi-day scope.

## Cutover strategy for ZT7

1. Verify `marketStore` has live sync for: price, symbol, rsi, ls, fr, frCd, oi/oiPrev, atr, tz, bids, asks, magnetBias
2. Verify `atStore` has live sync for: lastTradeTs, closedTradesToday, dailyPnL, mode
3. Verify `settingsStore` has live sync for: maxPos, sigMin, tz
4. Verify `positionsStore` has live sync for: journal, demoPositions, livePositions
5. For each CUTOVER getter: replace `window.X.field` fallback with `useStore.getState().field`; keep window fallback only if sync adapter isn't fully verified
6. For widen cases (oiTs, vol24h, TC size/slPct, dslEnabled/Positions): extend store type + sync adapter + then cutover
7. Mark HYBRID BY DESIGN explicitly with `// v3.0 ENGINE REWRITE — DO NOT CUTOVER` comment
8. Mark FUTURE v3.0 BRIDGE explicitly similarly

Target delta: 33 live transitions → 22 cutover + 11 justified KEEP.

---

## Status post-ZT7 execution (appended 2026-04-17)

The cutover plan above assumed Zustand stores were populated in
lockstep with legacy engine writers. ZT7 discovered this assumption
was false for most STORE CANDIDATE accessors: `w.S`, `w.AT`, `w.DSL`,
`w.TP`, `w.TC` are plain mutable objects written by legacy engines
without any Zustand bridge. Only `useATBridge` (10 fields) and a
handful of `setMarket`/`setBrain` calls in specific engines actually
maintain lockstep sync.

Actual ZT7 outcome:

- **3 accessors flipped store-first with fallback** (the bridged
  fields that ARE actually populated in lockstep): `getATMode`,
  `getATClosedToday`, `getATDailyPnL`. Each now tries
  `useATStore.getState()` first and falls back to `w.AT` on throw or
  missing field.
- **17 accessors reclassified as POPULATION DEBT** in the R14
  docstring at the head of `stateAccessors.ts`. Category
  `STORE CANDIDATE — POPULATION DEBT` means: the store type declares
  the field, but no writer mirrors the legacy object into the store,
  so flipping the read side would return stale/empty values. Unblocking
  each one is a per-engine population lot, not a leaf-level cutover.
- **HYBRID BY DESIGN / BRIDGE — NO CANONICAL STORE / MANUAL DSL
  STANDARD / CLOSED (store-backed)** classifications preserved as
  originally documented; they were never in ZT7's scope.
- **Accessor total**: 44 exports (the triage above counted 43; the
  ZT7 audit recounted the module and confirmed 44).

ZT7 did NOT complete the planned "22 cutover" — that plan assumed
populated stores that do not in fact exist. The honest refined state
lives in the four-bucket classification header of
`client/src/services/stateAccessors.ts`.

Close trail: `docs/close-plan-v2/ZT7_FULL_CLOSE_REPORT.md`.
