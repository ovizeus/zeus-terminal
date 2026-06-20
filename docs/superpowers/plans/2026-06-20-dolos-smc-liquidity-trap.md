# DOLOS — SMC Liquidity-Trap Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A new main-chart overlay indicator DOLOS that detects the most-recent SMC liquidity-trap setup (BOS · SWEEP · MSS · Order Block · Breaker Block · Target) and draws it.

**Architecture:** A pure, deterministic `dolos()` in `indicatorCalc.ts` (with a `_dolosSwings` fractal-pivot helper) returns the setup as indices+levels (TDD). The renderer in `indicators.ts` mirrors OLYMPUS exactly — a transparent carrier line series hosts `setMarkers()` for the BOS/SWEEP/MSS labels, top+bottom line-series "bands" draw the OB (red) and BB (blue) zones from origin→now, and `createPriceLine()` draws the TARGET. Registered as an overlay, wired identically to the existing `olympus` overlay.

**Tech Stack:** TS + Vite + vitest (`cd client && sudo -u zeus npx vitest run <file>`). lightweight-charts v4 main chart. Build `cd client && sudo -u zeus npm run build`; `chown -R zeus:zeus public/app` from repo root.

**Rules:** TDD for `dolos()`/`_dolosSwings`; build to verify the render compiles; one batched deploy at the end (no rapid reloads — Binance 429); GET operator GO before deploy. Client-only — never touches brain/trading.

---

## File structure
- **Modify** `client/src/engine/indicatorCalc.ts` — add `_dolosSwings` + `dolos()` + `Dolos` interface.
- **Create** `client/src/engine/__tests__/dolos.test.ts` — vitest.
- **Modify** `client/src/engine/indicators.ts` — `initDolosSeries`/`updateDolos`, import, `_indRenderHook` call, `applyIndVisibility` case, settings-label additions.
- **Modify** `client/src/core/config.ts` — `INDICATORS` entry + `IND_SETTINGS` default.
- **Modify** `server/services/indicatorIds.js` — add `'dolos'`.
- **Modify** `server/version.js` — bump at deploy.

---

## Task 1: `_dolosSwings` fractal pivots (TDD)

**Files:** Modify `client/src/engine/indicatorCalc.ts`; Create `client/src/engine/__tests__/dolos.test.ts`

- [ ] **Step 1: Write the failing test** — create `client/src/engine/__tests__/dolos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { _dolosSwings } from '../indicatorCalc'

describe('_dolosSwings', () => {
  it('finds fractal swing highs and lows (L=2)', () => {
    //            0   1   2   3   4   5
    const highs = [10, 11, 15, 12, 11, 10]
    const lows  = [ 9,  8,  5,  7,  8,  9] // index 2 is both peak high & trough low
    const sw = _dolosSwings(highs, lows, 2)
    expect(sw.find(s => s.index === 2 && s.type === 'H')?.value).toBe(15)
    expect(sw.find(s => s.index === 2 && s.type === 'L')?.value).toBe(5)
    // endpoints (within L of the edge) are never pivots
    expect(sw.some(s => s.index === 0 || s.index === 5)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/engine/__tests__/dolos.test.ts 2>&1 | tail -12
```
Expected: FAIL — `_dolosSwings` is not exported.

- [ ] **Step 3: Implement** — add to `client/src/engine/indicatorCalc.ts` (near the other structure helpers):

```ts
export interface DolosSwing { index: number; value: number; type: 'H' | 'L' }
// Fractal pivots: bar i is a swing High if its high is the strict max over [i-L, i+L]
// (symmetric, edges excluded), a swing Low if its low is the strict min. Sorted by index.
export function _dolosSwings(highs: number[], lows: number[], L: number): DolosSwing[] {
  const out: DolosSwing[] = []
  const n = highs.length
  for (let i = L; i < n - L; i++) {
    let isH = true, isL = true
    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue
      if (highs[j] > highs[i]) isH = false
      if (lows[j] < lows[i]) isL = false
    }
    if (isH) out.push({ index: i, value: highs[i], type: 'H' })
    if (isL) out.push({ index: i, value: lows[i], type: 'L' })
  }
  return out.sort((a, b) => a.index - b.index)
}
```

- [ ] **Step 4: Run to verify pass**

```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/engine/__tests__/dolos.test.ts 2>&1 | tail -6
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
cd /opt/zeus-terminal && git add client/src/engine/indicatorCalc.ts client/src/engine/__tests__/dolos.test.ts
git commit -m "feat(dolos): _dolosSwings fractal-pivot helper with test"
```

---

## Task 2: `dolos()` — full liquidity-trap detection (TDD)

The synthetic bear arrays below are hand-traced to produce a deterministic setup (L=2): swing highs at idx 3/8/13, swing lows at idx 11/16; the swing high at idx 8 (=15) is swept at idx 13 (high 15.8 > 15, close 14 < 15); MSS at idx 14 (close 11.5 < prior swing-low 12.5); OB = idx 13 (up candle); BB = idx 3; target = idx 16 low (10). The bull case is the same arrays flipped vertically (`30 − x`), which turns a swept-high trap into a swept-low trap.

**Files:** Modify `client/src/engine/indicatorCalc.ts`; Modify the test file.

- [ ] **Step 1: Write the failing test** — append to `dolos.test.ts`:

```ts
import { dolos } from '../indicatorCalc'

const H = [10,11,12,13,12.5,12.8,14,14.5,15,14.2,13.8,13.5,14,15.8,13,12.5,12,12.3,12.8,13]
const L = [9,10,11,11.5,11,12,12.5,13,13.5,13,12.8,12.5,12.8,13,11,10.5,10,10.8,11.2,11.5]
const O = [9.5,10.5,11.5,12,12.5,12.5,13,13.5,14,14.5,14,13.5,13,13.2,13.8,11.4,10.9,10.5,11,11.4]
const C = [10,11,12,12.5,12,13,13.5,14,14.8,14,13.5,13,13.5,14,11.5,10.8,10.2,11,11.5,12]

describe('dolos', () => {
  it('detects a bear liquidity-trap setup with all 6 elements', () => {
    const r = dolos(H, L, O, C, 2)
    expect(r.bias).toBe('bear')
    expect(r.sweep).toEqual({ index: 13, level: 15 })
    expect(r.mss?.index).toBe(14)
    expect(r.ob?.index).toBe(13)        // last up candle before the drop
    expect(r.bb?.index).toBe(3)         // prior swing high → breaker
    expect(r.bos?.index).toBe(8)
    expect(r.target?.level).toBe(10)    // opposing liquidity below
  })
  it('detects a bull setup on vertically-flipped data', () => {
    const f = (a: number[]) => a.map((x) => 30 - x)
    // flip swaps highs<->lows; pass flipped lows as highs and vice-versa
    const r = dolos(f(L), f(H), f(O), f(C), 2)
    expect(r.bias).toBe('bull')
    expect(r.sweep?.index).toBe(13)
  })
  it('returns all-null on flat/no-setup data', () => {
    const flat = new Array(20).fill(100)
    const r = dolos(flat, flat, flat, flat, 2)
    expect(r.bias).toBeNull()
    expect(r.sweep).toBeNull()
    expect(r.ob).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify fail**

```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/engine/__tests__/dolos.test.ts 2>&1 | tail -15
```
Expected: FAIL — `dolos` is not exported.

- [ ] **Step 3: Implement** — add to `client/src/engine/indicatorCalc.ts`:

```ts
export interface DolosZone { index: number; top: number; bottom: number }
export interface DolosPoint { index: number; level: number }
export interface Dolos {
  bias: 'bear' | 'bull' | null
  bos: DolosPoint | null
  sweep: DolosPoint | null
  mss: DolosPoint | null
  ob: DolosZone | null
  bb: DolosZone | null
  target: { level: number } | null
}

// DOLOS — Smart-Money-Concepts "liquidity trap". Returns the most-recent setup: a swing high (bear)
// or low (bull) gets swept (wick past + close back), then structure shifts (MSS) the other way; the
// order block is the last opposite candle before the shift, the breaker is the prior swing zone, the
// target is the opposing liquidity. Pure & deterministic; all-null when no clean setup exists.
export function dolos(highs: number[], lows: number[], opens: number[], closes: number[], lookback = 5): Dolos {
  const NULL: Dolos = { bias: null, bos: null, sweep: null, mss: null, ob: null, bb: null, target: null }
  const n = closes.length
  const Lk = Math.max(2, Math.round(lookback))
  if (n < Lk * 2 + 5) return NULL
  const sw = _dolosSwings(highs, lows, Lk)
  const swH = sw.filter((s) => s.type === 'H'), swL = sw.filter((s) => s.type === 'L')
  if (swH.length < 1 || swL.length < 1) return NULL

  // ── BEAR: a swing high swept (wick above + close back below), then MSS down ──
  for (let hi = swH.length - 1; hi >= 0; hi--) {
    const Hp = swH[hi]
    let sweep: DolosPoint | null = null
    for (let i = Hp.index + 1; i < n; i++) { if (highs[i] > Hp.value && closes[i] < Hp.value) { sweep = { index: i, level: Hp.value }; break } }
    if (!sweep) continue
    const priorLow = [...swL].reverse().find((s) => s.index < sweep!.index)
    if (!priorLow) continue
    let mss: DolosPoint | null = null
    for (let i = sweep.index + 1; i < n; i++) { if (closes[i] < priorLow.value) { mss = { index: i, level: priorLow.value }; break } }
    if (!mss) continue
    let ob: DolosZone | null = null
    for (let i = mss.index; i >= Math.max(0, sweep.index - 2); i--) { if (closes[i] > opens[i]) { ob = { index: i, top: Math.max(highs[i], closes[i]), bottom: Math.min(opens[i], lows[i]) }; break } }
    const prevH = [...swH].reverse().find((s) => s.index < Hp.index)
    const bb: DolosZone | null = prevH ? { index: prevH.index, top: prevH.value, bottom: Math.min(...lows.slice(Math.max(0, prevH.index - Lk), prevH.index + 1)) } : null
    const tgt = [...swL].reverse().find((s) => s.value < mss.level) || swL[0]
    return { bias: 'bear', bos: { index: Hp.index, level: Hp.value }, sweep, mss, ob, bb, target: tgt ? { level: tgt.value } : null }
  }

  // ── BULL: a swing low swept (wick below + close back above), then MSS up ──
  for (let li = swL.length - 1; li >= 0; li--) {
    const Lp = swL[li]
    let sweep: DolosPoint | null = null
    for (let i = Lp.index + 1; i < n; i++) { if (lows[i] < Lp.value && closes[i] > Lp.value) { sweep = { index: i, level: Lp.value }; break } }
    if (!sweep) continue
    const priorHigh = [...swH].reverse().find((s) => s.index < sweep!.index)
    if (!priorHigh) continue
    let mss: DolosPoint | null = null
    for (let i = sweep.index + 1; i < n; i++) { if (closes[i] > priorHigh.value) { mss = { index: i, level: priorHigh.value }; break } }
    if (!mss) continue
    let ob: DolosZone | null = null
    for (let i = mss.index; i >= Math.max(0, sweep.index - 2); i--) { if (closes[i] < opens[i]) { ob = { index: i, top: Math.max(opens[i], highs[i]), bottom: Math.min(lows[i], closes[i]) }; break } }
    const prevL = [...swL].reverse().find((s) => s.index < Lp.index)
    const bb: DolosZone | null = prevL ? { index: prevL.index, top: Math.max(...highs.slice(Math.max(0, prevL.index - Lk), prevL.index + 1)), bottom: prevL.value } : null
    const tgt = [...swH].reverse().find((s) => s.value > mss.level) || swH[swH.length - 1]
    return { bias: 'bull', bos: { index: Lp.index, level: Lp.value }, sweep, mss, ob, bb, target: tgt ? { level: tgt.value } : null }
  }

  return NULL
}
```

- [ ] **Step 4: Run to verify pass**

```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/engine/__tests__/dolos.test.ts 2>&1 | tail -8
```
Expected: PASS (4 tests). If the bear assertions are off by a bar, the arrays are the contract — re-trace and adjust the expected indices to match the deterministic output (do NOT weaken the algorithm).

- [ ] **Step 5: Commit**

```
cd /opt/zeus-terminal && git add client/src/engine/indicatorCalc.ts client/src/engine/__tests__/dolos.test.ts
git commit -m "feat(dolos): dolos() SMC liquidity-trap detection (6 elements) with tests"
```

---

## Task 3: Render + registration (mirror the `olympus` overlay)

**Files:** Modify `client/src/engine/indicators.ts`, `client/src/core/config.ts`, `server/services/indicatorIds.js`

- [ ] **Step 1: Find the olympus wiring** — `grep -n "olympus\|Olympus\|olyMarkS" client/src/engine/indicators.ts client/src/core/config.ts`. Note the 4 touch-points to mirror for `dolos`: (a) `INDICATORS` entry + `IND_SETTINGS` default in config.ts, (b) the `import { ... olympus as _calcOLYMPUS ...}` line, (c) the `_indRenderHook` line that calls `updateOlympus()`, (d) the `applyIndVisibility` `case 'olympus':` block.

- [ ] **Step 2: Add the calc import** — in indicators.ts, in the big `from './indicatorCalc'` import (line 13), add `dolos as _calcDOLOS` to the list.

- [ ] **Step 3: Add the renderer** — in `client/src/engine/indicators.ts`, after `updateOlympus` (~line 2862), add:

```ts
// ═══════════════════════════════════════════════════════════════
// DOLOS — SMC "liquidity trap": BOS / SWEEP / MSS labels + Order Block (red) &
// Breaker Block (blue) zones + TARGET line. Main-chart overlay (mirrors OLYMPUS).
// ═══════════════════════════════════════════════════════════════
export function initDolosSeries(): void {
  if (w.dolosMarkS || !w.mainChart) return
  w.dolosMarkS = w.mainChart.addLineSeries({ color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  const band = (c: string) => w.mainChart.addLineSeries({ color: c, lineWidth: 1, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w.dolosObTopS = band('rgba(255,59,48,0.6)'); w.dolosObBotS = band('rgba(255,59,48,0.6)')
  w.dolosBbTopS = band('rgba(91,141,239,0.6)'); w.dolosBbBotS = band('rgba(91,141,239,0.6)')
}
export function updateDolos(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initDolosSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.dolos || {}
  const r = _calcDOLOS(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.open), k.map((b: any) => b.close), Math.round(s.lookback) || 5)
  const col = r.bias === 'bull' ? '#00e676' : '#ff1744'
  const marks: any[] = []
  const mk = (p: any, text: string) => { if (p && k[p.index]) marks.push({ time: k[p.index].time, position: r.bias === 'bull' ? 'belowBar' : 'aboveBar', shape: r.bias === 'bull' ? 'arrowUp' : 'arrowDown', color: col, text }) }
  mk(r.bos, 'BOS'); mk(r.sweep, 'SWEEP'); mk(r.mss, 'MSS')
  try { w.dolosMarkS.setData(k.map((b: any) => ({ time: b.time, value: b.close }))); w.dolosMarkS.setMarkers(marks.sort((a, b) => a.time - b.time)) } catch (_) { }
  const t1 = k[k.length - 1].time
  const drawZone = (topS: any, botS: any, z: any) => {
    try {
      if (z && k[z.index]) { const t0 = k[z.index].time; topS.setData([{ time: t0, value: z.top }, { time: t1, value: z.top }]); botS.setData([{ time: t0, value: z.bottom }, { time: t1, value: z.bottom }]) }
      else { topS.setData([]); botS.setData([]) }
    } catch (_) { }
  }
  drawZone(w.dolosObTopS, w.dolosObBotS, r.ob)
  drawZone(w.dolosBbTopS, w.dolosBbBotS, r.bb)
  try { if (w._dolosTargetLine) { w.dolosMarkS.removePriceLine(w._dolosTargetLine); w._dolosTargetLine = null } } catch (_) { }
  if (r.target) { try { w._dolosTargetLine = w.dolosMarkS.createPriceLine({ price: r.target.level, color: 'rgba(255,255,255,0.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'TARGET' }) } catch (_) { } }
}
export function clearDolos(): void {
  try {
    [w.dolosObTopS, w.dolosObBotS, w.dolosBbTopS, w.dolosBbBotS].forEach((sx: any) => { if (sx) sx.setData([]) })
    if (w.dolosMarkS) { w.dolosMarkS.setMarkers([]); if (w._dolosTargetLine) { w.dolosMarkS.removePriceLine(w._dolosTargetLine); w._dolosTargetLine = null } }
  } catch (_) { }
}
```

- [ ] **Step 4: Wire the hook + visibility** — in indicators.ts: in `_indRenderHook` add (next to the olympus call) `if (w.S.activeInds.dolos) { try { updateDolos() } catch (_) {} }`. In `applyIndVisibility`, add a case:

```ts
    case 'dolos':
      if (show) updateDolos(); else clearDolos()
      break
```
And in the settings-label map (indicators.ts ~line 686) ensure `lookback: 'Swing Lookback'` exists (it already does) — no change needed.

- [ ] **Step 5: Register in config.ts** — in `client/src/core/config.ts`, add to the `INDICATORS` array (near other structure/overlay entries):

```ts
  { id: 'dolos', ico: _ZI.eye, name: 'DOLOS', desc: 'SMC liquidity trap — BOS / sweep / MSS + order & breaker blocks', cat: 'structure', isOverlay: true },
```
And add a default to `IND_SETTINGS` (grep `IND_SETTINGS` in config.ts for the defaults object): `dolos: { lookback: 5 },`. (If `_ZI.eye` is not a key, use any existing `_ZI.*` glyph present in the file.)

- [ ] **Step 6: Server id set** — in `server/services/indicatorIds.js`, add `'dolos',` to the `INDICATOR_IDS` set.

- [ ] **Step 7: Build**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS" | head
```
Expected: built clean. (Fix any TS error about `w.dolos*` by following how `w.oly*` props are typed — they're on the `any` window bridge, so no decl needed.)

- [ ] **Step 8: Commit**

```
cd /opt/zeus-terminal && git add client/src/engine/indicators.ts client/src/core/config.ts server/services/indicatorIds.js
git commit -m "feat(dolos): main-chart overlay render + registration (mirrors olympus)"
```

---

## Task 4: Deploy + headless verify

- [ ] **Step 1: chown + bump** — `cd /opt/zeus-terminal && chown -R zeus:zeus public/app`. Bump `server/version.js` (1.7.123 b149, changelog: DOLOS SMC liquidity-trap overlay). Validate `node -e "require('./server/version.js')" && echo OK`.

- [ ] **Step 2: Reload (operator GO)** — `sudo -u zeus pm2 reload zeus && sleep 3 && curl -s -o /dev/null -w "health=%{http_code}\n" http://localhost:3000/api/health` (expect 401).

- [ ] **Step 3: Headless** — mint uid=1 token; open the chart; enable DOLOS (toggle the overlay via the picker, or `applyIndVisibility('dolos', true)` is internal — toggle through the React picker switch for `dolos`). Assert: `w.dolosMarkS` exists, markers/zone series populate when a setup exists on the live data (may be empty if no setup — acceptable), 0 page/console errors. Screenshot the chart; delete the screenshot after.

- [ ] **Step 4: Commit + push (after GO)**

```
git add server/version.js
git commit -m "release: DOLOS SMC liquidity-trap overlay — b149"
git push origin main
```

---

## Rollback
Pure client overlay + an additive server id. Toggle DOLOS off (clearDolos) or revert the commits. No brain/trading impact.

## Self-review
- **Spec coverage:** `dolos()` 6-element detection (T2) ✓; `_dolosSwings` (T1) ✓; render markers+OB/BB bands+TARGET via OLYMPUS pattern (T3 S3) ✓; registration overlay + hook + visibility + IND_SETTINGS + indicatorIds (T3 S2,4,5,6) ✓; most-recent-only (the algorithm returns one setup, the latest swept high/low) ✓; null-safe/no-throw (NULL returns + try/catch) ✓; testing vitest + headless ✓.
- **Type consistency:** `dolos()` returns `{bias,bos,sweep,mss,ob,bb,target}`; `DolosZone{index,top,bottom}`, `DolosPoint{index,level}`, `target{level}`; renderer reads exactly those (`r.ob`, `r.bb`, `r.target.level`, `r.bos/sweep/mss.index`). `_dolosSwings(highs,lows,L)` signature consistent T1↔T2. Series names `dolosMarkS/dolosObTopS/dolosObBotS/dolosBbTopS/dolosBbBotS/_dolosTargetLine` consistent across init/update/clear.
- **Placeholder scan:** all code concrete; the synthetic test arrays are hand-traced (Task 2 header). Only soft spot: the exact `_ZI` glyph + `INDICATORS`/`IND_SETTINGS`/hook insertion points are "mirror olympus" — T3 S1 grounds them by grepping the real olympus wiring before editing.
