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
import { cancelPendingOrder, modifyPendingPrice, renderPendingOrders, _stopLivePendingSync, savePosSLTP, checkDemoPositionsSLTP, renderDemoPositions, calcPosPnL, updateLiveBalance, renderLivePositions, closeLivePos, getSymPrice as _mdGetSymPriceFull } from '../data/marketDataPositions'
// Phase 7F-E: marketData trading (chunk E — mode switch, orders, leverage, liq price)
import { switchGlobalMode, _applyGlobalModeUI, _showConfirmDialog, promptAddFunds, promptResetDemo, toggleTradePanel, onDemoOrdTypeChange, getDemoLev, getLiveLev, onDemoLevChange, onLiveLevChange, calcLiqPrice, updateDemoLiqPrice, updateLiveLiqPrice, setDemoPct, setLivePct, updateDemoBalance, placeDemoOrder, getSymPrice } from '../data/marketDataTrading'
// Phase 7F-B: marketData chart (chunk B — chart init, fetchKlines, renderChart)
import { getChartH, getChartW, initCharts, fetchKlines, renderChart } from '../data/marketDataChart'
// Phase 7F-D2: marketData WS (chunk D2 — WS connects, liq, symbol, modals, alerts, cloud)
import { connectBNB, connectBYB, updConn as _mdUpdConn, procLiq, updLiqStats, updLiqSourceMetrics, updBybHealth, renderOB, renderHotZones, updMarketPressure, setLiqSrcFilter, updLiqFilterBtns, renderFeed, setSymbol as _mdSetSymbol, toggleSnd, openM, closeM, _initModalDrag, swtab, updateMainMetrics, showTab, applyChartColors as _mdApplyChartColors, setCandleStyle, setTZ, applyHeatmapSettings, sendAlert, registerServiceWorker as _mdRegisterSW, checkLiqAlert, testNotification, saveAlerts, cloudClear as _mdCloudClear, injectFakeWhale, setLiqSym, setLiqUsd, setLiqTW, hashEmail, cloudSave as _mdCloudSave, cloudLoad as _mdCloudLoad, initCloudSettings, applySessionSettings, applyZS, renderZS } from '../data/marketDataWS'
// Phase 7F-D1: marketData feeds (chunk D1 — TF, API fetches, metrics, coexist with bridge)
import { setTF, ztfToggle, ztfPick, toggleFS, updatePriceDisplay, calcFrCd, safeFetch, throttledMainMetrics, fetchRSI, fetchAllRSI, fetchFG, fetchATR, fetchOI, fetchLS, fetch24h, setDtTf, updateMetrics, renderRSI, calcSRTable } from '../data/marketDataFeeds'
// Phase 7F-C: marketData overlays (chunk C — chart overlays, coexist with bridge marketData.js)
import { clearSR, renderTradeMarkers, llvEnsureCanvas, llvResizeCanvas, llvClearCanvas, llvRequestRender, clearLiqLevels, renderLiqLevels, llvSaveSettings, llvLoadSettings, _llvPressStart, _llvPressEnd, calcHeatmapPockets, renderHeatmapOverlay, renderSROverlay } from '../data/marketDataOverlays'
// Phase 7F-A: marketData helpers — DYNAMIC timezone versions + unique functions
// These supersede the static format.ts versions on window.* (S.tz support)
import { fmtTime as _dynFmtTime, fmtTimeSec as _dynFmtTimeSec, fmtDate as _dynFmtDate, fmtFull as _dynFmtFull, fmtNow, toast, _calcATRSeries } from '../data/marketDataHelpers'
// Phase 7E: foundation — state + config. earlyShims already set _ZI on window.
import '../core/state'   // defines w.S, w.TC, w.TP
import '../core/config'  // defines w.BM, w.BRAIN, w.DSL, w.INDICATORS (_ZI now direct import)
// Named imports for config.ts exports that need window.* mapping
import { AUB, AUB_COMPAT, AUB_PERF, AUB_SIM_KEY, ARIA_STATE, NOVA_STATE, _AN_KEY_A, _AN_KEY_N, NOTIFICATION_CENTER, USER_SETTINGS, BT, BT_INDICATORS, MSCAN_SYMS, MSCAN, DHF, PERF, DAILY_STATS, BEXT, SESS_CFG, PROFILE_TF, ARM_ASSIST, NEWS, _regimeHistory, _fakeout, _SESS_DEF, _SESS_PRIORITY, _NEURO_SYMS, ZANIM, _execQueue, _srUpdateStats, _srRenderStats, _srRenderList, _srSave, _srLoad, _srEnsureVisible, srStripUpdateBar, _dslStripOpen, _atStripOpen, _ptStripOpen, _macdChart, _macdInited, _audioCtx, vwapSeries as _cfgVwapSeries, oviSeries as _cfgOviSeries, oviPriceSeries as _cfgOviPriceSeries, _neuroLastScan, _execActive } from '../core/config'
import { BlockReason, ZState, mainChart as _stMainChart, bbUpperS, ichimokuSeries, fibSeries, pivotSeries, vpSeries, _rsiChart, _stochChart, _atrChart, _obvChart, _mfiChart, _cciChart, IND_SETTINGS as _stIND_SETTINGS, liqSeries, zsSeries, oiHistory, WL_SYMS, wlPrices, allPrices } from '../core/state'

import { el, safeSetText, safeSetHTML, isValidMarketPrice, safeLastKline } from '../utils/dom'
import { fP, fmtTime, fmtTimeSec, fmtDate, fmtFull, _TZ } from '../utils/format'
import { _clamp, _clampFB01, _clampFB, calcRSIArr } from '../utils/math'
import { _ZI } from '../constants/icons'
import { MACRO_MULT, GATE_DEFS } from '../constants/trading'
import { AT, PREDATOR, computePredatorState, _pendingClose, attachConfirmClose } from '../engine/events'
import { _safeLocalStorageSet, addTradeToJournal, loadJournalFromStorage, startFRCountdown } from '../services/storage'
import { ZStore, connectWatchlist, switchWLSymbol } from '../services/symbols'
import { savePerfToStorage, loadPerfFromStorage, recordIndicatorPnl, calcGlobalExpectancy, calcExpectancyByProfile, resetPerfStore } from '../engine/perfStore'
import { recordDailyClose, rebuildDailyFromJournal, getDailyStats, getMonthlyRollup, saveDailyPnl, loadDailyPnl, resetDailyPnl } from '../engine/dailyPnl'
import { renderSignals } from '../engine/signals'
import { calcConfluenceScore } from '../engine/confluence'
import { RegimeEngine } from '../engine/regime'
import { PhaseFilter } from '../engine/phaseFilter'
import { resetForecast, computeExitRisk, decideExitAction, applyQuantumExit, computeProbScore, updateScenarioData } from '../engine/forecast'
// Phase 5B: deepdive.js
import { PM, PM_render, initPMPanel, _pmStripUpdateStat, _pmCheckRegimeTransition } from '../engine/postMortem'
import { ARES_JOURNAL } from '../engine/aresJournal'
import { ARES_MIND } from '../engine/aresMind'
import { ARES, ARES_openPosition } from '../engine/ares'
import { ARES_DECISION } from '../engine/aresDecision'
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
import { recordIndicatorPerformance, recalcPerfWeights, renderPerfTracker, getCurrentADX, getSessionKey, updateSessionBacktest, updateSymPulseRows, updateBrainHeatmap, updateRiskGauges, setRiskGauge, updateDataStream, isCurrentTimeOK, renderDHF } from '../ui/render'
// Phase 7A: patch, hotkeys, pageview, marketCoreReactor, klines
import '../core/patch' // side-effect module
import '../core/hotkeys' // side-effect module
import { initPageView, openPageView, closePageView } from '../ui/pageview'
import '../ui/marketCoreReactor' // side-effect, self-registers MarketCoreReactor
import { calcADX, fetchSymbolKlines, _updateWhyBlocked, runMultiSymbolScan, renderMscanTable, manualEnterFromScan, runMultiSymbolAutoTrade, toggleMultiSymMode, _mscanUpdateLabel, toggleSymPicker, mscanToggleSym, mscanPickAll } from '../data/klines'
// Phase 6E: UI leaf files
import { _initAudio, _updateAudioBadge, _safePlayTone, playAlertSound, playEntrySound, playExitSound, toggleAlerts, initActBar, applyPriceAxisWidth, applyPriceAxisColors } from '../ui/dom2'
import { _showExecOverlay as _showExecOverlayModal, _queueExecOverlay as _queueExecOverlayModal } from '../ui/modals'
import '../ui/notifications' // 6 lines, self-registers
import { toggleTimeSales } from '../ui/timeSales'
import { initModeBar, _modeBarSwitch } from '../ui/modebar'
import { initZeusDock, dockClearActive } from '../ui/dock'
import '../ui/drawingTools' // self-registers drawing tool functions
// Phase 6D: brain extensions
import { aubToggle, aubToggleSFX, aubCheckCompat, aubBBSnapshot, aubBBExport, aubBBClear, aubCalcMTFStrength, aubCalcCorrelation, aubMacroImport, aubMacroClear, aubMacroFileLoad, aubGetActiveMacroRisk, aubSimRun, aubSimApply, initAUB } from '../engine/aub'
import '../engine/arianova' // self-registers on window via IIFE
// Phase 6B: trading files
import { dslToggleMagnet, _computeDslMagnetSnap, toggleAssistArm, _syncDslAssistUI, initDSLBubbles, _dslSafePrice, _dslSanitizeParams, runDSLBrain, _runClientDSLOnPositions, dslTakeControl, dslReleaseControl, dslManualParam, _dslPushParamsDebounced, _renderDslCard, startDSLIntervals, _dslTrimLogs, _dslTrimAll } from '../trading/dsl'
import { computeMacroCortex, updateMacroUI, estimateRoundTripFees, _adaptSave, _adaptLoad, _adaptClamp, recalcAdaptive, toggleAdaptive, adaptiveStripToggle, initAdaptiveStrip, macroAdjustEntryScore, macroAdjustExitRisk, computePositionSizingMult, perfRecordTrade, _posR as _riskPosR, _macroPhaseFromComposite } from '../trading/risk'
import { onPositionOpened, onTradeExecuted, onTradeClosed as onTradeClosedPos, triggerExecCinematic } from '../trading/positions'
import { _showExecOverlay, _queueExecOverlay, _dayKeyLocal, _bmResetDailyIfNeeded, _bmPostClose } from '../trading/orders'
import { liveApiSetToken, _liveApiHeaders, _idempotencyKey, _liveApiFetch, _liveApiError, _liveApiParse, liveApiStatus, liveApiGetBalance, liveApiGetPositions, liveApiPlaceOrder, liveApiCancelOrder, liveApiSetLeverage, liveApiClosePosition, liveApiSyncState, aresPlaceOrder, aresSetStopLoss, aresCancelOrder, manualLivePlaceOrder, manualLiveGetOpenOrders, manualLiveCancelOrder, manualLiveModifyLimit, manualLiveSetSL, manualLiveSetTP } from '../trading/liveApi'
// Phase 6C: autotrade.js
import { toggleAutoTrade, _doEnableAT, updateATMode, atLog as atLogFn, renderATLog, updateATStats, checkATConditions, setCondUI, isDataOkForAutoTrade, computeFusionDecision, runAutoTradeCheck, placeAutoTrade, openAddOn, scheduleAutoClose, resetKillSwitch, renderATPositions, openPartialClose, execPartialClose, closeAutoPos, closeAllDemoPos, closeAllATPos } from '../trading/autotrade'
// Phase 6A: managers.js, guards.js, dev.js, theme.js, decisionLog.js
import { Intervals, WS, FetchLock, ingestPrice, Timeouts } from '../core/managers'
import { _SAFETY, _safe, _safePnl, _isPriceSane, _resetWatchdog, _resetKlineWatchdog, _enterDegradedMode, _exitDegradedMode, _isDegradedOnly, _enterRecoveryMode, _exitRecoveryMode, _isExecAllowed, initSafetyEngine } from '../utils/guards'
import { DEV, devLog, devClearLog, devExportLog, ZLOG, safeAsync, devInjectSignal, devInjectLiquidation, devInjectWhale, devFeedDisconnect, devFeedRecover, devTriggerKillSwitch, devResetProtect, devReplayStart, devReplayStop, hubToggleDev, _devEnsureVisible, hubPopulate, hubSaveAll, hubLoadAll, hubTgSave, hubTgTest, hubTgPopulate, hubResetDefaults, hubSetTf, hubSetTZ, hubCloudSave, hubCloudLoad, hubCloudClear } from '../utils/dev'
// ui/theme — zeusApplyTheme, zeusGetTheme removed (direct imports)
import { DLog } from '../utils/decisionLog'
// Phase 5B4: brain.js
import { updateNeurons, getNeuronColor, setNeuron, updateBrainArc, updateBrainState, brainThink, armAssist, disarmAssist, isArmAssistValid, _setRadio, syncDslFromProfile, syncTFProfile, syncBrainFromState, setMode, _applyModeSwitch, confirmBrainModeSwitch, cancelBrainModeSwitch, setBrainMode, setProfile, setDslMode, calcDslTargetPrice, _calcAtrPct, detectRegimeEnhanced, updateMTFAlignment, detectSweepDisplacement, updateFlowEngine, computeGates, renderGates, computeEntryScore, computeMarketAtmosphere, updateChaosBar, updateNewsShield, checkProtectMode, updateDSLTelemetry, showExecCinematic, getStableRegime, checkAntiFakeout, computeSafetyGates, allSafetyPass, computeContextGates, _getActiveSessions, updateSessionPills, renderSessionBar, initNeuroCoinLEDs, pulseNeuronCoin, onNeuronScanUpdate, initZParticles, zAnimFrame, startZAnim, _brainDirtySet, _brainSafeSet, getBrainViewSnapshot, renderCircuitBrain, runGrandUpdate, detectMarketRegime, updateOrderFlow, adaptAutoTradeParams } from '../engine/brain'
import { connectLiveAPI, placeLiveOrder, connectLiveExchange, loadSavedAPI, installPWA, initIndicatorState, openIndPanel, closeIndPanel, toggleInd, applyIndVisibility, openIndSettings, closeIndSettings, applyIndSettings, initBBSeries, updateBB, initIchimokuSeries, updateIchimoku, updateFib, updatePivot, updateVP, initRSIChart, updateRSI, initStochChart, initATRChart, initOBVChart, initMFIChart, initCCIChart, renderActBar, getIndColor, deactivateInd, toggleActBar, calcMACD, initMACDChart, detectSupertrendFlip, detectRSIDivergence, runSignalScan, generateDeepDive, updateDeepDive } from '../engine/indicators'

// Phase 7D: orderflow — MUST be after managers (needs w.Intervals) and after guards (needs w._SAFETY)
import '../data/orderflow'

// Phase 8 — Bootstrap chunks — MUST be AFTER managers/guards/orderflow (heartbeat IIFE needs w.ingestPrice)
import { startApp } from '../core/bootstrapStartApp'
import '../core/bootstrapBrainDash'
import { _toggleExposurePanel, _toggleExpoInline, _toggleCmdPalette, _showMissedTrades, _showSessionReview, _showRegimeHistory, _showPerformance, _showCompare } from '../core/bootstrapPanels'
import { _actfeedToggle } from '../core/bootstrapError'
import { _pinIsSet, _pinCheckLock, pinUnlock, pinActivate, pinRemove, _pinUpdateUI, _showWelcomeModal, registerServiceWorker as _bsRegisterSW, showPWAUpdateBanner, hidePWAUpdateBanner, setPWAVersion, setupPWAReloadBtn, masterReset } from '../core/bootstrapMisc'
import { initZeusGroups, _startExtras, runHealthChecks, _updatePnlLabCondensed } from '../core/bootstrapInit'

export function installPhase1Adapters(): void {
  const w = window as Record<string, unknown>

  // ── Shim: ZT_safeInterval (defined in config.js, needed by arianova.ts at import time) ──
  if (typeof (w as any).ZT_safeInterval !== 'function') {
    (w as any).ZT_safeInterval = function (name: string, fn: any, ms?: number) {
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

  // ── Phase 1: helpers.js ──
  // w.el = el  // REMOVED — consumers now import { el } from utils/dom directly

  // ── Phase 1: formatters.js ──


  // ── Phase 1: icons.js ──  (moved to direct imports — earlyShims handles window init)

  // ── Phase 2: constants.js ──
  w.MACRO_MULT = MACRO_MULT
  w.GATE_DEFS = GATE_DEFS
  // NOTE: _SESS_DEF, _SESS_PRIORITY, _NEURO_SYMS are defined in config.js (still bridge-loaded)
  // constants.js just re-exported them — config.js will set them on window itself

  // ── Phase 2: events.js ──
  w.AT = AT
  w.PREDATOR = PREDATOR
  w.computePredatorState = computePredatorState
  w.attachConfirmClose = attachConfirmClose

  // ── Phase 3: tabLeader.js ──

  // ── Phase 3: storage.js ──
  w.addTradeToJournal = addTradeToJournal
  // renderTradeJournal — removed (direct import)
  w.loadJournalFromStorage = loadJournalFromStorage

  // trackOIDelta — removed (direct import)

  // ── Phase 3: symbols.js ──
  // connectWatchlist — removed (direct import)
  // switchWLSymbol — removed (direct import)

  // ── Phase 4: perfStore.js ──

  // loadPerfFromStorage — removed (direct import)
  // calcGlobalExpectancy — removed (direct import)
  w.calcExpectancyByProfile = calcExpectancyByProfile

  // ── Phase 4: dailyPnl.js ──


  // loadDailyPnl — removed (direct import)

  // ── config.ts exports → window.* ──
  w.AUB = AUB; w.AUB_COMPAT = AUB_COMPAT; w.AUB_PERF = AUB_PERF; w.AUB_SIM_KEY = AUB_SIM_KEY
  w.ARIA_STATE = ARIA_STATE; w.NOVA_STATE = NOVA_STATE
  // _AN_KEY_N — removed (direct import)
  // _AN_KEY_A — removed (direct import)
  w.NOTIFICATION_CENTER = NOTIFICATION_CENTER
  w.USER_SETTINGS = USER_SETTINGS; w.BT = BT; w.BT_INDICATORS = BT_INDICATORS
  w.MSCAN_SYMS = MSCAN_SYMS; w.MSCAN = MSCAN; w.DHF = DHF; w.PERF = PERF
  w.DAILY_STATS = DAILY_STATS; w.BEXT = BEXT
  // SESS_CFG — removed (direct import)
  w.PROFILE_TF = PROFILE_TF; w.ARM_ASSIST = ARM_ASSIST; w.NEWS = NEWS
  w._regimeHistory = _regimeHistory; w._fakeout = _fakeout
  w._SESS_PRIORITY = _SESS_PRIORITY; w._NEURO_SYMS = _NEURO_SYMS
  // _SESS_DEF — removed (direct import)
  w.ZANIM = ZANIM; w._execQueue = _execQueue
  w._srUpdateStats = _srUpdateStats; w._srRenderStats = _srRenderStats
  w._srRenderList = _srRenderList; w._srSave = _srSave; w._srLoad = _srLoad
  w._srEnsureVisible = _srEnsureVisible; w.srStripUpdateBar = srStripUpdateBar
  w._dslStripOpen = _dslStripOpen; w._atStripOpen = _atStripOpen; w._ptStripOpen = _ptStripOpen
  w._macdChart = _macdChart; w._macdInited = _macdInited
  w.vwapSeries = _cfgVwapSeries; w.oviSeries = _cfgOviSeries; w.oviPriceSeries = _cfgOviPriceSeries
  w._execActive = _execActive
  // state.ts exports
  w.BlockReason = BlockReason; w.ZState = ZState
  w.bbUpperS = bbUpperS; w.ichimokuSeries = ichimokuSeries
  w.fibSeries = fibSeries; w.pivotSeries = pivotSeries; w.vpSeries = vpSeries
  w._rsiChart = _rsiChart; w._stochChart = _stochChart; w._atrChart = _atrChart
  w._obvChart = _obvChart; w._mfiChart = _mfiChart; w._cciChart = _cciChart
  w.IND_SETTINGS = _stIND_SETTINGS; w.liqSeries = liqSeries; w.zsSeries = zsSeries
  w.oiHistory = oiHistory; w.WL_SYMS = WL_SYMS; w.wlPrices = wlPrices; w.allPrices = allPrices
  // Chart series refs — start as null/undefined, set by initCharts() in marketDataChart.ts
  // Bridge marketData.js renderChart() references these as globals
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

  // ── Phase 8E: bootstrap panels (coexist) ──
  w._toggleExposurePanel = _toggleExposurePanel; w._toggleExpoInline = _toggleExpoInline
  w._showPerformance = _showPerformance; w._showCompare = _showCompare

  // ── Phase 8D: bootstrap error + dlog + actfeed (coexist) ──

  // ── Phase 8C: bootstrap misc (coexist) ──
  w._pinCheckLock = _pinCheckLock
  w.pinRemove = pinRemove; w._pinUpdateUI = _pinUpdateUI
  // _showWelcomeModal — removed (direct import)
  w.setupPWAReloadBtn = setupPWAReloadBtn

  // ── Phase 8B: startApp (coexist — bootstrap.js still defines startApp for bridge) ──
  w.startApp = startApp

  // ── Phase 8A: bootstrap init (coexist — bootstrap.js still in bridge for startApp) ──
  w.initZeusGroups = initZeusGroups

  // _updatePnlLabCondensed — removed (direct import)

  // ── Phase 7F-G: closeDemoPos (coexist) ──
  w.closeDemoPos = closeDemoPos

  // ── Phase 7F-F: marketData positions (coexist) ──
  w.cancelPendingOrder = cancelPendingOrder
  w.modifyPendingPrice = modifyPendingPrice; w.renderPendingOrders = renderPendingOrders

  w.savePosSLTP = savePosSLTP; w.checkDemoPositionsSLTP = checkDemoPositionsSLTP
  w.renderDemoPositions = renderDemoPositions; w.calcPosPnL = calcPosPnL
  w.renderLivePositions = renderLivePositions
  w.closeLivePos = closeLivePos; w.getSymPrice = _mdGetSymPriceFull

  // ── Phase 7F-E: marketData trading (coexist) ──
  w.switchGlobalMode = switchGlobalMode; w._applyGlobalModeUI = _applyGlobalModeUI
  w.promptAddFunds = promptAddFunds; w.promptResetDemo = promptResetDemo
  // _showConfirmDialog — removed (direct import)
  // setLiveSide — removed (direct import)
  w.onDemoOrdTypeChange = onDemoOrdTypeChange; w.getDemoLev = getDemoLev; w.getLiveLev = getLiveLev
  /* onDemoLevChange — removed (direct import) */ w.onLiveLevChange = onLiveLevChange
  w.calcLiqPrice = calcLiqPrice; w.updateDemoLiqPrice = updateDemoLiqPrice; w.updateLiveLiqPrice = updateLiveLiqPrice
  w.setLivePct = setLivePct; w.updateDemoBalance = updateDemoBalance
  /* placeDemoOrder — removed (direct import) */ w.getSymPrice = getSymPrice

  // ── Phase 7F-B: marketData chart (coexist) ──
  w.getChartW = getChartW
  // getChartH — removed (direct import)
  w.initCharts = initCharts; w.fetchKlines = fetchKlines; w.renderChart = renderChart

  // ── Phase 7F-D2: marketData WS (coexist — old JS re-declares same functions) ──
  w.connectBYB = connectBYB
  // connectBNB — removed (direct import)
  w.updConn = _mdUpdConn; w.procLiq = procLiq
  w.updLiqSourceMetrics = updLiqSourceMetrics
  w.setSymbol = _mdSetSymbol; w.toggleSnd = toggleSnd
  w.openM = openM; w.closeM = closeM; w._initModalDrag = _initModalDrag; w.swtab = swtab
  w.updateMainMetrics = updateMainMetrics; w.showTab = showTab
  w.setCandleStyle = setCandleStyle; w.setTZ = setTZ
  w.sendAlert = sendAlert; w.registerServiceWorker = _mdRegisterSW
  w.checkLiqAlert = checkLiqAlert; w.testNotification = testNotification; w.saveAlerts = saveAlerts
  w.injectFakeWhale = injectFakeWhale
  // cloudClear — removed (direct import)
  // cloudLoad — removed (direct import)
  // cloudSave — removed (direct import)
  w.applySessionSettings = applySessionSettings

  // ── Phase 7F-D1: marketData feeds (coexist — old JS re-declares same functions) ──
  // setTf — removed (direct import)
  w.toggleFS = toggleFS
  w.updatePriceDisplay = updatePriceDisplay
  w.fetchAllRSI = fetchAllRSI; w.fetchFG = fetchFG
  w.fetchATR = fetchATR; w.fetchOI = fetchOI; w.fetchLS = fetchLS; w.fetch24h = fetch24h
  w.updateMetrics = updateMetrics; w.calcSRTable = calcSRTable

  // ── Phase 7F-C: marketData overlays (coexist — old JS re-declares same functions) ──
  // updOvrs — removed (direct import)
  // togOvr — removed (direct import)
  // clearSR — removed (direct import)
  w.renderTradeMarkers = renderTradeMarkers
  // llv*, renderHeatmapOverlay, renderSROverlay — removed (direct imports)

  // ── Phase 7F-A: marketData helpers ──
  // Dynamic timezone versions REPLACE the static ones from format.ts
  // Old JS and ported TS modules consume these via window.*
  w._calcATRSeries = _calcATRSeries
  // _escHtml: NOT set here — escHtml from dom.ts (Phase 1) is already on window

  // ── Phase 7B: panels + render ──
  // scanLiquidityMagnets — removed (direct import)
  w.jumpToMagnet = jumpToMagnet

  // renderVWAP — removed (direct import)
  // toggleVWAP — removed (direct import)
  w.renderOviLiquid = renderOviLiquid

  w.renderPnlLab = renderPnlLab
  // toggleSession — removed (direct import)
  w.renderPerfTracker = renderPerfTracker
  // getCurrentADX — removed (direct import)
  // updateQuantumClock — removed (direct import)
  // updateBrainExtension — removed (direct import)
  // isCurrentTimeOK — removed (direct import)
  // renderDHF — removed (direct import)

  // ── Phase 7A: patch, hotkeys, pageview, marketCoreReactor, klines ──
  // patch.ts, hotkeys.ts, marketCoreReactor.ts — side-effect imports, self-register
  w.initPageView = initPageView
  w.openPageView = openPageView
  w.closePageView = closePageView
  // calcADX — removed (direct import)
  // fetchSymbolKlines — removed (direct import)
  w._updateWhyBlocked = _updateWhyBlocked
  w.runMultiSymbolScan = runMultiSymbolScan

  w.manualEnterFromScan = manualEnterFromScan
  // runMultiSymbolAutoTrade, toggleMultiSymMode — removed (self-ref)
  // _mscanUpdateLabel — removed (direct import)

  w.mscanToggleSym = mscanToggleSym
  // mscanPickAll — removed (self-ref)

  // ── Phase 6E: ui leaf files ──
  w._initAudio = _initAudio
  // playAlertSound, toggleAlerts, initActBar — removed (direct imports)
  // togInd — removed (direct import)
  w.toggleTimeSales = toggleTimeSales

  // updateModeBar — removed (direct import)
  w._modeBarSwitch = _modeBarSwitch
  w.initZeusDock = initZeusDock
  // dockClearActive — removed (direct import)
  // modals.ts — _showExecOverlay already set by orders.ts adapter; modal version as alias
  // notifications.ts — self-registers on import
  // drawingTools.ts — self-registers on import

  // ── Phase 6D: brain/aub.js ──
  w.aubToggle = aubToggle
  w.aubToggleSFX = aubToggleSFX
  w.aubBBSnapshot = aubBBSnapshot
  // initAUB — removed (direct import)
  // arianova.js — self-registers on window via IIFE import above

  // ── Phase 6C: trading/autotrade.js ──
  w.toggleAutoTrade = toggleAutoTrade

  w.atLog = atLogFn

  w.updateATStats = updateATStats
  // computeFusionDecision — removed (direct import)
  w.runAutoTradeCheck = runAutoTradeCheck
  // placeAutoTrade — removed (direct import)
  // openAddOn, scheduleAutoClose — removed (direct imports)
  // triggerKillSwitch — removed (direct import)
  w.resetKillSwitch = resetKillSwitch
  w.renderATPositions = renderATPositions
  w.execPartialClose = execPartialClose
  // closeAllDemoPos — removed (direct import)

  // ── Phase 6B: trading/dsl.js ──
  w.dslToggleMagnet = dslToggleMagnet
  // toggleDSL — removed (direct import)
  w.toggleAssistArm = toggleAssistArm
  w._syncDslAssistUI = _syncDslAssistUI

  w.dslTakeControl = dslTakeControl
  w.dslReleaseControl = dslReleaseControl
  w.dslManualParam = dslManualParam
  // renderDSLWidget — removed (direct import)
  // stopDSLIntervals — removed (direct import)
  w.startDSLIntervals = startDSLIntervals
  // _dslTrimAll — removed (direct import)

  // ── Phase 6B: trading/risk.js ──
  // computeMacroCortex — removed (direct import)
  // estimateRoundTripFees — removed (direct import)
  // _adaptLoad — removed (direct import)
  // recalcAdaptive — removed (direct import)
  w.toggleAdaptive = toggleAdaptive
  // initAdaptiveStrip, macroAdjustEntryScore, macroAdjustExitRisk, perfRecordTrade — removed (direct imports)

  // ── Phase 6B: trading/positions.js ──
  w.onPositionOpened = onPositionOpened
  // onTradeExecuted — removed (direct import)

  // ── Phase 6B: trading/orders.js ──
  // _queueExecOverlay — removed (direct import)
  // _bmResetDailyIfNeeded — removed (direct import)
  // _bmPostClose — removed (direct import)

  // ── Phase 6B: trading/liveApi.js ──
  // liveApiGetPositions — removed (direct import)
  // liveApiPlaceOrder, liveApiSetLeverage — removed (direct imports)
  // liveApiClosePosition — removed (direct import)
  w.liveApiSyncState = liveApiSyncState
  // aresPlaceOrder — removed (direct import)
  // aresSetStopLoss — removed (direct import)
  w.aresCancelOrder = aresCancelOrder
  // manualLivePlaceOrder — removed (direct import)
  // manualLiveGetOpenOrders — removed (direct import)
  w.manualLiveCancelOrder = manualLiveCancelOrder

  w.manualLiveSetSL = manualLiveSetSL
  w.manualLiveSetTP = manualLiveSetTP

  // ── Phase 6A: managers.js (self-installs on window via import) ──
  // Intervals, WS, FetchLock, ingestPrice, Timeouts already on w.* from import
  void Intervals; void WS; void FetchLock; void ingestPrice; void Timeouts

  // ── Phase 6A: guards.js ──
  w._SAFETY = _SAFETY
  w._safe = _safe
  w._safePnl = _safePnl
  w._isPriceSane = _isPriceSane
  // _resetWatchdog — removed (direct import)
  w._resetKlineWatchdog = _resetKlineWatchdog
  w._enterDegradedMode = _enterDegradedMode
  w._exitDegradedMode = _exitDegradedMode
  w._isDegradedOnly = _isDegradedOnly
  w._enterRecoveryMode = _enterRecoveryMode
  w._exitRecoveryMode = _exitRecoveryMode
  // _isExecAllowed — removed (direct import)
  // initSafetyEngine — removed (direct import)

  // ── Phase 6A: dev.js ──
  w.DEV = DEV
  w.devLog = devLog
  w.devClearLog = devClearLog
  w.devExportLog = devExportLog
  w.ZLOG = ZLOG
  w.safeAsync = safeAsync
  w.devInjectSignal = devInjectSignal
  w.devInjectLiquidation = devInjectLiquidation
  w.devInjectWhale = devInjectWhale
  w.devFeedDisconnect = devFeedDisconnect
  w.devFeedRecover = devFeedRecover
  w.devTriggerKillSwitch = devTriggerKillSwitch
  w.devResetProtect = devResetProtect
  w.devReplayStart = devReplayStart
  w.devReplayStop = devReplayStop
  w.hubToggleDev = hubToggleDev
  // _devEnsureVisible — removed (direct import)
  // setUiScale — removed (direct import)
  w.hubPopulate = hubPopulate
  // hubSaveAll — removed (direct import)
  // hubLoadAll — removed (direct import)
  // hubTgSave — removed (direct import)
  // hubTgTest — removed (direct import)
  // hubTgPopulate — removed (direct import)
  // hubResetDefaults — removed (direct import)
  // hubSetTf, hubSetTZ — removed (self-ref)
  // hubCloudSave — removed (direct import)
  // hubCloudLoad — removed (direct import)
  // hubCloudClear — removed (direct import)

  // ── Phase 6A: theme.js (self-applies on import) ──
  // zeusApplyTheme — removed (direct import)
  // zeusGetTheme — removed (direct import)

  // ── Phase 6A: decisionLog.js ──
  w.DLog = DLog

  // ── Phase 5A: signals.js ──
  // renderSignals — removed (direct import)

  // ── Phase 5A: confluence.js ──
  w.calcConfluenceScore = calcConfluenceScore

  // ── Phase 5A: regime.js ──
  w.RegimeEngine = RegimeEngine

  // ── Phase 5A: phaseFilter.js ──
  w.PhaseFilter = PhaseFilter

  // ── Phase 5A: forecast.js ──

  // runQuantumExitUpdate — removed (direct import)
  // computeProbScore — removed (direct import)
  // updateScenarioUI — removed (direct import)

  // ── Phase 5B: deepdive.js — PM ──
  w.PM = PM
  // runPostMortem — removed (direct import)
  w.PM_render = PM_render

  // _pmCheckRegimeTransition — removed (direct import)

  // ── Phase 5B: deepdive.js — ARES core ──
  w.ARES = ARES
  w.ARES_DECISION = ARES_DECISION
  // ARES_EXECUTE — removed (direct import)
  w.ARES_MONITOR = ARES_MONITOR
  // ARES_JOURNAL — removed (direct import)
  w.ARES_MIND = ARES_MIND

  // ── Phase 5B: deepdive.js — ARES UI ──
  w._aresRender = _aresRender
  // initAriaBrain, initARES — removed (direct imports)

  // ── Phase 5B: deepdive.js — Indicators + Scanner + DeepDive ──
  w.connectLiveAPI = connectLiveAPI

  initIndicatorState()
  w.toggleInd = toggleInd
  // applyIndVisibility — removed (direct import)
  w.openIndSettings = openIndSettings
  w.closeIndSettings = closeIndSettings
  w.applyIndSettings = applyIndSettings
  // renderActBar — removed (direct import)
  w.deactivateInd = deactivateInd
  w.runSignalScan = runSignalScan
  w.updateDeepDive = updateDeepDive

  // ── Phase 5B4: brain.js ──
  // updateBrainArc — removed (direct import)
  w.brainThink = brainThink
  // runBrainUpdate — removed (direct import)
  // isArmAssistValid — removed (direct import)
  w.syncBrainFromState = syncBrainFromState
  w.setBrainMode = setBrainMode
  w.setProfile = setProfile
  w.setDslMode = setDslMode
  w.calcDslTargetPrice = calcDslTargetPrice
  w.detectRegimeEnhanced = detectRegimeEnhanced
  // updateMTFAlignment — removed (direct import)
  // detectSweepDisplacement — removed (direct import)
  // computeMarketAtmosphere — removed (direct import)
  // resetProtectMode — removed (direct import)
  // onNeuronScanUpdate — removed (direct import)
  // renderBrainCockpit — removed (direct import)
  // startZAnim — removed (direct import)
}
