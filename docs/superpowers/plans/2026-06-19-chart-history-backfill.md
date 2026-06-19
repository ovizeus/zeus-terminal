# Chart Historical Backfill-on-Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user scroll the chart back through up to 5000 bars per (symbol×timeframe) by lazily fetching+prepending older candles on left-edge scroll, without the view jumping, gated behind a flag for instant rollback.

**Architecture:** A new isolated client module `chartBackfill.ts` owns backfill state and the load-older flow; it installs its own visible-range subscription, fetches one older window at a time via the existing `/api/market/klines` route (extended with an additive `endTime` param), merges + re-renders + restores the visible range. A shared `_capKlines` helper reconciles the live-append trim with the 5000-bar window. The whole feature is gated behind `CHART_BACKFILL_ENABLED` (default ON, instant OFF restores today's behavior).

**Tech Stack:** TypeScript client (Vite/vitest), lightweight-charts ^4.1.3, Node CommonJS server (jest), `w.__MF` migration-flag surface.

**Rules (project):** TDD obligatory; backup `.bak` before each file edit; build client as `sudo -u zeus npm run build` then `chown -R zeus:zeus public/app`; run tests as `sudo -u zeus npx vitest run <path>` (client) / `sudo -u zeus npx jest <path> --forceExit --runInBand` (server); NEVER full jest on the live VPS; GO before deploy; bump `server/version.js` (build+version) to force SW update; commit per task.

---

## Files

- **Create:** `client/src/data/chartBackfill.ts` — backfill state + pure helpers + loadOlder/initBackfill/resetBackfill.
- **Create:** `client/src/data/__tests__/chartBackfill.test.ts` — unit tests for pure helpers.
- **Modify:** `client/src/data/marketDataChart.ts` — `_capKlines` at the 3 trim sites; call `initBackfill()` after the chart-sync subscription is installed.
- **Modify:** `client/src/data/marketDataWS.ts` — `setSymbol` → `resetBackfill()`.
- **Modify:** `client/src/data/marketDataFeeds.ts` — `setTF` → `resetBackfill()`.
- **Modify:** `server/routes/marketProxy.js` — extract pure `_buildKlinesUrl` + `_klinesCacheKeyParams`; accept additive `endTime`; long TTL for historical windows.
- **Create:** `server/routes/__tests__/marketProxy.klines.test.js` — unit tests for the pure URL/cache helpers.
- **Modify:** `server/migrationFlags.js` — add `CHART_BACKFILL_ENABLED: true` default + getter.
- **Modify:** `client/src/app.css` — discrete loading-indicator styles.
- **Modify:** `server/version.js` — bump build+version at deploy.

---

## Task 1: Migration flag `CHART_BACKFILL_ENABLED` (server, default ON)

**Files:**
- Modify: `server/migrationFlags.js` (defaults object near `ALT_WS_FEEDS: false` ~line 54; getters block near ~line 392)

- [ ] **Step 1: Back up the file**

```bash
cp server/migrationFlags.js server/migrationFlags.js.bak-backfill
```

- [ ] **Step 2: Add the default flag**

In the `flags` defaults object, immediately after the `ALT_WS_FEEDS: false,` line, add:

```js
    // [2026-06-19] CHART_BACKFILL_ENABLED — lazy historical backfill on left-edge
    // scroll (up to 5000 bars/symbol×tf). Default ON (operator-requested feature).
    // Flip OFF for instant rollback: client stops backfilling, _capKlines reverts
    // to the original 1500→1200 window, no endTime is sent. No trading-path change.
    CHART_BACKFILL_ENABLED: true,
```

- [ ] **Step 3: Add the getter**

In the getters block (near the other `get ALT_WS_FEEDS()` getter ~line 392), add:

```js
    get CHART_BACKFILL_ENABLED() { return flags.CHART_BACKFILL_ENABLED; },
```

- [ ] **Step 4: Verify `getAll()` exposes the new key**

Run:

```bash
cd /opt/zeus-terminal && node -e "const MF=require('./server/migrationFlags'); console.log('CHART_BACKFILL_ENABLED' in MF.getAll(), MF.getAll().CHART_BACKFILL_ENABLED)"
```

Expected output: `true true` (key present, default true). If the first value is `false`, `getAll()` does not enumerate the new key — inspect `getAll()` in migrationFlags.js and ensure it includes `CHART_BACKFILL_ENABLED` (mirror how `ALT_WS_FEEDS` is included).

- [ ] **Step 5: Commit**

```bash
git add server/migrationFlags.js && git commit -m "feat(flags): add CHART_BACKFILL_ENABLED (default on) for chart history backfill"
```

---

## Task 2: Pure helpers in `chartBackfill.ts` (TDD)

**Files:**
- Create: `client/src/data/chartBackfill.ts`
- Test: `client/src/data/__tests__/chartBackfill.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `client/src/data/__tests__/chartBackfill.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  _shouldTriggerBackfill, _mergeOlderKlines, _computeRestoredRange, _nextEndTime,
  MAX_BARS, EDGE_THRESHOLD, FETCH_LIMIT,
} from '../chartBackfill'

const bar = (t: number) => ({ time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 })

describe('_shouldTriggerBackfill', () => {
  const base = { from: 2, klinesLen: 1000, inFlight: false, exhausted: false, enabled: true, maxBars: MAX_BARS, edgeThreshold: EDGE_THRESHOLD }
  it('triggers when near the left edge and all clear', () => {
    expect(_shouldTriggerBackfill(base)).toBe(true)
  })
  it('does not trigger when disabled', () => {
    expect(_shouldTriggerBackfill({ ...base, enabled: false })).toBe(false)
  })
  it('does not trigger when a fetch is already in flight', () => {
    expect(_shouldTriggerBackfill({ ...base, inFlight: true })).toBe(false)
  })
  it('does not trigger when exhausted', () => {
    expect(_shouldTriggerBackfill({ ...base, exhausted: true })).toBe(false)
  })
  it('does not trigger at or above the bar cap', () => {
    expect(_shouldTriggerBackfill({ ...base, klinesLen: MAX_BARS })).toBe(false)
  })
  it('does not trigger when not near the edge', () => {
    expect(_shouldTriggerBackfill({ ...base, from: EDGE_THRESHOLD + 5 })).toBe(false)
  })
  it('does not trigger with empty klines or null range', () => {
    expect(_shouldTriggerBackfill({ ...base, klinesLen: 0 })).toBe(false)
    expect(_shouldTriggerBackfill({ ...base, from: null as any })).toBe(false)
  })
})

describe('_mergeOlderKlines', () => {
  it('prepends older bars and keeps strictly ascending unique times', () => {
    const older = [bar(100), bar(200), bar(300)]
    const current = [bar(300), bar(400)] // 300 overlaps boundary
    const merged = _mergeOlderKlines(older, current)
    expect(merged.map(b => b.time)).toEqual([100, 200, 300, 400])
  })
  it('returns current unchanged when older is empty', () => {
    const current = [bar(300), bar(400)]
    expect(_mergeOlderKlines([], current)).toEqual(current)
  })
  it('drops any older bar at or beyond the current boundary', () => {
    const older = [bar(100), bar(300), bar(500)] // 300 and 500 >= current[0]=300
    const current = [bar(300), bar(400)]
    expect(_mergeOlderKlines(older, current).map(b => b.time)).toEqual([100, 300, 400])
  })
})

describe('_computeRestoredRange', () => {
  it('shifts both bounds by the prepended count', () => {
    expect(_computeRestoredRange({ from: 2, to: 50 }, 1000)).toEqual({ from: 1002, to: 1050 })
  })
  it('is null-safe', () => {
    expect(_computeRestoredRange(null, 1000)).toBeNull()
  })
})

describe('_nextEndTime', () => {
  it('returns the oldest bar time in ms minus 1', () => {
    expect(_nextEndTime(1700)).toBe(1700 * 1000 - 1)
  })
})

describe('constants', () => {
  it('are set to the agreed values', () => {
    expect(MAX_BARS).toBe(5000)
    expect(EDGE_THRESHOLD).toBe(12)
    expect(FETCH_LIMIT).toBe(1000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/data/__tests__/chartBackfill.test.ts
```

Expected: FAIL — `Failed to resolve import "../chartBackfill"` / exports not found.

- [ ] **Step 3: Create the module with the pure helpers + constants**

Create `client/src/data/chartBackfill.ts`:

```ts
// Zeus — data/chartBackfill.ts
// Lazy historical backfill on left-edge scroll. Pure helpers are exported for unit
// tests; the impure loadOlder/initBackfill/resetBackfill orchestration is added in a
// later task. Gated by w.__MF.CHART_BACKFILL_ENABLED.

export const MAX_BARS = 5000
export const EDGE_THRESHOLD = 12
export const FETCH_LIMIT = 1000

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

export function _shouldTriggerBackfill(o: {
  from: number | null; klinesLen: number; inFlight: boolean; exhausted: boolean;
  enabled: boolean; maxBars: number; edgeThreshold: number
}): boolean {
  if (!o.enabled || o.inFlight || o.exhausted) return false
  if (o.klinesLen <= 0 || o.klinesLen >= o.maxBars) return false
  if (o.from == null) return false
  return o.from < o.edgeThreshold
}

// Concatenate older + current, dropping any older bar whose time is >= the current
// window's first bar time (boundary overlap), and guarantee strictly ascending unique
// times. Empty older → current unchanged.
export function _mergeOlderKlines(older: Bar[], current: Bar[]): Bar[] {
  if (!older || !older.length) return current
  if (!current || !current.length) return older
  const boundary = current[0].time
  const trimmed = older.filter(b => b.time < boundary)
  return trimmed.concat(current)
}

export function _computeRestoredRange(prev: { from: number; to: number } | null, prependedCount: number): { from: number; to: number } | null {
  if (!prev) return null
  return { from: prev.from + prependedCount, to: prev.to + prependedCount }
}

export function _nextEndTime(oldestBarTimeSec: number): number {
  return oldestBarTimeSec * 1000 - 1
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/data/__tests__/chartBackfill.test.ts
```

Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add client/src/data/chartBackfill.ts client/src/data/__tests__/chartBackfill.test.ts
git commit -m "feat(chart): pure backfill helpers (trigger/merge/range/endTime) with tests"
```

---

## Task 3: `_capKlines` helper + reconcile the 3 trim sites (TDD)

**Files:**
- Modify: `client/src/data/chartBackfill.ts` (add `_capKlines`)
- Modify: `client/src/data/__tests__/chartBackfill.test.ts` (add tests)
- Modify: `client/src/data/marketDataChart.ts` (replace the 3 inline trims at the WS append paths — currently `if (w.S.klines.length > 1500) w.S.klines = w.S.klines.slice(-1200)`)

- [ ] **Step 1: Write the failing test**

Append to `client/src/data/__tests__/chartBackfill.test.ts`:

```ts
import { _capKlines } from '../chartBackfill'

describe('_capKlines', () => {
  const arr = (n: number) => Array.from({ length: n }, (_, i) => bar(i))
  it('enabled: keeps a sliding 5000-bar window, trimming only past the buffer', () => {
    expect(_capKlines(arr(5000), true).length).toBe(5000)   // under buffer → untouched
    expect(_capKlines(arr(5201), true).length).toBe(5000)   // over buffer → sliced to 5000
  })
  it('disabled: preserves the original 1500→1200 behavior', () => {
    expect(_capKlines(arr(1500), false).length).toBe(1500)  // not over 1500 → untouched
    expect(_capKlines(arr(1501), false).length).toBe(1200)  // over 1500 → sliced to 1200
  })
  it('keeps the NEWEST bars when trimming (drops oldest)', () => {
    const out = _capKlines(arr(5201), true)
    expect(out[out.length - 1].time).toBe(5200) // newest preserved
    expect(out[0].time).toBe(201)               // oldest 201 dropped
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/data/__tests__/chartBackfill.test.ts -t _capKlines
```

Expected: FAIL — `_capKlines is not a function`.

- [ ] **Step 3: Add `_capKlines` to `chartBackfill.ts`**

Append to `client/src/data/chartBackfill.ts`:

```ts
// Trim the klines array to a bounded window. When backfill is enabled, use a sliding
// MAX_BARS (5000) window with a small buffer so we don't slice on every tick — and so
// backfilled history is not discarded by the next live append. When disabled, preserve
// the original pre-backfill behavior exactly (>1500 → keep last 1200).
export function _capKlines<T>(arr: T[], enabled: boolean): T[] {
  if (enabled) {
    if (arr.length > MAX_BARS + 200) return arr.slice(-MAX_BARS)
    return arr
  }
  if (arr.length > 1500) return arr.slice(-1200)
  return arr
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/data/__tests__/chartBackfill.test.ts
```

Expected: PASS (all, including `_capKlines`).

- [ ] **Step 5: Back up and wire `_capKlines` into the 3 WS append sites**

```bash
cp client/src/data/marketDataChart.ts client/src/data/marketDataChart.ts.bak-backfill
```

Add to the imports at the top of `client/src/data/marketDataChart.ts` (near the other `../utils/guards` / data imports):

```ts
import { _capKlines } from './chartBackfill'
```

Then replace **all three** occurrences of this exact line:

```ts
        else { w.S.klines.push(bar); if (w.S.klines.length > 1500) w.S.klines = w.S.klines.slice(-1200) }
```

with:

```ts
        else { w.S.klines.push(bar); w.S.klines = _capKlines(w.S.klines, !!(w.__MF && w.__MF.CHART_BACKFILL_ENABLED === true)) }
```

Note: one of the three is indented with 10 spaces (the direct-WS `onmessage` path) instead of 8 — match each site's existing indentation when editing. Confirm exactly 3 sites:

```bash
grep -n "_capKlines(w.S.klines" client/src/data/marketDataChart.ts
```

Expected: 3 lines.

- [ ] **Step 6: Run client build to verify it compiles**

```bash
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS|Error" | head
```

Expected: `✓ built in ...`, no `error TS`.

- [ ] **Step 7: Commit**

```bash
cd /opt/zeus-terminal && chown -R zeus:zeus public/app
git add client/src/data/chartBackfill.ts client/src/data/__tests__/chartBackfill.test.ts client/src/data/marketDataChart.ts
git commit -m "feat(chart): _capKlines sliding 5000-bar window (flag-gated), reconcile 3 WS trim sites"
```

---

## Task 4: Server `/klines` additive `endTime` (TDD via pure helpers)

**Files:**
- Modify: `server/routes/marketProxy.js` (extract `_buildKlinesUrl` + `_klinesCacheKeyParams`; use them in the `/klines` handler ~line 88)
- Test: `server/routes/__tests__/marketProxy.klines.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/routes/__tests__/marketProxy.klines.test.js`:

```js
const { _buildKlinesUrl, _klinesCacheKeyParams, _klinesTtl, FUTURES_BASE } = require('../marketProxy');

describe('_buildKlinesUrl', () => {
  it('builds the standard URL without endTime (byte-identical to today)', () => {
    const url = _buildKlinesUrl('BTCUSDT', '1h', 1000, undefined);
    expect(url).toBe(`${FUTURES_BASE}/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=1000`);
  });
  it('appends endTime when present', () => {
    const url = _buildKlinesUrl('ETHUSDT', '5m', 1000, 1699999999999);
    expect(url).toBe(`${FUTURES_BASE}/fapi/v1/klines?symbol=ETHUSDT&interval=5m&limit=1000&endTime=1699999999999`);
  });
  it('ignores a non-positive / non-numeric endTime', () => {
    expect(_buildKlinesUrl('BTCUSDT', '1h', 500, 0)).not.toContain('endTime');
    expect(_buildKlinesUrl('BTCUSDT', '1h', 500, -5)).not.toContain('endTime');
    expect(_buildKlinesUrl('BTCUSDT', '1h', 500, NaN)).not.toContain('endTime');
  });
});

describe('_klinesCacheKeyParams', () => {
  it('omits endTime when absent (same key as today)', () => {
    expect(_klinesCacheKeyParams('BTCUSDT', '1h', 1000, undefined)).toEqual({ symbol: 'BTCUSDT', interval: '1h', limit: 1000 });
  });
  it('includes endTime when present (distinct cache windows)', () => {
    expect(_klinesCacheKeyParams('BTCUSDT', '1h', 1000, 123)).toEqual({ symbol: 'BTCUSDT', interval: '1h', limit: 1000, endTime: 123 });
  });
});

describe('_klinesTtl', () => {
  it('uses the short poll TTL for tiny live polls', () => {
    expect(_klinesTtl(1, undefined)).toBe(10000);
  });
  it('uses the long historical TTL when endTime is present (immutable closed window)', () => {
    expect(_klinesTtl(1000, 123)).toBe(3600000);
  });
  it('uses the init TTL for a normal initial fetch', () => {
    expect(_klinesTtl(1000, undefined)).toBe(60000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/zeus-terminal && sudo -u zeus npx jest server/routes/__tests__/marketProxy.klines.test.js --forceExit --runInBand 2>&1 | tail -15
```

Expected: FAIL — `_buildKlinesUrl is not a function` (helpers not exported yet).

- [ ] **Step 3: Back up the file**

```bash
cp server/routes/marketProxy.js server/routes/marketProxy.js.bak-backfill
```

- [ ] **Step 4: Add pure helpers + a historical TTL, and use them in the handler**

In `server/routes/marketProxy.js`, add to the `CACHE_TTL` object (near `klines_init: 60000,`):

```js
    klines_history: 3600000,
```

Add these pure helpers (near the top, after the `CACHE_TTL` block):

```js
// [2026-06-19] Pure, testable helpers for the /klines route. endTime is additive:
// when absent the URL + cache key are byte-identical to the pre-backfill behavior.
function _validEndTime(endTime) {
    const n = Number(endTime);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
function _buildKlinesUrl(symbol, interval, lim, endTime) {
    let url = `${FUTURES_BASE}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${lim}`;
    const et = _validEndTime(endTime);
    if (et !== null) url += `&endTime=${et}`;
    return url;
}
function _klinesCacheKeyParams(symbol, interval, lim, endTime) {
    const params = { symbol, interval, limit: lim };
    const et = _validEndTime(endTime);
    if (et !== null) params.endTime = et;
    return params;
}
function _klinesTtl(lim, endTime) {
    if (_validEndTime(endTime) !== null) return CACHE_TTL.klines_history; // immutable closed window
    return lim <= 2 ? CACHE_TTL.klines_poll : CACHE_TTL.klines_init;
}
```

Replace the body of the `/klines` handler's URL/key/ttl setup. Find:

```js
    const lim = Math.min(parseInt(limit) || 500, 1500);
    const url = `${FUTURES_BASE}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${lim}`;
    const ttl = lim <= 2 ? CACHE_TTL.klines_poll : CACHE_TTL.klines_init;
    const key = _cacheKey('klines', { symbol, interval, limit: lim });
```

Replace with (note: read `endTime` from `req.query`):

```js
    const lim = Math.min(parseInt(limit) || 500, 1500);
    const url = _buildKlinesUrl(symbol, interval, lim, req.query.endTime);
    const ttl = _klinesTtl(lim, req.query.endTime);
    const key = _cacheKey('klines', _klinesCacheKeyParams(symbol, interval, lim, req.query.endTime));
```

At the bottom of the file, ensure the helpers + `FUTURES_BASE` are exported alongside the router. Find the existing `module.exports` and extend it. If the file currently does `module.exports = router;`, change to:

```js
module.exports = router;
module.exports._buildKlinesUrl = _buildKlinesUrl;
module.exports._klinesCacheKeyParams = _klinesCacheKeyParams;
module.exports._klinesTtl = _klinesTtl;
module.exports.FUTURES_BASE = FUTURES_BASE;
```

(If `FUTURES_BASE` is a `const` declared earlier in the file, this works; confirm with `grep -n "FUTURES_BASE" server/routes/marketProxy.js`.)

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /opt/zeus-terminal && sudo -u zeus npx jest server/routes/__tests__/marketProxy.klines.test.js --forceExit --runInBand 2>&1 | tail -15
```

Expected: PASS (all 3 describe blocks).

- [ ] **Step 6: Commit**

```bash
git add server/routes/marketProxy.js server/routes/__tests__/marketProxy.klines.test.js
git commit -m "feat(server): additive endTime on /klines (historical backfill) + long TTL for closed windows"
```

---

## Task 5: `loadOlder` + `initBackfill` + `resetBackfill` orchestration

**Files:**
- Modify: `client/src/data/chartBackfill.ts` (add the impure flow)
- Modify: `client/src/data/marketDataChart.ts` (call `initBackfill()` after the chart-sync subscription block)
- Modify: `client/src/data/marketDataWS.ts` (`setSymbol` → `resetBackfill()`)
- Modify: `client/src/data/marketDataFeeds.ts` (`setTF` → `resetBackfill()`)

This task is impure (network + chart mutation) and is verified by the headless integration test in Task 7, not by a unit test. Keep every external call guarded.

- [ ] **Step 1: Add the orchestration to `chartBackfill.ts`**

Append to `client/src/data/chartBackfill.ts`:

```ts
const w = window as any

let _inFlight = false
let _exhausted = false
let _installed = false

function _enabled(): boolean {
  return !!(w.__MF && w.__MF.CHART_BACKFILL_ENABLED === true)
}

function _showLoading(show: boolean): void {
  let el = document.getElementById('chartBackfillLoading')
  if (!el && show) {
    const host = document.getElementById('csec') || document.body
    el = document.createElement('div')
    el.id = 'chartBackfillLoading'
    el.textContent = '⟳ loading history…'
    host.appendChild(el)
  }
  if (el) el.style.display = show ? 'block' : 'none'
}

export function resetBackfill(): void {
  _inFlight = false
  _exhausted = false
  _showLoading(false)
}

export async function loadOlder(): Promise<void> {
  if (!_enabled() || _inFlight || _exhausted) return
  if (!w.cSeries || !w.mainChart || !Array.isArray(w.S?.klines) || !w.S.klines.length) return
  if (w.S.klines.length >= MAX_BARS) return

  _inFlight = true
  _showLoading(true)
  const gen = w.__wsGen
  const sym = w.S.symbol
  const tf = w.S.chartTf
  let prevRange: { from: number; to: number } | null = null
  try { prevRange = w.mainChart.timeScale().getVisibleLogicalRange() } catch (_) { prevRange = null }
  const oldest = w.S.klines[0].time

  try {
    const ac = new AbortController()
    const acTimer = setTimeout(() => ac.abort(), 10000)
    let r: Response
    try {
      r = await fetch(`/api/market/klines?symbol=${sym}&interval=${tf}&endTime=${_nextEndTime(oldest)}&limit=${FETCH_LIMIT}&bg=1`, { signal: ac.signal })
    } finally { clearTimeout(acTimer) }
    if (!r || !r.ok) return // no-op, never mutate klines on failure
    const d = await r.json()
    // Stale guard: symbol/tf/gen changed during the fetch → drop silently.
    if (w.__wsGen !== gen || w.S.symbol !== sym || w.S.chartTf !== tf) return
    if (!Array.isArray(d) || !d.length) { _exhausted = true; return }

    const olderBars: Bar[] = d
      .map((k: any) => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
      .filter((k: Bar) => _isHistoricalBarSane(k))
    if (!olderBars.length) { _exhausted = true; return }

    const before = w.S.klines.length
    const merged = _mergeOlderKlines(olderBars, w.S.klines)
    const prepended = merged.length - before
    if (prepended <= 0) { _exhausted = true; return } // nothing genuinely older
    if (olderBars.length < FETCH_LIMIT) _exhausted = true // reached listing date

    w.S.klines = merged
    try { w.cSeries.setData(w.S.klines) } catch (_) { }
    try { if (typeof w.rebuildCandleSeriesFromKlines === 'function') w.rebuildCandleSeriesFromKlines() } catch (_) { }
    try { if (typeof _indRenderHook === 'function') _indRenderHook() } catch (_) { }
    try { if (typeof renderTradeMarkers === 'function') renderTradeMarkers() } catch (_) { }
    const restored = _computeRestoredRange(prevRange, prepended)
    if (restored) { try { w.mainChart.timeScale().setVisibleLogicalRange(restored) } catch (_) { } }
  } catch (_) {
    // Any error → no-op. Never blank or partially-write the chart.
  } finally {
    _inFlight = false
    _showLoading(false)
  }
}

export function initBackfill(): void {
  if (_installed || !w.mainChart) return
  _installed = true
  try {
    w.mainChart.timeScale().subscribeVisibleLogicalRangeChange((r: any) => {
      const ok = _shouldTriggerBackfill({
        from: r ? r.from : null,
        klinesLen: Array.isArray(w.S?.klines) ? w.S.klines.length : 0,
        inFlight: _inFlight,
        exhausted: _exhausted,
        enabled: _enabled(),
        maxBars: MAX_BARS,
        edgeThreshold: EDGE_THRESHOLD,
      })
      if (ok) { void loadOlder() }
    })
  } catch (_) { _installed = false }
}
```

- [ ] **Step 2: Add the imports `chartBackfill.ts` now needs**

At the top of `client/src/data/chartBackfill.ts`, add:

```ts
import { _isHistoricalBarSane } from '../utils/guards'
import { _indRenderHook } from '../engine/indicators'
import { renderTradeMarkers } from './marketDataOverlays'
```

- [ ] **Step 3: Wire `initBackfill()` into the chart setup**

In `client/src/data/marketDataChart.ts`, add to the top imports (extend the existing `./chartBackfill` import from Task 3):

```ts
import { _capKlines, initBackfill, resetBackfill } from './chartBackfill'
```

Find the existing chart-sync subscription block (the `if (!w._chartSyncInstalled) { ... }` block, ~line 87-98). Immediately AFTER that block's closing `}`, add:

```ts
  try { initBackfill() } catch (_) { }
```

- [ ] **Step 4: Wire `resetBackfill()` into `setSymbol`**

In `client/src/data/marketDataWS.ts`, add the import (top of file):

```ts
import { resetBackfill } from './chartBackfill'
```

In `setSymbol`, immediately after the `w.S.klines = []; ...` reset line (~line 421), add:

```ts
    try { resetBackfill() } catch (_) { }
```

- [ ] **Step 5: Wire `resetBackfill()` into `setTF`**

In `client/src/data/marketDataFeeds.ts`, add the import (top of file):

```ts
import { resetBackfill } from './chartBackfill'
```

In `setTF`, immediately after `w.S.chartTf = tf` (~line 21), add:

```ts
  try { resetBackfill() } catch (_) { }
```

- [ ] **Step 6: Build to verify it compiles**

```bash
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS|Error" | head
```

Expected: `✓ built in ...`, no `error TS`. (A circular import between marketDataChart ↔ chartBackfill is acceptable for module-level functions called at runtime, but if the build flags a runtime-init cycle warning, confirm no value is used at import time — all cross-imports here are only called inside functions.)

- [ ] **Step 7: Run all client unit tests (no regression)**

```bash
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/data src/utils 2>&1 | tail -6
```

Expected: all pass (existing 62 + new chartBackfill tests).

- [ ] **Step 8: Commit**

```bash
cd /opt/zeus-terminal && chown -R zeus:zeus public/app
git add client/src/data/chartBackfill.ts client/src/data/marketDataChart.ts client/src/data/marketDataWS.ts client/src/data/marketDataFeeds.ts
git commit -m "feat(chart): backfill orchestration (loadOlder/initBackfill/resetBackfill) wired into scroll + symbol/tf switch"
```

---

## Task 6: Discrete loading-indicator styling

**Files:**
- Modify: `client/src/app.css`

- [ ] **Step 1: Back up the file**

```bash
cp client/src/app.css client/src/app.css.bak-backfill
```

- [ ] **Step 2: Add the indicator styles**

Append to `client/src/app.css`:

```css
/* [2026-06-19] Chart historical backfill — discrete left-edge loading hint */
#chartBackfillLoading {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  z-index: 30;
  display: none;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: #7a9ab8;
  background: rgba(10, 15, 22, 0.85);
  border: 1px solid #1a2530;
  border-radius: 6px;
  pointer-events: none;
}
```

Note: `#csec` (the chart section) must be a positioned ancestor for `position: absolute` to anchor correctly. Verify it is:

```bash
grep -nE "#csec\s*\{|#csec[^a-zA-Z]" client/src/app.css | head
```

If `#csec` has no `position`, the indicator anchors to the chart section only if `#csec` is `position: relative`/`absolute`. If it is `static`, change the `loadOlder` host fallback (Task 5, `_showLoading`) is already `#csec`; add `position: relative` to the `#csec` rule in app.css in this step.

- [ ] **Step 3: Build to verify CSS compiles**

```bash
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error|Error" | head
```

Expected: `✓ built in ...`.

- [ ] **Step 4: Commit**

```bash
cd /opt/zeus-terminal && chown -R zeus:zeus public/app
git add client/src/app.css && git commit -m "feat(chart): discrete backfill loading indicator styles"
```

---

## Task 7: Integration verification (headless) + deploy

**Files:**
- Modify: `server/version.js` (bump)

- [ ] **Step 1: Reload the server so the new flag + route are live**

```bash
cd /opt/zeus-terminal && sudo -u zeus pm2 reload zeus && sleep 3 && curl -s -o /dev/null -w "health=%{http_code}\n" http://localhost:3000/api/health
```

Expected: reload `✓`; `health=401` (auth-gated endpoint = server up).

- [ ] **Step 2: Confirm the flag reaches the client**

```bash
cd /opt/zeus-terminal && node -e "
require('dotenv').config();const jwt=require('jsonwebtoken');const Database=require('better-sqlite3');
const db=new Database('data/zeus.db',{readonly:true});const u=db.prepare('SELECT id,email,role,token_version FROM users WHERE id=1').get();
const tok=jwt.sign({id:u.id,email:u.email,role:u.role,tokenVersion:u.token_version||1},process.env.JWT_SECRET,{expiresIn:'2h'});
require('fs').writeFileSync('/tmp/_zt_tok.txt',tok);console.log('tok ok');"
curl -s --cookie "zeus_token=$(cat /tmp/_zt_tok.txt)" http://localhost:3000/api/migration/flags | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('CHART_BACKFILL_ENABLED=',j.CHART_BACKFILL_ENABLED)})"
```

Expected: `CHART_BACKFILL_ENABLED= true`.

- [ ] **Step 3: Write and run the headless backfill verification**

Create `/tmp/_zt_backfill.mjs`:

```js
import pw from '/root/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.js'
const { chromium } = pw
import fs from 'fs'
const tok = fs.readFileSync('/tmp/_zt_tok.txt', 'utf8').trim()
const errs = []
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' })
await ctx.addCookies([{ name: 'zeus_token', value: tok, domain: 'localhost', path: '/', httpOnly: true }])
const page = await ctx.newPage()
page.on('pageerror', e => errs.push('PAGEERR '+e.message))
page.on('console', m => { if (m.type()==='error') errs.push('CONSOLEERR '+m.text()) })
await page.goto('http://localhost:3000/app/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForFunction(() => window.cSeries && window.mainChart && window.S && Array.isArray(window.S.klines) && window.S.klines.length>0, null, { timeout: 25000 }).catch(()=>{})
await page.waitForTimeout(4000)
const before = await page.evaluate(() => window.S.klines.length)
// Simulate scrolling to the far left edge repeatedly to trigger backfill
for (let i=0;i<8;i++){
  await page.evaluate(() => { try { const ts=window.mainChart.timeScale(); const r=ts.getVisibleLogicalRange(); if(r){ ts.setVisibleLogicalRange({from:-5, to:r.to-(r.from+5)});} } catch(e){} })
  await page.waitForTimeout(2500)
}
const after = await page.evaluate(() => window.S.klines.length)
console.log('klines before='+before+' after='+after+(after>before?' GREW OK':' NO GROWTH'))
console.log('errors='+errs.length); errs.slice(0,10).forEach(e=>console.log('  '+e))
await browser.close()
```

Run:

```bash
cd /opt/zeus-terminal && timeout 120 node /tmp/_zt_backfill.mjs 2>&1 | tail -15
```

Expected: `klines before=1000 after=<larger, e.g. 2000-5000> GREW OK` and `errors=0`. (The chart must not blank: `after` is always ≥ `before`, never 0.)

- [ ] **Step 4: Clean up the temp artifacts**

```bash
rm -f /tmp/_zt_tok.txt /tmp/_zt_backfill.mjs
```

- [ ] **Step 5: Remove the `.bak` backups**

```bash
cd /opt/zeus-terminal && rm -f server/migrationFlags.js.bak-backfill client/src/data/marketDataChart.ts.bak-backfill server/routes/marketProxy.js.bak-backfill client/src/app.css.bak-backfill
```

- [ ] **Step 6: Bump `server/version.js`**

In `server/version.js`, bump `version` and `build` (e.g. `1.7.107`→`1.7.108`, `133`→`134`) and prepend a changelog entry summarizing: chart historical backfill-on-scroll, 5000-bar cap, flag-gated `CHART_BACKFILL_ENABLED` (default ON, instant OFF rollback), additive server `endTime`, headless-verified klines growth with 0 errors.

- [ ] **Step 7: Final build + chown + reload + commit + push (GET OPERATOR GO FIRST)**

```bash
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error" | head
cd /opt/zeus-terminal && chown -R zeus:zeus public/app
sudo -u zeus pm2 reload zeus && sleep 3
curl -s http://localhost:3000/sw.js | grep -o 'zt-v[0-9.]*-b[0-9]*' | head -1   # expect new build
git add server/version.js && git commit -m "release: chart historical backfill-on-scroll (flag-gated, 5000 bars)"
git push origin main
```

Expected: new SW version string; clean push.

---

## Rollback

- **Instant (no redeploy):** set `CHART_BACKFILL_ENABLED=false` via the admin migration-flags API (or `data/migration_flags.json`) + `pm2 reload zeus`. Client stops backfilling, `_capKlines` reverts to `>1500→1200`, no `endTime` is sent. 100% of pre-feature behavior restored.
- **Per-commit:** each task is an isolated commit with a `.bak` backup; any single piece can be `git revert`ed.
- **Server:** the `endTime` param is additive/backward-compatible — nothing to revert there even with the client flag off.

---

## Self-review notes

- **Spec coverage:** flag (T1) ✓; pure helpers (T2) ✓; cap reconciliation (T3) ✓; server endTime+TTL+cache key (T4) ✓; loadOlder/init/reset + scroll/switch wiring (T5) ✓; discrete indicator (T6) ✓; fail-safe never-blank (T5 guards) ✓; rollback flag (T1+T3+T5 `_enabled()`) ✓; headless verification (T7) ✓. Low-priority `bg=1` lane: the client sends `&bg=1`; explicit binanceScheduler lane-mapping is deferred (backfill shares the existing P4 klines lane, which already graceful-degrades under quota pressure — acceptable per spec). No other gaps.
- **Type consistency:** `Bar` shape `{time,open,high,low,close,volume}` consistent across helpers, tests, and loadOlder; `_capKlines(arr, enabled)`, `_shouldTriggerBackfill(obj)`, `_mergeOlderKlines(older,current)`, `_computeRestoredRange(prev,count)`, `_nextEndTime(sec)` signatures match between Tasks 2/3 and Task 5 usage.
- **Placeholder scan:** no TBD/TODO; every code step has concrete code.
