# ZT8 FULL CLOSE REPORT — phase1Adapters Reduction

**Date:** 2026-04-17
**Scope:** Master Zero-Tail Close Plan v2 — Lot ZT8 (phase1Adapters.ts
reduction + truthful header documentation).
**Mandate:** Audit every direct `window.*` attachment in
`client/src/bridge/phase1Adapters.ts::installPhase1Adapters()`; remove
bindings with no readers; rewrite the header to reflect the post-v2
state. No structural changes to side-effect import composition.
**Verdict:** **CLOSED REAL**

---

## 1. Summary

The ZT1.b triage (`docs/ZT-TRIAGE-phase1Adapters.md`) already established
that `phase1Adapters.ts` is not "100+ window exports" of migration debt —
it is **24 direct window slots** (at pre-ZT8 count) plus ~60 side-effect
imports for module self-registration. The side-effect imports are
intentional composition (each module self-registers on `window` via its
own IIFE) and cannot be collapsed without rewriting every consumer.

ZT8 executed the remaining cleanup promised by that triage:

- **Audited all 24 direct window attachments** by grep-verifying their
  readers in `client/src/`, `public/legacy/`, and `public/legacy/js/`.
- **Removed 2 verified-dead bindings**: `w.procLiq` and `w.showTab`.
  Neither had a live reader in any surface. procLiq is used only
  internally inside `marketDataWS.ts`; showTab has zero `onclick="show
  Tab("` bindings in legacy HTML and zero TS callers.
- **Rewrote the header comment** to drop stale "ZT1.b triage" / "ZT2-B"
  timeline language and replace it with a post-v2 classification of what
  remains.
- **Documented side-effect import policy as intentional** so future
  audits don't re-flag the composition as debt.

Result: bridge surface reduced from 24 → **22 direct window slots**.
Module side-effect imports (the ~60 bare `import '../foo'` lines) were
NOT touched — they remain the correct composition mechanism.

---

## 2. Audit method

1. **Enumerated** every `w.<name> =` assignment in
   `installPhase1Adapters()` body (24 slots).
2. **Grep-verified** each slot's readers across three surfaces:
   - `client/src/` (TypeScript/React — both `w.<name>` and `window.<name>`)
   - `public/legacy/index.html` (legacy HTML `onclick="…"`)
   - `public/legacy/js/**/*.js` (legacy bundled JS that runs alongside)
3. **Classified**: LIVE (has reader) vs DEAD (no reader anywhere).
4. **Confirmed** the server does not route `public/legacy/index.html` —
   no reference to `legacy/index.html` in `server/` or vite configs —
   so legacy HTML onclick bindings are dead unless mirrored in React or
   the active `client/index.html` entry.
5. Dropped the DEAD bindings only. Every LIVE binding stayed.

---

## 3. Audit table — 24 window slots

| # | Slot | Kind | Reader verification | Disposition |
|---|---|---|---|---|
| 1 | `ZT_safeInterval` | CRITICAL SHIM | `arianova.ts` IIFE reads at import time | KEEP |
| 2 | `MSCAN` | STATE REF | `klines.ts` writes; `arianova.ts:1410`, `ui/render.ts` read | KEEP |
| 3 | `DHF` | STATE REF | `autotrade.ts:325/775/1396/1397` read/write | KEEP |
| 4 | `PERF` | STATE REF (HYBRID) | `klines.ts:145`, `utils/dev.ts`, engine internals | KEEP |
| 5 | `ARM_ASSIST` | STATE REF | `trading/dsl.ts:167-169` read/write | KEEP |
| 6 | `_fakeout` | STATE REF | engine-internal counter | KEEP |
| 7–16 | `cSeries`, `cvdS`, `cvdChart`, `volS`, `ema50S`, `ema200S`, `wma20S`, `wma50S`, `stS`, `srSeries` | CHART BRIDGE | `utils/dev.ts:825`, `chartBridge.ts`, `marketDataChart.ts`, `marketDataWS.ts:339` | KEEP (null init keeps `typeof` checks safe before initCharts runs) |
| 17 | `_showConfirmDialog` | CROSS-CALL + onclick | `engine/brain.ts:479/576/623` read via `(window as any)._showConfirmDialog` | KEEP |
| 18 | `calcPosPnL` | CROSS-CALL | `trading/dsl.ts:546` + `trading/autotrade.ts:1854` read via `w.calcPosPnL` | KEEP |
| 19 | `getDemoLev` | CROSS-CALL | `core/config.ts:1511` reads via `w.getDemoLev` | KEEP |
| 20 | `updateDemoLiqPrice` | CROSS-CALL | `data/marketDataFeeds.ts:99`, `components/dock/ManualTradePanel.tsx:51/71/72` read via `w.updateDemoLiqPrice` | KEEP |
| 21 | `updateDemoBalance` | CROSS-CALL | 11 call sites across `trading/autotrade.ts`, `data/marketData*.ts`, `core/state.ts`, `core/bootstrapStartApp.ts` | KEEP |
| 22 | ~~`procLiq`~~ | STATE WRITER | **0 readers** (only internal call inside `marketDataWS.ts:61/62/93` which is in the same module and doesn't need `w.`) | **REMOVED** |
| 23 | ~~`showTab`~~ | onclick handler | **0 readers** — `grep -c showTab public/legacy/index.html` = 0; no TS caller; legacy JS has its own local definition | **REMOVED** |
| 24 | `testNotification` | onclick handler | `public/legacy/index.html:3123` (`onclick="testNotification()"`) + `components/modals/AlertsModal.tsx:129` (`w.testNotification?.()`) | KEEP |

22 of 24 slots are genuinely live. 2 were dead.

---

## 4. Changes applied

One file touched: `client/src/bridge/phase1Adapters.ts`.

### 4.1 Removed dead imports

```diff
-import { procLiq, showTab, testNotification } from '../data/marketDataWS'
+import { testNotification } from '../data/marketDataWS'
```

### 4.2 Removed dead window bindings

```diff
-  w.procLiq = procLiq
-  w.showTab = showTab
   w.testNotification = testNotification
```

The `procLiq` and `showTab` module-level exports in `marketDataWS.ts`
are intentionally kept — `procLiq` is still called from inside
`marketDataWS.ts` itself (lines 61/62/93), and leaving `showTab`
exported preserves future optionality. Only the window bindings were
dropped.

### 4.3 Rewrote file header comment

- Replaced "ZT1.b triage (2026-04-17): bridge surface = 24" with "ZT8
  resolution (2026-04-17): bridge surface = 22".
- Added explicit justification for WHY the ~60 side-effect imports are
  kept: each module self-registers via IIFE; collapsing would require
  rewriting every consumer.
- Split the "8 onclick handlers" counter into the honest sub-classes:
  5 cross-call handlers + 1 legacy-HTML onclick (testNotification).
- Documented the null-init rationale on the 10 chart-series refs so
  future audits don't flag them as pointless.

---

## 5. What ZT8 deliberately did NOT do

- **Did not touch the side-effect import list.** 60+ bare `import
  '../foo'` lines remain as-is. They are composition, not debt.
- **Did not remove `showTab` and `procLiq` exports.** Removing exports
  is a different lot (export-surface audit). ZT8 is a window-binding
  reduction; deleting exports risks breaking an import somewhere that a
  tree-shake pass didn't see.
- **Did not rewrite any cross-call reader.** `brain.ts` still reads
  `(window as any)._showConfirmDialog`, `autotrade.ts` still calls
  `w.updateDemoBalance()`, etc. Those would each need a direct named
  import — that's a reader refactor, out of scope.
- **Did not remove the chart-series null init.** Could arguably be
  removed because `marketDataChart.ts` overwrites all of them when
  `initCharts()` runs — but any TS/legacy reader that fires before
  `initCharts()` would then see `undefined` instead of `null`, and the
  `typeof w.cSeries !== 'undefined'` check in `utils/dev.ts:825` would
  flip. Keeping the null init is the safer bet.

---

## 6. Mandate compliance

| Requirement | Status | Evidence |
|---|---|---|
| Every window binding classified | ✅ | 24 slots audited; 22 live, 2 dead |
| Dead bindings removed | ✅ | `w.procLiq`, `w.showTab` gone + named imports trimmed |
| Header truthful | ✅ | Replaced "24 slots" / stale phase language with 22 + post-v2 classification |
| No scope creep | ✅ | 1 file changed, 8 lines net (−3 deletions, +16 comment expansion) |
| Side-effect imports preserved | ✅ | ~60 bare imports untouched |
| tsc principal = 0 | ✅ | Empty stderr |
| vite build green | ✅ | "built in 689ms" |
| No test regressions | ✅ | 4 failures = pre-ZT8 baseline |

---

## 7. Verification commands

```bash
# Confirm dead bindings gone:
grep -n "w\.procLiq\|w\.showTab" client/src/bridge/phase1Adapters.ts
# → 0 matches

# Confirm no other reader appeared for them:
grep -rn "w\.procLiq\|w\.showTab\|window\.procLiq\|window\.showTab" client/src/
# → 0 matches

grep -rn "onclick=['\"]showTab\|onclick=['\"]procLiq" public/legacy/
# → 0 matches

# Confirm all other bindings still present:
grep -c "^  w\." client/src/bridge/phase1Adapters.ts
# → 22

# Build + principal:
cd client && npx tsc --noEmit -p tsconfig.app.json && npm run build
# → 0 errors / built ~690ms
```

---

## 8. Artifacts

- Tag pair: `post-v2/ZT8-pre`, `post-v2/ZT8-post`
- Commit: `ZT8: phase1Adapters reduction — 2 dead window bindings removed`
- Branch: `post-v2/real-finish` (pushed)
- Final close tag: `post-v2/ZT8-FULL-CLOSED`

---

## 9. Verdict

**ZT8 — CLOSED REAL.**

Bridge surface trimmed from 24 → 22 live window slots. Header comment
rewritten to drop stale "ZT1.b triage" / "ZT2-B" timeline references
and to document why the side-effect import list is intentional
composition rather than migration debt. Every remaining window binding
has at least one verified reader in TS, React, or legacy HTML. The
"100+ exports" claim from the original audit was overstated — truthful
post-v2 count is 22 direct attachments + ~60 self-registering module
imports.

Next up: **ZT9 — Telegram fetch migration + i18n**.
