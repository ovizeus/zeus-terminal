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
}
