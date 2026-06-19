# THEIA — The All-Seeing Oracle (Zeus overview hub) — Design

**Date:** 2026-06-19
**Status:** Approved (operator gave full design freedom) → plan → implement
**Type:** New client dock panel — read-only synthesis hub. NOT money-path.
**Author's note:** Named THEIA (Titaness of sight & heavenly light — "she who sees all"). Operator-gifted as the assistant's dedicated place in Zeus.

## Goal

A new dock icon (group `intel`) with an `(i)` info card that opens THEIA — a read-only,
bird's-eye "oracle" that synthesizes ALL of Zeus into thoughtfully-organized modules
(live now + historical context), so the operator sees the whole machine at a glance.
The crown module is an honest **Verdict** ("fit to run autonomous now / flip-readiness").

## THE GOLDEN RULE — REAL data only, never fake

Every number/state in every module MUST be wired to a REAL source (a live Zustand store
or a real `/api` endpoint listed per-module below). **No hardcoded sample values, no mock
data, no fabricated numbers — ever.** If a source is genuinely unavailable at render time,
the module shows `—` (em-dash) or a clear "no data" state — it must NEVER invent a value
and NEVER crash (graceful per-module degradation; the 2026-06-19 chart-blank lesson). This
rule is verified at implementation time (headless asserts values track the live stores;
code review scans for hardcoded sample data).

## Scope & safety

- **Read-only.** THEIA shows + synthesizes; it does NOT place trades or change settings.
  Each module may deep-link to the real panel (open the relevant dock page) for actions.
- Distinct from existing intel panels: ARIA (pattern alerts), Nova (verdict log), Adaptive
  (self-tuning), OMEGA (ML cockpit). THEIA is the cross-subsystem bird's-eye synthesis.
- Not money-path: pure aggregation of existing read endpoints + stores. No new trading code.

## Modules (each lists its REAL source)

1. **🔮 VERDICT (hero band)** — single GREEN/AMBER/RED "fit to run autonomous now?" + the one
   limiting reason + a small per-input breakdown. Computed client-side by a PURE
   `computeTheiaVerdict(inputs)` helper (TDD) from REAL inputs:
   - parity health → `GET /api/parity/report` (+ `/api/parity/dsl/report`)
   - halt / circuit → `GET /api/.../halt` + `GET /api/health`
   - data freshness → client `window.S.dataStalled` / `_SAFETY` (guards.ts)
   - kill-switch → `useATStore` (killTriggered)
   - regime stability → `useBrainStore`/`useMarketStore` regime + recent regime changes
   - testnet P&L trend → real closed trades (`at_closed` via an existing endpoint such as
     `/api/risk/pnl` or `/api/audit/timeseries`; if none fits, a thin READ-ONLY endpoint may
     be added that aggregates closed-trade PnL — read-only, no money-path).
2. **🌅 Since you last looked** — ARES trades, DSL moves, kill events, realized P&L, restarts
   since the last THEIA open (timestamp persisted in localStorage) or session start.
   Sources: `useAresStore`, `useATStore` (closedTradesToday, realizedDailyPnL), `/api/audit/timeseries`.
3. **🧠 Brain pulse (live)** — regime, direction, confidence, entry-ready, gates open/blocked,
   MSCAN. Sources: `useBrainStore` + `GET /api/brain/dashboard` + `GET /api/brain/recent-blocks`.
4. **⚔️ Engine & positions** — ARES on/off + owner, open positions, exposure, leverage, trades
   today, win rate. Sources: `useAresStore`, `usePositionsStore`, `useATStore`.
5. **🛡️ Safety & health** — circuit state, rate-limit pressure, data freshness, feed states
   (BNB/BYB/OKX), kill-switch, halt. Sources: client `_SAFETY`, `GET /api/binance-telemetry`,
   `useMultiExchangeStore`, `useATStore`, `GET /api/.../halt`.
6. **📡 Market lens** — regime now, radar top movers, LS/sentiment, OI, funding, volatility.
   Sources: `useMarketStore`, `useMarketRadarStore`.
7. **🤖 ML / OMEGA digest** — mood, ring health, calibration drift, DSL bandit state, learning
   eligibility. Sources: existing OMEGA/doctor endpoints (`/api/.../modules`, doctor/ring5 APIs),
   `useDslStore`, ml endpoints already consumed by OmegaPage/DoctorPanel.
8. **📜 Memory (history)** — testnet P&L curve, regime ribbon over time, recent verdicts (Nova),
   recent decisions. Sources: `/api/audit/timeseries` (+ closed trades), regime history source
   (reuse RegimeHistoryPanel's source), `useBrainStatsStore`/Nova log.

Layout: a hero Verdict band on top, then a responsive grid of module cards below; a
`📜 Memory` section at the bottom for history. Each card is a small focused component.

## Architecture (isolation)

- `client/src/components/intel/TheiaPage.tsx` — the panel shell: lays out the hero + module grid,
  owns the data-fetch/refresh lifecycle (subscribe to stores for live; poll the read endpoints
  on open + on an interval; clean up on unmount).
- `client/src/components/intel/theia/` — one small component per module
  (`VerdictBand.tsx`, `SinceCard.tsx`, `BrainPulseCard.tsx`, `EnginePositionsCard.tsx`,
  `SafetyHealthCard.tsx`, `MarketLensCard.tsx`, `MlDigestCard.tsx`, `MemorySection.tsx`).
- `client/src/components/intel/theia/theiaVerdict.ts` — PURE `computeTheiaVerdict(inputs)` +
  types; unit-tested. Maps real inputs → {level: 'green'|'amber'|'red', reason, breakdown[]}.
- Dock registration (FOUR places, per the existing pattern):
  - `client/src/components/layout/ZeusDock.tsx` — new DOCK entry `{ id: 'theia', label: 'THEIA', group: 'intel', icon }`.
  - `client/src/ui/dock.ts` — mirror entry (legacy initZeusDock path).
  - `client/src/components/layout/PanelShell.tsx` — DOCK_TITLES + render `TheiaPage` for id `theia`.
  - `client/src/components/layout/panelInfo.tsx` — `PANEL_INFO.theia` `(i)` card copy.
- CSS in `client/src/app.css` (or a scoped block) following existing panel styling.

## Data flow

```
open THEIA dock icon → TheiaPage mounts
  → subscribes to live stores (brain/at/ares/market/radar/positions/dsl/multiExchange)
  → fetches read endpoints (parity/report, brain/dashboard, audit/timeseries, halt, telemetry…)
    on mount + every N seconds (e.g. 10–15s), aborted on unmount
  → each module renders REAL values (or "—" if a source is genuinely empty)
  → VerdictBand computes computeTheiaVerdict(realInputs) → GREEN/AMBER/RED + reason
unmount → clear interval + abort in-flight fetches
```

## Error handling

- Per-module try/guard: a failing source renders `—` / "no data", never crashes the panel
  and never blanks siblings (chart-blank lesson). No fabricated fallback values.
- All fetches: AbortController + timeout; failures degrade that module only.
- THEIA is read-only → no money-path failure modes.

## Testing

- Unit (vitest): `computeTheiaVerdict` — green when all inputs healthy; red when a hard input
  fails (e.g. circuit open / data stalled / parity below floor); amber on soft concerns; the
  `reason` names the single worst input; null/missing inputs handled (no throw).
- Headless integration: open the THEIA dock icon authenticated → panel renders, every module
  shows REAL values that match the live stores/endpoints (assert a couple of values equal what
  the store/endpoint returns, proving non-fake), the `(i)` button opens its card, 0 errors,
  layout intact.
- Review gate: a code-review pass explicitly checks there is NO hardcoded sample/mock data in
  any module — every value traces to a store selector or endpoint field.

## Files

- Create: `client/src/components/intel/TheiaPage.tsx`, `client/src/components/intel/theia/*` (module
  components + `theiaVerdict.ts`), `client/src/components/intel/theia/__tests__/theiaVerdict.test.ts`.
- Modify: `ZeusDock.tsx`, `ui/dock.ts`, `PanelShell.tsx`, `panelInfo.tsx`, `app.css`, `server/version.js`.
- Optional (only if no existing endpoint fits a history module): one thin READ-ONLY `/api/theia/*`
  aggregation endpoint over existing tables (e.g. closed-trade PnL trend). No writes, no money-path.

## Out of scope (YAGNI)

- Any action/trade/settings mutation from THEIA (read-only; deep-link to act elsewhere).
- A new persistent DB table (reads existing tables/stores only).
- Voice/auto-popup (deliberately a click-to-open panel, not an intrusive message).
- Configurable module layout (fixed, well-chosen set; can iterate later).

## Decisions (operator)

Full design freedom granted. Name THEIA. Read-only. The ONE hard constraint: **every module
wired to REAL data, nothing fake.**
