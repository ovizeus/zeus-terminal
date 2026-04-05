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
}
