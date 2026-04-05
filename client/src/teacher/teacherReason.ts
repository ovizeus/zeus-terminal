// Zeus — teacher/teacherReason.ts
// Ported 1:1 from public/js/teacher/teacherReason.js (Phase 7C)
// THE TEACHER — Reason Engine

const w = window as any

export function teacherWhyEntered(trade: any): any {
  if (!trade) return null
  const factors: any[] = []; const reasons = trade.entryReasons || []; const isLong = trade.side === 'LONG'
  let trendAligned = 0, momentumAligned = 0, volatilityOk = 0; const totalSignals = reasons.length
  for (let i = 0; i < reasons.length; i++) {
    const r = reasons[i]
    if (r === 'ST_FLIP_BULL' || r === 'ST_FLIP_BEAR' || r === 'REGIME_TREND' || r === 'REGIME_BREAKOUT') { trendAligned++; factors.push({ type: 'TREND', tag: r, impact: 'positive' }) }
    else if (r === 'MACD_CROSS_BULL' || r === 'MACD_CROSS_BEAR' || r === 'RSI_OVERSOLD' || r === 'RSI_OVERBOUGHT') { momentumAligned++; factors.push({ type: 'MOMENTUM', tag: r, impact: 'positive' }) }
    else if (r === 'CONFLUENCE_HIGH' || r === 'CONFLUENCE_LOW' || r === 'HIGH_ADX_TREND') { factors.push({ type: 'CONFIRMATION', tag: r, impact: 'positive' }) }
    else if (r === 'DIVERGENCE_BULL' || r === 'DIVERGENCE_BEAR') { factors.push({ type: 'REVERSAL', tag: r, impact: isLong ? (r === 'DIVERGENCE_BULL' ? 'positive' : 'negative') : (r === 'DIVERGENCE_BEAR' ? 'positive' : 'negative') }) }
    else if (r === 'BB_SQUEEZE_BREAK') { volatilityOk++; factors.push({ type: 'VOLATILITY', tag: r, impact: 'positive' }) }
    else if (r === 'LOW_ADX_RANGE' || r === 'REGIME_RANGE') { factors.push({ type: 'WARNING', tag: r, impact: 'negative' }) }
    else { factors.push({ type: 'OTHER', tag: r, impact: 'neutral' }) }
  }
  const groupsAligned = (trendAligned > 0 ? 1 : 0) + (momentumAligned > 0 ? 1 : 0) + (volatilityOk > 0 ? 1 : 0)
  const alignment = totalSignals > 0 ? Math.round((groupsAligned / 3) * 100) : 0
  const confidence = Math.min(100, totalSignals * 15 + groupsAligned * 20)
  const warnings: any[] = []
  if (totalSignals < 2) warnings.push('Few signals at entry (' + totalSignals + ')')
  if (trendAligned === 0) warnings.push('No trend confirmation')
  if (momentumAligned === 0) warnings.push('No momentum confirmation')
  for (let i = 0; i < factors.length; i++) { if (factors[i].impact === 'negative') warnings.push('Counter-signal: ' + factors[i].tag) }
  let verdict: string
  if (confidence >= 70 && warnings.length === 0) verdict = 'STRONG_ENTRY'
  else if (confidence >= 50) verdict = 'ADEQUATE_ENTRY'
  else if (confidence >= 30) verdict = 'WEAK_ENTRY'
  else verdict = 'POOR_ENTRY'
  const summary = trade.side + ' entry with ' + totalSignals + ' signals, ' + groupsAligned + '/3 groups aligned. ' + verdict + '.'
  return { summary, factors, alignment, confidence, verdict, warnings }
}

export function teacherWhyExited(trade: any): any {
  if (!trade) return null
  let exitType = 'UNKNOWN'; let wasOptimal = false; let analysis = ''
  switch (trade.exitReason) {
    case 'TP_HIT': exitType = 'TARGET'; wasOptimal = true; analysis = 'Take profit reached at $' + trade.exit.toFixed(2) + '. Planned exit executed.'; break
    case 'SL_HIT': exitType = 'STOP'; wasOptimal = false; analysis = 'Stop loss hit at $' + trade.exit.toFixed(2) + '. Risk was contained.'; break
    case 'DSL_HIT': exitType = 'TRAILING_STOP'; wasOptimal = true; analysis = 'Dynamic trailing stop activated and hit. Profit was protected.'; break
    case 'SIGNAL_FLIP': exitType = 'SIGNAL'; wasOptimal = trade.outcome === 'WIN'; analysis = 'Indicators flipped against position. ' + (trade.outcome === 'WIN' ? 'Exited with profit.' : 'Signal change came too late.'); break
    case 'REGIME_CHANGE': exitType = 'REGIME'; wasOptimal = trade.outcome !== 'LOSS'; analysis = 'Market regime changed from trend to range/volatile.'; break
    case 'CONFLUENCE_DROP': exitType = 'CONFLUENCE'; wasOptimal = trade.outcome === 'WIN'; analysis = 'Confluence score collapsed. Multi-indicator agreement lost.'; break
    case 'TIME_STOP': exitType = 'TIME'; wasOptimal = false; analysis = 'Trade held too long (' + trade.barsHeld + ' bars). Position timed out.'; break
    case 'MANUAL_EXIT': exitType = 'MANUAL'; wasOptimal = trade.outcome === 'WIN'; analysis = 'Manual exit by user. ' + (trade.outcome === 'WIN' ? 'Good judgement.' : 'Could have been avoided.'); break
    case 'MAX_BARS_EXIT': exitType = 'END_OF_DATA'; wasOptimal = false; analysis = 'Replay ended with open position. Force-closed at last bar.'; break
    default: analysis = 'Unknown exit reason: ' + trade.exitReason
  }
  let betterExit: any = null
  if (trade.exitReason === 'SL_HIT' && !trade.dslUsed) betterExit = 'DSL (trailing stop) may have captured profit before SL hit'
  if (trade.exitReason === 'TIME_STOP' && trade.pnlPct > 0) betterExit = 'Was profitable at exit — a tighter TP or DSL would have locked gains'
  const summary = exitType + ' exit: ' + trade.exitReason + ' → $' + trade.pnlNet.toFixed(2) + ' (' + trade.pnlPct.toFixed(1) + '%)'
  return { summary, exitType, wasOptimal, betterExit, analysis, pnlNet: trade.pnlNet, barsHeld: trade.barsHeld }
}

export function teacherWhyOutcome(trade: any): any {
  if (!trade) return null
  const keyFactors: any[] = []; const lessons: any[] = []; let classification = ''
  if (trade.outcome === 'WIN') {
    if (trade.exitReason === 'TP_HIT') { keyFactors.push('TP hit — market moved in predicted direction'); lessons.push('Entry signals correctly identified direction') }
    if (trade.exitReason === 'DSL_HIT') { keyFactors.push('DSL protected profits — trailed successfully'); lessons.push('Trailing stop captured majority of move') }
    if (trade.entryReasons && trade.entryReasons.length >= 3) { keyFactors.push('Strong multi-signal confluence at entry (' + trade.entryReasons.length + ' signals)'); lessons.push('High-confidence entries (3+ signals) correlate with wins') }
    if (trade.barsHeld <= 10) keyFactors.push('Quick win — captured move efficiently')
    if (trade.pnlPct >= 3) { classification = 'STRONG_WIN'; lessons.push('Excellent R:R achieved — replicate this setup') }
    else if (trade.pnlPct >= 1) classification = 'SOLID_WIN'
    else { classification = 'MARGINAL_WIN'; lessons.push('Small win — check if TP could have been wider') }
  } else if (trade.outcome === 'LOSS') {
    if (trade.exitReason === 'SL_HIT') { keyFactors.push('SL hit — market moved against position'); if (trade.entryReasons && trade.entryReasons.length < 2) { keyFactors.push('Weak entry: only ' + trade.entryReasons.length + ' signal(s)'); lessons.push('Avoid entries with < 2 confirming signals') } }
    if (trade.exitReason === 'TIME_STOP') { keyFactors.push('Held too long without resolution'); lessons.push('Consider tighter time stops or signal-based exits') }
    let hasRange = false, hasTrend = false; const reasons = trade.entryReasons || []
    for (let i = 0; i < reasons.length; i++) { if (reasons[i] === 'REGIME_RANGE' || reasons[i] === 'LOW_ADX_RANGE') hasRange = true; if (reasons[i] === 'REGIME_TREND' || reasons[i] === 'REGIME_BREAKOUT') hasTrend = true }
    if (hasRange && !hasTrend) { keyFactors.push('Entered during RANGE regime — low directional conviction'); lessons.push('Range regimes have lower win rates for directional trades') }
    if (trade.barsHeld <= 2) { keyFactors.push('Quick loss — immediate reversal after entry'); lessons.push('Quick stops suggest bad timing — wait for confirmation bar'); classification = 'QUICK_STOP' }
    else if (Math.abs(trade.pnlPct) > 3) { classification = 'HEAVY_LOSS'; lessons.push('Large loss — consider tighter SL or smaller position') }
    else { classification = 'CONTROLLED_LOSS'; lessons.push('Loss was controlled within acceptable risk') }
  } else { classification = 'BREAKEVEN'; keyFactors.push('Trade ended near entry price'); lessons.push('Breakeven often means entry timing was slightly off') }
  const summary = trade.outcome + ' (' + classification + '): ' + trade.side + ' $' + trade.pnlNet.toFixed(2) + ' (' + trade.pnlPct.toFixed(1) + '%) in ' + trade.barsHeld + ' bars. ' + keyFactors.length + ' key factor(s).'
  return { summary, keyFactors, lessons, classification, outcome: trade.outcome, pnlPct: trade.pnlPct }
}

export function teacherTradeReport(trade: any): any {
  if (!trade) return null
  return { tradeId: trade.id, side: trade.side, entry: teacherWhyEntered(trade), exit: teacherWhyExited(trade), outcome: teacherWhyOutcome(trade), quality: w.teacherScoreTrade(trade), rMultiple: w.teacherCalcRMultiple(trade) }
}

export const TEACHER_PATTERNS: any = {
  'TREND_FOLLOW':    { requires: ['REGIME_TREND', 'HIGH_ADX_TREND'], description: 'Trend-following entry in strong directional move' },
  'BREAKOUT':        { requires: ['REGIME_BREAKOUT', 'BB_SQUEEZE_BREAK'], description: 'Breakout entry from squeeze/consolidation' },
  'REVERSAL':        { requires: ['DIVERGENCE_BULL|DIVERGENCE_BEAR', 'RSI_OVERSOLD|RSI_OVERBOUGHT'], description: 'Mean-reversion entry at extreme RSI + divergence' },
  'MOMENTUM_CONF':   { requires: ['MACD_CROSS_BULL|MACD_CROSS_BEAR', 'ST_FLIP_BULL|ST_FLIP_BEAR'], description: 'MACD + SuperTrend momentum confirmation' },
  'CONFLUENCE_PLAY': { requires: ['CONFLUENCE_HIGH|CONFLUENCE_LOW'], description: 'High multi-indicator confluence entry' },
  'RANGE_TRADE':     { requires: ['REGIME_RANGE', 'LOW_ADX_RANGE'], description: 'Trade within range-bound market' },
}

export function teacherClassifyPattern(trade: any): any[] {
  if (!trade || !trade.entryReasons) return []
  const reasons = trade.entryReasons; const matched: any[] = []
  const patternNames = Object.keys(TEACHER_PATTERNS)
  for (let p = 0; p < patternNames.length; p++) {
    const name = patternNames[p]; const pat = TEACHER_PATTERNS[name]; let allMatch = true
    for (let r = 0; r < pat.requires.length; r++) {
      const alts = pat.requires[r].split('|'); let anyAltMatch = false
      for (let a = 0; a < alts.length; a++) { if (reasons.indexOf(alts[a]) !== -1) { anyAltMatch = true; break } }
      if (!anyAltMatch) { allMatch = false; break }
    }
    if (allMatch) matched.push({ name, description: pat.description })
  }
  return matched
}

export function teacherExtractLessons(trades: any): any[] {
  if (!trades || trades.length < 3) return []
  const lessons: any[] = []
  const patternStats: any = {}
  for (let i = 0; i < trades.length; i++) {
    const patterns = teacherClassifyPattern(trades[i])
    for (let p = 0; p < patterns.length; p++) {
      const name = patterns[p].name; if (!patternStats[name]) patternStats[name] = { wins: 0, losses: 0, total: 0 }
      patternStats[name].total++; if (trades[i].outcome === 'WIN') patternStats[name].wins++; else if (trades[i].outcome === 'LOSS') patternStats[name].losses++
    }
  }
  const pKeys = Object.keys(patternStats)
  for (let i = 0; i < pKeys.length; i++) {
    const ps = patternStats[pKeys[i]]
    if (ps.total >= 3) {
      const wr = (ps.wins / ps.total) * 100
      if (wr >= 70) lessons.push({ type: 'EDGE', description: pKeys[i] + ' pattern has ' + wr.toFixed(0) + '% win rate (' + ps.total + ' samples)', confidence: Math.min(90, Math.round(50 + ps.total * 5)), evidence: ps, tags: [pKeys[i]] })
      else if (wr <= 30) lessons.push({ type: 'AVOID', description: pKeys[i] + ' pattern has only ' + wr.toFixed(0) + '% win rate — consider avoiding', confidence: Math.min(90, Math.round(50 + ps.total * 5)), evidence: ps, tags: [pKeys[i]] })
    }
  }
  const exitStats: any = {}
  for (let i = 0; i < trades.length; i++) { const er = trades[i].exitReason; if (!exitStats[er]) exitStats[er] = { count: 0, avgPnl: 0, totalPnl: 0 }; exitStats[er].count++; exitStats[er].totalPnl += trades[i].pnlNet }
  const eKeys = Object.keys(exitStats)
  for (let i = 0; i < eKeys.length; i++) { exitStats[eKeys[i]].avgPnl = exitStats[eKeys[i]].totalPnl / exitStats[eKeys[i]].count; if (exitStats[eKeys[i]].count >= 2 && exitStats[eKeys[i]].avgPnl < -5) lessons.push({ type: 'MISTAKE', description: eKeys[i] + ' exits average $' + exitStats[eKeys[i]].avgPnl.toFixed(2) + ' — investigate', confidence: 60, evidence: exitStats[eKeys[i]], tags: [eKeys[i]] }) }
  let quickWins = 0, quickLosses = 0, longHolds = 0
  for (let i = 0; i < trades.length; i++) { if (trades[i].barsHeld <= 3) { if (trades[i].outcome === 'WIN') quickWins++; else if (trades[i].outcome === 'LOSS') quickLosses++ }; if (trades[i].barsHeld > 50) longHolds++ }
  if (quickLosses >= 3 && quickLosses > quickWins * 2) lessons.push({ type: 'TIMING', description: 'Many quick stops (' + quickLosses + '). Consider waiting for confirmation bar before entry.', confidence: 70, evidence: { quickWins, quickLosses }, tags: ['TIMING', 'QUICK_STOP'] })
  if (longHolds >= 2) lessons.push({ type: 'TIMING', description: longHolds + ' trades held 50+ bars. Use tighter time stops or signal exits.', confidence: 60, evidence: { longHolds }, tags: ['TIMING', 'LONG_HOLD'] })
  const regimeWins: any = { TREND: 0, RANGE: 0, BREAKOUT: 0, VOLATILE: 0 }; const regimeLosses: any = { TREND: 0, RANGE: 0, BREAKOUT: 0, VOLATILE: 0 }
  for (let i = 0; i < trades.length; i++) { const reasons = trades[i].entryReasons || []; let regime: any = null; for (let j = 0; j < reasons.length; j++) { if (reasons[j] === 'REGIME_TREND') regime = 'TREND'; else if (reasons[j] === 'REGIME_BREAKOUT') regime = 'BREAKOUT'; else if (reasons[j] === 'REGIME_RANGE') regime = 'RANGE' }; if (regime) { if (trades[i].outcome === 'WIN') regimeWins[regime]++; else if (trades[i].outcome === 'LOSS') regimeLosses[regime]++ } }
  const regKeys = Object.keys(regimeWins)
  for (let i = 0; i < regKeys.length; i++) { const rw = regimeWins[regKeys[i]], rl = regimeLosses[regKeys[i]], rt = rw + rl; if (rt >= 3) { const rwr = (rw / rt) * 100; if (rwr >= 70) lessons.push({ type: 'REGIME', description: regKeys[i] + ' regime trades: ' + rwr.toFixed(0) + '% win rate (' + rt + ' trades)', confidence: Math.min(85, 50 + rt * 5), evidence: { wins: rw, losses: rl }, tags: ['REGIME_' + regKeys[i]] }); else if (rwr <= 30) lessons.push({ type: 'REGIME', description: 'Poor performance in ' + regKeys[i] + ' regime: ' + rwr.toFixed(0) + '% — avoid this regime', confidence: Math.min(85, 50 + rt * 5), evidence: { wins: rw, losses: rl }, tags: ['REGIME_' + regKeys[i]] }) } }
  return lessons
}

export function teacherCompareTrades(tradeA: any, tradeB: any): any {
  if (!tradeA || !tradeB) return null
  const diffs: any[] = [], sims: any[] = []
  if (tradeA.side === tradeB.side) sims.push('Same direction: ' + tradeA.side); else diffs.push('Different sides: ' + tradeA.side + ' vs ' + tradeB.side)
  if (tradeA.outcome === tradeB.outcome) sims.push('Same outcome: ' + tradeA.outcome); else diffs.push('Different outcomes: ' + tradeA.outcome + ' vs ' + tradeB.outcome)
  const sigA = (tradeA.entryReasons || []).length, sigB = (tradeB.entryReasons || []).length
  if (Math.abs(sigA - sigB) <= 1) sims.push('Similar signal count: ' + sigA + ' vs ' + sigB); else diffs.push('Signal count: ' + sigA + ' vs ' + sigB)
  diffs.push('PnL: $' + tradeA.pnlNet.toFixed(2) + ' vs $' + tradeB.pnlNet.toFixed(2))
  diffs.push('Duration: ' + tradeA.barsHeld + ' vs ' + tradeB.barsHeld + ' bars')
  if (tradeA.exitReason === tradeB.exitReason) sims.push('Same exit: ' + tradeA.exitReason); else diffs.push('Exit: ' + tradeA.exitReason + ' vs ' + tradeB.exitReason)
  const scoreA = w.teacherScoreTrade(tradeA).score, scoreB = w.teacherScoreTrade(tradeB).score
  return { differences: diffs, similarities: sims, betterTrade: scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'TIE', scoreA, scoreB }
}

;(function _teacherReasonGlobals() {
  if (typeof window !== 'undefined') {
    w.teacherWhyEntered = teacherWhyEntered; w.teacherWhyExited = teacherWhyExited; w.teacherWhyOutcome = teacherWhyOutcome
    w.teacherTradeReport = teacherTradeReport; w.TEACHER_PATTERNS = TEACHER_PATTERNS; w.teacherClassifyPattern = teacherClassifyPattern
    w.teacherExtractLessons = teacherExtractLessons; w.teacherCompareTrades = teacherCompareTrades
  }
})()
