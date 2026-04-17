# ZT11 FULL CLOSE REPORT — Minor repo cleanup

**Date:** 2026-04-17
**Scope:** Master Zero-Tail Close Plan v2 — Lot ZT11 (export-surface
follow-on to ZT8). Remove genuinely-dead exports that ZT8 deliberately
left alone because they were outside the window-binding reduction
boundary.
**Mandate:** Same as every ZT lot — minimal, verifiable fix; no
structural rewrites; tsc principal = 0; vite green; no regressions.
**Verdict:** **CLOSED REAL**

---

## 1. Summary

ZT8 removed the `w.procLiq` and `w.showTab` window bindings after grep
verified zero readers anywhere. The ZT8 close report explicitly
deferred the matching export-surface audit:

> The `procLiq` and `showTab` module-level exports in
> `marketDataWS.ts` are intentionally kept — `procLiq` is still called
> from inside `marketDataWS.ts` itself (lines 61/62/93), and leaving
> `showTab` exported preserves future optionality. Only the window
> bindings were dropped.

ZT11 closes that follow-on:

1. **`showTab`**: fully removed. Zero readers in `client/src/` (both
   `showTab` references and `marketDataWS` named-import lists
   grep-verified). The `/legacy/` bundle has its own locally-declared
   `function showTab()` in `public/legacy/js/data/marketData.js:1666`
   and does not consume the React module — so the export was
   completely unreachable.
2. **`procLiq`**: demoted from `export function` to module-private
   `function`. Internal callers on lines 61/62/93 of the same file
   are unchanged; no external reader exists after the ZT8 window
   binding was removed.

No other changes. This is the narrow cleanup ZT8 named, nothing more.

---

## 2. Changes applied

One file touched: `client/src/data/marketDataWS.ts`.

### 2.1 `procLiq` — demoted to module-private

```diff
-// ===== PROCESS LIQUIDATION =====
-export function procLiq(o: any, src?: string): void {
+// ===== PROCESS LIQUIDATION =====
+// Module-private: the two WebSocket handlers above (lines ~61/62/93)
+// are the only callers. The `w.procLiq` bridge binding was removed in
+// ZT8 after audit confirmed zero external readers.
+function procLiq(o: any, src?: string): void {
```

Dropping `export` narrows the module's public surface without
touching any call path.

### 2.2 `showTab` — deleted

```diff
-// ===== CHART SETTINGS =====
-export function showTab(tab: string, btn: any): void { document.querySelectorAll('.ctab-pane').forEach((p: any) => p.classList.remove('act')); document.querySelectorAll('.ctab-btn').forEach((b: any) => b.classList.remove('act')); const pane = el('ct-' + tab); if (pane) pane.classList.add('act'); if (btn) btn.classList.add('act') }
-export function applyChartColors(): void { … }
+// ===== CHART SETTINGS =====
+// ZT11: `showTab` removed — zero readers across client/src (TS/React)
+// and the /legacy/ bundle has its own local showTab() in
+// public/legacy/js/data/marketData.js. The `w.showTab` bridge binding
+// was removed in ZT8.
+export function applyChartColors(): void { … }
```

The leading comment is retained so a future audit sees the full
removal lineage (ZT8 unbind → ZT11 delete).

---

## 3. What ZT11 deliberately did NOT do

- **Did not attempt a full export-surface audit across all
  `client/src/`.** Dead exports are a known tail in any mid-sized
  TypeScript codebase and TS strict mode (`noUnusedLocals: true`) does
  not flag them. A full sweep would be an unbounded lot; ZT11 is
  narrowly scoped to the two exports ZT8 explicitly named.
- **Did not touch data backup directories under
  `data/backups/post-v2/`.** Those are the pre-state snapshots taken
  by `scripts/backup-pre-phase.sh` as part of the migration
  discipline. They are intentionally tracked (18 files currently) and
  exist to support rollback. Removing them would break the audit
  trail.
- **Did not change `.gitignore`.** Current rules already cover
  `.env.*`, `*.bak*`, `data/db_backups/`, etc. — no missing rule
  surfaced.
- **Did not consolidate package `scripts`.** `backup-pre-phase.sh`,
  `rollback-to-phase.sh`, `migrate-ctx-to-sqlite.js`,
  `validate-ctx-sqlite-vs-fs.js` are all still referenced in
  `MIGRATION_LOG.md` and would be needed for the deferred Phase 2
  server migration; not dead.

---

## 4. Mandate compliance

| Requirement | Status | Evidence |
|---|---|---|
| `showTab` export surface clean | ✅ | `grep -rn "\bshowTab\b" client/src/` → only doc-comment references in phase1Adapters + marketDataWS header |
| `procLiq` demoted | ✅ | Line 116 `function procLiq(…)` (was `export function`) |
| Internal `procLiq` callers unchanged | ✅ | Lines 61/62/93 still call `procLiq(…)` unchanged |
| tsc principal = 0 | ✅ | Empty stderr |
| vite build green | ✅ | "built in 708ms" |
| No test regressions | ✅ | 4 failures = pre-ZT11 baseline (ATPanel kill banner + 3 BrainCockpit neural-grid label tests) |
| No scope creep | ✅ | 1 file touched, 2 targeted edits |

---

## 5. Verification commands

```bash
# 1. showTab fully gone as an export/function:
grep -n "export function showTab\|function showTab" client/src/data/marketDataWS.ts
# → 0 matches

# 2. showTab has no live reader anywhere:
grep -rn "\bshowTab\b" client/src/ | grep -v "//"
# → 0 matches

# 3. procLiq is module-private:
grep -n "procLiq" client/src/data/marketDataWS.ts
# → 3 internal call sites (lines 61/62/93) + 1 declaration (line 116) + comments

# 4. No external procLiq readers:
grep -rn "\bprocLiq\b" client/src/ | grep -v "client/src/data/marketDataWS.ts" | grep -v "//"
# → 0 matches

# 5. Build + principal:
cd client && npx tsc --noEmit -p tsconfig.app.json && npm run build
# → 0 errors / built ~708ms
```

---

## 6. Artifacts

- Tag pair: `post-v2/ZT11-pre`, `post-v2/ZT11-post`
- Commit: `ZT11: drop dead showTab export + demote procLiq to module-private`
- Branch: `post-v2/real-finish` (pushed)
- Final close tag: `post-v2/ZT11-FULL-CLOSED`

---

## 7. Verdict

**ZT11 — CLOSED REAL.**

The two export-surface follow-ons named by ZT8 are closed: `showTab`
is fully removed (function body + export), `procLiq` is demoted from
exported to module-private. Internal behavior unchanged. No other
exports touched — the broader dead-export audit remains an explicit
non-goal, not a quiet oversight.

Next up: **ZT12 — Docs truth alignment**.
