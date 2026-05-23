# ZT3 FULL CLOSE REPORT — MTFPanel Option A Cutover

**Date:** 2026-04-17
**Scope:** Master Zero-Tail Close Plan v2 — Lot ZT3 (MTFPanel → store-driven, Option A)
**Mandate:** Eliminate engine DOM writes into MTFPanel-owned elements; React renders
from store; tsc principal = 0; vite build green; no runtime regressions.
**Verdict:** **CLOSED REAL**

---

## 1. Summary

`renderMTFPanel()` in `core/config.ts` used to perform ~160 lines of
`document.getElementById(...).textContent = ...` writes directly against the
spans rendered by `MTFPanel.tsx`. That coupling violated the R7 single-writer
invariant from the post-v2 close, which reserves DOM ownership to React in
migrated components.

ZT3 converts `MTFPanel` to a pure store-consumer:

```
engine/brain.ts (tick data) ─┐
engine/phaseFilter.ts ───────┤
engine/regime.ts ────────────┼─▶ core/config.ts::_coreTickMI
engine/brain.ts::liqCycle ───┘               │
                                             ▼
                         engine/mtfSync.ts::syncMTFStore()
                                             │
                                             ▼
                             stores/mtfStore.ts::useMTFStore
                                             │
                                             ▼
                   components/dock/MTFPanel.tsx (React render)
```

Engine no longer writes into panel spans. The legacy `renderMTFPanel()` is
retained only for the condensed strip-bar ids (which remain in legacy DOM
and will migrate in ZT4).

---

## 2. Sub-lot roll-up

### ZT3-A — mtfStore + mtfSync adapter
- Tag pair: `post-v2/ZT3-A-store-{pre,post}`
- Commit: `fb1661d`
- New: `client/src/stores/mtfStore.ts` — typed `MTFSnapshot` (regime/structure/
  ATR/vol/squeeze/ADX/volRegime/volPct/sweep/trapRate/magnets/mtfAlign/score/ts +
  RE/PF blocks), `MTFCell = { text, tone }`, `MTFTone = '' | 'good' | 'warn' | 'bad'`.
- New: `client/src/engine/mtfSync.ts::syncMTFStore()` — same classification logic
  previously embedded in `renderMTFPanel()` (regime map, structure tone, ATR
  thresholds, vol regime map, squeeze active, sweep strength, trap-rate %,
  magnet distances, MTF alignment arrows, RE regime map, RE trap/conf thresholds,
  PF phase map, PF risk mode, PF size multiplier).
- Wired: `_coreTickMI()` now calls `syncMTFStore()` alongside `renderMTFPanel()`
  (side-by-side, safe to roll back by reverting this commit).

### ZT3-B — MTFPanel.tsx becomes a store consumer
- Tag pair: `post-v2/ZT3-B-panel-{pre,post}`
- Commit: `24be271`
- `MTFPanel.tsx` rewritten. Subscribes via `useMTFStore((s) => s.snapshot)` and
  renders all rows through a `Row` helper (label + tone-driven class). DOM ids
  preserved on rendered spans so legacy CSS selectors continue to target them.
- +54 / -25 lines.

### ZT3-C — Strip engine DOM writers for panel ids
- Tag pair: `post-v2/ZT3-C-strip-{pre,post}`
- Commit: `238e504`
- `renderMTFPanel()` trimmed from 163 → 32 lines. Removed writes to
  `mtf-regime, mtf-structure, mtf-atr, mtf-vol, mtf-squeeze, mtf-adx,
  mtf-vol-regime, mtf-vol-pct, mtf-sweep, mtf-trap-rate, mtf-mag-above,
  mtf-mag-below, mtf-mag-bias, mtf-15m, mtf-1h, mtf-4h, mtf-score-txt,
  mtf-score-fill, mtf-ts, re-regime, re-trap, re-conf, pf-phase, pf-risk,
  pf-size` (25 ids).
- Retained writes to condensed strip-bar: `mtf-strip-score, mtf-bar-re,
  mtf-bar-regime, mtf-bar-score, mtf-bar-vol, mtf-bar-squeeze` (6 ids) — these
  live in legacy DOM injected by `initMTFStrip()` and are out of MTFPanel
  scope. Bar migration → ZT4.

---

## 3. Mandate compliance

| Requirement | Status | Evidence |
|---|---|---|
| No engine writes into MTFPanel-owned spans | ✅ | `grep -n "_el('mtf-regime\|_el('mtf-structure\|_el('re-regime\|_el('pf-" client/src/core/config.ts` → 0 matches |
| tsc -p tsconfig.app.json = 0 errors | ✅ | Empty output on every sub-lot |
| vite build green | ✅ | "built in 704ms" on ZT3-C final |
| No test regressions | ✅ | Same 4 pre-existing failures (ATPanel kill banner + 3 BrainCockpit) — both pre-ZT3 and post-ZT3 |
| Sub-lot protocol (pre+post tag, commit, push per sub-lot) | ✅ | 6 tags, 3 commits |
| Truthful closure | ✅ | Classification logic ported 1:1 (regime/structure/ATR/vol thresholds reproduced exactly); no invention |

---

## 4. Verification commands

```bash
# Confirm no MTFPanel-owned id writes remain in engine:
grep -n "_el('mtf-regime\|_el('mtf-structure\|_el('mtf-atr\|_el('mtf-vol\|_el('mtf-squeeze\|_el('mtf-adx\|_el('mtf-vol-\|_el('mtf-sweep\|_el('mtf-trap\|_el('mtf-mag\|_el('mtf-score\|_el('mtf-ts\|_el('re-\|_el('pf-" client/src/core/config.ts
# → (no matches)

# Confirm retained strip-bar writes (out of scope):
grep -n "mtf-strip-score\|mtf-bar-" client/src/core/config.ts
# → 6 writes (mtf-strip-score, mtf-bar-re, mtf-bar-regime, mtf-bar-score, mtf-bar-vol, mtf-bar-squeeze)

# tsc:
cd client && npx tsc --noEmit -p tsconfig.app.json   # → 0 errors

# build:
cd client && npm run build   # → built in ~700ms
```

---

## 5. Artifacts

- Tags: `post-v2/ZT3-A-store-{pre,post}`, `post-v2/ZT3-B-panel-{pre,post}`,
  `post-v2/ZT3-C-strip-{pre,post}`.
- Commits: `fb1661d` (store+sync), `24be271` (panel), `238e504` (strip).
- Branch: `post-v2/real-finish` (pushed).

---

## 6. Verdict

**ZT3 — CLOSED REAL.**

MTFPanel is now a pure React store-consumer. Engine no longer writes into
panel-owned DOM. `syncMTFStore()` is the single writer for
`useMTFStore`. Classification logic (tones, thresholds, arrow glyphs, label
maps) is a 1:1 port of the prior engine code, not a reimagined version.

Next up: **ZT4 — Risk strip Option A cutover** (covers the
`mtf-bar-*` / `mtf-strip-score` writes still remaining + the risk strip it
belongs to).
