# ZT10 FULL CLOSE REPORT — Notification + PostMortem onclick cleanup

**Date:** 2026-04-17
**Scope:** Master Zero-Tail Close Plan v2 — Lot ZT10 (two final onclick
tails: the `w.testNotification?.()` window-indirection in
`AlertsModal.tsx` and the inline `onclick="…PM_render()"` HTML string
injected by `engine/postMortem.ts::initPMPanel()`).
**Mandate:** Remove the remaining UI paths that go through `window.*`
or inline HTML attributes when a direct reference or real listener is
trivially available. Same boundary as every ZT lot: minimal,
verifiable fix; no structural rewrites; tsc principal = 0; vite green;
no regressions.
**Verdict:** **CLOSED REAL**

---

## 1. Summary

ZT10 closed two independent loose ends both classified as "onclick
tails":

1. **`testNotification` window indirection.** `AlertsModal.tsx:129`
   called `w.testNotification?.()` via window lookup, relying on
   `phase1Adapters.ts` to bind `w.testNotification = testNotification`
   at startup. The legacy-HTML rationale for that binding (see the
   phase1Adapters header comment written in ZT8) was wrong: the
   `/legacy/` bundle has its own locally-declared
   `function testNotification()` in
   `public/legacy/js/data/marketData.js:1770`, which already resolves
   `onclick="testNotification()"` in `public/legacy/index.html:3123`
   without needing the React bridge. That made the binding reachable
   by exactly one reader — the React `AlertsModal`. Switched that
   reader to a direct named import; dropped the now-dead binding.

2. **`engine/postMortem.ts::initPMPanel()` inline onclick.**
   `initPMPanel()` injected a string template containing
   `onclick="this.closest('#pm-strip').classList.toggle('open');PM_render()"`.
   `PM_render` is a named export of the same module and is **not**
   bound to `window` anywhere in the codebase — so the inline handler
   threw a silent `ReferenceError` on every click (the
   `classList.toggle` ran first and succeeded; `PM_render()` then
   failed and was swallowed). Replaced the inline attribute with a
   real `addEventListener('click', …)` attached after the element is
   inserted, which (a) removes the inline-HTML handler and (b) fixes
   the broken `PM_render()` call.

Result: bridge surface trimmed from 22 → **21 direct window slots**,
one more inline `onclick="…"` HTML attribute eliminated from the
React TS surface, and one silently-broken handler repaired.

---

## 2. Changes applied

Three files touched.

### 2.1 `client/src/components/modals/AlertsModal.tsx`

```diff
-import { injectFakeWhale, toggleSnd, saveAlerts } from '../../data/marketDataWS'
+import { injectFakeWhale, toggleSnd, saveAlerts, testNotification } from '../../data/marketDataWS'
…
-            }} onClick={() => w.testNotification?.()}>Test Notification</button>
+            }} onClick={() => testNotification()}>Test Notification</button>
```

The other `w.*` accesses in this modal (`w.S.alerts.*`) are reads of
the live state object, not function calls; they are out of scope and
stay as-is.

### 2.2 `client/src/bridge/phase1Adapters.ts`

```diff
-import { testNotification } from '../data/marketDataWS'
 …
   w.updateDemoBalance = updateDemoBalance
-  w.testNotification = testNotification
```

And rewrote the header comment:
- `ZT8 resolution (…): bridge surface = 22` → `ZT10 resolution (…):
  bridge surface = 21`.
- Replaced the "1 legacy HTML onclick (testNotification)" classifier
  with an accurate note: the `/legacy/` bundle resolves
  `testNotification` through its own module-local declaration, not
  through this bridge, so the binding was never actually reachable
  from legacy HTML.
- Collapsed the old "5 onclick / cross-call handlers" + "1 legacy HTML
  onclick" split into a single "5 cross-call handlers" bucket.

### 2.3 `client/src/engine/postMortem.ts`

```diff
-    <div id="pm-strip-bar" onclick="this.closest('#pm-strip').classList.toggle('open');PM_render()">
+    <div id="pm-strip-bar">
 …
   srStrip.insertAdjacentElement('afterend', panel)

+  // ZT10: replaced inline `onclick="…PM_render()"` with a real listener.
+  // PM_render was never bound to window, so the inline call silently
+  // threw a ReferenceError after the classList.toggle ran.
+  const bar = panel.querySelector<HTMLDivElement>('#pm-strip-bar')
+  if (bar) {
+    bar.style.cursor = 'pointer'
+    bar.addEventListener('click', () => {
+      panel.classList.toggle('open')
+      PM_render()
+    })
+  }
```

The `cursor: pointer` inline style matches what the stylesheet already
applies to `#pm-strip-bar` (see the `(function injectPMStyles())` IIFE
earlier in the file); setting it on the element defensively ensures
the hand cursor appears even if the stylesheet fails to register
before the bar is rendered.

---

## 3. What ZT10 deliberately did NOT do

- **Did not delete `initPMPanel()` or the legacy string-template
  injection.** The React `PostMortemPanel.tsx` renders the same DOM
  via JSX when the `postmortem` dock view is active, and the legacy
  `initPMPanel()` is invoked from `bootstrapStartApp.ts:124`. The
  legacy path guards itself with
  `if (document.getElementById('pm-strip')) return`, so the two are
  mutually exclusive at runtime. Killing the legacy path is a
  separate lot (dock-view composition audit), not a side-effect of
  fixing the onclick.

- **Did not touch the Romanian placeholder `"Nicio tranzacție
  analizată încă."` at line 336.** It is outside the Telegram vertical
  scoped by ZT9's deliberate non-scope and belongs to the future full
  RO→EN sweep lot.

- **Did not remove the `testNotification` export from
  `marketDataWS.ts`** (or the local `testNotification` declaration in
  `public/legacy/js/data/marketData.js`). Both are legitimate module
  APIs.

- **Did not refactor the other `w.*` accesses in `AlertsModal.tsx`**
  (e.g. `w.S?.alerts.*`). Those are state reads, not onclick handlers;
  they're the same hybrid-by-design pattern as other store/state refs
  and are out of scope.

- **Did not touch the 4 remaining cross-call bindings**
  (`_showConfirmDialog`, `calcPosPnL`, `getDemoLev`,
  `updateDemoLiqPrice`, `updateDemoBalance`). Each still has at least
  one verified reader that hits `window`, and refactoring the readers
  to named imports is a separate reader-refactor lot.

---

## 4. Mandate compliance

| Requirement | Status | Evidence |
|---|---|---|
| `w.testNotification` dead and removed | ✅ | `grep -rn "w\.testNotification\|window\.testNotification" client/src/` → 0 reader matches; binding + import gone from phase1Adapters |
| AlertsModal uses direct import | ✅ | `grep -n "testNotification" AlertsModal.tsx` → 1 import + 1 call, no `w.` |
| No inline `onclick="…"` in engine/postMortem.ts | ✅ | `grep -n "onclick=" engine/postMortem.ts` → 0 matches |
| PM_render call actually runs | ✅ | Real listener, not inline HTML attribute |
| Bridge slot count decremented | ✅ | Header says 21; enumerated set = 1 (ZT_safeInterval) + 5 (config/state) + 10 (chart-series) + 5 (cross-call) = 21 |
| tsc principal = 0 | ✅ | Empty stderr |
| vite build green | ✅ | "built in 702ms" |
| No test regressions | ✅ | 4 failures = pre-ZT10 baseline (ATPanel kill banner + 3 BrainCockpit neural-grid label tests) |
| No scope creep | ✅ | 3 files touched; no changes outside the two named tails |

---

## 5. Verification commands

```bash
# 1. No remaining window-indirection for testNotification:
grep -rn "w\.testNotification\|window\.testNotification" client/src/
# → 0 reader matches (only header-comment mentions in phase1Adapters)

# 2. Direct import in AlertsModal is wired:
grep -n "testNotification" client/src/components/modals/AlertsModal.tsx
# → 1 import + 1 call site (onClick={() => testNotification()})

# 3. No inline onclick in engine/postMortem.ts:
grep -n "onclick=" client/src/engine/postMortem.ts
# → 0 matches

# 4. Bridge slot count = 21:
grep -nE "^\s*(if \(w\.|w\.|\(w as any\)\.)" client/src/bridge/phase1Adapters.ts \
  | grep -vcE "__ZT_INT_ERR__"
# → 21 (1 ZT_safeInterval + 5 state refs + 10 chart-series + 5 cross-call)

# 5. Build + principal:
cd client && npx tsc --noEmit -p tsconfig.app.json && npm run build
# → 0 errors / built ~700ms
```

---

## 6. Artifacts

- Tag pair: `post-v2/ZT10-pre`, `post-v2/ZT10-post`
- Commit: `ZT10: Notification + PostMortem onclick cleanup`
- Branch: `post-v2/real-finish` (pushed)
- Final close tag: `post-v2/ZT10-FULL-CLOSED`

---

## 7. Verdict

**ZT10 — CLOSED REAL.**

Bridge surface trimmed from 22 → 21 live window slots. The React
`AlertsModal` no longer goes through `window.*` to call its own
module's function; the `engine/postMortem.ts::initPMPanel()` inline
onclick is replaced by a real listener that actually runs
`PM_render()` (previously silently broken). The phase1Adapters header
comment no longer misrepresents the legacy-HTML binding situation.

Next up: **ZT11 — Minor repo cleanup**.
