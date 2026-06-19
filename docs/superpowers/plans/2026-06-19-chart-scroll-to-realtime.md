# Chart "Scroll to Realtime" Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A TradingView-style round arrow button at the chart's bottom-right that appears only when the user has scrolled back into history and, on click, jumps the chart to the latest bar (realtime).

**Architecture:** A small isolated UI module `client/src/ui/chartScrollToRealtime.ts` with a pure `_isAtRealtime` helper (TDD) and an idempotent `initScrollToRealtime()` that creates the button, installs its own `subscribeVisibleLogicalRangeChange` listener to toggle visibility, and calls `timeScale().scrollToRealTime()` on click. Anchored to `#csec` (already `position: relative`). Wired once in the chart setup next to `initBackfill()`.

**Tech Stack:** TypeScript client (vitest), lightweight-charts ^4.1.3 (`scrollToRealTime`, `subscribeVisibleLogicalRangeChange`).

**Rules:** TDD; backup `.bak` before edits; build as `sudo -u zeus npm run build` + `chown -R zeus:zeus public/app`; tests `sudo -u zeus npx vitest run <path>`; GO before deploy; bump version.js for SW.

---

## Files
- **Create:** `client/src/ui/chartScrollToRealtime.ts`, `client/src/ui/__tests__/chartScrollToRealtime.test.ts`
- **Modify:** `client/src/data/marketDataChart.ts` (one import + one `initScrollToRealtime()` call), `client/src/app.css` (button style), `server/version.js` (bump).

---

## Task 1: `_isAtRealtime` pure helper + module skeleton (TDD)

**Files:** Create `client/src/ui/chartScrollToRealtime.ts`; Test `client/src/ui/__tests__/chartScrollToRealtime.test.ts`

- [ ] **Step 1: Write the failing test** — create `client/src/ui/__tests__/chartScrollToRealtime.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { _isAtRealtime } from '../chartScrollToRealtime'

describe('_isAtRealtime', () => {
  it('treats a null range as realtime (button hidden)', () => {
    expect(_isAtRealtime(null, 1000)).toBe(true)
  })
  it('is realtime when the last bar is within the visible right edge (with 1-bar margin)', () => {
    expect(_isAtRealtime(1010, 1000)).toBe(true) // realtime rightOffset pushes `to` past last bar
    expect(_isAtRealtime(999, 1000)).toBe(true)  // last bar index 999 visible
    expect(_isAtRealtime(998, 1000)).toBe(true)  // boundary barCount-2
  })
  it('is NOT realtime when scrolled back', () => {
    expect(_isAtRealtime(997, 1000)).toBe(false) // just past the margin
    expect(_isAtRealtime(500, 1000)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail**
```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/ui/__tests__/chartScrollToRealtime.test.ts
```
Expected: FAIL — Failed to resolve import "../chartScrollToRealtime".

- [ ] **Step 3: Create the module with the pure helper** — `client/src/ui/chartScrollToRealtime.ts`:
```ts
// Zeus — ui/chartScrollToRealtime.ts
// TradingView-style "back to realtime" button: hidden at realtime, shown when the user
// scrolls back into history, click → jump to the latest bar. The pure _isAtRealtime helper
// is unit-tested; the DOM/subscription wiring (initScrollToRealtime) is verified headless.

// Treat a null range as realtime (nothing to scroll back from). Otherwise the chart is at
// realtime when the last bar index (barCount-1) sits within the visible range's right edge,
// with a 1-bar margin to avoid flicker (the realtime rightOffset makes `to` exceed barCount-1).
export function _isAtRealtime(rangeTo: number | null, barCount: number): boolean {
  if (rangeTo == null) return true
  return rangeTo >= barCount - 2
}
```

- [ ] **Step 4: Run to verify pass**
```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/ui/__tests__/chartScrollToRealtime.test.ts
```
Expected: PASS (3 describe-block cases green).

- [ ] **Step 5: Commit**
```
git add client/src/ui/chartScrollToRealtime.ts client/src/ui/__tests__/chartScrollToRealtime.test.ts
git commit -m "feat(chart): _isAtRealtime pure helper for scroll-to-realtime button"
```

---

## Task 2: Button DOM + visibility subscription + click + CSS + wiring

**Files:** Modify `client/src/ui/chartScrollToRealtime.ts`, `client/src/app.css`, `client/src/data/marketDataChart.ts`

- [ ] **Step 1: Append `initScrollToRealtime` to `client/src/ui/chartScrollToRealtime.ts`**
```ts
const w = window as any
let _installed = false

export function initScrollToRealtime(): void {
  if (_installed || !w.mainChart) return
  _installed = true
  try {
    const host = document.getElementById('csec') || document.body
    let btn = document.getElementById('chartScrollRtBtn') as HTMLElement | null
    if (!btn) {
      btn = document.createElement('button')
      btn.id = 'chartScrollRtBtn'
      btn.type = 'button'
      btn.title = 'Back to realtime'
      btn.setAttribute('aria-label', 'Back to realtime')
      btn.innerHTML = '&#187;' // »
      btn.style.display = 'none'
      btn.addEventListener('click', () => {
        try { w.mainChart.timeScale().scrollToRealTime() } catch (_) { }
        const e = document.getElementById('chartScrollRtBtn')
        if (e) e.style.display = 'none'
      })
      host.appendChild(btn)
    }
    w.mainChart.timeScale().subscribeVisibleLogicalRangeChange((r: any) => {
      const barCount = Array.isArray(w.S?.klines) ? w.S.klines.length : 0
      const atRt = _isAtRealtime(r ? r.to : null, barCount)
      const e = document.getElementById('chartScrollRtBtn')
      if (e) e.style.display = atRt ? 'none' : 'flex'
    })
  } catch (_) { _installed = false }
}
```

- [ ] **Step 2: Back up + add CSS** — `cp client/src/app.css client/src/app.css.bak-rtbtn`, then append to `client/src/app.css`:
```css
/* [2026-06-19] Chart "back to realtime" button (TradingView-style) */
#chartScrollRtBtn {
  position: absolute;
  bottom: 48px;
  right: 16px;
  z-index: 31;
  display: none;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  font-size: 16px;
  line-height: 1;
  color: #7a9ab8;
  background: rgba(10, 15, 22, 0.9);
  border: 1px solid #1a2530;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  transition: color 0.15s, border-color 0.15s;
}
#chartScrollRtBtn:hover { color: #d4af37; border-color: #d4af37; }
```

- [ ] **Step 3: Wire into chart setup** — in `client/src/data/marketDataChart.ts`, add the import near the other imports:
```ts
import { initScrollToRealtime } from '../ui/chartScrollToRealtime'
```
Then find the line `try { initBackfill() } catch (_) { }` (added for the backfill feature, in the chart-setup function after the `_chartSyncInstalled` block) and add immediately after it:
```ts
  try { initScrollToRealtime() } catch (_) { }
```

- [ ] **Step 4: Build to verify compile**
```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS|Error" | head
```
Expected: `✓ built in ...`, no `error TS`.

- [ ] **Step 5: Run unit tests (no regression)**
```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/ui src/data 2>&1 | tail -6
```
Expected: all pass.

- [ ] **Step 6: Commit**
```
cd /opt/zeus-terminal && chown -R zeus:zeus public/app
git add client/src/ui/chartScrollToRealtime.ts client/src/app.css client/src/data/marketDataChart.ts
git commit -m "feat(chart): scroll-to-realtime button — DOM + visibility subscription + click + wiring"
```
Then `rm -f client/src/app.css.bak-rtbtn`.

---

## Task 3: Headless verify + deploy (GO gate)

- [ ] **Step 1: Reload** — `cd /opt/zeus-terminal && sudo -u zeus pm2 reload zeus && sleep 3 && curl -s -o /dev/null -w "health=%{http_code}\n" http://localhost:3000/api/health` (expect 401 = up).

- [ ] **Step 2: Headless verification.** Mint a uid=1 token (as in prior chart verifications), load `/app/` with `serviceWorkers: 'block'`, wait for chart + klines. Assert:
  - Initially at realtime → `#chartScrollRtBtn` display is `none`.
  - Programmatically scroll back (`timeScale().setVisibleLogicalRange({from:-3, to:~50})`) → button display becomes `flex` (visible).
  - Click the button (or call `scrollToRealTime()`) → after a tick, button display returns to `none`.
  - 0 page/console errors (ignore unrelated `/spot/klines` 502 background polls).
  - Screenshot for layout sanity.

- [ ] **Step 3: Clean up** temp token/script/png.

- [ ] **Step 4: Bump `server/version.js`** (build+version, e.g. 1.7.108→1.7.109, b134→b135) with a changelog entry: TradingView-style scroll-to-realtime button — hidden at realtime, shows when scrolled back, click jumps to latest; `_isAtRealtime` unit-tested + headless-verified; additive zero-data-risk UI.

- [ ] **Step 5: Final build + chown + reload + commit + push (GET OPERATOR GO FIRST).**
```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error" | head
cd /opt/zeus-terminal && chown -R zeus:zeus public/app
sudo -u zeus pm2 reload zeus && sleep 3
curl -s http://localhost:3000/sw.js | grep -o 'zt-v[0-9.]*-b[0-9]*' | head -1
git add server/version.js && git commit -m "release: chart scroll-to-realtime button — bXXX"
git push origin main
```

---

## Rollback
Additive, self-contained UI. Revert the two feature commits (Task 1 + Task 2). The button only appears when scrolled back and only calls `scrollToRealTime()`; it never touches klines/data.

## Self-review
- **Spec coverage:** `_isAtRealtime` (T1) ✓; button DOM + show/hide subscription + click + CSS + wiring (T2) ✓; headless verify + deploy gate (T3) ✓; hides on symbol/tf switch via renderChart's existing scrollToRealTime — no extra task needed (covered by behavior) ✓.
- **Type consistency:** `_isAtRealtime(rangeTo: number|null, barCount: number): boolean` and `initScrollToRealtime(): void` used identically in tests, module, and wiring. Button id `chartScrollRtBtn` consistent across JS + CSS.
- **Placeholder scan:** Task 3 Step 2 describes the headless script in prose (matching the prior backfill verification pattern in this repo) rather than full code — acceptable as it mirrors an established, working harness; all code-producing steps (T1/T2) have complete code.
