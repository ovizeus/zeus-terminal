/**
 * Phase 1+2 Adapters — expose ported modules on window.*
 * so old JS consumers work unchanged.
 *
 * Called from legacyLoader.ts installShims() BEFORE any old JS loads.
 * Phase 1: helpers.js, formatters.js, math.js, icons.js
 * Phase 2: constants.js, events.js
 */

// Early shims — MUST be first import (sets ZT_safeInterval before arianova.ts IIFE runs)
import './earlyShims'
// Phase 7F-G: marketData close (chunk G — closeDemoPos)
import { closeDemoPos } from '../data/marketDataClose'
// Phase 7F-F: marketData positions (chunk F — pending orders, SL/TP, render, closeLivePos)
import { cancelPendingOrder, modifyPendingPrice, renderPendingOrders, _stopLivePendingSync, savePosSLTP, renderDemoPositions, calcPosPnL, updateLiveBalance, getSymPrice as _mdGetSymPriceFull } from '../data/marketDataPositions'
// Phase 7F-E: marketData trading (chunk E — mode switch, orders, leverage, liq price)
import { _showConfirmDialog, toggleTradePanel, onDemoOrdTypeChange, getDemoLev, onDemoLevChange, calcLiqPrice, updateDemoLiqPrice, setDemoPct, setLivePct, updateDemoBalance, placeDemoOrder, getSymPrice } from '../data/marketDataTrading'
// Phase 7F-B: marketData chart (chunk B — chart init, fetchKlines, renderChart)
import { getChartH, getChartW, initCharts, fetchKlines, renderChart } from '../data/marketDataChart'
// Phase 7F-D2: marketData WS (chunk D2 — WS connects, liq, symbol, modals, alerts, cloud)
import { connectBNB, connectBYB, procLiq, updLiqStats, updLiqSourceMetrics, updBybHealth, renderOB, renderHotZones, updMarketPressure, setLiqSrcFilter, updLiqFilterBtns, renderFeed, setSymbol as _mdSetSymbol, openM, closeM, _initModalDrag, swtab, updateMainMetrics, showTab, applyChartColors as _mdApplyChartColors, setCandleStyle, setTZ, applyHeatmapSettings, checkLiqAlert, testNotification, cloudClear as _mdCloudClear, injectFakeWhale, setLiqSym, setLiqUsd, setLiqTW, hashEmail, cloudSave as _mdCloudSave, cloudLoad as _mdCloudLoad, initCloudSettings, applySessionSettings, applyZS, renderZS } from '../data/marketDataWS'
// Phase 7F-D1: marketData feeds (chunk D1 — TF, API fetches, metrics, coexist with bridge)
import { setTF, ztfToggle, ztfPick, toggleFS, updatePriceDisplay, calcFrCd, safeFetch, throttledMainMetrics, fetchRSI, fetchAllRSI, fetchFG, fetchATR, fetchOI, fetchLS, fetch24h, setDtTf, updateMetrics, renderRSI } from '../data/marketDataFeeds'
// Phase 7F-C: marketData overlays (chunk C — chart overlays, coexist with bridge marketData.js)
import { clearSR, llvEnsureCanvas, llvResizeCanvas, llvClearCanvas, llvRequestRender, clearLiqLevels, renderLiqLevels, llvSaveSettings, llvLoadSettings, _llvPressStart, _llvPressEnd, calcHeatmapPockets, renderHeatmapOverlay, renderSROverlay } from '../data/marketDataOverlays'
// Phase 7F-A: marketData helpers — DYNAMIC timezone versions + unique functions
// These supersede the static format.ts versions on window.* (S.tz support)
import { fmtTime as _dynFmtTime, fmtTimeSec as _dynFmtTimeSec, fmtDate as _dynFmtDate, fmtFull as _dynFmtFull, fmtNow, toast } from '../data/marketDataHelpers'
// Phase 7E: foundation — state + config. earlyShims already set _ZI on window.
import '../core/state'   // defines w.S, w.TC, w.TP
import '../core/config'  // defines w.BM, w.BRAIN, w.DSL, w.INDICATORS (_ZI now direct import)
// Named imports for config.ts exports that need window.* mapping
import { AUB, AUB_COMPAT, AUB_PERF, AUB_SIM_KEY, ARIA_STATE, NOVA_STATE, _AN_KEY_A, _AN_KEY_N, NOTIFICATION_CENTER, USER_SETTINGS, BT, BT_INDICATORS, MSCAN_SYMS, MSCAN, DHF, PERF, DAILY_STATS, BEXT, SESS_CFG, ARM_ASSIST, _fakeout, _SESS_DEF, _SESS_PRIORITY, _NEURO_SYMS, ZANIM, _srRenderList, _srSave, _srLoad, _srEnsureVisible, srStripUpdateBar, _dslStripOpen, _atStripOpen, _ptStripOpen, _macdChart, _macdInited, _audioCtx, vwapSeries as _cfgVwapSeries, oviSeries as _cfgOviSeries, _neuroLastScan, _execActive } from '../core/config'
import { BlockReason, ZState, mainChart as _stMainChart, bbUpperS, ichimokuSeries, fibSeries, pivotSeries, vpSeries, _rsiChart, _stochChart, _atrChart, _obvChart, _mfiChart, _cciChart, IND_SETTINGS as _stIND_SETTINGS, liqSeries, zsSeries, oiHistory, WL_SYMS, wlPrices, allPrices } from '../core/state'

import { el, safeSetText, safeSetHTML, isValidMarketPrice, safeLastKline } from '../utils/dom'
import { fP, fmtTime, fmtTimeSec, fmtDate, fmtFull, _TZ } from '../utils/format'
import { _clamp, _clampFB01, _clampFB, calcRSIArr } from '../utils/math'
import { _ZI } from '../constants/icons'
import { MACRO_MULT, GATE_DEFS } from '../constants/trading'
import { AT, PREDATOR, computePredatorState, _pendingClose } from '../engine/events'
import { _safeLocalStorageSet, loadJournalFromStorage, startFRCountdown } from '../services/storage'
import { ZStore, connectWatchlist, switchWLSymbol } from '../services/symbols'
import { savePerfToStorage, loadPerfFromStorage, recordIndicatorPnl, calcGlobalExpectancy, calcExpectancyByProfile, resetPerfStore } from '../engine/perfStore'
import { recordDailyClose, rebuildDailyFromJournal, getDailyStats, getMonthlyRollup, saveDailyPnl, loadDailyPnl, resetDailyPnl } from '../engine/dailyPnl'
import { renderSignals } from '../engine/signals'
// calcConfluenceScore — now direct import in consumers
// RegimeEngine — now direct import in consumers
import { PhaseFilter } from '../engine/phaseFilter'
import { resetForecast, computeExitRisk, decideExitAction, applyQuantumExit, computeProbScore, updateScenarioData } from '../engine/forecast'
// Phase 5B: deepdive.js
import { PM, PM_render, initPMPanel, _pmStripUpdateStat, _pmCheckRegimeTransition } from '../engine/postMortem'
import { ARES_JOURNAL } from '../engine/aresJournal'
// ARES_MIND — now direct import in consumers
import { ARES, ARES_openPosition } from '../engine/ares'
// ARES_DECISION — now direct import in consumers
import { ARES_EXECUTE } from '../engine/aresExecute'
import { ARES_MONITOR } from '../engine/aresMonitor'
import { _aresRender, _aresRenderArc, initAriaBrain, initARES } from '../engine/aresUI'
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
import { renderMagnets, updateMagnetBias, jumpToMagnet, runBacktest, renderBacktestResults, calcVWAPBands, oviReadSettings, oviApplySettings, oviCalcATR, oviPivots, oviWeightAt, oviColor, oviCalcPockets, renderOviLiquid, oviRenderScale, clearOviLiquid, toggleOviLiquid, togglePnlLab, renderPnlLab, _pnlLabCard, _pnlLabProfileCard, renderSessionOverlay } from '../ui/panels'
import { recordIndicatorPerformance, recalcPerfWeights, getCurrentADX, getSessionKey, updateSessionBacktest, updateSymPulseRows, updateBrainHeatmap, updateRiskGauges, setRiskGauge, updateDataStream, isCurrentTimeOK, renderDHF } from '../ui/render'
// Phase 7A: patch, hotkeys, pageview, marketCoreReactor, klines
import '../core/patch' // side-effect module
import '../core/hotkeys' // side-effect module
import { initPageView } from '../ui/pageview'
import '../ui/marketCoreReactor' // side-effect, self-registers MarketCoreReactor
import { calcADX, fetchSymbolKlines, runMultiSymbolScan, renderMscanTable, manualEnterFromScan, runMultiSymbolAutoTrade, toggleMultiSymMode, _mscanUpdateLabel, toggleSymPicker, mscanToggleSym, mscanPickAll } from '../data/klines'
// Phase 6E: UI leaf files
import { _updateAudioBadge, _safePlayTone, playAlertSound, playEntrySound, playExitSound, toggleAlerts, initActBar, applyPriceAxisWidth, applyPriceAxisColors } from '../ui/dom2'
import { _showExecOverlay as _showExecOverlayModal, _queueExecOverlay as _queueExecOverlayModal } from '../ui/modals'
import '../ui/notifications' // 6 lines, self-registers
import { toggleTimeSales } from '../ui/timeSales'
import { initModeBar, _modeBarSwitch } from '../ui/modebar'
// initZeusDock, dockClearActive — removed (direct imports)
import '../ui/drawingTools' // self-registers drawing tool functions
// Phase 6D: brain extensions
import { aubToggle, aubToggleSFX, aubCheckCompat, aubBBSnapshot, aubBBExport, aubBBClear, aubCalcMTFStrength, aubCalcCorrelation, aubMacroImport, aubMacroClear, aubMacroFileLoad, aubGetActiveMacroRisk, aubSimRun, aubSimApply, initAUB } from '../engine/aub'
import '../engine/arianova' // self-registers on window via IIFE
// Phase 6B: trading files
import { dslToggleMagnet, _computeDslMagnetSnap, toggleAssistArm, _syncDslAssistUI, initDSLBubbles, _dslSafePrice, _dslSanitizeParams, runDSLBrain, _runClientDSLOnPositions, dslTakeControl, dslReleaseControl, dslManualParam, _dslPushParamsDebounced, _renderDslCard, startDSLIntervals, _dslTrimLogs, _dslTrimAll } from '../trading/dsl'
import { computeMacroCortex, updateMacroUI, estimateRoundTripFees, _adaptSave, _adaptLoad, _adaptClamp, recalcAdaptive, adaptiveStripToggle, initAdaptiveStrip, macroAdjustEntryScore, macroAdjustExitRisk, computePositionSizingMult, perfRecordTrade, _posR as _riskPosR, _macroPhaseFromComposite } from '../trading/risk'
import { onTradeExecuted, onTradeClosed as onTradeClosedPos, triggerExecCinematic } from '../trading/positions'
import { _showExecOverlay, _queueExecOverlay, _dayKeyLocal, _bmResetDailyIfNeeded, _bmPostClose } from '../trading/orders'
import { liveApiSetToken, _liveApiHeaders, _idempotencyKey, _liveApiFetch, _liveApiError, _liveApiParse, liveApiStatus, liveApiGetBalance, liveApiGetPositions, liveApiPlaceOrder, liveApiCancelOrder, liveApiSetLeverage, liveApiClosePosition, aresPlaceOrder, aresSetStopLoss, aresCancelOrder, manualLivePlaceOrder, manualLiveGetOpenOrders, manualLiveCancelOrder, manualLiveModifyLimit, manualLiveSetSL, manualLiveSetTP } from '../trading/liveApi'
// Phase 6C: autotrade.js
import { toggleAutoTrade, _doEnableAT, updateATMode, atLog as atLogFn, renderATLog, updateATStats, checkATConditions, setCondUI, isDataOkForAutoTrade, computeFusionDecision, placeAutoTrade, openAddOn, scheduleAutoClose, resetKillSwitch, renderATPositions, openPartialClose, execPartialClose, closeAutoPos, closeAllDemoPos, closeAllATPos } from '../trading/autotrade'
// Phase 6A: managers.js, guards.js, dev.js, theme.js, decisionLog.js
import { Intervals, WS, FetchLock, ingestPrice, Timeouts } from '../core/managers'
import { _SAFETY, _safe, _safePnl, _isPriceSane, _resetWatchdog, _resetKlineWatchdog, _enterDegradedMode, _exitDegradedMode, _isDegradedOnly, _enterRecoveryMode, _exitRecoveryMode, _isExecAllowed, initSafetyEngine } from '../utils/guards'
import { devLog, ZLOG, safeAsync, devInjectSignal, devInjectLiquidation, devInjectWhale, devFeedDisconnect, devFeedRecover, devTriggerKillSwitch, devResetProtect, devReplayStart, devReplayStop, hubToggleDev, _devEnsureVisible, hubPopulate, hubSaveAll, hubLoadAll, hubTgSave, hubTgTest, hubTgPopulate, hubResetDefaults, hubSetTf, hubSetTZ, hubCloudSave, hubCloudLoad, hubCloudClear } from '../utils/dev'
// ui/theme — zeusApplyTheme, zeusGetTheme removed (direct imports)
import { DLog } from '../utils/decisionLog'
// Phase 5B4: brain.js
import { updateNeurons, getNeuronColor, setNeuron, updateBrainArc, updateBrainState, brainThink, armAssist, disarmAssist, isArmAssistValid, _setRadio, syncDslFromProfile, syncTFProfile, syncBrainFromState, setMode, _applyModeSwitch, confirmBrainModeSwitch, cancelBrainModeSwitch, setBrainMode, setDslMode, calcDslTargetPrice, _calcAtrPct, detectRegimeEnhanced, updateMTFAlignment, detectSweepDisplacement, updateFlowEngine, computeGates, renderGates, computeEntryScore, computeMarketAtmosphere, updateChaosBar, updateNewsShield, checkProtectMode, updateDSLTelemetry, showExecCinematic, getStableRegime, checkAntiFakeout, computeSafetyGates, allSafetyPass, computeContextGates, _getActiveSessions, updateSessionPills, renderSessionBar, initNeuroCoinLEDs, pulseNeuronCoin, onNeuronScanUpdate, initZParticles, zAnimFrame, startZAnim, _brainDirtySet, _brainSafeSet, getBrainViewSnapshot, renderCircuitBrain, runGrandUpdate, detectMarketRegime, updateOrderFlow, adaptAutoTradeParams } from '../engine/brain'
import { connectLiveAPI, placeLiveOrder, connectLiveExchange, loadSavedAPI, installPWA, initIndicatorState, openIndPanel, closeIndPanel, toggleInd, applyIndVisibility, openIndSettings, closeIndSettings, applyIndSettings, initBBSeries, updateBB, initIchimokuSeries, updateIchimoku, updateFib, updatePivot, updateVP, initRSIChart, updateRSI, initStochChart, initATRChart, initOBVChart, initMFIChart, initCCIChart, renderActBar, getIndColor, deactivateInd, toggleActBar, calcMACD, initMACDChart, detectSupertrendFlip, detectRSIDivergence, runSignalScan, generateDeepDive } from '../engine/indicators'

// Phase 7D: orderflow — MUST be after managers (needs w.Intervals) and after guards (needs w._SAFETY)
import '../data/orderflow'

// Phase 8 — Bootstrap chunks — MUST be AFTER managers/guards/orderflow (heartbeat IIFE needs w.ingestPrice)
import { startApp } from '../core/bootstrapStartApp'
import '../core/bootstrapBrainDash'
import { _showPerformance, _showCompare } from '../core/bootstrapPanels'
import { _actfeedToggle } from '../core/bootstrapError'
import { _pinIsSet, pinUnlock, pinActivate, pinRemove, _pinUpdateUI, _showWelcomeModal, registerServiceWorker as _bsRegisterSW, showPWAUpdateBanner, hidePWAUpdateBanner, setPWAVersion, masterReset } from '../core/bootstrapMisc'
import { initZeusGroups, _startExtras, runHealthChecks, _updatePnlLabCondensed } from '../core/bootstrapInit'

/**
 * [R23] Function body is the *true* surface of the bridge after the 7-phase
 * port to TS. Almost everything that used to live here is now a direct
 * import — see the named imports above for the modules whose side-effect
 * registration still needs to happen at bridge-install time.
 *
 * What remains here:
 *   - ZT_safeInterval shim (config.js used to define this globally; some
 *     IIFEs still look it up by name on window)
 *   - A small set of window.* bindings for modules that can't import each
 *     other due to circular deps, or are read by onclick="" attributes in
 *     static HTML (showTab, testNotification)
 *   - Chart-series globals that marketData.js (still bridge-active in a
 *     couple of paths) dereferences
 *   - initIndicatorState() — must run before other engines read state
 */
export function installPhase1Adapters(): void {
  const w = window as Record<string, unknown>

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
  w.procLiq = procLiq
  w.showTab = showTab
  w.testNotification = testNotification

  // Force managers.ts to run its top-level side-effect registration.
  void Intervals; void WS; void FetchLock; void ingestPrice; void Timeouts

  initIndicatorState()
}
