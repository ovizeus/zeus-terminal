/**
 * Phase 1+2 Adapters — expose ported modules on window.*
 * so old JS consumers work unchanged.
 *
 * Called from legacyLoader.ts installShims() BEFORE any old JS loads.
 * Phase 1: helpers.js, formatters.js, math.js, icons.js
 * Phase 2: constants.js, events.js
 */

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

export function installPhase1Adapters(): void {
  const w = window as Record<string, unknown>

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
