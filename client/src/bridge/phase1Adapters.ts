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
  // MACRO_MULT — removed (direct import)
  // GATE_DEFS — removed (direct import)
  // NOTE: _SESS_DEF, _SESS_PRIORITY, _NEURO_SYMS are defined in config.js (still bridge-loaded)
  // constants.js just re-exported them — config.js will set them on window itself

  // ── Phase 2: events.js ──
  w.AT = AT
  // PREDATOR — removed (direct import)
  // computePredatorState — removed (direct import)
  // attachConfirmClose — removed (direct import)

  // ── Phase 3: tabLeader.js ──

  // ── Phase 3: storage.js ──
  // addTradeToJournal — removed (direct import)
  // renderTradeJournal — removed (direct import)
  // loadJournalFromStorage — removed (direct import)

  // trackOIDelta — removed (direct import)

  // ── Phase 3: symbols.js ──
  // connectWatchlist — removed (direct import)
  // switchWLSymbol — removed (direct import)

  // ── Phase 4: perfStore.js ──

  // loadPerfFromStorage — removed (direct import)
  // calcGlobalExpectancy — removed (direct import)
  // calcExpectancyByProfile — removed (direct import)

  // ── Phase 4: dailyPnl.js ──


  // loadDailyPnl — removed (direct import)

  // ── config.ts exports → window.* ──
  w.ARIA_STATE = ARIA_STATE; w.NOVA_STATE = NOVA_STATE
  // _AN_KEY_N — removed (direct import)
  // _AN_KEY_A — removed (direct import)
  // NOTIFICATION_CENTER — removed (direct import)
  w.USER_SETTINGS = USER_SETTINGS; w.BT = BT; w.BT_INDICATORS = BT_INDICATORS
  /* MSCAN_SYMS — removed (direct import) */ w.MSCAN = MSCAN; w.DHF = DHF; w.PERF = PERF
  w.DAILY_STATS = DAILY_STATS; w.BEXT = BEXT
  // SESS_CFG — removed (direct import)
  /* PROFILE_TF — removed (direct import) */ w.ARM_ASSIST = ARM_ASSIST; /* NEWS — removed (self-ref in config.ts) */
  /* _regimeHistory — removed (direct import) */ w._fakeout = _fakeout
  // _NEURO_SYMS — removed (direct import)
  // _SESS_DEF — removed (direct import)
  w.ZANIM = ZANIM; /* _execQueue — removed (0 refs) */
  /* _srUpdateStats — removed (direct import) */ /* _srRenderStats — removed (direct import) */
  w._srRenderList = _srRenderList; w._srSave = _srSave; w._srLoad = _srLoad
  w._srEnsureVisible = _srEnsureVisible; w.srStripUpdateBar = srStripUpdateBar
  w._dslStripOpen = _dslStripOpen; w._atStripOpen = _atStripOpen; w._ptStripOpen = _ptStripOpen
  w._macdChart = _macdChart; w._macdInited = _macdInited
  w.vwapSeries = _cfgVwapSeries; w.oviSeries = _cfgOviSeries; /* oviPriceSeries — removed (0 refs) */
  // state.ts exports
  w.BlockReason = BlockReason; w.ZState = ZState
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

  // ── Phase 8D: bootstrap error + dlog + actfeed (coexist) ──

  // ── Phase 8C: bootstrap misc (coexist) ──
  /* _pinCheckLock — removed (direct import) */
  // _pinUpdateUI — removed (direct import)
  // _showWelcomeModal — removed (direct import)
  /* setupPWAReloadBtn — removed (direct import) */

  // ── Phase 8B: startApp (coexist — bootstrap.js still defines startApp for bridge) ──

  // ── Phase 8A: bootstrap init (coexist — bootstrap.js still in bridge for startApp) ──

  // _updatePnlLabCondensed — removed (direct import)

  // ── Phase 7F-G: closeDemoPos (coexist) ──
  // closeDemoPos — removed (direct import)

  // ── Phase 7F-F: marketData positions (coexist) ──

  /* renderDemoPositions — removed (direct import) */ w.calcPosPnL = calcPosPnL
  // renderLivePositions — removed (direct import)
  // closeLivePos — removed (direct import)
  // getSymPrice (from positions) — removed (direct import)

  // ── Phase 7F-E: marketData trading (coexist) ──
  // switchGlobalMode — removed (direct import) /* _applyGlobalModeUI — removed (direct import) */
  // promptAddFunds — removed (direct import) /* promptResetDemo — removed (direct import) */
  // _showConfirmDialog — removed (direct import)
  // setLiveSide — removed (direct import)
  /* onDemoOrdTypeChange — removed (direct import) */ w.getDemoLev = getDemoLev; /* getLiveLev — removed (direct import) */
  /* onDemoLevChange — removed (direct import) */ /* onLiveLevChange — removed (direct import) */
  /* calcLiqPrice — removed (direct import) */ w.updateDemoLiqPrice = updateDemoLiqPrice; /* updateLiveLiqPrice — removed (direct import) */
  /* setLivePct — removed (direct import) */ w.updateDemoBalance = updateDemoBalance
  /* placeDemoOrder — removed (direct import) */ /* getSymPrice (from trading) — removed (direct import) */

  // ── Phase 7F-B: marketData chart (coexist) ──
  // getChartW — removed (direct import)
  // getChartH — removed (direct import)

  // ── Phase 7F-D2: marketData WS (coexist — old JS re-declares same functions) ──
  // connectBNB — removed (direct import)
  /* updConn — removed (direct import) */ w.procLiq = procLiq
  /* setSymbol — removed (direct import) */ /* toggleSnd — removed (direct import) */
  w.openM = openM; w.closeM = closeM; w._initModalDrag = _initModalDrag; w.swtab = swtab
  /* updateMainMetrics — removed (direct import) */ w.showTab = showTab
  // setTZ — removed (direct import)
  /* sendAlert — removed (direct import) */ /* registerServiceWorker — removed (direct import) */
  /* checkLiqAlert — removed (direct import) */ w.testNotification = testNotification; /* saveAlerts — removed (direct import) */
  // injectFakeWhale — removed (direct import)
  // cloudClear — removed (direct import)
  // cloudLoad — removed (direct import)
  // cloudSave — removed (direct import)

  // ── Phase 7F-D1: marketData feeds (coexist — old JS re-declares same functions) ──
  // setTf — removed (direct import)
  // toggleFS — removed (direct import)
  w.fetchAllRSI = fetchAllRSI; w.fetchFG = fetchFG
  w.fetchATR = fetchATR; w.fetchOI = fetchOI; w.fetchLS = fetchLS; w.fetch24h = fetch24h
  /* updateMetrics — removed (direct import) */ /* calcSRTable — removed (self-ref in marketDataFeeds) */

  // ── Phase 7F-C: marketData overlays (coexist — old JS re-declares same functions) ──
  // updOvrs — removed (direct import)
  // togOvr — removed (direct import)
  // clearSR — removed (direct import)
  // renderTradeMarkers — removed (direct import)
  // llv*, renderHeatmapOverlay, renderSROverlay — removed (direct imports)

  // ── Phase 7F-A: marketData helpers ──
  // Dynamic timezone versions REPLACE the static ones from format.ts
  // Old JS and ported TS modules consume these via window.*
  // _calcATRSeries — removed (direct import)
  // _escHtml: NOT set here — escHtml from dom.ts (Phase 1) is already on window

  // ── Phase 7B: panels + render ──
  // scanLiquidityMagnets — removed (direct import)

  // renderVWAP — removed (direct import)
  // toggleVWAP — removed (direct import)
  // renderOviLiquid — removed (direct import)

  // toggleSession — removed (direct import)
  // renderPerfTracker — removed (direct import)
  // getCurrentADX — removed (direct import)
  // updateQuantumClock — removed (direct import)
  // updateBrainExtension — removed (direct import)
  // isCurrentTimeOK — removed (direct import)
  // renderDHF — removed (direct import)

  // ── Phase 7A: patch, hotkeys, pageview, marketCoreReactor, klines ──
  // patch.ts, hotkeys.ts, marketCoreReactor.ts — side-effect imports, self-register
  w.initPageView = initPageView
  // openPageView — removed (direct import)
  /* closePageView — removed (self-ref in pageview.ts) */
  // calcADX — removed (direct import)
  // fetchSymbolKlines — removed (direct import)
  // _updateWhyBlocked — removed (direct import)
  w.runMultiSymbolScan = runMultiSymbolScan

  // runMultiSymbolAutoTrade, toggleMultiSymMode — removed (self-ref)
  // _mscanUpdateLabel — removed (direct import)

  // mscanPickAll — removed (self-ref)

  // ── Phase 6E: ui leaf files ──
  /* _initAudio — removed (direct import) */
  // playAlertSound, toggleAlerts, initActBar — removed (direct imports)
  // togInd — removed (direct import)
  w.toggleTimeSales = toggleTimeSales

  // updateModeBar — removed (direct import)
  // initZeusDock — removed (direct import)
  // dockClearActive — removed (direct import)
  // modals.ts — _showExecOverlay already set by orders.ts adapter; modal version as alias
  // notifications.ts — self-registers on import
  // drawingTools.ts — self-registers on import

  // ── Phase 6D: brain/aub.js ──
  // aubBBSnapshot — removed (direct import)
  // initAUB — removed (direct import)
  // arianova.js — self-registers on window via IIFE import above

  // ── Phase 6C: trading/autotrade.js ──
  w.toggleAutoTrade = toggleAutoTrade

  // atLog — removed (direct import)

  // updateATStats — removed (direct import)
  // computeFusionDecision — removed (direct import)
  // runAutoTradeCheck — removed (direct import)
  // placeAutoTrade — removed (direct import)
  // openAddOn, scheduleAutoClose — removed (direct imports)
  // triggerKillSwitch — removed (direct import)
  // renderATPositions — removed (direct import)
  // closeAllDemoPos — removed (direct import)

  // ── Phase 6B: trading/dsl.js ──
  // toggleDSL — removed (direct import)
  // _syncDslAssistUI — removed (direct import)

  // renderDSLWidget — removed (direct import)
  // stopDSLIntervals — removed (direct import)
  // _dslTrimAll — removed (direct import)

  // ── Phase 6B: trading/risk.js ──
  // computeMacroCortex — removed (direct import)
  // estimateRoundTripFees — removed (direct import)
  // _adaptLoad — removed (direct import)
  // recalcAdaptive — removed (direct import)
  // toggleAdaptive — removed (direct import)
  // initAdaptiveStrip, macroAdjustEntryScore, macroAdjustExitRisk, perfRecordTrade — removed (direct imports)

  // ── Phase 6B: trading/positions.js ──
  // onPositionOpened — removed (direct import)
  // onTradeExecuted — removed (direct import)

  // ── Phase 6B: trading/orders.js ──
  // _queueExecOverlay — removed (direct import)
  // _bmResetDailyIfNeeded — removed (direct import)
  // _bmPostClose — removed (direct import)

  // ── Phase 6B: trading/liveApi.js ──
  // liveApiGetPositions — removed (direct import)
  // liveApiPlaceOrder, liveApiSetLeverage — removed (direct imports)
  // liveApiClosePosition — removed (direct import)
  // liveApiSyncState — removed (direct import)
  // aresPlaceOrder — removed (direct import)
  // aresSetStopLoss — removed (direct import)
  // aresCancelOrder — removed (direct import)
  // manualLivePlaceOrder — removed (direct import)
  // manualLiveGetOpenOrders — removed (direct import)
  // manualLiveCancelOrder — removed (direct import)

  // manualLiveSetSL — removed (direct import)
  // manualLiveSetTP — removed (direct import)

  // ── Phase 6A: managers.js (self-installs on window via import) ──
  // Intervals, WS, FetchLock, ingestPrice, Timeouts already on w.* from import
  void Intervals; void WS; void FetchLock; void ingestPrice; void Timeouts

  // ── Phase 6A: guards.js ──
  w._SAFETY = _SAFETY
  w._safe = _safe
  // _safePnl — removed (direct import)
  // _isPriceSane — removed (direct import)
  // _resetWatchdog — removed (direct import)
  // _resetKlineWatchdog — removed (direct import)
  // _enterDegradedMode — removed (direct import)
  // _exitDegradedMode — removed (direct import)
  // _isDegradedOnly — removed (direct import)
  // _enterRecoveryMode — removed (direct import)
  // _exitRecoveryMode — removed (direct import)
  // _isExecAllowed — removed (direct import)
  // initSafetyEngine — removed (direct import)

  // ── Phase 6A: dev.js ──
  // DEV — removed (direct import)
  // devLog — removed (direct import)
  /* devClearLog — removed (direct import) */
  /* devExportLog — removed (direct import) */
  w.ZLOG = ZLOG
  // safeAsync — removed (direct import)
  // hubToggleDev — removed (direct import)
  // _devEnsureVisible — removed (direct import)
  // setUiScale — removed (direct import)
  // hubPopulate — removed (direct import)
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
  // calcConfluenceScore — removed (direct import)

  // ── Phase 5A: regime.js ──
  // RegimeEngine — removed (direct import, no w.* refs remain)

  // ── Phase 5A: phaseFilter.js ──
  // PhaseFilter — removed (direct import)

  // ── Phase 5A: forecast.js ──

  // runQuantumExitUpdate — removed (direct import)
  // computeProbScore — removed (direct import)
  // updateScenarioUI — removed (direct import)

  // ── Phase 5B: deepdive.js — PM ──
  // PM — removed (direct import)
  // runPostMortem — removed (direct import)
  w.PM_render = PM_render

  // _pmCheckRegimeTransition — removed (direct import)

  // ── Phase 5B: deepdive.js — ARES core ──
  w.ARES = ARES
  // ARES_DECISION — removed (direct import)
  // ARES_EXECUTE — removed (direct import)
  // ARES_MONITOR — removed (direct import)
  // ARES_JOURNAL — removed (direct import)
  // ARES_MIND — removed (direct import)

  // ── Phase 5B: deepdive.js — ARES UI ──
  w._aresRender = _aresRender
  // initAriaBrain, initARES — removed (direct imports)

  // ── Phase 5B: deepdive.js — Indicators + Scanner + DeepDive ──

  initIndicatorState()
  // applyIndVisibility — removed (direct import)
  // renderActBar — removed (direct import)
  // runSignalScan — removed (direct import)
  // updateDeepDive — removed (direct import)

  // ── Phase 5B4: brain.js ──
  // updateBrainArc — removed (direct import)
  // brainThink — removed (direct import)
  // runBrainUpdate — removed (direct import)
  // isArmAssistValid — removed (direct import)
  // syncBrainFromState — removed (direct import)
  /* setProfile — removed (direct import) */
  // calcDslTargetPrice — removed (direct import)
  w.detectRegimeEnhanced = detectRegimeEnhanced  // KEPT: circular dep regime↔brain
  // updateMTFAlignment — removed (direct import)
  // detectSweepDisplacement — removed (direct import)
  // computeMarketAtmosphere — removed (direct import)
  // resetProtectMode — removed (direct import)
  // onNeuronScanUpdate — removed (direct import)
  // renderBrainCockpit — removed (direct import)
  // startZAnim — removed (direct import)
}
