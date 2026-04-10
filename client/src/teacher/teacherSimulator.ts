// Zeus — teacher/teacherSimulator.ts
// Ported 1:1 from public/js/teacher/teacherSimulator.js (Phase 7C)
// THE TEACHER — Enhanced trade lifecycle
n// [8E-3] w.TEACHER reads migrated to getTeacher()
import { getTeacher } from '../services/stateAccessors'

const w = window as any

// ══════════════════════════════════════════════════════════════════
// EQUITY CURVE
// ══════════════════════════════════════════════════════════════════

export function teacherInitEquity(): void {
  const T = getTeacher()
  if (!T) return
  T._equity = {
    startCapital: T.config.capitalUSD,
    capital: T.config.capitalUSD,
    curve: [{ bar: T.cursor, capital: T.config.capitalUSD, pnl: 0 }],
    peak: T.config.capitalUSD,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    currentDD: 0,
    currentDDPct: 0,
    tradeEquity: [],
  }
}

export function _teacherUpdateEquity(closedTrade: any): void {
  const T = getTeacher()
  if (!T || !T._equity) return
  const eq = T._equity
  eq.capital += closedTrade.pnlNet
  eq.curve.push({ bar: closedTrade.exitBar, capital: parseFloat(eq.capital.toFixed(2)), pnl: closedTrade.pnlNet, tradeId: closedTrade.id })
  eq.tradeEquity.push({ tradeNum: T.trades.length, capital: parseFloat(eq.capital.toFixed(2)), pnlNet: closedTrade.pnlNet, outcome: closedTrade.outcome })
  if (eq.capital > eq.peak) eq.peak = eq.capital
  eq.currentDD = eq.peak - eq.capital
  eq.currentDDPct = eq.peak > 0 ? (eq.currentDD / eq.peak) * 100 : 0
  if (eq.currentDD > eq.maxDrawdown) {
    eq.maxDrawdown = parseFloat(eq.currentDD.toFixed(2))
    eq.maxDrawdownPct = parseFloat(eq.currentDDPct.toFixed(2))
  }
}

export function teacherGetEquity(): any {
  const T = getTeacher()
  if (!T || !T._equity) return null
  const eq = T._equity
  return {
    startCapital: eq.startCapital,
    currentCapital: parseFloat(eq.capital.toFixed(2)),
    returnPct: eq.startCapital > 0 ? parseFloat(((eq.capital - eq.startCapital) / eq.startCapital * 100).toFixed(2)) : 0,
    peak: parseFloat(eq.peak.toFixed(2)),
    maxDrawdown: eq.maxDrawdown,
    maxDrawdownPct: eq.maxDrawdownPct,
    currentDD: parseFloat(eq.currentDD.toFixed(2)),
    currentDDPct: parseFloat(eq.currentDDPct.toFixed(2)),
    curveLength: eq.curve.length,
    tradeEquity: eq.tradeEquity,
  }
}

// ══════════════════════════════════════════════════════════════════
// SIGNAL-BASED EXIT
// ══════════════════════════════════════════════════════════════════

export function teacherCheckSignalExit(): any {
  const T = getTeacher()
  if (!T || !T.openTrade) return null
  const trade = T.openTrade
  const ind = T.indicators
  if (!ind) return null
  const isLong = trade.side === 'LONG'
  if (ind.macdDir) {
    if (isLong && ind.macdDir === 'bear') return 'SIGNAL_FLIP'
    if (!isLong && ind.macdDir === 'bull') return 'SIGNAL_FLIP'
  }
  if (ind.stDir && ind.stDir !== 'neut') {
    if (isLong && ind.stDir === 'bear') return 'SIGNAL_FLIP'
    if (!isLong && ind.stDir === 'bull') return 'SIGNAL_FLIP'
  }
  if (ind.confluence !== null && ind.confluence !== undefined) {
    if (isLong && ind.confluence <= 30) return 'CONFLUENCE_DROP'
    if (!isLong && ind.confluence >= 70) return 'CONFLUENCE_DROP'
  }
  if (ind.regime) {
    let entryHadTrend = false
    for (let i = 0; i < trade.entryReasons.length; i++) {
      if (trade.entryReasons[i] === 'REGIME_TREND' || trade.entryReasons[i] === 'REGIME_BREAKOUT') { entryHadTrend = true; break }
    }
    if (entryHadTrend && (ind.regime === 'RANGE' || ind.regime === 'VOLATILE')) return 'REGIME_CHANGE'
  }
  return null
}

// ══════════════════════════════════════════════════════════════════
// TIME STOP
// ══════════════════════════════════════════════════════════════════

let TEACHER_MAX_BARS_IN_TRADE = 100

export function teacherSetMaxBarsInTrade(n: any): void {
  TEACHER_MAX_BARS_IN_TRADE = Math.max(5, Math.min(500, n || 100))
}

export function teacherCheckTimeStop(): any {
  const T = getTeacher()
  if (!T || !T.openTrade) return null
  const barsHeld = T.cursor - T.openTrade.entryBar
  if (barsHeld >= TEACHER_MAX_BARS_IN_TRADE) return 'TIME_STOP'
  return null
}

// ══════════════════════════════════════════════════════════════════
// ENHANCED STEP
// ══════════════════════════════════════════════════════════════════

export function teacherEnhancedStep(opts?: any): any {
  opts = opts || {}
  const signalExits = opts.signalExits !== false
  const timeStop = opts.timeStop !== false

  const tick = w.teacherStep(1)
  if (!tick) return null

  const T = getTeacher()

  if (tick.openTrade === null && T.trades.length > 0) {
    const lastClosed = T.trades[T.trades.length - 1]
    if (lastClosed && lastClosed.exitBar === T.cursor) {
      _teacherUpdateEquity(lastClosed)
    }
  }

  if (T.openTrade) {
    let exitReason: any = null
    if (signalExits && !exitReason) exitReason = teacherCheckSignalExit()
    if (timeStop && !exitReason) exitReason = teacherCheckTimeStop()
    if (exitReason) {
      const bar = T.dataset.bars[T.cursor]
      const closed = w._teacherCloseTrade(bar.close, exitReason, { bar: bar, barIndex: T.cursor })
      if (closed) {
        _teacherUpdateEquity(closed)
        tick.closedTrade = closed
        tick.openTrade = null
      }
    }
  }

  return tick
}

// ══════════════════════════════════════════════════════════════════
// POSITION SIZING MODELS
// ══════════════════════════════════════════════════════════════════

export function teacherSizeFixedFraction(capitalUSD: any, riskPct: any, slDistancePct: any, entryPrice: any, maxLeverage?: any): any {
  if (!capitalUSD || !slDistancePct || !entryPrice) return null
  maxLeverage = maxLeverage || w.TEACHER_TRADE_DEFAULTS.maxLeverage
  const riskUSD = capitalUSD * (riskPct / 100)
  let qty = riskUSD / (entryPrice * slDistancePct / 100)
  let notional = qty * entryPrice
  const leverage = Math.min(maxLeverage, Math.max(1, Math.round(notional / capitalUSD)))
  notional = capitalUSD * leverage
  qty = notional / entryPrice
  return { leverage: leverage, qty: parseFloat(qty.toFixed(6)), notional: parseFloat(notional.toFixed(2)), riskUSD: parseFloat(riskUSD.toFixed(2)) }
}

export function teacherSizeKelly(winRate: any, avgWinLossRatio: any, capitalUSD: any, entryPrice: any, maxLeverage?: any): any {
  if (winRate == null || !avgWinLossRatio || !capitalUSD || !entryPrice) return null
  maxLeverage = maxLeverage || w.TEACHER_TRADE_DEFAULTS.maxLeverage
  const kellyFull = (winRate * avgWinLossRatio - (1 - winRate)) / avgWinLossRatio
  const kellyPct = Math.max(0, Math.min(25, kellyFull * 50))
  let notional = capitalUSD * (kellyPct / 100) * 10
  const leverage = Math.min(maxLeverage, Math.max(1, Math.round(notional / capitalUSD)))
  notional = capitalUSD * leverage
  const qty = notional / entryPrice
  return { kellyPct: parseFloat(kellyPct.toFixed(2)), leverage: leverage, qty: parseFloat(qty.toFixed(6)), notional: parseFloat(notional.toFixed(2)) }
}

// ══════════════════════════════════════════════════════════════════
// MISSED TRADE DETECTION
// ══════════════════════════════════════════════════════════════════

export function teacherFindMissedTrades(dataset: any, trades: any, opts?: any): any[] {
  if (!dataset || !dataset.bars) return []
  opts = opts || {}
  const minConf = opts.minConfluence || 65
  const minADX = opts.minADX || 25
  const minBars = w.TEACHER_REPLAY_DEFAULTS.lookback
  const tradedBars: any = {}
  for (let t = 0; t < trades.length; t++) {
    for (let b = trades[t].entryBar; b <= trades[t].exitBar; b++) tradedBars[b] = true
  }
  const missed: any[] = []
  for (let i = minBars; i < dataset.bars.length; i++) {
    if (tradedBars[i]) continue
    const visibleBars = dataset.bars.slice(0, i + 1)
    const ind = w.teacherComputeIndicators(visibleBars)
    if (ind.confluence >= minConf && ind.stDir === 'bull' && ind.macdDir === 'bull') {
      if (ind.adx !== null && ind.adx >= minADX) {
        missed.push({ barIndex: i, bar: dataset.bars[i], side: 'LONG', reasons: w._teacherAutoTagEntry('LONG', ind), confluence: ind.confluence, indicators: ind })
        i += 5; continue
      }
    }
    if (ind.confluence <= (100 - minConf) && ind.stDir === 'bear' && ind.macdDir === 'bear') {
      if (ind.adx !== null && ind.adx >= minADX) {
        missed.push({ barIndex: i, bar: dataset.bars[i], side: 'SHORT', reasons: w._teacherAutoTagEntry('SHORT', ind), confluence: ind.confluence, indicators: ind })
        i += 5; continue
      }
    }
  }
  return missed
}

// ══════════════════════════════════════════════════════════════════
// TRADE QUALITY SCORE
// ══════════════════════════════════════════════════════════════════

export function teacherScoreTrade(trade: any): any {
  if (!trade) return { score: 0, components: {}, grade: 'F' }
  const components: any = {}
  let total = 0, count = 0
  const entryScore = Math.min(100, (trade.entryReasons ? trade.entryReasons.length : 0) * 20)
  components.entryAlignment = entryScore; total += entryScore; count++
  let rrAchieved = 0
  if (trade.outcome === 'WIN' && trade.pnlNet > 0) {
    const potentialLoss = Math.abs(trade.entry - trade.sl) * trade.qty
    if (potentialLoss > 0) rrAchieved = trade.pnlRaw / potentialLoss
  }
  const rrScore = Math.min(100, Math.round(rrAchieved * 40))
  components.riskReward = rrScore; total += rrScore; count++
  let exitScore = 0
  if (trade.exitReason === 'TP_HIT') exitScore = 100
  else if (trade.exitReason === 'DSL_HIT') exitScore = 80
  else if (trade.exitReason === 'SIGNAL_FLIP') exitScore = 70
  else if (trade.exitReason === 'MANUAL_EXIT') exitScore = 50
  else if (trade.exitReason === 'REGIME_CHANGE') exitScore = 60
  else if (trade.exitReason === 'TIME_STOP') exitScore = 30
  else if (trade.exitReason === 'SL_HIT') exitScore = 20
  else if (trade.exitReason === 'MAX_BARS_EXIT') exitScore = 10
  components.exitQuality = exitScore; total += exitScore; count++
  let effScore = 0
  if (trade.pnlPct > 5) effScore = 100
  else if (trade.pnlPct > 2) effScore = 80
  else if (trade.pnlPct > 0) effScore = 60
  else if (trade.pnlPct > -1) effScore = 40
  else effScore = 10
  components.pnlEfficiency = effScore; total += effScore; count++
  let barsScore = 0
  const bh = trade.barsHeld || 0
  if (bh >= 5 && bh <= 30) barsScore = 100
  else if (bh >= 3 && bh <= 50) barsScore = 70
  else if (bh >= 1 && bh <= 80) barsScore = 40
  else barsScore = 10
  components.holdDuration = barsScore; total += barsScore; count++
  const finalScore = count > 0 ? Math.round(total / count) : 0
  const grade = finalScore >= 80 ? 'A' : finalScore >= 65 ? 'B' : finalScore >= 50 ? 'C' : finalScore >= 35 ? 'D' : 'F'
  return { score: finalScore, components: components, grade: grade }
}

// ══════════════════════════════════════════════════════════════════
// STREAK TRACKER
// ══════════════════════════════════════════════════════════════════

export function teacherCalcStreaks(trades: any): any {
  if (!trades || !trades.length) return { currentStreak: 0, currentType: null, maxWinStreak: 0, maxLossStreak: 0 }
  let curType: any = null, curLen = 0, maxWin = 0, maxLoss = 0
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i]
    if (t.outcome === 'WIN') {
      if (curType === 'WIN') curLen++; else { curType = 'WIN'; curLen = 1 }
      if (curLen > maxWin) maxWin = curLen
    } else if (t.outcome === 'LOSS') {
      if (curType === 'LOSS') curLen++; else { curType = 'LOSS'; curLen = 1 }
      if (curLen > maxLoss) maxLoss = curLen
    } else { curType = null; curLen = 0 }
  }
  return { currentStreak: curLen, currentType: curType, maxWinStreak: maxWin, maxLossStreak: maxLoss }
}

// ══════════════════════════════════════════════════════════════════
// R-MULTIPLE
// ══════════════════════════════════════════════════════════════════

export function teacherCalcRMultiple(trade: any): any {
  if (!trade || !trade.entry || !trade.sl) return null
  const riskPerUnit = Math.abs(trade.entry - trade.sl)
  if (riskPerUnit === 0) return null
  const rDollar = riskPerUnit * trade.qty
  const rMultiple = rDollar > 0 ? trade.pnlRaw / rDollar : 0
  return { rDollar: parseFloat(rDollar.toFixed(2)), rMultiple: parseFloat(rMultiple.toFixed(2)), pnlInR: parseFloat(rMultiple.toFixed(2)) }
}

// ══════════════════════════════════════════════════════════════════
// FULL SESSION ANALYTICS
// ══════════════════════════════════════════════════════════════════

export function teacherFullSessionAnalytics(): any {
  const T = getTeacher()
  if (!T) return null
  const trades = T.trades
  const equity = teacherGetEquity()
  const streaks = teacherCalcStreaks(trades)
  const scores: any[] = []
  const rMultiples: any[] = []
  let totalR = 0
  for (let i = 0; i < trades.length; i++) {
    const sc = teacherScoreTrade(trades[i])
    scores.push({ tradeId: trades[i].id, score: sc.score, grade: sc.grade })
    trades[i]._quality = sc
    const rm = teacherCalcRMultiple(trades[i])
    if (rm) { rMultiples.push(rm.rMultiple); totalR += rm.rMultiple; trades[i]._rMultiple = rm }
  }
  const exitBreakdown: any = {}
  for (let i = 0; i < trades.length; i++) {
    const reason = trades[i].exitReason || 'UNKNOWN'
    if (!exitBreakdown[reason]) exitBreakdown[reason] = { count: 0, totalPnl: 0 }
    exitBreakdown[reason].count++; exitBreakdown[reason].totalPnl += trades[i].pnlNet
  }
  const ebKeys = Object.keys(exitBreakdown)
  for (let i = 0; i < ebKeys.length; i++) exitBreakdown[ebKeys[i]].totalPnl = parseFloat(exitBreakdown[ebKeys[i]].totalPnl.toFixed(2))
  const entryReasonFreq: any = {}
  for (let i = 0; i < trades.length; i++) {
    const reasons = trades[i].entryReasons || []
    for (let j = 0; j < reasons.length; j++) {
      if (!entryReasonFreq[reasons[j]]) entryReasonFreq[reasons[j]] = { count: 0, wins: 0, losses: 0 }
      entryReasonFreq[reasons[j]].count++
      if (trades[i].outcome === 'WIN') entryReasonFreq[reasons[j]].wins++
      else if (trades[i].outcome === 'LOSS') entryReasonFreq[reasons[j]].losses++
    }
  }
  let avgScore = 0
  for (let i = 0; i < scores.length; i++) avgScore += scores[i].score
  avgScore = scores.length > 0 ? Math.round(avgScore / scores.length) : 0
  const avgR = rMultiples.length > 0 ? parseFloat((totalR / rMultiples.length).toFixed(2)) : 0
  return { equity, streaks, scores, avgTradeQuality: avgScore, rMultiples, avgR, totalR: parseFloat(totalR.toFixed(2)), exitBreakdown, entryReasonFreq }
}

// Attach to window
;(function _teacherSimulatorGlobals() {
  if (typeof window !== 'undefined') {
    w.teacherInitEquity = teacherInitEquity
    w._teacherUpdateEquity = _teacherUpdateEquity
    w.teacherGetEquity = teacherGetEquity
    w.teacherCheckSignalExit = teacherCheckSignalExit
    w.teacherSetMaxBarsInTrade = teacherSetMaxBarsInTrade
    w.teacherCheckTimeStop = teacherCheckTimeStop
    w.teacherEnhancedStep = teacherEnhancedStep
    w.teacherSizeFixedFraction = teacherSizeFixedFraction
    w.teacherSizeKelly = teacherSizeKelly
    w.teacherFindMissedTrades = teacherFindMissedTrades
    w.teacherScoreTrade = teacherScoreTrade
    w.teacherCalcStreaks = teacherCalcStreaks
    w.teacherCalcRMultiple = teacherCalcRMultiple
    w.teacherFullSessionAnalytics = teacherFullSessionAnalytics
  }
})()
