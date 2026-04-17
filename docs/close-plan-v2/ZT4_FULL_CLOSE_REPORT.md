# ZT4 FULL CLOSE REPORT — Risk Strip Option A Cutover

**Date:** 2026-04-17
**Scope:** Master Zero-Tail Close Plan v2 — Lot ZT4 (EXIT RISK strip / qexit-risk-strip → store-driven, Option A)
**Mandate:** Eliminate engine DOM writes into the qexit risk strip; React renders
from store; tsc principal = 0; vite build green; no runtime regressions.
**Verdict:** **CLOSED REAL**

---

## 1. Summary

`_qebUpdateRiskUI()` in `engine/forecast.ts` used to perform direct DOM writes
against six spans inside the EXIT RISK strip (inside the Scenario Engine
section of `AnalysisSections.tsx`):

- `qexit-risk-strip` (container visibility)
- `qexit-bar-fill` (width + background)
- `qexit-risk-val` (textContent + color)
- `qexit-action-badge` (textContent + class)
- `qexit-sigs-detail` (innerHTML, 4 signal rows)
- `qexit-advisory` (innerHTML + color)

That coupling violated the R7 single-writer invariant for React-owned
components.

ZT4 converts the strip to a pure store-consumer:

```
engine/brain.ts (tick data) ─┐
engine/forecast.ts::_qebTick ┤
user position state (TP) ────┼─▶ _qebUpdateRiskUI()
settingsStore (smartExit) ───┘               │
                                             ▼
                         useQexitRiskStore.getState().setSnapshot()
                                             │
                                             ▼
                   stores/qexitRiskStore.ts::useQexitRiskStore
                                             │
                                             ▼
          components/analysis/AnalysisSections.tsx::QexitRiskStrip
```

Engine no longer touches qexit-* DOM. The consumer JSX in the Scenario Engine
section subscribes to the store through a `QexitRiskStrip` subcomponent.

---

## 2. Sub-lot roll-up

### ZT4-A — qexitRiskStore + engine→store writer
- Tag pair: `post-v2/ZT4-A-store-{pre,post}`
- Commit: `cc099b7`
- New: `client/src/stores/qexitRiskStore.ts` — `QexitAction =
  'HOLD'|'TIGHTEN'|'REDUCE'|'EMERGENCY'`, `QexitSignalRow {name, valueHtml}`,
  `QexitRiskSnapshot {visible, risk, action, fillColor, valueColor, signals,
  advisoryHtml, advisoryColor}`, `emptyQexitRiskSnapshot`, `useQexitRiskStore`.
- Rewrote: `engine/forecast.ts::_qebUpdateRiskUI()` — now computes snapshot
  and calls `useQexitRiskStore.getState().setSnapshot(next)` instead of
  `document.getElementById().textContent/.innerHTML/.style` writes.
- Classification ports 1:1:
  - risk → fill/value color: `<40 #556677`, `<60 #f0c040`, `<80 #ff8844`,
    `>=80 #ff2244`
  - Signal rows (DIVERGENCE/VOL CLIMAX/REGIME FLIP/LIQ ABOVE) — HTML markup
    reproduced exactly (BEAR/BULL color spans, conf %, mult, regime flip
    arrow, liquidity dist%).
  - Advisory line: bolt + "Smart Exit ENABLED…" when smartExitEnabled=true
    (gold), eye + "Advisory mode…" otherwise (#556677).
  - hasPos gate: hides strip when no open demo position, matches prior
    `display: none` behavior.

### ZT4-B — QexitRiskStrip subcomponent consumes store
- Tag pair: `post-v2/ZT4-B-panel-{pre,post}`
- Commit: `a509f37`
- `AnalysisSections.tsx` gains a `QexitRiskStrip` subcomponent that subscribes
  to `useQexitRiskStore((s) => s.snapshot)` and renders:
  - container `display: snap.visible ? 'block' : 'none'`
  - fill width `snap.risk + '%'`, background `snap.fillColor`
  - value text `{snap.risk}`, color `snap.valueColor`
  - badge class `'qexit-action ' + snap.action`, text `{snap.action}`
  - signal rows `<div class="qexit-sig-row"><span class="qexit-sig-name">NAME
    </span> HTML</div>` (matches prior innerHTML exactly)
  - advisory: color `snap.advisoryColor`, innerHTML `snap.advisoryHtml`
- The legacy JSX block (12 static lines of placeholder markup at lines
  727–738) replaced with `<QexitRiskStrip />`.
- DOM ids preserved on rendered elements so any legacy CSS selectors still
  target them.

### ZT4-C — Verify no residual engine writes
- Tag pair: `post-v2/ZT4-C-verify-{pre,post}`
- No commit (verification only).
- `grep -rn "getElementById.'qexit-\|_el('qexit-" client/src/` → 0 matches.
- `grep -rn "qexit-(bar-fill|risk-val|action-badge|sigs-detail|advisory|
  risk-strip)" client/src/` → 6 hits, all inside `AnalysisSections.tsx`
  (React-owned render) + 1 comment in `qexitRiskStore.ts`.
- Test suite: 4 pre-existing failures (ATPanel kill banner + 3 BrainCockpit
  neural grid), same counts as pre-ZT4, confirmed not regressions.

---

## 3. Mandate compliance

| Requirement | Status | Evidence |
|---|---|---|
| No engine writes into qexit-* DOM ids | ✅ | `grep "getElementById.'qexit-" src/` → 0 matches |
| tsc -p tsconfig.app.json = 0 errors | ✅ | Empty output on ZT4-A, ZT4-B |
| vite build green | ✅ | "built in 742ms" (ZT4-A), "built in 658ms" (ZT4-B) |
| No test regressions | ✅ | Same 4 pre-existing failures pre- and post-ZT4 |
| Sub-lot protocol (pre+post tag, commit, push per sub-lot) | ✅ | 6 tags, 2 commits |
| Truthful closure | ✅ | Classification logic ported 1:1 (risk→color thresholds, signal HTML, advisory branch); no invention |

---

## 4. Verification commands

```bash
# Confirm no engine DOM writes to qexit ids:
grep -rn "getElementById.'qexit-\|_el('qexit-\|_el(\"qexit-" client/src/
# → (no matches)

# All qexit-* id references — should all be in React JSX + store comment:
grep -rn "qexit-bar-fill\|qexit-risk-val\|qexit-action-badge\|qexit-sigs-detail\|qexit-advisory\|qexit-risk-strip" client/src/
# → 6 hits in AnalysisSections.tsx (React render) + 1 comment in qexitRiskStore.ts

# tsc:
cd client && npx tsc --noEmit -p tsconfig.app.json   # → 0 errors

# build:
cd client && npm run build   # → built in ~700ms
```

---

## 5. Artifacts

- Tags: `post-v2/ZT4-A-store-{pre,post}`, `post-v2/ZT4-B-panel-{pre,post}`,
  `post-v2/ZT4-C-verify-{pre,post}`.
- Commits: `cc099b7` (store+engine writer), `a509f37` (JSX consumer).
- Branch: `post-v2/real-finish` (pushed).

---

## 6. Verdict

**ZT4 — CLOSED REAL.**

The EXIT RISK strip (`qexit-risk-strip`) is now a pure React store-consumer.
Engine no longer writes into strip-owned DOM. `_qebUpdateRiskUI()` is the
single writer for `useQexitRiskStore`, and `QexitRiskStrip` is the single
reader. Classification logic (risk-color thresholds, signal HTML, advisory
branch, visibility gate) is a 1:1 port, not a reimagined version.

Next up: **ZT5 — Brain cockpit stats Option A** (remaining engine DOM
writes into BrainCockpit stats spans).
