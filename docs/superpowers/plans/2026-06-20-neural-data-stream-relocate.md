# Neural Data Stream — Relocate Below Fear & Greed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render the Neural Data Stream / Quantum Analytics panel always-visible directly below the Fear & Greed Index, removing it from the collapsed AutoTrade toggle (single instance — ids stay unique so the live interval keeps updating it).

**Architecture:** Extract the existing `#brainExt` markup (AutoTradePanel.tsx:259-324) into a presentational `NeuralDataStream` component (always visible), render it after the Fear & Greed `<div className="sec">` in AnalysisSections, and delete the toggle + block + `bextOpen` state from AutoTradePanel. No JS rewiring: the `startApp()` brainExt interval and render.ts update by element id, which works wherever the single instance lives.

**Tech Stack:** React + TS + Vite. Build `cd /opt/zeus-terminal/client && sudo -u zeus npm run build`; `chown -R zeus:zeus public/app` from repo root. Verify via headless (no pure logic to unit-test — it's a markup move).

**Rules:** Single instance only (no duplicate `#brainExt` id). One batched deploy; GET operator GO before deploy.

---

## File structure
- **Create** `client/src/components/analysis/NeuralDataStream.tsx` — presentational component returning the `#brainExt` markup, always visible.
- **Modify** `client/src/components/analysis/AnalysisSections.tsx` — render `<NeuralDataStream />` after the Fear & Greed section.
- **Modify** `client/src/components/dock/AutoTradePanel.tsx` — remove the toggle (254-257), the `#brainExt` block (259-324), and the `bextOpen` state (line 32).
- **Modify** `server/version.js` — bump at deploy.

---

## Task 1: Extract the panel into `NeuralDataStream.tsx`

**Files:** Create `client/src/components/analysis/NeuralDataStream.tsx`

- [ ] **Step 1: Read the source block** — open `client/src/components/dock/AutoTradePanel.tsx` lines **259-324** (the `<div className="bext show" id="brainExt" …> … </div>`). This is the exact markup to move (quantum clock SVG, `#brainMarketPhase`, `#sessBacktestBox`, `#symPulseRows`, `#brainHeatmap`, the risk-matrix `rg-*`/`rgv-*` gauges, `#dstreamInner`). Note any local variables it references inside the JSX (e.g. a risk-gauges array `.map`). If it references a component-local array, that array must move into the new component too.

- [ ] **Step 2: Create the component** — `client/src/components/analysis/NeuralDataStream.tsx`:

```tsx
// Neural Data Stream / Quantum Analytics — relocated from the AutoTrade panel's collapsed
// toggle to sit always-visible under the Fear & Greed Index. Pure markup; updated in place
// by the startApp() brainExt interval + render.ts (by element id). Single instance only.
export function NeuralDataStream() {
  return (
    <div className="bext show" id="brainExt">
      {/* PASTE lines 260-323 from AutoTradePanel.tsx verbatim here (everything BETWEEN the
          opening <div id="brainExt"> and its closing </div>). Do NOT change ids or classes. */}
    </div>
  )
}
```
Replace the comment with the exact inner markup copied from AutoTradePanel.tsx:260-323. The opening `<div className="bext show" id="brainExt">` here drops the old `style={bextOpen ? undefined : { display: 'none' }}` → always visible. If the copied markup `.map`s over a risk-gauges array declared in AutoTradePanel, copy that array constant into this file too (above the component).

- [ ] **Step 3: Build to verify it compiles**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS" | head
```
Expected: built clean (the component exists but isn't rendered yet — still must compile; a duplicate `#brainExt` is fine at build time but we won't ship two — Task 3 removes the original before deploy).

- [ ] **Step 4: Commit**

```
cd /opt/zeus-terminal && git add client/src/components/analysis/NeuralDataStream.tsx
git commit -m "feat(ui): extract NeuralDataStream panel component (always-visible)"
```

---

## Task 2: Render it below Fear & Greed

**Files:** Modify `client/src/components/analysis/AnalysisSections.tsx`

- [ ] **Step 1: Import** — at the top of `AnalysisSections.tsx`, add:

```tsx
import { NeuralDataStream } from './NeuralDataStream'
```

- [ ] **Step 2: Render after Fear & Greed** — find the FEAR & GREED INDEX block (`{/* ===== FEAR & GREED INDEX ===== */}` … the `<div className="sec">…</div>` that closes around line 88, right before the BTC metrics comment). Insert immediately after that section's closing `</div>`:

```tsx
      {/* ===== NEURAL DATA STREAM (relocated here, always visible) ===== */}
      <NeuralDataStream />
```

- [ ] **Step 3: Build**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS" | head
```
Expected: built clean.

- [ ] **Step 4: Commit**

```
cd /opt/zeus-terminal && git add client/src/components/analysis/AnalysisSections.tsx
git commit -m "feat(ui): render NeuralDataStream below the Fear & Greed Index"
```

---

## Task 3: Remove the old toggle + block from AutoTradePanel (de-duplicate)

**Files:** Modify `client/src/components/dock/AutoTradePanel.tsx`

- [ ] **Step 1: Delete the toggle + block** — remove lines **254-324** (the `{/* Neural Data Stream toggle */}` comment, the `<button className="bext-toggle-btn">…</button>`, the blank line, and the entire `<div className="bext show" id="brainExt">…</div>`). Keep line 253 (`<div className="at-sep" …>`) and line 326+ (`<div className="at-line">` / the `at-center` AUTO TRADE block) intact — `.at-sep` still wraps the main AutoTrade toggle.

- [ ] **Step 2: Remove the now-unused state** — delete line 32 `const [bextOpen, setBextOpen] = useState(false)`. Grep the file for any remaining `bextOpen`/`setBextOpen` references; there should be none after Step 1.

```
grep -n "bextOpen\|setBextOpen\|brainExt\|bext-toggle" client/src/components/dock/AutoTradePanel.tsx
```
Expected: no matches.

- [ ] **Step 3: Build**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS" | head
```
Expected: built clean (no unused-var error; `useState` may still be used elsewhere in the file — leave its import).

- [ ] **Step 4: Commit**

```
cd /opt/zeus-terminal && git add client/src/components/dock/AutoTradePanel.tsx
git commit -m "refactor(ui): remove Neural Data Stream toggle+block from AutoTrade (moved below F&G)"
```

---

## Task 4: Deploy + headless verify

**Files:** Modify `server/version.js`

- [ ] **Step 1: chown + bump** — `cd /opt/zeus-terminal && chown -R zeus:zeus public/app`. Bump `server/version.js` to 1.7.127 b153 (changelog: Neural Data Stream moved below Fear & Greed, always visible). Validate `node -e "require('./server/version.js')" && echo OK`.

- [ ] **Step 2: Reload (operator GO)** — `sudo -u zeus pm2 reload zeus && sleep 3 && curl -s -o /dev/null -w "health=%{http_code}\n" http://localhost:3000/api/health` (expect 401).

- [ ] **Step 3: Headless verify** — mint uid=1 token; load app; assert in the DOM:
  - exactly ONE `#brainExt` element exists (`document.querySelectorAll('#brainExt').length === 1`);
  - it is visible (`getComputedStyle(el).display !== 'none'`);
  - it sits AFTER the Fear & Greed value (`#brainExt` bounding `top` > `#fgval` bounding `top`);
  - the AutoTrade panel no longer has a `.bext-toggle-btn` (`document.querySelector('.bext-toggle-btn') === null`);
  - update targets present (`#qSecArc`, `#brainHeatmap` exist);
  - 0 page/console errors. Screenshot the bottom of the page; delete the screenshot after.

- [ ] **Step 4: Commit + push (after GO)**

```
git add server/version.js
git commit -m "release: Neural Data Stream below Fear & Greed — b153"
git push origin main
```

---

## Rollback
Pure client markup move. Revert the commits → the panel returns to the AutoTrade collapsed toggle. No brain/trading/data change.

## Self-review
- **Spec coverage:** extract into NeuralDataStream component, always visible (T1) ✓; render after Fear & Greed (T2) ✓; remove toggle+block+state from AutoTrade, single instance (T3) ✓; live updates unchanged (id-based, no rewiring) ✓; headless verify: one #brainExt, visible, after F&G, no toggle, update targets present (T4 S3) ✓.
- **Consistency:** component name `NeuralDataStream` used in T1 (create), T2 (import + render); the moved id `#brainExt` is removed in T3 before deploy so exactly one ships (verified in T4).
- **Placeholder note:** T1 Step 2 intentionally references "paste lines 260-323 verbatim" — this is a MOVE of existing, working markup (66 lines); re-typing it risks transcription errors, so the plan points to the exact source lines + the single change (drop the display:none). The executor copies the real code.
