# Post-v2 — R28.2 TRUE CLOSE REPORT

**Date:** 2026-04-17
**Lot:** R28.2 — ARES Option A full store+UI conversion
**Sub-lots:** A → J (all executed, zero skipped)
**Verdict:** **CLOSED REAL**

---

## 0. Pre/post-tag inventory

```
post-v2/R28.2-A-typestore-{pre,post}       AresStoreUI type + DEFAULT_ARES_UI
post-v2/R28.2-B-syncadapter-{pre,post}     aresStoreSync.ts + syncAresUIToStore()
post-v2/R28.2-C-stripcogstats-{pre,post}   StripBadge/StripConf/ImmSpan/EmotionSpan/
                                            CognitiveBar/StatsRow
post-v2/R28.2-D-wallstageobj-{pre,post}    StageCol/WalletCol/ObjectivesCol
post-v2/R28.2-E-positions-{pre,post}       PositionsList + live/demo close path
post-v2/R28.2-F-svg-{pre,post}             BrainDots overlay + MissionArc
post-v2/R28.2-G-text-{pre,post}            WoundLine/DecisionLine/ThoughtStream/
                                            LessonText/HistoryBar + dead-code kill
post-v2/R28.2-H-events-{pre,post}          strip-bar toggle → store, delete initARES()
                                            + 4 inline onclick=""
post-v2/R28.2-I-purge-{pre,post}           window.ARES UI detox (components/)
post-v2/R28.2-J-close-{pre,post}           close report (this document)
```

Each sub-lot shipped through the full protocol: backup, pre-tag, code, tsc
typecheck filter, `vite build`, `pm2 restart zeus`, pm2 log sanity check,
git commit, post-tag. No silent reclassifications.

---

## 1. What moved to the store (real)

`client/src/types/ares.ts` → `AresStoreUI` now owns every UI field that used
to be read or derived imperatively in `aresUI.ts`:

| Slice | Populated by | Consumed by (React) |
|---|---|---|
| `ui.core` (id/label/emoji/color/glow/consecutiveLoss) | aresStoreSync `_core()` | StripBadge, BrainDots (glow coupling) |
| `ui.confidence` | aresStoreSync | StripConf |
| `ui.immPct` | aresStoreSync | ImmSpan |
| `ui.emotion` | aresStoreSync | EmotionSpan |
| `ui.wound` (visible/kind/text/color) | aresStoreSync `_wound()` | WoundLine |
| `ui.decision` (visible/side/reasons/color) | aresStoreSync `_decision()` | DecisionLine |
| `ui.stage` (name/from/to/pct/bar/next/complete) | aresStoreSync `_stage()` | StageCol |
| `ui.wallet` (balance/available/locked/failBannerVisible/withdrawEnabled) | aresStoreSync `_wallet()` | WalletCol |
| `ui.objectives[3]` + `ui.objectivesTitle` | aresStoreSync `_objectives()` | ObjectivesCol |
| `ui.positions[]` + `ui.closeAllVisible` | aresStoreSync `_positions()` | PositionsList |
| `ui.cognitive.clarity` + `ui.cognitive.cogLines` | aresStoreSync `_cognitive()` | CognitiveBar, ThoughtStream |
| `ui.stats` (day/delta/prediction/winRate) | aresStoreSync `_stats()` | StatsRow |
| `ui.lobDots[6]` + `ui.consciousnessActiveIdx` | aresStoreSync `_lobDots()` + `_consciousnessActiveIdx()` | BrainDots |
| `ui.missionArc` (visible/pct/tPct/col/startBalance/daysPassed/trajectoryDelta) | aresStoreSync `_missionArc()` | MissionArc |
| `ui.thoughts[]` | aresStoreSync `_thoughts()` | ThoughtStream |
| `ui.lesson` | aresStoreSync — concat of lastLesson + patternInsight | LessonText |
| `ui.history[]` | aresStoreSync `_history()` | HistoryBar |
| `ui.stripOpen` | setStripOpen action (user toggle) | ARESPanel className, config.ts tick gate |

Sync cadence: `syncAresUIToStore()` runs at the top of `_aresRender()` so
every engine tick drives a partial-merge into the store; no component
re-renders unless its narrow selector changes.

## 2. What exited imperative rendering (real)

Each of the following imperative DOM paths that used to live in
`aresUI.ts::_aresRender` is replaced by a memo'd React subscriber:

| Old path | New React owner |
|---|---|
| `document.getElementById('ares-strip-badge').innerHTML = icon+label` | StripBadge |
| `document.getElementById('ares-strip-conf').textContent = ...` | StripConf |
| `document.getElementById('ares-imm-span').textContent = ...` | ImmSpan |
| `document.getElementById('ares-emotion-span').innerHTML = ...` | EmotionSpan |
| `document.getElementById('ares-cog-fill').style.width = pct%` | CognitiveBar |
| 4× `document.getElementById('ares-stat-*').textContent = ...` | StatsRow |
| `ares-stage-name` / `-prog-bar` / `-prog-next` textContent triplet | StageCol |
| 4 wallet `document.getElementById(...).textContent = ...` + 2 style mutations | WalletCol |
| 3× `aobj-N`/`aobj-Nb` per objective + title | ObjectivesCol |
| `positions-list.innerHTML = map(...).join('')` + per-tick close-btn wiring | PositionsList |
| 6× `document.getElementById('ldot-*').setAttribute('fill'/'opacity')` | BrainDots (lobs) |
| 3× consciousness dot setAttribute (c0/c1/c2) | BrainDots (consciousness) |
| `arc-svg.innerHTML = _aresRenderArc(...)` (40-line helper) | MissionArc |
| `wound-line.innerHTML = icon+text` | WoundLine |
| `decision-line.innerHTML = icon+text` + visible toggle | DecisionLine |
| `thought-inner.innerHTML = lines.join('')` + animation duration mutation | ThoughtStream |
| `lesson-text.textContent = lastLesson + patternInsight` | LessonText |
| `history-bar.innerHTML = dots.map(...).join('')` | HistoryBar |
| Strip-bar toggle: `classList.toggle('open')` on a ref | Store `setStripOpen` + className binding |

## 3. What disappeared from aresUI.ts

- `_aresRenderArc()` (~40 lines) — superseded by `<MissionArc />`.
- Dead SVG-builder block (~170 lines): `const V = [...]`, `TRIS`, `ZC`, `HOT`,
  `EDGES`, `ZONES`, and the `let svg = '…'; svg += …` sequence that built
  a brain SVG string but never wrote it anywhere. Live brain always came
  from `initAriaBrain()`; this was pure dead code carried forward from
  the deepdive.js port.
- `initARES()` (~136 lines) — the legacy pre-React scaffold with
  `wrap.innerHTML = '…'` injecting the full strip plus **4 inline
  `onclick=""` handlers** (strip-bar toggle, wallet add prompt, wallet
  withdraw prompt, close-all button). Shadowed since ARESPanel.tsx
  mounted unconditionally and its early-return guard triggered on every
  call. Now deleted outright; the first-tick `setTimeout(ARES.tick, 1000)`
  it used to schedule is preserved at the call site in bootstrapStartApp.
- Helper `_setIconText(el, iconSvg, trailingText)` — no remaining callers
  after icons migrated to React (`dangerouslySetInnerHTML` on trusted
  `_ZI.*` SVG constants, or plain JSX text).
- Unused imports purged: `escHtml`, `fP`, `ARES_DECISION`, `ARES_MIND`,
  `ARES_MONITOR`, `TARGET`.
- LOB_DOTS + DOT_COLORS consts (moved into BrainDots) and the
  `LOB_DOTS.forEach` emission block inside `generateBrainSVG`.

Size delta: **~470 lines removed** from aresUI.ts across sub-lots C–I
(pre: ~1500, post: 1033). What remains is (a) the CSS IIFE block, (b)
the dual-writer shim `_aresRender()` that now does nothing except call
`syncAresUIToStore()` + bootstrap `initAriaBrain()` once, (c) the
`initAriaBrain()` neuron-starfield RAF engine (~400 lines, writes only
to animation properties, not UI state), (d) `_demoTick()`, and (e) the
`ARES_BRAIN_COLOR_OVERRIDE()` CSS injector.

## 4. Grep-zero verification

Run in `client/src/`:

```
grep -rE 'onclick=' src/engine/aresUI.ts
  → 1 match, inside a comment block ("4 inline onclick=\"\" handlers")
  → functional onclick count = 0

grep -rE 'addEventListener' src/engine/aresUI.ts
  → 0

grep -rE 'w\.ARES|window\.ARES' src/components/
  → 0  (was 10 pre-R28.2-I)

grep -nE "ares-strip" src/core/config.ts
  → 0  (was: `document.getElementById('ares-strip')?.classList.contains('open')`)

grep -rE '\.innerHTML\s*=' src/engine/aresUI.ts
  → 1 functional: line 847 `panel.innerHTML = svg` inside initAriaBrain
    — one-shot static brain-anatomy write, author-authored template,
    no user input flow. Per-tick output path is innerHTML-clean.
```

Comment-only matches are shown explicitly so the report does not claim
clean greps it did not deliver.

## 5. Runtime checks

After each sub-lot post-tag, PM2 zeus was restarted and `pm2 logs zeus`
tail inspected:

- `Zeus Terminal started on port 3000`
- `[MIGRATION] Feature flags: ... CLIENT_BRAIN:true CLIENT_AT:true`
- `[WS] Client connected uid=1` (x2)
- `[AT_DB] State restored uid=1: mode=demo seq=1757 balance=$10000.00`
- `[AT_DB] Restored 1 open position(s)`
- `[DSL] [S1753] Attached LONG BTCUSDT @ $74675.58 | Activation: $75048.96`
- `[BRAIN] Config updated uid=1` cadence continuing post-restart
- No `[_aresRender]` warnings, no `ARIA BRAIN error`, no React hydration
  errors, no ReferenceError from the removed helpers/consts

Bundle size dropped ~9KB (`index.js`: 1,583.95 → 1,574.75 KB gzip
448.26 → 446.16) purely from dead-code removal in R28.2-G + H.

## 6. window.ARES: business SoT, not UI SoT

Remaining `window.ARES` reads across `client/src/`:

| File | Lines | Purpose | Classification |
|---|---|---|---|
| `engine/aresStoreSync.ts` | `_positions`, `_wallet`, `_core`, … | Engine → store mirror (read ARES, write ui.*) | Business → UI bridge (the dual-writer itself) |
| `stores/aresStore.ts::_readFromEngine` | 4 reads | Fallback only when `/api/user/ares` fetch fails | Legitimate business bootstrap |
| `stores/aresStore.ts` fundWallet / withdrawWallet / closeArePosition / closeAllArePositions | 4 actions | Imperative engine business calls, triggered by UI events | Business actions, not state reads |
| `components/dock/ares/*` | 0 | — | **0 reads (target)** |

**Outcome:** `window.ARES` is the engine's business SoT. The UI tree
subscribes exclusively to the Zustand `ui` slice via narrow selectors.
Components never read `window.ARES` for rendering state; they dispatch
store actions that wrap the imperative engine APIs.

## 7. Verdict

**CLOSED REAL.**

All ten sub-lots A–J executed under the full backup + pre-tag + code +
typecheck + build + restart + commit + post-tag protocol. Each deferred
item called out in the R28.2 plan shipped with matching evidence
(pre/post tags, commit hash, grep deltas, bundle delta).

`aresUI.ts` is no longer the principal renderer — its `_aresRender()`
is a 15-line shim whose only remaining functional work is
`syncAresUIToStore()` plus a one-time `initAriaBrain()` bootstrap. The
neural brain starfield animation remains imperative (RAF loop mutating
`opacity`/`fill` on `abn-*` SVG children) — that is animation, not UI
state. No user-adjacent text passes through any imperative innerHTML on
the output path. The 4 inline `onclick=""` handlers that motivated R28
are deleted outright rather than neutered; `initARES()` itself is gone.

`window.ARES` survives as the engine business SoT only. It is consulted
by the dual-writer (`aresStoreSync.ts`) and by store action wrappers
that expose narrow imperative capabilities (fund/withdraw/close) to the
UI. The UI component tree does not read it at all.

### Known non-goals (not in R28.2 scope, still present)

- `initAriaBrain()` still lives in `aresUI.ts` (~400 lines). Splitting
  it into `engine/aresBrainStarfield.ts` would reduce `aresUI.ts` below
  100 lines but adds module churn with no runtime benefit. Deferred to
  a future cleanup lot if desired.
- The `_aresCSS()` IIFE blocks (~150 lines of styles) could move to a
  real stylesheet for better cacheability. Out of scope.
- `aresStore._readFromEngine` keeps its `window.ARES` fallback — this
  is the correct place for a business-SoT bridge on failed server
  fetch, not a UI SoT leak.
