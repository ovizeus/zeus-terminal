// Zeus — teacher/teacherBrain.ts
// Ported 1:1 from public/js/teacher/teacherBrain.js (Phase 7C)
// TEACHER V2 — Autonomous Decision Brain

const w = window as any

// ══════════════════════════════════════════════════════════════════
// PROFILE DEFINITIONS — FAST / SWING / DEFENSE
// ══════════════════════════════════════════════════════════════════

export const TEACHER_PROFILES: any = {
  FAST: {
    name: 'FAST', slPct: 0.5, tpPct: 1.0, leverageX: 10, dslEnabled: true,
    dslActivation: 0.3, dslTrailPct: 0.2, maxBarsInTrade: 30, feeProfile: 'fast',
    orderType: 'MARKET', minADX: 20, minConfluence: 55, rsiOversold: 35, rsiOverbought: 65,
    preferredRegimes: ['TREND', 'EXPANSION', 'RECOVERY'], avoidRegimes: ['CAPITULATION'],
  },
  SWING: {
    name: 'SWING', slPct: 1.5, tpPct: 3.0, leverageX: 5, dslEnabled: true,
    dslActivation: 1.0, dslTrailPct: 0.5, maxBarsInTrade: 80, feeProfile: 'swing',
    orderType: 'MARKET', minADX: 18, minConfluence: 60, rsiOversold: 30, rsiOverbought: 70,
    preferredRegimes: ['TREND', 'RANGE', 'RECOVERY'], avoidRegimes: ['CAPITULATION'],
  },
  DEFENSE: {
    name: 'DEFENSE', slPct: 0.8, tpPct: 1.6, leverageX: 3, dslEnabled: true,
    dslActivation: 0.5, dslTrailPct: 0.3, maxBarsInTrade: 50, feeProfile: 'defensive',
    orderType: 'MARKET', minADX: 15, minConfluence: 65, rsiOversold: 28, rsiOverbought: 72,
    preferredRegimes: ['RANGE', 'SQUEEZE', 'RECOVERY'], avoidRegimes: ['CAPITULATION', 'EXPANSION'],
  },
}

// ══════════════════════════════════════════════════════════════════
// REGIME DETECTION (V2 — enhanced, 6 regimes)
// ══════════════════════════════════════════════════════════════════

export function teacherDetectRegimeV2(ind: any, bars: any): any {
  if (!ind || !bars || bars.length < 30) {
    return { regime: 'RANGE', confidence: 30, volatilityState: 'normal', trendBias: 'neutral' }
  }

  const adx = ind.adx
  const rsi = ind.rsi
  const atr = ind.atr
  const squeeze = ind.bbSqueeze
  const bbBandwidth = ind.bbBandwidth || 0
  const macdDir = ind.macdDir
  const stDir = ind.stDir
  const climax = ind.climax
  const wickChaos = ind.wickChaos || 0

  // Calculate recent price velocity (20 bars)
  const recentBars = bars.slice(-20)
  const priceChange20 = recentBars.length >= 2
    ? (recentBars[recentBars.length - 1].close - recentBars[0].close) / recentBars[0].close * 100
    : 0
  const absPriceChange20 = Math.abs(priceChange20)

  // Calculate ATR% for volatility state
  const lastClose = bars[bars.length - 1].close
  const atrPct = (atr && lastClose > 0) ? (atr / lastClose) * 100 : 0

  // Volatility state
  let volatilityState = 'normal'
  if (atrPct > 2.0) volatilityState = 'extreme'
  else if (atrPct > 1.0) volatilityState = 'high'
  else if (atrPct < 0.3) volatilityState = 'low'

  // Trend bias
  let trendBias = 'neutral'
  if (macdDir === 'bull' && stDir === 'bull') trendBias = 'bullish'
  else if (macdDir === 'bear' && stDir === 'bear') trendBias = 'bearish'
  else if (macdDir === 'bull' || stDir === 'bull') trendBias = 'lean_bull'
  else if (macdDir === 'bear' || stDir === 'bear') trendBias = 'lean_bear'

  // BB bandwidth expansion rate
  let bbExpanding = false
  if (bars.length >= 30 && ind.bbUpper && ind.bbLower && ind.bbMiddle) {
    const curBW = (ind.bbUpper - ind.bbLower) / ind.bbMiddle * 100
    let avgBW = 0
    let bwSamples = 0
    for (let bi = Math.max(0, bars.length - 30); bi < bars.length - 1; bi++) {
      const bHigh = bars[bi].high
      const bLow = bars[bi].low
      const bMid = (bHigh + bLow) / 2
      if (bMid > 0) { avgBW += (bHigh - bLow) / bMid * 100; bwSamples++ }
    }
    if (bwSamples > 0) {
      avgBW /= bwSamples
      bbExpanding = curBW > avgBW * 1.5
    }
  }

  // suppress unused warnings
  void squeeze; void bbBandwidth; void rsi

  // ── CAPITULATION check ──
  if (volatilityState === 'extreme' && climax && wickChaos >= 60 && absPriceChange20 > 5) {
    return { regime: 'CAPITULATION', confidence: 80, volatilityState: volatilityState, trendBias: trendBias }
  }
  if (volatilityState === 'extreme' && absPriceChange20 > 8) {
    return { regime: 'CAPITULATION', confidence: 65, volatilityState: volatilityState, trendBias: trendBias }
  }

  // ── RECOVERY check ──
  let was_oversold_recently = false
  if (bars.length >= 40) {
    let low20 = Infinity, high20pre = 0
    for (let ri = Math.max(0, bars.length - 40); ri < bars.length - 20; ri++) {
      if (bars[ri].high > high20pre) high20pre = bars[ri].high
    }
    for (let ri2 = bars.length - 20; ri2 < bars.length; ri2++) {
      if (bars[ri2].low < low20) low20 = bars[ri2].low
    }
    const dropPct = high20pre > 0 ? (high20pre - low20) / high20pre * 100 : 0
    was_oversold_recently = dropPct > 5 && ind.rsi !== null && ind.rsi > 40 && ind.rsi < 60
  }
  if (was_oversold_recently && volatilityState !== 'extreme' && priceChange20 > 1) {
    return { regime: 'RECOVERY', confidence: 60, volatilityState: volatilityState, trendBias: trendBias }
  }

  // ── EXPANSION check ──
  if (bbExpanding && adx !== null && adx > 25 && absPriceChange20 > 2) {
    return { regime: 'EXPANSION', confidence: 75, volatilityState: volatilityState, trendBias: trendBias }
  }

  // ── SQUEEZE check ──
  if (ind.bbSqueeze) {
    return { regime: 'SQUEEZE', confidence: 70, volatilityState: volatilityState, trendBias: trendBias }
  }

  // ── TREND check ──
  if (adx !== null && adx >= 25) {
    let trendConf = 60
    if (adx >= 35) trendConf = 80
    if (macdDir === stDir && macdDir !== 'neut') trendConf += 10
    return { regime: 'TREND', confidence: Math.min(95, trendConf), volatilityState: volatilityState, trendBias: trendBias }
  }

  // ── RANGE (fallback) ──
  let rangeConf = 50
  if (adx !== null && adx < 15) rangeConf = 75
  else if (adx !== null && adx < 20) rangeConf = 60
  return { regime: 'RANGE', confidence: rangeConf, volatilityState: volatilityState, trendBias: trendBias }
}

// ══════════════════════════════════════════════════════════════════
// OHLCV PROXY SIGNALS
// ══════════════════════════════════════════════════════════════════

export function teacherOHLCVProxies(bars: any): any {
  if (!bars || bars.length < 5) return { volumeImbalance: 0, wickAbsorption: null, volumeSpike: false, gapDetected: false }

  const last = bars[bars.length - 1]
  const prev = bars[bars.length - 2]
  const range = last.high - last.low

  // Volume imbalance proxy
  const body = last.close - last.open
  const volumeImbalance = range > 0 ? body / range : 0

  // Wick absorption proxy
  let wickAbsorption: any = null
  if (range > 0) {
    const lowerWick = Math.min(last.open, last.close) - last.low
    const upperWick = last.high - Math.max(last.open, last.close)
    if (lowerWick / range > 0.4) wickAbsorption = { side: 'BUY', strength: lowerWick / range }
    else if (upperWick / range > 0.4) wickAbsorption = { side: 'SELL', strength: upperWick / range }
  }

  // Volume spike proxy
  let volSum = 0
  const volCount = Math.min(10, bars.length - 1)
  for (let i = bars.length - 1 - volCount; i < bars.length - 1; i++) {
    volSum += bars[i].volume
  }
  const volAvg = volCount > 0 ? volSum / volCount : 0
  const volumeSpike = volAvg > 0 && last.volume > volAvg * 2

  // Gap proxy
  const gapPct = prev.close > 0 ? Math.abs(last.open - prev.close) / prev.close * 100 : 0
  const gapDetected = gapPct > 0.1

  return {
    volumeImbalance: parseFloat(volumeImbalance.toFixed(3)),
    wickAbsorption: wickAbsorption,
    volumeSpike: volumeSpike,
    gapDetected: gapDetected,
    _isProxy: true,
  }
}

// ══════════════════════════════════════════════════════════════════
// AUTO-PROFILE SELECTION
// ══════════════════════════════════════════════════════════════════

export function teacherAutoSelectProfile(regimeInfo: any): any {
  if (!regimeInfo) return TEACHER_PROFILES.SWING
  const r = regimeInfo.regime
  const v = regimeInfo.volatilityState
  if (r === 'CAPITULATION') return TEACHER_PROFILES.DEFENSE
  if (r === 'EXPANSION') return TEACHER_PROFILES.FAST
  if (r === 'SQUEEZE' && v === 'low') return TEACHER_PROFILES.FAST
  if (r === 'TREND') {
    if (v === 'high' || v === 'extreme') return TEACHER_PROFILES.DEFENSE
    return TEACHER_PROFILES.SWING
  }
  if (r === 'RECOVERY') return TEACHER_PROFILES.SWING
  if (r === 'RANGE') {
    if (v === 'low') return TEACHER_PROFILES.DEFENSE
    return TEACHER_PROFILES.SWING
  }
  return TEACHER_PROFILES.SWING
}

// ══════════════════════════════════════════════════════════════════
// ENTRY DECISION
// ══════════════════════════════════════════════════════════════════

export function teacherDecideEntry(ind: any, regimeInfo: any, profile: any, equity: any, _memory: any): any {
  const result: any = { action: 'NO_TRADE', reasons: [], confidence: 0, warnings: [], noTradeReasons: [] }
  if (!ind || !regimeInfo || !profile) return result

  const adx = ind.adx
  const rsi = ind.rsi
  const confluence = ind.confluence
  const macdDir = ind.macdDir
  const stDir = ind.stDir
  const squeeze = ind.bbSqueeze

  // ── CAPITAL GUARD ──
  if (equity && equity.currentDDPct > 15) {
    result.noTradeReasons.push('DD_HIGH (>' + equity.currentDDPct.toFixed(1) + '%)')
    result.warnings.push('Drawdown too high — skip')
    return result
  }

  // ── REGIME AVOID ──
  if (profile.avoidRegimes && profile.avoidRegimes.indexOf(regimeInfo.regime) !== -1) {
    result.noTradeReasons.push('REGIME_AVOIDED:' + regimeInfo.regime)
    return result
  }

  // ── ADX FILTER ──
  if (adx !== null && adx < profile.minADX) {
    result.noTradeReasons.push('LOW_ADX:' + (adx ? adx.toFixed(0) : '?'))
  }

  // ── CONFLUENCE FILTER ──
  if (confluence === null || confluence === undefined) {
    result.noTradeReasons.push('NO_CONFLUENCE')
    return result
  }

  // ── SCORING ──
  let bullScore = 0
  let bearScore = 0
  const bullReasons: any[] = []
  const bearReasons: any[] = []

  if (rsi !== null) {
    if (rsi < profile.rsiOversold) { bullScore += 25; bullReasons.push('RSI_OVERSOLD') }
    if (rsi > profile.rsiOverbought) { bearScore += 25; bearReasons.push('RSI_OVERBOUGHT') }
    if (rsi > 50 && rsi < profile.rsiOverbought) { bullScore += 5 }
    if (rsi < 50 && rsi > profile.rsiOversold) { bearScore += 5 }
  }

  if (macdDir === 'bull') { bullScore += 20; bullReasons.push('MACD_BULL') }
  if (macdDir === 'bear') { bearScore += 20; bearReasons.push('MACD_BEAR') }

  if (stDir === 'bull') { bullScore += 20; bullReasons.push('ST_BULL') }
  if (stDir === 'bear') { bearScore += 20; bearReasons.push('ST_BEAR') }

  if (squeeze) {
    bullScore += 5; bearScore += 5
    bullReasons.push('BB_SQUEEZE'); bearReasons.push('BB_SQUEEZE')
  }

  if (confluence >= 70) { bullScore += 15; bullReasons.push('CONF_HIGH') }
  if (confluence <= 30) { bearScore += 15; bearReasons.push('CONF_LOW') }

  if (adx !== null && adx >= 30) {
    if (macdDir === 'bull') { bullScore += 10; bullReasons.push('HIGH_ADX_TREND') }
    if (macdDir === 'bear') { bearScore += 10; bearReasons.push('HIGH_ADX_TREND') }
  }

  if (regimeInfo.regime === 'TREND') {
    if (regimeInfo.trendBias === 'bullish') { bullScore += 10; bullReasons.push('REGIME_TREND_UP') }
    if (regimeInfo.trendBias === 'bearish') { bearScore += 10; bearReasons.push('REGIME_TREND_DN') }
  }
  if (regimeInfo.regime === 'EXPANSION') { bullScore += 5; bearScore += 5 }

  if (ind.divergence) {
    if (ind.divergence.type === 'bull') { bullScore += 15; bullReasons.push('DIVERGENCE_BULL') }
    if (ind.divergence.type === 'bear') { bearScore += 15; bearReasons.push('DIVERGENCE_BEAR') }
  }

  // ── DECIDE ──
  const threshold = profile.minConfluence
  let winner: any = null
  let winnerScore = 0
  let winnerReasons: any[] = []

  if (bullScore > bearScore && bullScore >= threshold) {
    winner = 'LONG'; winnerScore = bullScore; winnerReasons = bullReasons
  } else if (bearScore > bullScore && bearScore >= threshold) {
    winner = 'SHORT'; winnerScore = bearScore; winnerReasons = bearReasons
  }

  if (!winner) {
    if (bullScore > 0 && bearScore > 0 && Math.abs(bullScore - bearScore) < 15) {
      result.noTradeReasons.push('CONFLICT:bull=' + bullScore + ',bear=' + bearScore)
    } else {
      result.noTradeReasons.push('WEAK_SIGNAL:bull=' + bullScore + ',bear=' + bearScore)
    }
    return result
  }

  // ── MEMORY CHECK ──
  if (_memory && typeof w.teacherPreTradeLookback === 'function') {
    const lookback = w.teacherPreTradeLookback(winner, ind)
    if (lookback && lookback.warnings && lookback.warnings.length > 0) {
      for (let ww = 0; ww < lookback.warnings.length; ww++) {
        result.warnings.push(lookback.warnings[ww])
      }
      if (lookback.memoryScore !== undefined && lookback.memoryScore < 20) {
        result.noTradeReasons.push('MEMORY_WARNS:score=' + lookback.memoryScore)
        return result
      }
    }
  }

  result.action = winner
  result.reasons = winnerReasons
  result.confidence = Math.min(100, winnerScore)

  return result
}

// ══════════════════════════════════════════════════════════════════
// EXIT DECISION
// ══════════════════════════════════════════════════════════════════

export function teacherDecideExit(trade: any, ind: any, regimeInfo: any, profile: any): any {
  if (!trade || !ind) return null
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
    if (isLong && ind.confluence <= 25) return 'CONFLUENCE_DROP'
    if (!isLong && ind.confluence >= 75) return 'CONFLUENCE_DROP'
  }

  if (regimeInfo && regimeInfo.regime === 'CAPITULATION') return 'REGIME_CAPITULATION'

  if (profile && trade.barsHeld !== undefined) {
    const barsHeld = (w.TEACHER && w.TEACHER.cursor) ? w.TEACHER.cursor - trade.entryBar : 0
    if (barsHeld >= profile.maxBarsInTrade) return 'TIME_STOP'
  }

  return null
}

// ══════════════════════════════════════════════════════════════════
// SIZING
// ══════════════════════════════════════════════════════════════════

export function teacherAutoSize(profile: any, equity: any, ind: any): any {
  if (!profile || !equity) return null

  const capital = equity.currentCapital || equity.startCapital || 10000
  let riskPct = 1.0

  if (equity.currentDDPct > 10) riskPct = 0.5
  else if (equity.currentDDPct > 5) riskPct = 0.75

  let slPct = profile.slPct
  if (ind && ind.atr && ind.atr > 0) {
    let lastClose = 0
    const T = w.TEACHER
    if (T && T.dataset && T.dataset.bars && T.cursor >= 0) {
      lastClose = T.dataset.bars[T.cursor].close
    }
    if (lastClose > 0) {
      const atrSlPct = (ind.atr / lastClose) * 100 * 1.5
      slPct = Math.max(profile.slPct, Math.min(profile.slPct * 2, atrSlPct))
    }
  }

  const rrRatio = profile.tpPct / profile.slPct
  const tpPct = slPct * rrRatio

  let leverageX = profile.leverageX
  if (equity.currentDDPct > 8) {
    leverageX = Math.max(1, Math.floor(leverageX * 0.5))
  }

  return {
    leverageX: leverageX,
    slPct: parseFloat(slPct.toFixed(2)),
    tpPct: parseFloat(tpPct.toFixed(2)),
    capitalUSD: capital,
    riskPct: riskPct,
    dslEnabled: profile.dslEnabled,
    dslActivation: profile.dslActivation,
    dslTrailPct: profile.dslTrailPct,
    feeProfile: profile.feeProfile,
    orderType: profile.orderType,
  }
}

// ══════════════════════════════════════════════════════════════════
// TRADE CLASSIFICATION
// ══════════════════════════════════════════════════════════════════

export function teacherClassifyTradeV2(trade: any): string {
  if (!trade) return 'UNKNOWN'

  let score = 0
  if (typeof w.teacherScoreTrade === 'function') {
    const result = w.teacherScoreTrade(trade)
    score = result.score
  }

  if (trade.outcome === 'WIN') {
    if (score >= 70) return 'GOOD_TRADE'
    if (score >= 40) return 'OK_TRADE'
    return 'LUCKY_TRADE'
  }

  if (trade.outcome === 'LOSS') {
    if (score >= 50 && trade.exitReason === 'SL_HIT') return 'GOOD_LOSS'
    if (score >= 50 && trade.exitReason === 'DSL_HIT') return 'GOOD_LOSS'
    if (trade.entryReasons && trade.entryReasons.length <= 1) return 'AVOIDABLE_LOSS'
    if (score < 30) return 'MISTAKE'
    return 'BAD_TRADE'
  }

  return 'BREAKEVEN'
}

// ══════════════════════════════════════════════════════════════════
// AUTO TF SELECTION
// ══════════════════════════════════════════════════════════════════

export function teacherAutoSelectTF(regimeInfo: any, curriculumHint: any): string {
  if (curriculumHint && curriculumHint.tf) return curriculumHint.tf
  if (!regimeInfo) return '15m'
  const r = regimeInfo.regime
  if (r === 'CAPITULATION' || r === 'EXPANSION') return '5m'
  if (r === 'TREND') return '15m'
  if (r === 'RANGE' || r === 'SQUEEZE') return '1h'
  if (r === 'RECOVERY') return '15m'
  return '15m'
}

// ══════════════════════════════════════════════════════════════════
// AUTO REPLAY SPEED
// ══════════════════════════════════════════════════════════════════

export function teacherAutoSpeed(hasOpenTrade: any, ind: any, regimeInfo: any): number {
  if (hasOpenTrade) return 100
  if (ind && ind.confluence !== null) {
    if (ind.confluence >= 70 || ind.confluence <= 30) return 80
  }
  if (regimeInfo && (regimeInfo.regime === 'EXPANSION' || regimeInfo.regime === 'CAPITULATION')) return 60
  return 20
}

// Attach to window
;(function _teacherBrainGlobals() {
  if (typeof window !== 'undefined') {
    w.TEACHER_PROFILES = TEACHER_PROFILES
    w.teacherDetectRegimeV2 = teacherDetectRegimeV2
    w.teacherOHLCVProxies = teacherOHLCVProxies
    w.teacherAutoSelectProfile = teacherAutoSelectProfile
    w.teacherDecideEntry = teacherDecideEntry
    w.teacherDecideExit = teacherDecideExit
    w.teacherAutoSize = teacherAutoSize
    w.teacherClassifyTradeV2 = teacherClassifyTradeV2
    w.teacherAutoSelectTF = teacherAutoSelectTF
    w.teacherAutoSpeed = teacherAutoSpeed
  }
})()
