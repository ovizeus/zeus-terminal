# THEIA — All-Seeing Oracle Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A new read-only `intel` dock panel "THEIA" that synthesizes all of Zeus into modules (live + historical) from REAL data sources, crowned by an honest GREEN/AMBER/RED autonomous-readiness Verdict.

**Architecture:** A `TheiaPage` React panel registered like the existing `OmegaPage`; small per-module card components reading live Zustand stores + real read-only `/api` endpoints; a pure `computeTheiaVerdict` helper (TDD). No money-path, no writes.

**Tech Stack:** React + Zustand (vitest), existing dock/PanelShell pattern, lightweight existing `/api` reads.

**THE GOLDEN RULE (every task):** REAL data only. No hardcoded/mock/sample values. If a source is genuinely empty → render `—`. Never fabricate, never crash a sibling module. Each module's values must trace to a store selector or endpoint field.

**Rules:** TDD for pure logic; backup `.bak` before edits; build `sudo -u zeus npm run build` + `chown -R zeus:zeus public/app`; tests `sudo -u zeus npx vitest run <path>`; GO before deploy; bump version.js for SW.

---

## File structure
- `client/src/components/intel/TheiaPage.tsx` — panel shell: layout + data-fetch lifecycle (poll endpoints on mount + interval, abort on unmount) + passes endpoint data to modules; live modules read stores directly.
- `client/src/components/intel/theia/theiaVerdict.ts` — pure `computeTheiaVerdict(inputs)` + types.
- `client/src/components/intel/theia/__tests__/theiaVerdict.test.ts` — unit tests.
- `client/src/components/intel/theia/VerdictBand.tsx`, `SinceCard.tsx`, `BrainPulseCard.tsx`, `EnginePositionsCard.tsx`, `SafetyHealthCard.tsx`, `MarketLensCard.tsx`, `MlDigestCard.tsx`, `MemorySection.tsx` — module components.
- Modify: `ZeusDock.tsx`, `ui/dock.ts`, `PanelShell.tsx`, `panelInfo.tsx`, `app.css`, `server/version.js`.

---

## Task 1: `computeTheiaVerdict` pure helper (TDD)

**Files:** Create `client/src/components/intel/theia/theiaVerdict.ts` + `client/src/components/intel/theia/__tests__/theiaVerdict.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeTheiaVerdict, TheiaVerdictInput } from '../theiaVerdict'

const healthy: TheiaVerdictInput = {
  circuitOpen: false, halted: false, dataStalled: false, killTriggered: false,
  parityPct: 0.95, regimeStable: true, testnetPnlTrend: 'up',
}

describe('computeTheiaVerdict', () => {
  it('is GREEN when every input is healthy', () => {
    const v = computeTheiaVerdict(healthy)
    expect(v.level).toBe('green')
  })
  it('is RED when a hard safety input fails, and names it', () => {
    expect(computeTheiaVerdict({ ...healthy, circuitOpen: true }).level).toBe('red')
    expect(computeTheiaVerdict({ ...healthy, halted: true }).level).toBe('red')
    expect(computeTheiaVerdict({ ...healthy, dataStalled: true }).level).toBe('red')
    expect(computeTheiaVerdict({ ...healthy, killTriggered: true }).level).toBe('red')
    expect(computeTheiaVerdict({ ...healthy, circuitOpen: true }).reason.toLowerCase()).toContain('circuit')
  })
  it('is AMBER on soft concerns (low parity / unstable regime / declining pnl)', () => {
    expect(computeTheiaVerdict({ ...healthy, parityPct: 0.7 }).level).toBe('amber')
    expect(computeTheiaVerdict({ ...healthy, regimeStable: false }).level).toBe('amber')
    expect(computeTheiaVerdict({ ...healthy, testnetPnlTrend: 'down' }).level).toBe('amber')
  })
  it('RED outranks AMBER (worst input wins)', () => {
    expect(computeTheiaVerdict({ ...healthy, parityPct: 0.7, halted: true }).level).toBe('red')
  })
  it('handles missing/unknown inputs without throwing (null parity, unknown trend)', () => {
    const v = computeTheiaVerdict({ ...healthy, parityPct: null, testnetPnlTrend: 'unknown' })
    expect(['green', 'amber', 'red']).toContain(v.level)
    expect(typeof v.reason).toBe('string')
  })
})
```

- [ ] **Step 2: Run to verify fail**

```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/components/intel/theia/__tests__/theiaVerdict.test.ts
```
Expected: FAIL — cannot resolve `../theiaVerdict`.

- [ ] **Step 3: Implement** — `client/src/components/intel/theia/theiaVerdict.ts`:

```ts
// THEIA verdict — pure synthesis of REAL readiness inputs into one honest traffic-light.
// No data fetching here; callers pass real values read from stores/endpoints.
export interface TheiaVerdictInput {
  circuitOpen: boolean        // exchange circuit breaker open (real: /api/health or telemetry)
  halted: boolean             // global trading halt (real: /api/.../halt)
  dataStalled: boolean        // price/kline feed stalled (real: window.S.dataStalled)
  killTriggered: boolean      // kill-switch fired (real: useATStore)
  parityPct: number | null    // brain↔server parity match % 0..1 (real: /api/parity/report); null = unknown
  regimeStable: boolean       // regime not flipping (real: brain/market regime recent stability)
  testnetPnlTrend: 'up' | 'flat' | 'down' | 'unknown'  // real: closed-trade pnl trend
}

export interface TheiaVerdict {
  level: 'green' | 'amber' | 'red'
  reason: string
  breakdown: { key: string; ok: boolean; soft?: boolean; note: string }[]
}

const PARITY_FLOOR = 0.85

export function computeTheiaVerdict(i: TheiaVerdictInput): TheiaVerdict {
  const breakdown: TheiaVerdict['breakdown'] = []
  // Hard (RED) gates — any one fails → not fit to run autonomously.
  const hard: { key: string; bad: boolean; note: string }[] = [
    { key: 'circuit', bad: i.circuitOpen, note: 'exchange circuit breaker open' },
    { key: 'halt', bad: i.halted, note: 'global trading halt active' },
    { key: 'data', bad: i.dataStalled, note: 'price/data feed stalled' },
    { key: 'kill', bad: i.killTriggered, note: 'kill-switch triggered' },
  ]
  for (const h of hard) breakdown.push({ key: h.key, ok: !h.bad, note: h.bad ? h.note : 'ok' })
  const firstHard = hard.find(h => h.bad)

  // Soft (AMBER) concerns.
  const soft: { key: string; bad: boolean; note: string }[] = [
    { key: 'parity', bad: i.parityPct != null && i.parityPct < PARITY_FLOOR, note: `brain parity below ${Math.round(PARITY_FLOOR * 100)}%` },
    { key: 'regime', bad: !i.regimeStable, note: 'regime unstable / flipping' },
    { key: 'pnl', bad: i.testnetPnlTrend === 'down', note: 'testnet P&L trending down' },
  ]
  for (const s of soft) breakdown.push({ key: s.key, ok: !s.bad, soft: true, note: s.bad ? s.note : 'ok' })
  const firstSoft = soft.find(s => s.bad)

  if (firstHard) return { level: 'red', reason: `Not fit to run — ${firstHard.note}.`, breakdown }
  if (firstSoft) return { level: 'amber', reason: `Caution — ${firstSoft.note}.`, breakdown }
  return { level: 'green', reason: 'Fit to run autonomously — all checks healthy.', breakdown }
}
```

- [ ] **Step 4: Run to verify pass**

```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/components/intel/theia/__tests__/theiaVerdict.test.ts
```
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```
git add client/src/components/intel/theia/theiaVerdict.ts client/src/components/intel/theia/__tests__/theiaVerdict.test.ts
git commit -m "feat(theia): pure computeTheiaVerdict readiness helper with tests"
```

---

## Task 2: Dock registration + TheiaPage shell + (i) info

Registers the icon in all FOUR required places and renders a real (initially data-loading) panel. NO fake data — empty modules show a loading/`—` state.

**Files:** `ZeusDock.tsx`, `ui/dock.ts`, `PanelShell.tsx`, `panelInfo.tsx`, create `TheiaPage.tsx`.

- [ ] **Step 1: Create the shell** `client/src/components/intel/TheiaPage.tsx`:

```tsx
import { useEffect, useState, useRef } from 'react'

// THEIA — read-only all-seeing oracle. Module components are added in later tasks;
// this shell owns the endpoint-poll lifecycle and lays out the hero + grid. REAL data only.
export function TheiaPage() {
  const [, setTick] = useState(0)
  const acRef = useRef<AbortController | null>(null)
  useEffect(() => {
    let alive = true
    const poll = () => { if (alive) setTick(t => t + 1) } // modules self-fetch; tick drives refresh cadence
    const id = setInterval(poll, 12000)
    return () => { alive = false; clearInterval(id); try { acRef.current?.abort() } catch (_) {} }
  }, [])
  return (
    <div className="theia-page">
      <div className="theia-grid">
        {/* Module cards are added in Tasks 3–6 */}
        <div className="theia-card theia-empty">THEIA — modules loading…</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the dock icon** — in `client/src/components/layout/ZeusDock.tsx`, add to the `DOCK` array within the `intel` group (after the `adaptive` entry), an entry:

```tsx
  { id: 'theia', label: 'THEIA', group: 'intel',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="0.8" opacity=".4" />
        <circle cx="12" cy="12" r="3.2" fill="currentColor" opacity=".15" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <path d="M3 12 Q12 4 21 12 Q12 20 3 12 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </>
    ) },
```
(An "all-seeing eye" glyph. Match the existing entry formatting.)

- [ ] **Step 3: Mirror in legacy dock** — in `client/src/ui/dock.ts`, add the mirror entry for `theia` following the exact shape of the other intel entries there (read the file; replicate an existing entry's structure with id `theia`, label `THEIA`, same group, an eye glyph or reuse the label). Keep it consistent with the ZeusDock entry.

- [ ] **Step 4: Render the page + title** — in `client/src/components/layout/PanelShell.tsx`:
  - add import near the other page imports (line ~30): `import { TheiaPage } from '../intel/TheiaPage'`
  - add to `DOCK_TITLES` (line ~86): `theia: 'THEIA',`
  - add the page container next to the OmegaPage one (line ~555), mirroring it exactly:
  ```tsx
            <div data-panel-id="theia" className={dockActive === 'theia' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
              <TheiaPage />
            </div>
  ```

- [ ] **Step 5: Add the (i) info card** — in `client/src/components/layout/panelInfo.tsx`, add a `theia` entry to `PANEL_INFO`:

```tsx
  theia: {
    title: 'THEIA — The All-Seeing Oracle',
    body: `THEIA is Zeus's bird's-eye view. It gathers everything — live and historical — into one place so you can read the whole machine at a glance, without opening ten panels.

At the top is THE VERDICT: a single honest light — green, amber or red — answering "is Zeus fit to run autonomously right now?" with the one reason holding it back (it blends safety circuit, trading halt, data freshness, kill-switch, brain↔server parity, regime stability and testnet P&L trend).

Below it, modules: what happened since you last looked (engine trades, stop moves, P&L); the brain's live pulse (regime, direction, confidence, gates); engine & open positions; safety & feed health; the market lens (regime, movers, funding, open interest); an ML/OMEGA digest; and a memory section with the P&L curve and recent decisions.

THEIA is read-only — it shows and explains, it does not trade. Every number is live from Zeus's real systems; nothing here is mocked. Tap through to the relevant panel when you want to act.`,
  },
```

- [ ] **Step 6: Minimal CSS** — append to `client/src/app.css` (back it up first):

```css
/* [2026-06-19] THEIA oracle panel */
.theia-page { padding: 8px; overflow-y: auto; height: 100%; }
.theia-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.theia-card { background: rgba(10,15,22,0.6); border: 1px solid #1a2530; border-radius: 8px; padding: 10px 12px; min-height: 60px; }
.theia-card h4 { margin: 0 0 6px; font-size: 11px; letter-spacing: .4px; color: #7a9ab8; text-transform: uppercase; }
.theia-hero { grid-column: 1 / -1; }
.theia-empty { grid-column: 1 / -1; color: var(--dim, #5a6a7a); text-align: center; }
@media (max-width: 700px) { .theia-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 7: Build + verify the icon appears**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS|Error" | head
```
Expected: `✓ built in ...`, no error TS.

- [ ] **Step 8: Commit**

```
cd /opt/zeus-terminal && chown -R zeus:zeus public/app && rm -f client/src/app.css.bak*
git add client/src/components/intel/TheiaPage.tsx client/src/components/layout/ZeusDock.tsx client/src/ui/dock.ts client/src/components/layout/PanelShell.tsx client/src/components/layout/panelInfo.tsx client/src/app.css
git commit -m "feat(theia): dock icon + page shell + (i) info (read-only oracle scaffold)"
```

---

## Task 3: VERDICT band + live-store modules (Brain pulse, Engine & positions, Market lens)

These read REAL live Zustand stores directly. **Before writing each card, READ the store file** to use its real selector field names; render `—` for any genuinely-absent field; NEVER fabricate.

**Files:** create `VerdictBand.tsx`, `BrainPulseCard.tsx`, `EnginePositionsCard.tsx`, `MarketLensCard.tsx`; modify `TheiaPage.tsx` to render them.

- [ ] **Step 1: Identify real fields** — read these stores and note the real selectors:
  - `client/src/stores/brainStore.ts` (regime, direction/dir, confidence/score, entryReady, gates, mscan)
  - `client/src/stores/atStore.ts` (killTriggered, trades today, win rate, leverage, exposure)
  - `client/src/stores/aresStore.ts` (engine on/off, owner, lastDecision/state)
  - `client/src/stores/positionsStore.ts` (open positions list/count)
  - `client/src/stores/marketStore.ts` (regime, price, OI, funding, LS, atr/volatility)
  - `client/src/stores/marketRadarStore.ts` (top movers)
  Also read `client/src/utils/guards.ts` for `window.S.dataStalled` access.

- [ ] **Step 2: VerdictBand.tsx** — a hero card that gathers the REAL verdict inputs and renders `computeTheiaVerdict`. Read: `useATStore` (killTriggered), `window.S.dataStalled` (data), and the endpoint values fetched by TheiaPage and passed as props (`circuitOpen`, `halted`, `parityPct`, `testnetPnlTrend`) plus `regimeStable` derived from the brain/market regime. Render the green/amber/red light + `reason` + the `breakdown` chips. Use `theia-card theia-hero`. For inputs not yet wired (endpoint ones arrive in Task 5), pass `null`/safe defaults that `computeTheiaVerdict` already tolerates — but mark them visually as "—/pending", never as a fake healthy value.

- [ ] **Step 3: BrainPulseCard.tsx** — `useBrainStore` selectors (real): regime, direction, confidence, entryReady, gates open/blocked count, MSCAN on/off. Render each; `—` if absent.

- [ ] **Step 4: EnginePositionsCard.tsx** — `useAresStore` (engine on/off + owner) + `usePositionsStore` (open count) + `useATStore` (trades today, win rate, leverage, exposure). Real fields; `—` if absent.

- [ ] **Step 5: MarketLensCard.tsx** — `useMarketStore` (regime, price, OI, funding, LS, volatility) + `useMarketRadarStore` (top N movers). Real fields; `—` if absent.

- [ ] **Step 6: Wire into TheiaPage** — replace the `theia-empty` placeholder with `<VerdictBand .../>` then the three cards in the grid.

- [ ] **Step 7: Build + unit tests (no regression)**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS" | head
sudo -u zeus npx vitest run src/components/intel 2>&1 | tail -5
```
Expected: build clean; tests pass.

- [ ] **Step 8: Commit**

```
cd /opt/zeus-terminal && chown -R zeus:zeus public/app
git add client/src/components/intel
git commit -m "feat(theia): verdict band + live-store modules (brain/engine/market) — real data"
```

---

## Task 4: Endpoint-backed modules (Since you last looked, Safety & health, ML/OMEGA digest) + history

TheiaPage fetches REAL read-only endpoints and passes data down. **Read each route's response shape** (in `server/routes/*.js`) to map real fields; `—` on empty; never fabricate.

**Files:** modify `TheiaPage.tsx` (add fetches); create `SinceCard.tsx`, `SafetyHealthCard.tsx`, `MlDigestCard.tsx`, `MemorySection.tsx`.

- [ ] **Step 1: Add endpoint fetching to TheiaPage** — on mount + every 12s (abortable), fetch the REAL endpoints and hold results in state, passed to modules + VerdictBand:
  - `GET /api/parity/report` → `parityPct` (map the real match-% field)
  - `GET /api/health` and/or the halt route → `circuitOpen`, `halted`
  - `GET /api/binance-telemetry` → rate-limit pressure + feed health
  - `GET /api/brain/dashboard` + `GET /api/brain/recent-blocks` → brain detail / recent gate blocks
  - `GET /api/audit/timeseries` (and/or closed-trade source) → P&L history + `testnetPnlTrend`
  All fetches: `credentials:'same-origin'`, AbortController, try/catch → that module shows `—` on failure (no fake).

- [ ] **Step 2: SinceCard.tsx** — "since you last looked": persist `theia_last_open` timestamp in localStorage; show ARES trades / DSL moves / kill events / realized P&L / restarts since then, from `useAresStore` + `useATStore` (realizedDailyPnL, closedTradesToday) + the audit timeseries. Real values; `—` if none.

- [ ] **Step 3: SafetyHealthCard.tsx** — circuit/halt (from fetched health), rate-limit pressure (telemetry), data freshness (`window.S.dataStalled`), feeds BNB/BYB/OKX (`useMultiExchangeStore` + `window.S.bnbOk`/`bybOk`), kill-switch (`useATStore`). Real; `—` if absent.

- [ ] **Step 4: MlDigestCard.tsx** — reuse the endpoints OmegaPage/DoctorPanel already call (read `client/src/components/omega/omegaApi.ts` / `doctorApi.ts` / `ring5Api.ts` for the real endpoints) to show mood, ring health, calibration drift, DSL bandit (`useDslStore`), learning eligibility. Real; `—` if absent. Do NOT add new ML endpoints — reuse existing reads.

- [ ] **Step 5: MemorySection.tsx** — full-width (`theia-card theia-hero`): a simple P&L sparkline from the audit-timeseries/closed-trade data already fetched, plus recent decisions/verdicts from `useBrainStatsStore` or the Nova/decision source. Real; "no history yet" if empty. (Keep it a lightweight inline SVG sparkline — no new chart lib.)

- [ ] **Step 6: Wire all into TheiaPage grid** in a sensible order (Verdict hero → Since / Brain → Engine / Safety → Market / ML → Memory full-width).

- [ ] **Step 7: Build + tests**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS" | head
sudo -u zeus npx vitest run src/components/intel src/data src/utils 2>&1 | tail -5
```
Expected: clean + all pass.

- [ ] **Step 8: Commit**

```
cd /opt/zeus-terminal && chown -R zeus:zeus public/app
git add client/src/components/intel
git commit -m "feat(theia): endpoint modules (since/safety/ml/memory) — real data, graceful degrade"
```

---

## Task 5: Headless verification (REAL data) + deploy (GO gate)

- [ ] **Step 1: Reload** — `cd /opt/zeus-terminal && sudo -u zeus pm2 reload zeus && sleep 3 && curl -s -o /dev/null -w "health=%{http_code}\n" http://localhost:3000/api/health` (expect 401 = up).

- [ ] **Step 2: Headless verification.** Mint a uid=1 token (as in prior verifications), load `/app/` with `serviceWorkers:'block'`, dismiss the welcome modal, click the THEIA dock icon (`[data-panel-id="theia"]` becomes active; click the dock button whose label/id is theia). Assert:
  - The THEIA panel renders; the Verdict band shows a level ∈ {green,amber,red} with a non-empty reason.
  - Brain/Engine/Market modules show values that MATCH the live stores — prove non-fake by reading e.g. `window.S.symbol`/`useMarketStore` price and confirming the same value appears in the Market module (compare the rendered text to the store value).
  - The `(i)` button opens the THEIA info card.
  - 0 page/console errors (ignore unrelated `/spot/klines` 502 background polls); layout intact; screenshot.

- [ ] **Step 3: Anti-fake review** — grep the THEIA components for suspicious hardcoded numbers/strings that should be dynamic; confirm every displayed metric reads from a store selector or fetched endpoint field. Fix any literal that should be live.

- [ ] **Step 4: Clean up** temp token/script/png.

- [ ] **Step 5: Bump `server/version.js`** (build+version, e.g. b136→b137) with a changelog entry: THEIA all-seeing oracle dock panel — read-only synthesis of brain/engine/market/safety/ML + flip-readiness verdict, all REAL data, graceful degrade, `(i)` info; pure verdict helper unit-tested + headless-verified.

- [ ] **Step 6: Final build + chown + reload + commit + push (GET OPERATOR GO FIRST).**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error" | head
cd /opt/zeus-terminal && chown -R zeus:zeus public/app
sudo -u zeus pm2 reload zeus && sleep 3
curl -s http://localhost:3000/sw.js | grep -o 'zt-v[0-9.]*-b[0-9]*' | head -1
git add server/version.js && git commit -m "release: THEIA all-seeing oracle hub — bXXX"
git push origin main
```

---

## Rollback
Additive, read-only, self-contained under `components/intel/theia` + 4 dock-registration edits. Revert the feature commits; THEIA touches no data/trading logic.

## Self-review
- **Spec coverage:** verdict pure helper (T1) ✓; dock icon + shell + (i) (T2) ✓; verdict band + live modules brain/engine/market (T3) ✓; endpoint modules since/safety/ml + memory history (T4) ✓; headless real-data verify + anti-fake review + deploy gate (T5) ✓. All 8 spec modules covered (Verdict, Since, Brain, Engine, Safety, Market, ML, Memory). REAL-data rule restated per task + verified in T5 ✓. Read-only ✓.
- **Type consistency:** `computeTheiaVerdict(input: TheiaVerdictInput): TheiaVerdict` and `{level, reason, breakdown}` used consistently in T1 + VerdictBand (T3). Dock id `theia` consistent across ZeusDock/ui-dock/PanelShell/panelInfo. Component names match the file list.
- **Placeholder note:** module cards (T3/T4) intentionally instruct "read the real store/route to map exact field names" rather than hardcoding field names I haven't verified — this is the anti-fake mandate (wire real fields), not a placeholder; the structure, sources, and the no-fabrication rule are fully specified, and T5 verifies real data + scans for hardcoded values.
