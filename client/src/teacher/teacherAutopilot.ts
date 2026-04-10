// Zeus — teacher/teacherAutopilot.ts
// Ported 1:1 from public/js/teacher/teacherAutopilot.js (Phase 7C)
// TEACHER V2 — Main Autonomous Loop
// [8E-3] w.TEACHER reads migrated to getTeacher()
import { getTeacher } from '../services/stateAccessors'

const w = window as any

let _teacherAutoRunning = false
let _teacherAutoPaused = false

export function teacherInitV2State(): any {
  const T = getTeacher(); if (!T) return
  T.v2 = T.v2 || {
    running: false, status: 'IDLE', statusDetail: '', startedAt: 0,
    startCapital: 10000, currentCapital: 10000, failCount: 0, reloadCount: 0, ruinThreshold: 1000,
    currentSegment: null, currentProfile: null, currentRegime: null, currentTF: '', sessionTrades: 0,
    lifetimeTrades: [], lifetimeStats: null, lifetimeSessions: 0,
    curriculum: w.teacherInitCurriculum(),
    lastDecision: null, lastReview: null, lastLesson: null, recentActivity: [],
    capability: 0, capabilityLabel: 'WEAK', capabilityBreakdown: null,
  }
  return T.v2
}

function _teacherLog(msg: any, type?: any): void {
  const T = getTeacher(); if (!T || !T.v2) return; type = type || 'info'
  T.v2.recentActivity.unshift({ ts: Date.now(), msg, type }); if (T.v2.recentActivity.length > 30) T.v2.recentActivity.length = 30
}

function _teacherSetStatus(status: any, detail?: any): void {
  const T = getTeacher(); if (!T || !T.v2) return; T.v2.status = status; T.v2.statusDetail = detail || ''
}

function _teacherCheckRuin(): boolean {
  const T = getTeacher(); if (!T || !T.v2 || !T._equity) return false; return T._equity.capital <= T.v2.ruinThreshold
}

function _teacherReloadCapital(): void {
  const T = getTeacher(); if (!T || !T.v2) return
  T.v2.failCount++; T.v2.reloadCount++
  _teacherLog('CAPITAL DESTROYED — Fail #' + T.v2.failCount + ' — Reloading $10,000', 'fail')
  _teacherSetStatus('RELOADING', 'Fail #' + T.v2.failCount)
  T.v2.currentCapital = T.v2.startCapital; T.config.capitalUSD = T.v2.startCapital
}

export async function teacherRunOneSession(): Promise<any> {
  const T = getTeacher(); if (!T || !T.v2) return null; const v2 = T.v2
  _teacherSetStatus('LOADING', 'Choosing segment...')
  let segment: any
  if (w.teacherShouldForceRotation(v2.curriculum)) { segment = w.teacherForceRotatedSegment(v2.curriculum); _teacherLog('Forced rotation — least-tested TF/regime', 'info') }
  else { segment = w.teacherPickNextSegment(v2.curriculum) }
  if (!segment) { _teacherLog('No segment available', 'warn'); return null }
  v2.currentSegment = segment; v2.currentTF = segment.tf
  const monthLabel = segment.year + '-' + String(segment.month).padStart(2, '0')
  _teacherLog('Segment: ' + monthLabel + ' ' + segment.tf + (segment.isOOS ? ' [OOS]' : ' [IS]'), 'info')
  _teacherSetStatus('LOADING', 'Fetching ' + monthLabel + ' ' + segment.tf + '...')
  let dataset: any
  try { dataset = await w.teacherLoadDataset({ tf: segment.tf, startMs: segment.startMs, endMs: segment.endMs, maxBars: 5000 }) }
  catch (err: any) { _teacherLog('Fetch failed: ' + err.message, 'warn'); _teacherSetStatus('IDLE', 'Fetch error'); return null }
  if (!dataset || !dataset.bars || dataset.bars.length < 200) { _teacherLog('Insufficient data: ' + (dataset ? dataset.bars.length : 0) + ' bars', 'warn'); return null }
  _teacherLog('Loaded ' + dataset.bars.length + ' bars', 'info')
  T.config.capitalUSD = v2.currentCapital
  w.teacherInitReplay(dataset, { startBar: Math.min(100, dataset.bars.length - 1), onTick: null, onComplete: null })
  w.teacherInitEquity()
  const initBars = dataset.bars.slice(0, T.cursor + 1)
  const initRegime = w.teacherDetectRegimeV2(T.indicators, initBars)
  let profile = w.teacherAutoSelectProfile(initRegime)
  v2.currentProfile = profile; v2.currentRegime = initRegime; w.teacherSetMaxBarsInTrade(profile.maxBarsInTrade)
  _teacherLog('Profile: ' + profile.name + ' | Regime: ' + initRegime.regime, 'info')
  _teacherSetStatus('SCANNING', profile.name + ' | ' + initRegime.regime)
  const maxCursor = dataset.bars.length - 1; let sessionTrades = 0; let noTradeCount = 0; const dominantRegimeMap: any = {}
  while (T.cursor < maxCursor && _teacherAutoRunning) {
    while (_teacherAutoPaused && _teacherAutoRunning) { await new Promise(function (r: any) { setTimeout(r, 200) }) }
    if (!_teacherAutoRunning) break
    const tick = w.teacherStep(1); if (!tick) break
    if (T.cursor % 10 === 0) {
      const visibleBars = dataset.bars.slice(0, T.cursor + 1); const regime = w.teacherDetectRegimeV2(T.indicators, visibleBars)
      v2.currentRegime = regime; dominantRegimeMap[regime.regime] = (dominantRegimeMap[regime.regime] || 0) + 1
      const newProfile = w.teacherAutoSelectProfile(regime)
      if (newProfile.name !== profile.name && !T.openTrade) { profile = newProfile; v2.currentProfile = profile; w.teacherSetMaxBarsInTrade(profile.maxBarsInTrade) }
    }
    if (T.openTrade) {
      _teacherSetStatus('IN_TRADE', T.openTrade.side + ' @ ' + T.openTrade.entry.toFixed(0))
      const exitReason = w.teacherDecideExit(T.openTrade, T.indicators, v2.currentRegime, profile)
      if (exitReason) { const bar = dataset.bars[T.cursor]; const closed = w._teacherCloseTrade(bar.close, exitReason, { bar, barIndex: T.cursor }); if (closed) { w._teacherUpdateEquity(closed); _teacherPostTradeReview(closed, v2); sessionTrades++ } }
      if (!T.openTrade && T.trades.length > 0) { const lastTrade = T.trades[T.trades.length - 1]; if (lastTrade.exitBar === T.cursor) { w._teacherUpdateEquity(lastTrade); _teacherPostTradeReview(lastTrade, v2); sessionTrades++ } }
    } else {
      _teacherSetStatus('SCANNING', (v2.currentRegime ? v2.currentRegime.regime : '?') + ' | ' + profile.name)
      const equity = w.teacherGetEquity()
      const decision = w.teacherDecideEntry(T.indicators, v2.currentRegime, profile, equity, T.memory); v2.lastDecision = decision
      if (decision.action !== 'NO_TRADE') {
        const sizing = w.teacherAutoSize(profile, equity || { currentCapital: v2.currentCapital, startCapital: v2.startCapital, currentDDPct: 0 }, T.indicators)
        if (sizing) {
          const opened = w.teacherOpenTrade(decision.action, { slPct: sizing.slPct, tpPct: sizing.tpPct, leverageX: sizing.leverageX, dslEnabled: sizing.dslEnabled, dslActivation: sizing.dslActivation, dslTrailPct: sizing.dslTrailPct, feeProfile: sizing.feeProfile, orderType: sizing.orderType })
          if (opened) { opened._profile = profile.name; opened._regime = v2.currentRegime ? v2.currentRegime.regime : 'UNKNOWN'; opened._tf = segment.tf; opened._decision = decision; opened._segment = { year: segment.year, month: segment.month }; _teacherLog(decision.action + ' @ ' + opened.entry.toFixed(0) + ' [' + decision.reasons.join(', ') + ']', 'trade'); noTradeCount = 0 }
        }
      } else { noTradeCount++ }
    }
    if (_teacherCheckRuin()) { _teacherReloadCapital(); if (T.openTrade) { const ruinBar = dataset.bars[T.cursor]; w._teacherCloseTrade(ruinBar.close, 'RUIN_EXIT', { bar: ruinBar, barIndex: T.cursor }) }; w.teacherInitEquity(); _teacherLog('Capital reloaded. Continuing session.', 'fail') }
    const speed = w.teacherAutoSpeed(!!T.openTrade, T.indicators, v2.currentRegime)
    await new Promise(function (r: any) { setTimeout(r, speed) })
    if (typeof w._teacherV2OnTick === 'function') { try { w._teacherV2OnTick(tick) } catch (_e) { /* silent */ } }
  }
  void noTradeCount
  if (T.openTrade && dataset.bars.length > 0) { const lastBar = dataset.bars[dataset.bars.length - 1]; const finalClosed = w._teacherCloseTrade(lastBar.close, 'SESSION_END', { bar: lastBar, barIndex: dataset.bars.length - 1 }); if (finalClosed) { w._teacherUpdateEquity(finalClosed); _teacherPostTradeReview(finalClosed, v2); sessionTrades++ } }
  let sessionStats: any = null
  if (typeof w.teacherComputeStats === 'function' && T.trades.length > 0) sessionStats = w.teacherComputeStats(T.trades)
  let dominantRegime = 'RANGE', maxRegimeCount = 0
  for (const rk in dominantRegimeMap) { if (dominantRegimeMap[rk] > maxRegimeCount) { maxRegimeCount = dominantRegimeMap[rk]; dominantRegime = rk } }
  const sessionResult = { sessionId: 'S_' + Date.now(), totalTrades: sessionTrades, totalPnl: sessionStats ? sessionStats.totalPnl : 0, winRate: sessionStats ? sessionStats.winRate : 0, profitFactor: sessionStats ? sessionStats.profitFactor : 0, profile: profile.name, tf: segment.tf, dominantRegime, isOOS: segment.isOOS, barsReplayed: T.cursor + 1, year: segment.year, month: segment.month }
  _teacherSetStatus('LEARNING', 'Extracting lessons...')
  for (let ti = 0; ti < T.trades.length; ti++) { const tr = T.trades[ti]; tr._profile = tr._profile || profile.name; tr._regime = tr._regime || dominantRegime; tr._tf = tr._tf || segment.tf; tr._isOOS = segment.isOOS; tr._classification = w.teacherClassifyTradeV2(tr); v2.lifetimeTrades.push(tr) }
  if (v2.lifetimeTrades.length > 2000) v2.lifetimeTrades = v2.lifetimeTrades.slice(-2000)
  if (typeof w.teacherExtractLessons === 'function' && T.trades.length > 0) { const lessons = w.teacherExtractLessons(T.trades); if (typeof w.teacherEndSessionMemoryUpdate === 'function') w.teacherEndSessionMemoryUpdate(T.trades); if (lessons && lessons.length > 0) { v2.lastLesson = lessons[0]; _teacherLog('Learned ' + lessons.length + ' lesson(s)', 'learn') } }
  w.teacherRecordSegment(v2.curriculum, segment, sessionResult)
  const eq = w.teacherGetEquity(); if (eq) v2.currentCapital = eq.currentCapital
  if (typeof w.teacherComputeCapability === 'function') { const cap = w.teacherComputeCapability(v2); v2.capability = cap.score; v2.capabilityLabel = cap.label; v2.capabilityBreakdown = cap.breakdown }
  if (typeof w.teacherComputeStats === 'function' && v2.lifetimeTrades.length > 0) v2.lifetimeStats = w.teacherComputeStats(v2.lifetimeTrades)
  v2.lifetimeSessions++
  _teacherLog('Session complete: ' + sessionTrades + ' trades, PnL: $' + (sessionStats ? sessionStats.totalPnl.toFixed(2) : '0.00') + (segment.isOOS ? ' [OOS]' : ''), 'info')
  if (typeof w.teacherSaveV2State === 'function') w.teacherSaveV2State()
  return sessionResult
}

function _teacherPostTradeReview(trade: any, v2: any): void {
  if (!trade || !v2) return
  const review: any = { tradeId: trade.id, ts: Date.now() }
  trade._classification = w.teacherClassifyTradeV2(trade)
  if (typeof w.teacherScoreTrade === 'function') { const scoreResult = w.teacherScoreTrade(trade); trade._qualityScore = scoreResult.score; trade._qualityGrade = scoreResult.grade; review.score = scoreResult.score; review.grade = scoreResult.grade }
  if (typeof w.teacherCalcRMultiple === 'function') trade._rMultiple = w.teacherCalcRMultiple(trade)
  if (trade._classification === 'MISTAKE' || trade._classification === 'BAD_TRADE' || trade._classification === 'AVOIDABLE_LOSS' || trade._classification === 'LUCKY_TRADE') {
    if (typeof w.teacherWhyEntered === 'function') review.whyEntered = w.teacherWhyEntered(trade)
    if (typeof w.teacherWhyExited === 'function') review.whyExited = w.teacherWhyExited(trade)
    if (typeof w.teacherWhyOutcome === 'function') review.whyOutcome = w.teacherWhyOutcome(trade)
    _teacherLog(trade._classification + ': ' + trade.side + ' ' + trade.exitReason + ' (' + (trade.pnlNet >= 0 ? '+' : '') + trade.pnlNet.toFixed(2) + ')', 'review')
  } else { _teacherLog(trade.side + ' ' + trade.exitReason + ' → ' + trade.outcome + ' ' + (trade.pnlNet >= 0 ? '+' : '') + '$' + trade.pnlNet.toFixed(2), 'trade') }
  v2.lastReview = review
}

export async function teacherStartAutonomous(): Promise<void> {
  let T = getTeacher()
  if (!T) { if (typeof w._initTeacherState === 'function') w.TEACHER = w._initTeacherState(); T = getTeacher() }
  if (!T) return
  teacherInitV2State(); const v2 = T.v2
  if (typeof w.teacherLoadV2State === 'function') w.teacherLoadV2State()
  if (typeof w.teacherLoadAllPersistent === 'function') w.teacherLoadAllPersistent()
  _teacherAutoRunning = true; _teacherAutoPaused = false; v2.running = true; v2.startedAt = Date.now()
  _teacherLog('TEACHER V2 STARTED — Autonomous mode', 'info')
  _teacherSetStatus('LOADING', 'Starting autonomous loop...')
  while (_teacherAutoRunning) {
    try { const result = await teacherRunOneSession(); if (!result && _teacherAutoRunning) { _teacherLog('Retrying in 5s...', 'warn'); await new Promise(function (r: any) { setTimeout(r, 5000) }) } }
    catch (err: any) { _teacherLog('Session error: ' + err.message, 'warn'); await new Promise(function (r: any) { setTimeout(r, 5000) }) }
    if (_teacherAutoRunning) { _teacherSetStatus('IDLE', 'Preparing next session...'); await new Promise(function (r: any) { setTimeout(r, 2000) }) }
  }
  v2.running = false; _teacherSetStatus('IDLE', 'Stopped'); _teacherLog('TEACHER V2 STOPPED', 'info')
  if (typeof w.teacherSaveV2State === 'function') w.teacherSaveV2State()
}

export function teacherStopAutonomous(): void {
  _teacherAutoRunning = false; const T = getTeacher()
  if (T && T.v2) { T.v2.running = false; _teacherSetStatus('IDLE', 'Stopping...') }
  if (typeof w.teacherStopReplay === 'function') w.teacherStopReplay()
}

export function teacherIsRunning(): boolean { return _teacherAutoRunning }

let _teacherV2OnTick: any = null
export function teacherSetV2TickCallback(fn: any): void { _teacherV2OnTick = typeof fn === 'function' ? fn : null }

;(function _teacherAutopilotGlobals() {
  if (typeof window !== 'undefined') {
    w.teacherInitV2State = teacherInitV2State; w.teacherRunOneSession = teacherRunOneSession
    w.teacherStartAutonomous = teacherStartAutonomous; w.teacherStopAutonomous = teacherStopAutonomous
    w.teacherIsRunning = teacherIsRunning; w.teacherSetV2TickCallback = teacherSetV2TickCallback
    w._teacherV2OnTick = _teacherV2OnTick
  }
})()
