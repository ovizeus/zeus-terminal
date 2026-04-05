// Zeus — teacher/teacherStats.ts
// Ported 1:1 from public/js/teacher/teacherStats.js (Phase 7C)
// THE TEACHER — Aggregated statistics across sessions

const w = window as any

function _r2(n: any): any {
  if (!isFinite(n)) return n === Infinity ? 999 : (n === -Infinity ? -999 : 0)
  return parseFloat(n.toFixed(2))
}

function _teacherEmptyStats(): any {
  return {
    totalTrades: 0, wins: 0, losses: 0, breakevens: 0, winRate: 0,
    totalPnl: 0, totalPnlPct: 0, avgPnl: 0, avgPnlPct: 0,
    grossWins: 0, grossLosses: 0, profitFactor: 0, expectancy: 0,
    avgWin: 0, avgLoss: 0, wlRatio: 0, avgBarsHeld: 0, totalFees: 0,
    bestTrade: { id: null, pnl: 0 }, worstTrade: { id: null, pnl: 0 },
    longWinRate: 0, shortWinRate: 0,
  }
}

export function teacherComputeStats(trades: any): any {
  if (!trades || trades.length === 0) return _teacherEmptyStats()
  let wins = 0, losses = 0, breakevens = 0
  let totalPnl = 0, totalPnlPct = 0, grossWins = 0, grossLosses = 0
  let bestPnl = -Infinity, worstPnl = Infinity
  let bestTrade: any = null, worstTrade: any = null
  let totalBars = 0, totalFees = 0
  let longWins = 0, longLosses = 0, shortWins = 0, shortLosses = 0
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i]
    totalPnl += t.pnlNet; totalPnlPct += t.pnlPct; totalBars += t.barsHeld || 0; totalFees += t.totalFees || 0
    if (t.outcome === 'WIN') { wins++; grossWins += t.pnlNet; if (t.side === 'LONG') longWins++; else shortWins++ }
    else if (t.outcome === 'LOSS') { losses++; grossLosses += Math.abs(t.pnlNet); if (t.side === 'LONG') longLosses++; else shortLosses++ }
    else breakevens++
    if (t.pnlNet > bestPnl) { bestPnl = t.pnlNet; bestTrade = t.id }
    if (t.pnlNet < worstPnl) { worstPnl = t.pnlNet; worstTrade = t.id }
  }
  const total = trades.length
  const winRate = total > 0 ? (wins / total) * 100 : 0
  const avgPnl = total > 0 ? totalPnl / total : 0
  const avgBars = total > 0 ? totalBars / total : 0
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : (grossWins > 0 ? Infinity : 0)
  const expectancy = total > 0 ? totalPnl / total : 0
  const avgWin = wins > 0 ? grossWins / wins : 0
  const avgLoss = losses > 0 ? grossLosses / losses : 0
  const wlRatio = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0)
  return {
    totalTrades: total, wins, losses, breakevens, winRate: _r2(winRate),
    totalPnl: _r2(totalPnl), totalPnlPct: _r2(totalPnlPct), avgPnl: _r2(avgPnl),
    avgPnlPct: _r2(total > 0 ? totalPnlPct / total : 0),
    grossWins: _r2(grossWins), grossLosses: _r2(grossLosses), profitFactor: _r2(profitFactor),
    expectancy: _r2(expectancy), avgWin: _r2(avgWin), avgLoss: _r2(avgLoss), wlRatio: _r2(wlRatio),
    avgBarsHeld: _r2(avgBars), totalFees: _r2(totalFees),
    bestTrade: { id: bestTrade, pnl: _r2(bestPnl) }, worstTrade: { id: worstTrade, pnl: _r2(worstPnl) },
    longWinRate: _r2((longWins + longLosses) > 0 ? (longWins / (longWins + longLosses)) * 100 : 0),
    shortWinRate: _r2((shortWins + shortLosses) > 0 ? (shortWins / (shortWins + shortLosses)) * 100 : 0),
  }
}

export function teacherGroupStats(trades: any, keyFn: any): any {
  if (!trades || !keyFn) return {}
  const groups: any = {}
  for (let i = 0; i < trades.length; i++) {
    let key = keyFn(trades[i]); if (!key) key = 'UNKNOWN'
    if (!groups[key]) groups[key] = []; groups[key].push(trades[i])
  }
  const result: any = {}
  const keys = Object.keys(groups)
  for (let i = 0; i < keys.length; i++) result[keys[i]] = teacherComputeStats(groups[keys[i]])
  return result
}

export function teacherStatsBySide(trades: any): any { return teacherGroupStats(trades, function (t: any) { return t.side }) }
export function teacherStatsByExitReason(trades: any): any { return teacherGroupStats(trades, function (t: any) { return t.exitReason }) }
export function teacherStatsByRegime(trades: any): any {
  return teacherGroupStats(trades, function (t: any) {
    const reasons = t.entryReasons || []
    for (let i = 0; i < reasons.length; i++) {
      if (reasons[i] === 'REGIME_TREND') return 'TREND'
      if (reasons[i] === 'REGIME_BREAKOUT') return 'BREAKOUT'
      if (reasons[i] === 'REGIME_RANGE') return 'RANGE'
    }
    return 'UNKNOWN'
  })
}
export function teacherStatsByPattern(trades: any): any {
  return teacherGroupStats(trades, function (t: any) {
    const pats = w.teacherClassifyPattern(t)
    return pats.length > 0 ? pats[0].name : 'UNCLASSIFIED'
  })
}

export function teacherRollingStats(trades: any, n?: any): any {
  if (!trades || trades.length === 0) return _teacherEmptyStats()
  n = n || 20
  const win = trades.slice(-n)
  return teacherComputeStats(win)
}

export function teacherCompareSessionStats(sessionStats: any, overallStats: any): any {
  if (!sessionStats || !overallStats) return { improvements: [], regressions: [], neutral: [] }
  const imp: any[] = [], reg: any[] = [], neu: any[] = []
  const fields = [
    { key: 'winRate', label: 'Win Rate', higher: true },
    { key: 'profitFactor', label: 'Profit Factor', higher: true },
    { key: 'avgPnl', label: 'Avg PnL', higher: true },
    { key: 'avgBarsHeld', label: 'Avg Hold Time', higher: false },
    { key: 'wlRatio', label: 'Win/Loss Ratio', higher: true },
    { key: 'expectancy', label: 'Expectancy', higher: true },
  ]
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    const sv = sessionStats[f.key] || 0; const ov = overallStats[f.key] || 0
    const diff = sv - ov
    const diffPct = ov !== 0 ? (diff / Math.abs(ov)) * 100 : (diff > 0 ? 100 : (diff < 0 ? -100 : 0))
    const item = { key: f.key, label: f.label, session: sv, overall: ov, diff: _r2(diff), diffPct: _r2(diffPct) }
    if (Math.abs(diffPct) < 5) neu.push(item)
    else if ((f.higher && diff > 0) || (!f.higher && diff < 0)) imp.push(item)
    else reg.push(item)
  }
  return { improvements: imp, regressions: reg, neutral: neu }
}

export function teacherAggregateStats(sessions: any): any {
  if (!sessions || sessions.length === 0) return _teacherEmptyStats()
  const allTrades: any[] = []
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]
    if (s.trades && Array.isArray(s.trades)) for (let j = 0; j < s.trades.length; j++) allTrades.push(s.trades[j])
  }
  const stats = teacherComputeStats(allTrades)
  stats.sessionCount = sessions.length; stats.tradeCount = allTrades.length
  return stats
}

export function teacherPnlDistribution(trades: any, bucketSize?: any): any[] {
  if (!trades || trades.length === 0) return []
  bucketSize = bucketSize || 5
  const buckets: any = {}
  for (let i = 0; i < trades.length; i++) {
    const pnl = trades[i].pnlNet; const key = Math.floor(pnl / bucketSize) * bucketSize
    if (!buckets[key]) buckets[key] = 0; buckets[key]++
  }
  const result: any[] = []
  const keys = Object.keys(buckets).map(Number).sort(function (a: any, b: any) { return a - b })
  for (let i = 0; i < keys.length; i++) result.push({ from: keys[i], to: keys[i] + bucketSize, count: buckets[keys[i]] })
  return result
}

export function teacherHourlyPerformance(trades: any): any[] {
  const hours: any[] = []
  for (let h = 0; h < 24; h++) hours.push({ hour: h, trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 })
  if (!trades) return hours
  for (let i = 0; i < trades.length; i++) {
    const ts = trades[i].entryTs; if (!ts) continue
    const d = new Date(ts > 1e12 ? ts : ts * 1000)
    const h = d.getUTCHours()
    hours[h].trades++; hours[h].totalPnl += trades[i].pnlNet || 0
    if (trades[i].outcome === 'WIN') hours[h].wins++; else if (trades[i].outcome === 'LOSS') hours[h].losses++
  }
  for (let h = 0; h < 24; h++) {
    hours[h].totalPnl = _r2(hours[h].totalPnl)
    hours[h].winRate = hours[h].trades > 0 ? _r2((hours[h].wins / hours[h].trades) * 100) : 0
  }
  return hours
}

export function teacherTopTrades(trades: any, n?: any): any[] {
  if (!trades || trades.length === 0) return []; n = n || 5
  return trades.slice().sort(function (a: any, b: any) { return b.pnlNet - a.pnlNet }).slice(0, n)
}

export function teacherBottomTrades(trades: any, n?: any): any[] {
  if (!trades || trades.length === 0) return []; n = n || 5
  return trades.slice().sort(function (a: any, b: any) { return a.pnlNet - b.pnlNet }).slice(0, n)
}

// Attach to window
;(function _teacherStatsGlobals() {
  if (typeof window !== 'undefined') {
    w.teacherComputeStats = teacherComputeStats
    w.teacherGroupStats = teacherGroupStats
    w.teacherStatsBySide = teacherStatsBySide
    w.teacherStatsByExitReason = teacherStatsByExitReason
    w.teacherStatsByRegime = teacherStatsByRegime
    w.teacherStatsByPattern = teacherStatsByPattern
    w.teacherRollingStats = teacherRollingStats
    w.teacherCompareSessionStats = teacherCompareSessionStats
    w.teacherAggregateStats = teacherAggregateStats
    w.teacherPnlDistribution = teacherPnlDistribution
    w.teacherHourlyPerformance = teacherHourlyPerformance
    w.teacherTopTrades = teacherTopTrades
    w.teacherBottomTrades = teacherBottomTrades
  }
})()
