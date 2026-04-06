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
// Phase 8F: bootstrap brain dashboard (chunk F — brain vision + reflection engine IIFEs)
import '../core/bootstrapBrainDash'
// Phase 8E: bootstrap panels (chunk E — exposure, cmd palette, missed, session, regime, perf, compare)
import { _toggleExposurePanel, _toggleExpoInline, _toggleCmdPalette, _showMissedTrades, _showSessionReview, _showRegimeHistory, _showPerformance, _showCompare } from '../core/bootstrapPanels'
// Phase 8D: bootstrap error + dlog + actfeed (chunk D)
import { _checkAppUpdate, _toggleDecisionPanel, _actfeedToggle } from '../core/bootstrapError'
// Phase 8C: bootstrap misc (chunk C — PIN, build info, welcome, PWA, masterReset, heartbeat, resize)
import { _pinIsSet, _pinCheckLock, pinUnlock, pinActivate, pinRemove, _pinUpdateUI, _renderBuildInfo, _showWelcomeModal, registerServiceWorker as _bsRegisterSW, showPWAUpdateBanner, hidePWAUpdateBanner, setPWAVersion, setupPWAReloadBtn, masterReset } from '../core/bootstrapMisc'
// Phase 8A: bootstrap init (chunk A — initZeusGroups, extras, health)
import { initZeusGroups, _waitForFeedThenStartExtras, _startExtras, runHealthChecks, _updatePnlLabCondensed } from '../core/bootstrapInit'
// Phase 7F-G: marketData close (chunk G — closeDemoPos)
import { closeDemoPos } from '../data/marketDataClose'
// Phase 7F-F: marketData positions (chunk F — pending orders, SL/TP, render, closeLivePos)
import { checkPendingOrders, cancelPendingOrder, modifyPendingPrice, renderPendingOrders, _startLivePendingSync, _stopLivePendingSync, _resumeLivePendingSyncIfNeeded, savePosSLTP, checkDemoPositionsSLTP, renderDemoPositions, calcPosPnL, updateLiveBalance, renderLivePositions, closeLivePos, getSymPrice as _mdGetSymPriceFull } from '../data/marketDataPositions'
// Phase 7F-E: marketData trading (chunk E — mode switch, orders, leverage, liq price)
import { switchGlobalMode, _applyGlobalModeUI, _showConfirmDialog, promptAddFunds, promptResetDemo, toggleTradePanel, setDemoSide, setLiveSide, onDemoOrdTypeChange, getDemoLev, getLiveLev, onDemoLevChange, onLiveLevChange, calcLiqPrice, updateDemoLiqPrice, updateLiveLiqPrice, setDemoPct, setLivePct, updateDemoBalance, placeDemoOrder, getSymPrice } from '../data/marketDataTrading'
// Phase 7F-B: marketData chart (chunk B — chart init, fetchKlines, renderChart)
import { getChartH, getChartW, initCharts, fetchKlines, renderChart } from '../data/marketDataChart'
// Phase 7F-D2: marketData WS (chunk D2 — WS connects, liq, symbol, modals, alerts, cloud)
import { connectBNB, connectBYB, updConn as _mdUpdConn, procLiq, updLiqStats, updLiqSourceMetrics, updBybHealth, renderOB, renderHotZones, updMarketPressure, setLiqSrcFilter, updLiqFilterBtns, renderFeed, setSymbol as _mdSetSymbol, toggleSnd, openM, closeM, _initModalDrag, swtab, updateMainMetrics, showTab, applyChartColors as _mdApplyChartColors, setCandleStyle, setTZ, applyHeatmapSettings, sendAlert, registerServiceWorker as _mdRegisterSW, checkLiqAlert, testNotification, saveAlerts, applySR, cloudClear as _mdCloudClear, injectFakeWhale, setLiqSym, setLiqUsd, setLiqTW, hashEmail, cloudSave as _mdCloudSave, cloudLoad as _mdCloudLoad, initCloudSettings, applySessionSettings, applyZS, clearZS, renderZS } from '../data/marketDataWS'
// Phase 7F-D1: marketData feeds (chunk D1 — TF, API fetches, metrics, coexist with bridge)
import { setTF, setTf, ztfToggle, ztfPick, toggleFS, updatePriceDisplay, calcFrCd, safeFetch, throttledMainMetrics, fetchRSI, fetchAllRSI, fetchFG, fetchATR, fetchOI, fetchLS, fetch24h, setDtTf, updateMetrics, renderRSI, calcSRTable } from '../data/marketDataFeeds'
// Phase 7F-C: marketData overlays (chunk C — chart overlays, coexist with bridge marketData.js)
import { updOvrs, togOvr, clearHeatmap, clearSR, renderTradeMarkers, llvEnsureCanvas, llvResizeCanvas, llvClearCanvas, llvRequestRender, clearLiqLevels, renderLiqLevels, llvSaveSettings, llvLoadSettings, _llvPressStart, _llvPressEnd, calcHeatmapPockets, renderHeatmapOverlay, renderSROverlay } from '../data/marketDataOverlays'
// Phase 7F-A: marketData helpers — DYNAMIC timezone versions + unique functions
// These supersede the static format.ts versions on window.* (S.tz support)
import { fmtTime as _dynFmtTime, fmtTimeSec as _dynFmtTimeSec, fmtDate as _dynFmtDate, fmtFull as _dynFmtFull, fmtNow, toast, _calcATRSeries, calcRSI } from '../data/marketDataHelpers'
// Phase 7E: foundation — state + config. earlyShims already set _ZI on window.
import '../core/state'   // defines w.S, w.TC, w.TP
import '../core/config'  // defines w.BM, w.BRAIN, w.DSL, w.INDICATORS (needs w._ZI)
// Named imports for config.ts exports that need window.* mapping
import { AUB, AUB_COMPAT, AUB_PERF, AUB_SIM_KEY, ARIA_STATE, NOVA_STATE, _AN_KEY_A, _AN_KEY_N, SIGNAL_REGISTRY, NOTIFICATION_CENTER, USER_SETTINGS, BT, BT_INDICATORS, MSCAN_SYMS, MSCAN, DHF, PERF, DAILY_STATS, BEXT, SESSION_HOURS_BT, SESS_CFG, PROFILE_TF, ARM_ASSIST, NEWS, _regimeHistory, _fakeout, _SESS_DEF, _SESS_PRIORITY, _NEURO_SYMS, ZANIM, _execQueue, _srUpdateStats, _srRenderStats, _srRenderList, _srSave, _srLoad, _srEnsureVisible, srStripUpdateBar, _dslStripOpen, _atStripOpen, _ptStripOpen, _macdChart, _macdInited, _audioCtx, _audioReady, vwapSeries as _cfgVwapSeries, oviSeries as _cfgOviSeries, oviPriceSeries as _cfgOviPriceSeries, _sessLastBt, _neuroLastScan, _execActive } from '../core/config'
import { BlockReason, ZState, mainChart as _stMainChart, bbUpperS, ichimokuSeries, fibSeries, pivotSeries, vpSeries, _rsiChart, _stochChart, _atrChart, _obvChart, _mfiChart, _cciChart, IND_SETTINGS as _stIND_SETTINGS, liqSeries, zsSeries, oiHistory, WL_SYMS, wlPrices, allPrices } from '../core/state'

import { el, safeSetText, safeSetHTML, escHtml, isValidMarketPrice, safeLastKline } from '../utils/dom'
import { fmt, fP, fmtTime, fmtTimeSec, fmtDate, fmtFull, _TZ } from '../utils/format'
import { _clamp, _clampFB01, _clampFB, calcRSIArr } from '../utils/math'
import { _ZI } from '../constants/icons'
import { MACRO_MULT, STALL_GRACE_MS, GATE_DEFS } from '../constants/trading'
import { AT, PREDATOR, computePredatorState, _pendingClose, attachConfirmClose, _safeSetInterval, _clearAllIntervals } from '../engine/events'
import { TabLeader } from '../services/tabLeader'
import { _safeLocalStorageSet, addTradeToJournal, renderTradeJournal, loadJournalFromStorage, exportJournalCSV, startFRCountdown, trackOIDelta } from '../services/storage'
import { ZStore, connectWatchlist, switchWLSymbol } from '../services/symbols'
import { savePerfToStorage, loadPerfFromStorage, recordIndicatorPnl, calcExpectancy, calcGlobalExpectancy, calcExpectancyByProfile, resetPerfStore } from '../engine/perfStore'
import { recordDailyClose, rebuildDailyFromJournal, getDailyStats, getLastNDays, getWeeklyRollup, getMonthlyRollup, getDrawdownStats, saveDailyPnl, loadDailyPnl, resetDailyPnl } from '../engine/dailyPnl'
import { renderSignals } from '../engine/signals'
import { calcConfluenceScore } from '../engine/confluence'
import { RegimeEngine } from '../engine/regime'
import { PhaseFilter } from '../engine/phaseFilter'
import { resetForecast, computeExitRisk, decideExitAction, applyQuantumExit, runQuantumExitUpdate, computeProbScore, updateScenarioData, updateScenarioUI } from '../engine/forecast'
// Phase 5B: deepdive.js
import { PM, runPostMortem, PM_render, initPMPanel, _pmStripUpdateStat, _pmCheckRegimeTransition } from '../engine/postMortem'
import { ARES_JOURNAL } from '../engine/aresJournal'
import { ARES_MIND } from '../engine/aresMind'
import { ARES, ARES_openPosition } from '../engine/ares'
import { ARES_DECISION } from '../engine/aresDecision'
import { ARES_EXECUTE } from '../engine/aresExecute'
import { ARES_MONITOR } from '../engine/aresMonitor'
import { _aresRender, _aresRenderArc, initAriaBrain, initARES, _demoTick } from '../engine/aresUI'
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
import { scanLiquidityMagnets, renderMagnets, updateMagnetBias, jumpToMagnet, runBacktest, renderBacktestResults, calcVWAPBands, renderVWAP, toggleVWAP, oviReadSettings, oviApplySettings, oviCalcATR, oviPivots, oviWeightAt, oviColor, oviCalcPockets, renderOviLiquid, oviRenderScale, clearOviLiquid, toggleOviLiquid, togglePnlLab, renderPnlLab, _pnlLabCard, _pnlLabProfileCard, toggleSession, clearAllSessionOverlays, renderSessionOverlay } from '../ui/panels'
import { recordIndicatorPerformance, recordAllIndicators, recalcPerfWeights, renderPerfTracker, getCurrentADX, updateQuantumClock, getSessionKey, updateSessionBacktest, updateSymPulseRows, updateBrainHeatmap, updateRiskGauges, setRiskGauge, updateDataStream, updateBrainExtension, getTimeUTC, getRoTime, isCurrentTimeOK, renderDHF } from '../ui/render'
// Phase 7A: patch, hotkeys, pageview, marketCoreReactor, klines
import '../core/patch' // side-effect module
import '../core/hotkeys' // side-effect module
import { initPageView, openPageView, closePageView, _pvMoveIn } from '../ui/pageview'
import '../ui/marketCoreReactor' // side-effect, self-registers MarketCoreReactor
import { calcADX, calcRSIFromKlines, detectMACDDir, detectSTDir, calcSymbolScore, fetchSymbolKlines, _updateWhyBlocked, runMultiSymbolScan, renderMscanTable, manualEnterFromScan, _endMultiScan, runMultiSymbolAutoTrade, toggleMultiSymMode, _mscanGetActive, _mscanSaveActive, _mscanUpdateLabel, getActiveMscanSyms, toggleSymPicker, mscanToggleSym, mscanPickAll } from '../data/klines'
// Phase 6E: UI leaf files
import { _initAudio, _updateAudioBadge, _safePlayTone, playAlertSound, playEntrySound, playExitSound, toggleAlerts, applyChartColors, initActBar, applyPriceAxisWidth, togInd, applyPriceAxisColors } from '../ui/dom2'
import { _showExecOverlay as _showExecOverlayModal, _queueExecOverlay as _queueExecOverlayModal } from '../ui/modals'
import '../ui/notifications' // 6 lines, self-registers
import { toggleTimeSales } from '../ui/timeSales'
import { initModeBar, updateModeBar, _modeBarSwitch } from '../ui/modebar'
import { initZeusDock, dockClearActive } from '../ui/dock'
import '../ui/drawingTools' // self-registers drawing tool functions
// Phase 6D: brain extensions
import { aubToggle, aubToggleSFX, aubCheckCompat, aubBBSnapshot, aubBBExport, aubBBClear, aubCalcMTFStrength, aubCalcCorrelation, aubMacroImport, aubMacroClear, aubMacroFileLoad, aubGetActiveMacroRisk, aubSimRun, aubSimApply, aubRefreshAll, initAUB } from '../engine/aub'
import '../engine/arianova' // self-registers on window via IIFE
// Phase 6B: trading files
import { dslToggleMagnet, _computeDslMagnetSnap, toggleDSL, toggleAssistArm, _syncDslAssistUI, initDSLBubbles, _dslSafePrice, _dslSanitizeParams, runDSLBrain, _runClientDSLOnPositions, dslTakeControl, dslReleaseControl, dslManualParam, _dslPushParamsDebounced, renderDSLWidget, _renderDslCard, stopDSLIntervals, startDSLIntervals, _dslTrimLogs, _dslTrimAll } from '../trading/dsl'
import { computeMacroCortex, updateMacroUI, FEE_MODEL, estimateRoundTripFees, _adaptSave, _adaptLoad, _adaptClamp, recalcAdaptive, _renderAdaptivePanel, toggleAdaptive, _updateAdaptiveBarTxt, adaptiveStripToggle, initAdaptiveStrip, macroAdjustEntryScore, macroAdjustExitRisk, computePositionSizingMult, perfRecordTrade, _posR as _riskPosR, _macroPhaseFromComposite } from '../trading/risk'
import { onPositionOpened, onTradeExecuted, onTradeClosed as onTradeClosedPos, triggerExecCinematic } from '../trading/positions'
import { _showExecOverlay, _queueExecOverlay, _dayKeyLocal, _bmResetDailyIfNeeded, _bmPostClose } from '../trading/orders'
import { liveApiSetToken, _liveApiHeaders, _idempotencyKey, _liveApiFetch, _liveApiError, _liveApiParse, liveApiStatus, liveApiGetBalance, liveApiGetPositions, liveApiPlaceOrder, liveApiCancelOrder, liveApiSetLeverage, liveApiClosePosition, liveApiSyncState, aresPlaceOrder, aresSetStopLoss, aresSetTakeProfit, atSetStopLoss, atSetTakeProfit, aresClosePosition, aresCancelOrder, manualLivePlaceOrder, manualLiveGetOpenOrders, manualLiveCancelOrder, manualLiveModifyLimit, manualLiveSetSL, manualLiveSetTP } from '../trading/liveApi'
// Phase 6C: autotrade.js
import { toggleAutoTrade, _doEnableAT, _applyATToggleUI, updateATMode, atLog as atLogFn, renderATLog, updateATStats, checkATConditions, setCondUI, isDataOkForAutoTrade, computeFusionDecision, runAutoTradeCheck, placeAutoTrade, canAddOn, openAddOn, scheduleAutoClose, checkKillThreshold, triggerKillSwitch, resetKillSwitch, renderATPositions, openPartialClose, execPartialClose, closeAutoPos, closeAllDemoPos, closeAllATPos } from '../trading/autotrade'
// Phase 6A: managers.js, guards.js, dev.js, theme.js, decisionLog.js
import { Intervals, WS, FetchLock, ingestPrice, Timeouts } from '../core/managers'
import { _SAFETY, _safe, _safePnl, _isPriceSane, _syncServerTime, _onNewUTCDay, _startServerTimeSync, _resetWatchdog, _resetKlineWatchdog, _startWatchdog, _enterDegradedMode, _exitDegradedMode, _isDegradedOnly, _enterRecoveryMode, _exitRecoveryMode, _verifyPositionsAfterReconnect, _safeSetInterval as _guardsSafeSetInterval, _clearAllIntervals as _guardsClearAllIntervals, _isExecAllowed, initSafetyEngine } from '../utils/guards'
import { DEV, devLog, devClearLog, devExportLog, ZLOG, safeAsync, _devModuleOk, _devModuleError, devInjectSignal, devInjectLiquidation, devInjectWhale, devFeedDisconnect, devFeedRecover, devTriggerKillSwitch, devResetProtect, devReplayStart, devReplayStop, hubToggleDev, _devEnsureVisible, setUiScale, hubPopulate, hubSaveAll, hubLoadAll, hubTgSave, hubTgTest, hubTgPopulate, hubResetDefaults, hubSetTf, hubSetTZ, hubApplyChartColors, hubCloudSave, hubCloudLoad, hubCloudClear } from '../utils/dev'
import { zeusApplyTheme, zeusGetTheme } from '../ui/theme'
import { DLog } from '../utils/decisionLog'
// Phase 5B4: brain.js
import { updateNeurons, getNeuronColor, setNeuron, updateBrainArc, updateBrainState, brainThink, runBrainUpdate, armAssist, disarmAssist, isArmAssistValid, _setRadio, syncDslFromProfile, syncTFProfile, syncBrainFromState, setMode, _applyModeSwitch, confirmBrainModeSwitch, cancelBrainModeSwitch, setBrainMode, setProfile, setDslMode, calcDslTargetPrice, _calcAtrPct, applyTimezone, detectRegimeEnhanced, updateMTFAlignment, detectSweepDisplacement, updateFlowEngine, computeGates, renderGates, computeEntryScore, computeMarketAtmosphere, updateChaosBar, updateNewsShield, checkProtectMode, resetProtectMode, updateDSLTelemetry, showExecCinematic, getStableRegime, checkAntiFakeout, computeSafetyGates, _getCooldownMs, allSafetyPass, computeContextGates, _getActiveSessions, updateSessionPills, renderSessionBar, initNeuroCoinLEDs, pulseNeuronCoin, onNeuronScanUpdate, renderBrainCockpit, initZParticles, zAnimFrame, startZAnim, _brainDirtySet, _brainSafeSet, getBrainViewSnapshot, renderCircuitBrain, runGrandUpdate, _initBrainCockpit, detectMarketRegime, updateOrderFlow, adaptAutoTradeParams } from '../engine/brain'
import { connectLiveAPI, placeLiveOrder, connectLiveExchange, loadSavedAPI, installPWA, initIndicatorState, openIndPanel, closeIndPanel, toggleInd, applyIndVisibility, openIndSettings, closeIndSettings, applyIndSettings, initBBSeries, updateBB, initIchimokuSeries, updateIchimoku, updateFib, updatePivot, updateVP, initRSIChart, updateRSI, initStochChart, initATRChart, initOBVChart, initMFIChart, initCCIChart, _indRenderHook, renderActBar, getIndColor, deactivateInd, toggleActBar, calcMACD, initMACDChart, _macdKlineHook, detectSupertrendFlip, detectRSIDivergence, runSignalScan, generateDeepDive, updateDeepDive, _syncSubChartsToMain } from '../engine/indicators'

// Phase 7D: orderflow — MUST be after managers (needs w.Intervals) and after guards (needs w._SAFETY)
import '../data/orderflow'

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
  w.el = el
  w.safeSetText = safeSetText
  w.safeSetHTML = safeSetHTML
  w.escHtml = escHtml
  w.isValidMarketPrice = isValidMarketPrice
  w.safeLastKline = safeLastKline

  // ── Phase 1: formatters.js ──
  w.fmt = fmt
  w.fP = fP
  w.fmtTime = fmtTime
  w.fmtTimeSec = fmtTimeSec
  w.fmtDate = fmtDate
  w.fmtFull = fmtFull
  w._TZ = _TZ
  w._dtfTime = { format: (d: Date) => fmtTime(d.getTime() / 1000) }
  w._dtfTimeSec = { format: (d: Date) => fmtTimeSec(d.getTime() / 1000) }
  w._dtfDate = { format: (d: Date) => fmtDate(d.getTime() / 1000) }
  w._dtfFull = { format: (d: Date) => fmtFull(d.getTime() / 1000) }

  // ── Phase 1: math.js ──
  w._clamp = _clamp
  w._clampFB01 = _clampFB01
  w._clampFB = _clampFB
  w.calcRSIArr = calcRSIArr

  // ── Phase 1: icons.js ──
  w._ZI = _ZI

  // ── Phase 2: constants.js ──
  w.MACRO_MULT = MACRO_MULT
  w.STALL_GRACE_MS = STALL_GRACE_MS
  w.GATE_DEFS = GATE_DEFS
  // NOTE: _SESS_DEF, _SESS_PRIORITY, _NEURO_SYMS are defined in config.js (still bridge-loaded)
  // constants.js just re-exported them — config.js will set them on window itself

  // ── Phase 2: events.js ──
  w.AT = AT
  w.PREDATOR = PREDATOR
  w.computePredatorState = computePredatorState
  w._pendingClose = _pendingClose
  w.attachConfirmClose = attachConfirmClose
  w._safeSetInterval = _safeSetInterval
  w._clearAllIntervals = _clearAllIntervals

  // ── Phase 3: tabLeader.js ──
  w.TabLeader = TabLeader

  // ── Phase 3: storage.js ──
  w._safeLocalStorageSet = _safeLocalStorageSet
  w.addTradeToJournal = addTradeToJournal
  w.renderTradeJournal = renderTradeJournal
  w.loadJournalFromStorage = loadJournalFromStorage
  w.exportJournalCSV = exportJournalCSV
  w.startFRCountdown = startFRCountdown
  w.trackOIDelta = trackOIDelta

  // ── Phase 3: symbols.js ──
  w.ZStore = ZStore
  w.connectWatchlist = connectWatchlist
  w.switchWLSymbol = switchWLSymbol

  // ── Phase 4: perfStore.js ──
  w.savePerfToStorage = savePerfToStorage
  w.loadPerfFromStorage = loadPerfFromStorage
  w.recordIndicatorPnl = recordIndicatorPnl
  w.calcExpectancy = calcExpectancy
  w.calcGlobalExpectancy = calcGlobalExpectancy
  w.calcExpectancyByProfile = calcExpectancyByProfile
  w.resetPerfStore = resetPerfStore

  // ── Phase 4: dailyPnl.js ──
  w.recordDailyClose = recordDailyClose
  w.rebuildDailyFromJournal = rebuildDailyFromJournal
  w.getDailyStats = getDailyStats
  w.getLastNDays = getLastNDays
  w.getWeeklyRollup = getWeeklyRollup
  w.getMonthlyRollup = getMonthlyRollup
  w.getDrawdownStats = getDrawdownStats
  w.saveDailyPnl = saveDailyPnl
  w.loadDailyPnl = loadDailyPnl
  w.resetDailyPnl = resetDailyPnl

  // ── config.ts exports → window.* ──
  w.AUB = AUB; w.AUB_COMPAT = AUB_COMPAT; w.AUB_PERF = AUB_PERF; w.AUB_SIM_KEY = AUB_SIM_KEY
  w.ARIA_STATE = ARIA_STATE; w.NOVA_STATE = NOVA_STATE
  w._AN_KEY_A = _AN_KEY_A; w._AN_KEY_N = _AN_KEY_N
  w.SIGNAL_REGISTRY = SIGNAL_REGISTRY; w.NOTIFICATION_CENTER = NOTIFICATION_CENTER
  w.USER_SETTINGS = USER_SETTINGS; w.BT = BT; w.BT_INDICATORS = BT_INDICATORS
  w.MSCAN_SYMS = MSCAN_SYMS; w.MSCAN = MSCAN; w.DHF = DHF; w.PERF = PERF
  w.DAILY_STATS = DAILY_STATS; w.BEXT = BEXT
  w.SESSION_HOURS_BT = SESSION_HOURS_BT; w.SESS_CFG = SESS_CFG
  w.PROFILE_TF = PROFILE_TF; w.ARM_ASSIST = ARM_ASSIST; w.NEWS = NEWS
  w._regimeHistory = _regimeHistory; w._fakeout = _fakeout
  w._SESS_DEF = _SESS_DEF; w._SESS_PRIORITY = _SESS_PRIORITY; w._NEURO_SYMS = _NEURO_SYMS
  w.ZANIM = ZANIM; w._execQueue = _execQueue
  w._srUpdateStats = _srUpdateStats; w._srRenderStats = _srRenderStats
  w._srRenderList = _srRenderList; w._srSave = _srSave; w._srLoad = _srLoad
  w._srEnsureVisible = _srEnsureVisible; w.srStripUpdateBar = srStripUpdateBar
  w._dslStripOpen = _dslStripOpen; w._atStripOpen = _atStripOpen; w._ptStripOpen = _ptStripOpen
  w._macdChart = _macdChart; w._macdInited = _macdInited
  w._audioCtx = _audioCtx; w._audioReady = _audioReady
  w.vwapSeries = _cfgVwapSeries; w.oviSeries = _cfgOviSeries; w.oviPriceSeries = _cfgOviPriceSeries
  w._sessLastBt = _sessLastBt; w._neuroLastScan = _neuroLastScan; w._execActive = _execActive
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
  w._toggleCmdPalette = _toggleCmdPalette; w._showMissedTrades = _showMissedTrades
  w._showSessionReview = _showSessionReview; w._showRegimeHistory = _showRegimeHistory
  w._showPerformance = _showPerformance; w._showCompare = _showCompare

  // ── Phase 8D: bootstrap error + dlog + actfeed (coexist) ──
  w._checkAppUpdate = _checkAppUpdate
  w._toggleDecisionPanel = _toggleDecisionPanel
  w._actfeedToggle = _actfeedToggle

  // ── Phase 8C: bootstrap misc (coexist) ──
  w._pinIsSet = _pinIsSet; w._pinCheckLock = _pinCheckLock
  w.pinUnlock = pinUnlock; w.pinActivate = pinActivate; w.pinRemove = pinRemove; w._pinUpdateUI = _pinUpdateUI
  w._renderBuildInfo = _renderBuildInfo; w._showWelcomeModal = _showWelcomeModal
  w.showPWAUpdateBanner = showPWAUpdateBanner; w.hidePWAUpdateBanner = hidePWAUpdateBanner
  w.setPWAVersion = setPWAVersion; w.setupPWAReloadBtn = setupPWAReloadBtn
  w.masterReset = masterReset

  // ── Phase 8A: bootstrap init (coexist — bootstrap.js still in bridge for startApp) ──
  w.initZeusGroups = initZeusGroups
  w._waitForFeedThenStartExtras = _waitForFeedThenStartExtras
  w._startExtras = _startExtras
  w.runHealthChecks = runHealthChecks
  w._updatePnlLabCondensed = _updatePnlLabCondensed

  // ── Phase 7F-G: closeDemoPos (coexist) ──
  w.closeDemoPos = closeDemoPos

  // ── Phase 7F-F: marketData positions (coexist) ──
  w.checkPendingOrders = checkPendingOrders; w.cancelPendingOrder = cancelPendingOrder
  w.modifyPendingPrice = modifyPendingPrice; w.renderPendingOrders = renderPendingOrders
  w._startLivePendingSync = _startLivePendingSync; w._stopLivePendingSync = _stopLivePendingSync
  w._resumeLivePendingSyncIfNeeded = _resumeLivePendingSyncIfNeeded
  w.savePosSLTP = savePosSLTP; w.checkDemoPositionsSLTP = checkDemoPositionsSLTP
  w.renderDemoPositions = renderDemoPositions; w.calcPosPnL = calcPosPnL
  w.updateLiveBalance = updateLiveBalance; w.renderLivePositions = renderLivePositions
  w.closeLivePos = closeLivePos; w.getSymPrice = _mdGetSymPriceFull

  // ── Phase 7F-E: marketData trading (coexist) ──
  w.switchGlobalMode = switchGlobalMode; w._applyGlobalModeUI = _applyGlobalModeUI
  w._showConfirmDialog = _showConfirmDialog; w.promptAddFunds = promptAddFunds; w.promptResetDemo = promptResetDemo
  w.toggleTradePanel = toggleTradePanel; w.setDemoSide = setDemoSide; w.setLiveSide = setLiveSide
  w.onDemoOrdTypeChange = onDemoOrdTypeChange; w.getDemoLev = getDemoLev; w.getLiveLev = getLiveLev
  w.onDemoLevChange = onDemoLevChange; w.onLiveLevChange = onLiveLevChange
  w.calcLiqPrice = calcLiqPrice; w.updateDemoLiqPrice = updateDemoLiqPrice; w.updateLiveLiqPrice = updateLiveLiqPrice
  w.setDemoPct = setDemoPct; w.setLivePct = setLivePct; w.updateDemoBalance = updateDemoBalance
  w.placeDemoOrder = placeDemoOrder; w.getSymPrice = getSymPrice

  // ── Phase 7F-B: marketData chart (coexist) ──
  w.getChartH = getChartH; w.getChartW = getChartW
  w.initCharts = initCharts; w.fetchKlines = fetchKlines; w.renderChart = renderChart

  // ── Phase 7F-D2: marketData WS (coexist — old JS re-declares same functions) ──
  w.connectBNB = connectBNB; w.connectBYB = connectBYB
  w.updConn = _mdUpdConn; w.procLiq = procLiq
  w.updLiqStats = updLiqStats; w.updLiqSourceMetrics = updLiqSourceMetrics
  w.updBybHealth = updBybHealth; w.renderOB = renderOB
  w.renderHotZones = renderHotZones; w.updMarketPressure = updMarketPressure
  w.setLiqSrcFilter = setLiqSrcFilter; w.updLiqFilterBtns = updLiqFilterBtns; w.renderFeed = renderFeed
  w.setSymbol = _mdSetSymbol; w.toggleSnd = toggleSnd
  w.openM = openM; w.closeM = closeM; w._initModalDrag = _initModalDrag; w.swtab = swtab
  w.updateMainMetrics = updateMainMetrics; w.showTab = showTab
  w.applyChartColors = _mdApplyChartColors; w.setCandleStyle = setCandleStyle; w.setTZ = setTZ
  w.applyHeatmapSettings = applyHeatmapSettings
  w.sendAlert = sendAlert; w.registerServiceWorker = _mdRegisterSW
  w.checkLiqAlert = checkLiqAlert; w.testNotification = testNotification; w.saveAlerts = saveAlerts
  w.applySR = applySR; w.cloudClear = _mdCloudClear; w.injectFakeWhale = injectFakeWhale
  w.setLiqSym = setLiqSym; w.setLiqUsd = setLiqUsd; w.setLiqTW = setLiqTW
  w.hashEmail = hashEmail; w.cloudSave = _mdCloudSave; w.cloudLoad = _mdCloudLoad
  w.initCloudSettings = initCloudSettings; w.applySessionSettings = applySessionSettings
  w.applyZS = applyZS; w.clearZS = clearZS; w.renderZS = renderZS

  // ── Phase 7F-D1: marketData feeds (coexist — old JS re-declares same functions) ──
  w.setTF = setTF; w.setTf = setTf
  w.ztfToggle = ztfToggle; w.ztfPick = ztfPick
  w.toggleFS = toggleFS
  w.updatePriceDisplay = updatePriceDisplay
  w.calcFrCd = calcFrCd; w.safeFetch = safeFetch; w.throttledMainMetrics = throttledMainMetrics
  w.fetchRSI = fetchRSI; w.fetchAllRSI = fetchAllRSI; w.fetchFG = fetchFG
  w.fetchATR = fetchATR; w.fetchOI = fetchOI; w.fetchLS = fetchLS; w.fetch24h = fetch24h
  w.setDtTf = setDtTf; w.updateMetrics = updateMetrics; w.renderRSI = renderRSI; w.calcSRTable = calcSRTable

  // ── Phase 7F-C: marketData overlays (coexist — old JS re-declares same functions) ──
  w.updOvrs = updOvrs
  w.togOvr = togOvr
  w.clearHeatmap = clearHeatmap
  w.clearSR = clearSR
  w.renderTradeMarkers = renderTradeMarkers
  w.llvEnsureCanvas = llvEnsureCanvas
  w.llvResizeCanvas = llvResizeCanvas
  w.llvClearCanvas = llvClearCanvas
  w.llvRequestRender = llvRequestRender
  w.clearLiqLevels = clearLiqLevels
  w.renderLiqLevels = renderLiqLevels
  w.llvSaveSettings = llvSaveSettings
  w.llvLoadSettings = llvLoadSettings
  w._llvPressStart = _llvPressStart
  w._llvPressEnd = _llvPressEnd
  w.calcHeatmapPockets = calcHeatmapPockets
  w.renderHeatmapOverlay = renderHeatmapOverlay
  w.renderSROverlay = renderSROverlay

  // ── Phase 7F-A: marketData helpers ──
  // Dynamic timezone versions REPLACE the static ones from format.ts
  // Old JS and ported TS modules consume these via window.*
  w.fmtTime = _dynFmtTime
  w.fmtTimeSec = _dynFmtTimeSec
  w.fmtDate = _dynFmtDate
  w.fmtFull = _dynFmtFull
  w.fmtNow = fmtNow
  w.toast = toast
  w._calcATRSeries = _calcATRSeries
  w.calcRSI = calcRSI
  // _escHtml: NOT set here — escHtml from dom.ts (Phase 1) is already on window

  // ── Phase 7B: panels + render ──
  w.scanLiquidityMagnets = scanLiquidityMagnets
  w.renderMagnets = renderMagnets
  w.updateMagnetBias = updateMagnetBias
  w.jumpToMagnet = jumpToMagnet
  w.runBacktest = runBacktest
  w.renderBacktestResults = renderBacktestResults
  w.calcVWAPBands = calcVWAPBands
  w.renderVWAP = renderVWAP
  w.toggleVWAP = toggleVWAP
  w.oviReadSettings = oviReadSettings
  w.oviApplySettings = oviApplySettings
  w.oviCalcATR = oviCalcATR
  w.oviPivots = oviPivots
  w.oviWeightAt = oviWeightAt
  w.oviColor = oviColor
  w.oviCalcPockets = oviCalcPockets
  w.renderOviLiquid = renderOviLiquid
  w.oviRenderScale = oviRenderScale
  w.clearOviLiquid = clearOviLiquid
  w.toggleOviLiquid = toggleOviLiquid
  w.togglePnlLab = togglePnlLab
  w.renderPnlLab = renderPnlLab
  w._pnlLabCard = _pnlLabCard
  w._pnlLabProfileCard = _pnlLabProfileCard
  w.toggleSession = toggleSession
  w.clearAllSessionOverlays = clearAllSessionOverlays
  w.renderSessionOverlay = renderSessionOverlay
  w.recordIndicatorPerformance = recordIndicatorPerformance
  w.recordAllIndicators = recordAllIndicators
  w.recalcPerfWeights = recalcPerfWeights
  w.renderPerfTracker = renderPerfTracker
  w.getCurrentADX = getCurrentADX
  w.updateQuantumClock = updateQuantumClock
  w.getSessionKey = getSessionKey
  w.updateSessionBacktest = updateSessionBacktest
  w.updateSymPulseRows = updateSymPulseRows
  w.updateBrainHeatmap = updateBrainHeatmap
  w.updateRiskGauges = updateRiskGauges
  w.setRiskGauge = setRiskGauge
  w.updateDataStream = updateDataStream
  w.updateBrainExtension = updateBrainExtension
  w.getTimeUTC = getTimeUTC
  w.getRoTime = getRoTime
  w.isCurrentTimeOK = isCurrentTimeOK
  w.renderDHF = renderDHF

  // ── Phase 7A: patch, hotkeys, pageview, marketCoreReactor, klines ──
  // patch.ts, hotkeys.ts, marketCoreReactor.ts — side-effect imports, self-register
  w.initPageView = initPageView
  w.openPageView = openPageView
  w.closePageView = closePageView
  w._pvMoveIn = _pvMoveIn
  w.calcADX = calcADX
  w.calcRSIFromKlines = calcRSIFromKlines
  w.detectMACDDir = detectMACDDir
  w.detectSTDir = detectSTDir
  w.calcSymbolScore = calcSymbolScore
  w.fetchSymbolKlines = fetchSymbolKlines
  w._updateWhyBlocked = _updateWhyBlocked
  w.runMultiSymbolScan = runMultiSymbolScan
  w.renderMscanTable = renderMscanTable
  w.manualEnterFromScan = manualEnterFromScan
  w._endMultiScan = _endMultiScan
  w.runMultiSymbolAutoTrade = runMultiSymbolAutoTrade
  w.toggleMultiSymMode = toggleMultiSymMode
  w._mscanGetActive = _mscanGetActive
  w._mscanSaveActive = _mscanSaveActive
  w._mscanUpdateLabel = _mscanUpdateLabel
  w.getActiveMscanSyms = getActiveMscanSyms
  w.toggleSymPicker = toggleSymPicker
  w.mscanToggleSym = mscanToggleSym
  w.mscanPickAll = mscanPickAll

  // ── Phase 6E: ui leaf files ──
  w._initAudio = _initAudio
  w._updateAudioBadge = _updateAudioBadge
  w._safePlayTone = _safePlayTone
  w.playAlertSound = playAlertSound
  w.playEntrySound = playEntrySound
  w.playExitSound = playExitSound
  w.toggleAlerts = toggleAlerts
  w.applyChartColors = applyChartColors
  w.initActBar = initActBar
  w.applyPriceAxisWidth = applyPriceAxisWidth
  w.togInd = togInd
  w.applyPriceAxisColors = applyPriceAxisColors
  w.toggleTimeSales = toggleTimeSales
  w.initModeBar = initModeBar
  w.updateModeBar = updateModeBar
  w._modeBarSwitch = _modeBarSwitch
  w.initZeusDock = initZeusDock
  w.dockClearActive = dockClearActive
  // modals.ts — _showExecOverlay already set by orders.ts adapter; modal version as alias
  // notifications.ts — self-registers on import
  // drawingTools.ts — self-registers on import

  // ── Phase 6D: brain/aub.js ──
  w.aubToggle = aubToggle
  w.aubToggleSFX = aubToggleSFX
  w.aubCheckCompat = aubCheckCompat
  w.aubBBSnapshot = aubBBSnapshot
  w.aubBBExport = aubBBExport
  w.aubBBClear = aubBBClear
  w.aubCalcMTFStrength = aubCalcMTFStrength
  w.aubCalcCorrelation = aubCalcCorrelation
  w.aubMacroImport = aubMacroImport
  w.aubMacroClear = aubMacroClear
  w.aubMacroFileLoad = aubMacroFileLoad
  w.aubGetActiveMacroRisk = aubGetActiveMacroRisk
  w.aubSimRun = aubSimRun
  w.aubSimApply = aubSimApply
  w.aubRefreshAll = aubRefreshAll
  w.initAUB = initAUB
  // arianova.js — self-registers on window via IIFE import above

  // ── Phase 6C: trading/autotrade.js ──
  w.toggleAutoTrade = toggleAutoTrade
  w._doEnableAT = _doEnableAT
  w._applyATToggleUI = _applyATToggleUI
  w.updateATMode = updateATMode
  w.atLog = atLogFn
  w.renderATLog = renderATLog
  w.updateATStats = updateATStats
  w.checkATConditions = checkATConditions
  w.setCondUI = setCondUI
  w.isDataOkForAutoTrade = isDataOkForAutoTrade
  w.computeFusionDecision = computeFusionDecision
  w.runAutoTradeCheck = runAutoTradeCheck
  w.placeAutoTrade = placeAutoTrade
  w.canAddOn = canAddOn
  w.openAddOn = openAddOn
  w.scheduleAutoClose = scheduleAutoClose
  w.checkKillThreshold = checkKillThreshold
  w.triggerKillSwitch = triggerKillSwitch
  w.resetKillSwitch = resetKillSwitch
  w.renderATPositions = renderATPositions
  w.openPartialClose = openPartialClose
  w.execPartialClose = execPartialClose
  w.closeAutoPos = closeAutoPos
  w.closeAllDemoPos = closeAllDemoPos
  w.closeAllATPos = closeAllATPos

  // ── Phase 6B: trading/dsl.js ──
  w.dslToggleMagnet = dslToggleMagnet
  w._computeDslMagnetSnap = _computeDslMagnetSnap
  w.toggleDSL = toggleDSL
  w.toggleAssistArm = toggleAssistArm
  w._syncDslAssistUI = _syncDslAssistUI
  w.initDSLBubbles = initDSLBubbles
  w._dslSafePrice = _dslSafePrice
  w._dslSanitizeParams = _dslSanitizeParams
  w.runDSLBrain = runDSLBrain
  w._runClientDSLOnPositions = _runClientDSLOnPositions
  w.dslTakeControl = dslTakeControl
  w.dslReleaseControl = dslReleaseControl
  w.dslManualParam = dslManualParam
  w._dslPushParamsDebounced = _dslPushParamsDebounced
  w.renderDSLWidget = renderDSLWidget
  w._renderDslCard = _renderDslCard
  w.stopDSLIntervals = stopDSLIntervals
  w.startDSLIntervals = startDSLIntervals
  w._dslTrimLogs = _dslTrimLogs
  w._dslTrimAll = _dslTrimAll

  // ── Phase 6B: trading/risk.js ──
  w.computeMacroCortex = computeMacroCortex
  w.updateMacroUI = updateMacroUI
  w.FEE_MODEL = FEE_MODEL
  w.estimateRoundTripFees = estimateRoundTripFees
  w._adaptSave = _adaptSave
  w._adaptLoad = _adaptLoad
  w._adaptClamp = _adaptClamp
  w.recalcAdaptive = recalcAdaptive
  w._renderAdaptivePanel = _renderAdaptivePanel
  w.toggleAdaptive = toggleAdaptive
  w._updateAdaptiveBarTxt = _updateAdaptiveBarTxt
  w.adaptiveStripToggle = adaptiveStripToggle
  w.initAdaptiveStrip = initAdaptiveStrip
  w.macroAdjustEntryScore = macroAdjustEntryScore
  w.macroAdjustExitRisk = macroAdjustExitRisk
  w.computePositionSizingMult = computePositionSizingMult
  w.perfRecordTrade = perfRecordTrade
  w._macroPhaseFromComposite = _macroPhaseFromComposite

  // ── Phase 6B: trading/positions.js ──
  w.onPositionOpened = onPositionOpened
  w.onTradeExecuted = onTradeExecuted
  w.onTradeClosedPos = onTradeClosedPos
  w.triggerExecCinematic = triggerExecCinematic

  // ── Phase 6B: trading/orders.js ──
  w._showExecOverlay = _showExecOverlay
  w._queueExecOverlay = _queueExecOverlay
  w._dayKeyLocal = _dayKeyLocal
  w._bmResetDailyIfNeeded = _bmResetDailyIfNeeded
  w._bmPostClose = _bmPostClose

  // ── Phase 6B: trading/liveApi.js ──
  w.liveApiSetToken = liveApiSetToken
  w._liveApiHeaders = _liveApiHeaders
  w._idempotencyKey = _idempotencyKey
  w._liveApiFetch = _liveApiFetch
  w._liveApiError = _liveApiError
  w._liveApiParse = _liveApiParse
  w.liveApiStatus = liveApiStatus
  w.liveApiGetBalance = liveApiGetBalance
  w.liveApiGetPositions = liveApiGetPositions
  w.liveApiPlaceOrder = liveApiPlaceOrder
  w.liveApiCancelOrder = liveApiCancelOrder
  w.liveApiSetLeverage = liveApiSetLeverage
  w.liveApiClosePosition = liveApiClosePosition
  w.liveApiSyncState = liveApiSyncState
  w.aresPlaceOrder = aresPlaceOrder
  w.aresSetStopLoss = aresSetStopLoss
  w.aresSetTakeProfit = aresSetTakeProfit
  w.atSetStopLoss = atSetStopLoss
  w.atSetTakeProfit = atSetTakeProfit
  w.aresClosePosition = aresClosePosition
  w.aresCancelOrder = aresCancelOrder
  w.manualLivePlaceOrder = manualLivePlaceOrder
  w.manualLiveGetOpenOrders = manualLiveGetOpenOrders
  w.manualLiveCancelOrder = manualLiveCancelOrder
  w.manualLiveModifyLimit = manualLiveModifyLimit
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
  w._syncServerTime = _syncServerTime
  w._onNewUTCDay = _onNewUTCDay
  w._startServerTimeSync = _startServerTimeSync
  w._resetWatchdog = _resetWatchdog
  w._resetKlineWatchdog = _resetKlineWatchdog
  w._startWatchdog = _startWatchdog
  w._enterDegradedMode = _enterDegradedMode
  w._exitDegradedMode = _exitDegradedMode
  w._isDegradedOnly = _isDegradedOnly
  w._enterRecoveryMode = _enterRecoveryMode
  w._exitRecoveryMode = _exitRecoveryMode
  w._verifyPositionsAfterReconnect = _verifyPositionsAfterReconnect
  w._isExecAllowed = _isExecAllowed
  w.initSafetyEngine = initSafetyEngine

  // ── Phase 6A: dev.js ──
  w.DEV = DEV
  w.devLog = devLog
  w.devClearLog = devClearLog
  w.devExportLog = devExportLog
  w.ZLOG = ZLOG
  w.safeAsync = safeAsync
  w._devModuleOk = _devModuleOk
  w._devModuleError = _devModuleError
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
  w._devEnsureVisible = _devEnsureVisible
  w.setUiScale = setUiScale
  w.hubPopulate = hubPopulate
  w.hubSaveAll = hubSaveAll
  w.hubLoadAll = hubLoadAll
  w.hubTgSave = hubTgSave
  w.hubTgTest = hubTgTest
  w.hubTgPopulate = hubTgPopulate
  w.hubResetDefaults = hubResetDefaults
  w.hubSetTf = hubSetTf
  w.hubSetTZ = hubSetTZ
  w.hubApplyChartColors = hubApplyChartColors
  w.hubCloudSave = hubCloudSave
  w.hubCloudLoad = hubCloudLoad
  w.hubCloudClear = hubCloudClear

  // ── Phase 6A: theme.js (self-applies on import) ──
  w.zeusApplyTheme = zeusApplyTheme
  w.zeusGetTheme = zeusGetTheme

  // ── Phase 6A: decisionLog.js ──
  w.DLog = DLog

  // ── Phase 5A: signals.js ──
  w.renderSignals = renderSignals

  // ── Phase 5A: confluence.js ──
  w.calcConfluenceScore = calcConfluenceScore

  // ── Phase 5A: regime.js ──
  w.RegimeEngine = RegimeEngine

  // ── Phase 5A: phaseFilter.js ──
  w.PhaseFilter = PhaseFilter

  // ── Phase 5A: forecast.js ──
  w.resetForecast = resetForecast
  w.computeExitRisk = computeExitRisk
  w.decideExitAction = decideExitAction
  w.applyQuantumExit = applyQuantumExit
  w.runQuantumExitUpdate = runQuantumExitUpdate
  w.computeProbScore = computeProbScore
  w.updateScenarioData = updateScenarioData
  w.updateScenarioUI = updateScenarioUI

  // ── Phase 5B: deepdive.js — PM ──
  w.PM = PM
  w.runPostMortem = runPostMortem
  w.PM_render = PM_render
  w.initPMPanel = initPMPanel
  w._pmStripUpdateStat = _pmStripUpdateStat
  w._pmCheckRegimeTransition = _pmCheckRegimeTransition

  // ── Phase 5B: deepdive.js — ARES core ──
  w.ARES = ARES
  w.ARES_openPosition = ARES_openPosition
  w.ARES_DECISION = ARES_DECISION
  w.ARES_EXECUTE = ARES_EXECUTE
  w.ARES_MONITOR = ARES_MONITOR
  w.ARES_JOURNAL = ARES_JOURNAL
  w.ARES_MIND = ARES_MIND

  // ── Phase 5B: deepdive.js — ARES UI ──
  w._aresRender = _aresRender
  w._aresRenderArc = _aresRenderArc
  w.initAriaBrain = initAriaBrain
  w.initARES = initARES
  w._demoTick = _demoTick

  // ── Phase 5B: deepdive.js — Indicators + Scanner + DeepDive ──
  w.connectLiveAPI = connectLiveAPI
  w.placeLiveOrder = placeLiveOrder
  w.connectLiveExchange = connectLiveExchange
  w.loadSavedAPI = loadSavedAPI
  w.installPWA = installPWA
  initIndicatorState()
  w.openIndPanel = openIndPanel
  w.closeIndPanel = closeIndPanel
  w.toggleInd = toggleInd
  w.applyIndVisibility = applyIndVisibility
  w.openIndSettings = openIndSettings
  w.closeIndSettings = closeIndSettings
  w.applyIndSettings = applyIndSettings
  w.initBBSeries = initBBSeries
  w.updateBB = updateBB
  w.initIchimokuSeries = initIchimokuSeries
  w.updateIchimoku = updateIchimoku
  w.updateFib = updateFib
  w.updatePivot = updatePivot
  w.updateVP = updateVP
  w.initRSIChart = initRSIChart
  w.updateRSI = updateRSI
  w.initStochChart = initStochChart
  w.initATRChart = initATRChart
  w.initOBVChart = initOBVChart
  w.initMFIChart = initMFIChart
  w.initCCIChart = initCCIChart
  w._indRenderHook = _indRenderHook
  w.renderActBar = renderActBar
  w.getIndColor = getIndColor
  w.deactivateInd = deactivateInd
  w.toggleActBar = toggleActBar
  w.calcMACD = calcMACD
  w.initMACDChart = initMACDChart
  w._macdKlineHook = _macdKlineHook
  w.detectSupertrendFlip = detectSupertrendFlip
  w.detectRSIDivergence = detectRSIDivergence
  w.runSignalScan = runSignalScan
  w.generateDeepDive = generateDeepDive
  w.updateDeepDive = updateDeepDive
  w._syncSubChartsToMain = _syncSubChartsToMain

  // ── Phase 5B4: brain.js ──
  w.updateNeurons = updateNeurons
  w.getNeuronColor = getNeuronColor
  w.setNeuron = setNeuron
  w.updateBrainArc = updateBrainArc
  w.updateBrainState = updateBrainState
  w.brainThink = brainThink
  w.runBrainUpdate = runBrainUpdate
  w.armAssist = armAssist
  w.disarmAssist = disarmAssist
  w.isArmAssistValid = isArmAssistValid
  w._setRadio = _setRadio
  w.syncDslFromProfile = syncDslFromProfile
  w.syncTFProfile = syncTFProfile
  w.syncBrainFromState = syncBrainFromState
  w.setMode = setMode
  w._applyModeSwitch = _applyModeSwitch
  w.confirmBrainModeSwitch = confirmBrainModeSwitch
  w.cancelBrainModeSwitch = cancelBrainModeSwitch
  w.setBrainMode = setBrainMode
  w.setProfile = setProfile
  w.setDslMode = setDslMode
  w.calcDslTargetPrice = calcDslTargetPrice
  w._calcAtrPct = _calcAtrPct
  w.applyTimezone = applyTimezone
  w.detectRegimeEnhanced = detectRegimeEnhanced
  w.updateMTFAlignment = updateMTFAlignment
  w.detectSweepDisplacement = detectSweepDisplacement
  w.updateFlowEngine = updateFlowEngine
  w.computeGates = computeGates
  w.renderGates = renderGates
  w.computeEntryScore = computeEntryScore
  w.computeMarketAtmosphere = computeMarketAtmosphere
  w.updateChaosBar = updateChaosBar
  w.updateNewsShield = updateNewsShield
  w.checkProtectMode = checkProtectMode
  w.resetProtectMode = resetProtectMode
  w.updateDSLTelemetry = updateDSLTelemetry
  w.showExecCinematic = showExecCinematic
  w.getStableRegime = getStableRegime
  w.checkAntiFakeout = checkAntiFakeout
  w.computeSafetyGates = computeSafetyGates
  w._getCooldownMs = _getCooldownMs
  w.allSafetyPass = allSafetyPass
  w.computeContextGates = computeContextGates
  w._getActiveSessions = _getActiveSessions
  w.updateSessionPills = updateSessionPills
  w.renderSessionBar = renderSessionBar
  w.initNeuroCoinLEDs = initNeuroCoinLEDs
  w.pulseNeuronCoin = pulseNeuronCoin
  w.onNeuronScanUpdate = onNeuronScanUpdate
  w.renderBrainCockpit = renderBrainCockpit
  w.initZParticles = initZParticles
  w.zAnimFrame = zAnimFrame
  w.startZAnim = startZAnim
  w._brainDirtySet = _brainDirtySet
  w._brainSafeSet = _brainSafeSet
  w.getBrainViewSnapshot = getBrainViewSnapshot
  w.renderCircuitBrain = renderCircuitBrain
  w.runGrandUpdate = runGrandUpdate
  w._initBrainCockpit = _initBrainCockpit
  w.detectMarketRegime = detectMarketRegime
  w.updateOrderFlow = updateOrderFlow
  w.adaptAutoTradeParams = adaptAutoTradeParams
}
