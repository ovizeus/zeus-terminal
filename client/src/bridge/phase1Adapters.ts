/**
 * Phase 1+2 Adapters — expose ported modules on window.*
 * so old JS consumers work unchanged.
 *
 * Called from legacyLoader.ts installShims() BEFORE any old JS loads.
 *
 * ZT8 resolution (2026-04-17): bridge surface = 22 direct window slots +
 * ~60 side-effect imports for module self-registration (IIFEs that run
 * at module-load time). The side-effect import list is intentional
 * composition, NOT migration debt — each module self-registers on
 * `window` through its own IIFE; those cannot be removed without
 * rewriting every consumer. In ZT2-B the file was reduced from ~200
 * named imports to only those used in the function body. ZT8 removed
 * two verified-dead bindings (`w.procLiq`, `w.showTab`): neither had a
 * reader in TS, React, or legacy HTML onclick.
 *
 * What remains in the function body:
 *   - ZT_safeInterval shim (arianova.ts IIFE looks it up on window)
 *   - 5 config/state refs (MSCAN/DHF/PERF/ARM_ASSIST/_fakeout — circular-
 *     dep escapes; PERF is HYBRID BY DESIGN, same pattern as BM/BRAIN)
 *   - 10 chart-series refs (null/[] init; real values written by
 *     marketDataChart.ts after chart creation — the null init keeps
 *     typeof checks from throwing before initCharts runs)
 *   - 5 onclick="" / cross-call handlers (_showConfirmDialog, calcPosPnL,
 *     getDemoLev, updateDemoLiqPrice, updateDemoBalance)
 *   - 1 legacy HTML onclick (testNotification — bound by
 *     public/legacy/index.html:3123 + AlertsModal.tsx)
 *   - 5 manager force-registration void refs (Intervals, WS, FetchLock,
 *     ingestPrice, Timeouts) — trigger module-body side-effects
 *   - initIndicatorState() — must run before other engines read state
 */

// Early shims — MUST be first import (sets ZT_safeInterval before arianova.ts IIFE runs)
import './earlyShims'

// Phase 7F: marketData modules (side-effect registration)
import '../data/marketDataClose'
import { calcPosPnL } from '../data/marketDataPositions'
import {
  _showConfirmDialog,
  getDemoLev,
  updateDemoLiqPrice,
  updateDemoBalance,
} from '../data/marketDataTrading'
import '../data/marketDataChart'
import { testNotification } from '../data/marketDataWS'
import '../data/marketDataFeeds'
import '../data/marketDataOverlays'
import '../data/marketDataHelpers'

// Phase 7E: foundation
import '../core/state'
import { MSCAN, DHF, PERF, ARM_ASSIST, _fakeout } from '../core/config'

// Utils / constants / services
import '../utils/dom'
import '../utils/format'
import '../utils/math'
import '../constants/icons'
import '../constants/trading'
import '../engine/events'
import '../services/storage'
import '../services/symbols'

// Engine layer (self-registration via IIFEs or named exports on window)
import '../engine/perfStore'
import '../engine/dailyPnl'
import '../engine/signals'
import '../engine/phaseFilter'
import '../engine/forecast'
import '../engine/postMortem'
import '../engine/aresJournal'
import '../engine/ares'
import '../engine/aresExecute'
import '../engine/aresMonitor'
import '../engine/aresUI'

// Phase 7C: teacher (15 files, self-register on window)
import '../teacher/teacherConfig'
import '../teacher/teacherStorage'
import '../teacher/teacherIndicators'
import '../teacher/teacherDataset'
import '../teacher/teacherBrain'
import '../teacher/teacherSimulator'
import '../teacher/teacherStats'
import '../teacher/teacherMemory'
import '../teacher/teacherReason'
import '../teacher/teacherCalibration'
import '../teacher/teacherCurriculum'
import '../teacher/teacherCapability'
import '../teacher/teacherAutopilot'
import '../teacher/teacherEngine'
import '../teacher/teacherPanel'

// Phase 7B: panels + render
import '../ui/panels'
import '../ui/render'

// Phase 7A: patch, hotkeys, pageview, marketCoreReactor, klines
import '../core/patch'
import '../core/hotkeys'
import '../ui/pageview'
import '../ui/marketCoreReactor'
import '../data/klines'

// Phase 6E: UI leaf files
import '../ui/dom2'
import '../ui/modals'
import '../ui/notifications'
import '../ui/timeSales'
import '../ui/modebar'
import '../ui/drawingTools'

// Phase 6D: brain extensions
import '../engine/aub'
import '../engine/arianova'

// Phase 6B: trading files
import '../trading/dsl'
import '../trading/risk'
import '../trading/positions'
import '../trading/orders'
import '../trading/liveApi'

// Phase 6C: autotrade
import '../trading/autotrade'

// Phase 6A: managers, guards, dev, decisionLog
import { Intervals, WS, FetchLock, ingestPrice, Timeouts } from '../core/managers'
import '../utils/guards'
import '../utils/dev'
import '../utils/decisionLog'

// Phase 5B4: brain.js
import '../engine/brain'

// Indicators — initIndicatorState() called in function body
import { initIndicatorState } from '../engine/indicators'

// Phase 7D: orderflow — MUST be after managers (needs w.Intervals) and after guards (needs w._SAFETY)
import '../data/orderflow'

// Phase 8 — Bootstrap chunks — MUST be AFTER managers/guards/orderflow (heartbeat IIFE needs w.ingestPrice)
import '../core/bootstrapStartApp'
import '../core/bootstrapBrainDash'
import '../core/bootstrapPanels'
import '../core/bootstrapError'
import '../core/bootstrapMisc'
import '../core/bootstrapInit'

export function installPhase1Adapters(): void {
  const w = window as unknown as Record<string, unknown>

  // ZT_safeInterval: config.js defined it globally; arianova.ts IIFE reads
  // it from window at import time, so it must exist before any module body
  // runs.
  if (typeof (w as any).ZT_safeInterval !== 'function') {
    (w as any).ZT_safeInterval = function (name: string, fn: any, _ms?: number) {
      try {
        if (!(w as any).__ZT_INT_ERR__) (w as any).__ZT_INT_ERR__ = {}
        const wrap = function () {
          try { fn() }
          catch (e: any) {
            (w as any).__ZT_INT_ERR__[name] = ((w as any).__ZT_INT_ERR__[name] || 0) + 1
            console.warn('[ZT interval error]', name, e?.message || e)
          }
        }
        return wrap
      } catch (_) { return fn }
    }
  }

  // config.ts/state.ts exports read by onclick="" attributes in static HTML
  // or by circular-dep consumers that can't import directly.
  w.MSCAN = MSCAN
  w.DHF = DHF
  w.PERF = PERF
  w.ARM_ASSIST = ARM_ASSIST
  w._fakeout = _fakeout

  // Chart-series refs: marketData.js (bridge-active) reads these as globals.
  // Initialized to null/[] so it doesn't crash before initCharts() runs.
  if (w.cSeries === undefined) w.cSeries = null
  if (w.cvdS === undefined) w.cvdS = null
  if (w.cvdChart === undefined) w.cvdChart = null
  if (w.volS === undefined) w.volS = null
  if (w.ema50S === undefined) w.ema50S = null
  if (w.ema200S === undefined) w.ema200S = null
  if (w.wma20S === undefined) w.wma20S = null
  if (w.wma50S === undefined) w.wma50S = null
  if (w.stS === undefined) w.stS = null
  if (w.srSeries === undefined) w.srSeries = []

  // Circular-dep escape hatches + HTML onclick="" bindings.
  w._showConfirmDialog = _showConfirmDialog
  w.calcPosPnL = calcPosPnL
  w.getDemoLev = getDemoLev
  w.updateDemoLiqPrice = updateDemoLiqPrice
  w.updateDemoBalance = updateDemoBalance
  w.testNotification = testNotification

  // Force managers.ts to run its top-level side-effect registration.
  void Intervals; void WS; void FetchLock; void ingestPrice; void Timeouts

  initIndicatorState()
}
