// Zeus — teacher/teacherIndicators.ts
// Ported 1:1 from public/js/teacher/teacherIndicators.js (Phase 7C)
// THE TEACHER — Pure indicator calculations for sandboxed replay
// ZERO side effects — NO DOM, NO globals read/write, NO BM/S/BRAIN
// Every function takes data in, returns result out.

const w = window as any

// Local alias for indicator defaults — accessed inside functions only
function _getTID(): any {
  return w.TEACHER_IND_DEFAULTS || {}
}

// ══════════════════════════════════════════════════════════════════
// RSI (Wilder smoothing, returns full array)
// ══════════════════════════════════════════════════════════════════
export function teacherCalcRSI(closes: any, period?: any): any[] {
  const _TID = _getTID()
  period = period || _TID.rsiPeriod
  const len = closes.length
  const out = new Array(len).fill(null)
  if (len < period + 1) return out
  let g = 0, l = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) g += d; else l += Math.abs(d)
  }
  let ag = g / period, al = l / period
  out[period] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)))
  for (let i = period + 1; i < len; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) { ag = (ag * (period - 1) + d) / period; al = al * (period - 1) / period }
    else { ag = ag * (period - 1) / period; al = (al * (period - 1) + Math.abs(d)) / period }
    out[i] = al === 0 ? 100 : parseFloat((100 - (100 / (1 + (ag / al)))).toFixed(1))
  }
  return out
}

// ══════════════════════════════════════════════════════════════════
// ADX (Wilder smoothing, returns scalar for last bar)
// ══════════════════════════════════════════════════════════════════
export function teacherCalcADX(bars: any, period?: any): any {
  const _TID = _getTID()
  period = period || _TID.adxPeriod
  if (!bars || bars.length < period * 3 + 1) return null
  const slice = bars.slice(-(period * 3 + 1))
  let sTR = 0, sDMp = 0, sDMm = 0
  for (let i = 1; i <= period; i++) {
    const h = slice[i].high, l2 = slice[i].low, pc = slice[i - 1].close
    const ph = slice[i - 1].high, pl = slice[i - 1].low
    sTR += Math.max(h - l2, Math.abs(h - pc), Math.abs(l2 - pc))
    sDMp += (h - ph > 0 && h - ph > pl - l2) ? h - ph : 0
    sDMm += (pl - l2 > 0 && pl - l2 > h - ph) ? pl - l2 : 0
  }
  let smoothADX = 0, dxCount = 0
  for (let i = period + 1; i < slice.length; i++) {
    const h = slice[i].high, l2 = slice[i].low, pc = slice[i - 1].close
    const ph = slice[i - 1].high, pl = slice[i - 1].low
    const tr = Math.max(h - l2, Math.abs(h - pc), Math.abs(l2 - pc))
    const dp = (h - ph > 0 && h - ph > pl - l2) ? h - ph : 0
    const dm = (pl - l2 > 0 && pl - l2 > h - ph) ? pl - l2 : 0
    sTR = sTR - sTR / period + tr
    sDMp = sDMp - sDMp / period + dp
    sDMm = sDMm - sDMm / period + dm
    if (sTR === 0) continue
    const diP = (sDMp / sTR) * 100
    const diM = (sDMm / sTR) * 100
    const dxD = diP + diM
    const dx = dxD === 0 ? 0 : Math.abs(diP - diM) / dxD * 100
    if (dxCount === 0) smoothADX = dx
    else smoothADX = (smoothADX * (period - 1) + dx) / period
    dxCount++
  }
  return dxCount === 0 ? null : Math.round(smoothADX)
}

// ══════════════════════════════════════════════════════════════════
// MACD (returns {macd, signal, hist} for last bar)
// ══════════════════════════════════════════════════════════════════
export function teacherCalcMACD(closes: any, fast?: any, slow?: any, sig?: any): any {
  const _TID = _getTID()
  fast = fast || _TID.macdFast
  slow = slow || _TID.macdSlow
  sig  = sig  || _TID.macdSignal
  if (!closes || closes.length < slow + sig) return null
  const emaCalc = function (data: any, p: any) {
    const k = 2 / (p + 1); let e = data[0]
    const out = [e]
    for (let i = 1; i < data.length; i++) { e = data[i] * k + e * (1 - k); out.push(e) }
    return out
  }
  const emaF = emaCalc(closes, fast)
  const emaS = emaCalc(closes, slow)
  const macdLine: any[] = []
  for (let i = 0; i < closes.length; i++) macdLine.push(emaF[i] - emaS[i])
  const signalLine = emaCalc(macdLine, sig)
  const last = closes.length - 1
  const m = macdLine[last]
  const s = signalLine[last]
  return { macd: m, signal: s, hist: m - s }
}

// MACD direction (bull/bear/neut)
export function teacherDetectMACDDir(closes: any, fast?: any, slow?: any, sig?: any): string {
  const _TID = _getTID()
  fast = fast || _TID.macdFast
  slow = slow || _TID.macdSlow
  sig  = sig  || _TID.macdSignal
  if (!closes || closes.length < slow + sig + 2) return 'neut'
  const emaCalc = function (data: any, p: any) {
    const k = 2 / (p + 1); let e = data[0]
    const out = [e]
    for (let i = 1; i < data.length; i++) { e = data[i] * k + e * (1 - k); out.push(e) }
    return out
  }
  const emaF = emaCalc(closes, fast)
  const emaS = emaCalc(closes, slow)
  const macdLine: any[] = []
  for (let i = 0; i < closes.length; i++) macdLine.push(emaF[i] - emaS[i])
  const signalLine = emaCalc(macdLine, sig)
  const last = closes.length - 1
  const m = macdLine[last], mp = macdLine[last - 1]
  const s = signalLine[last], sp = signalLine[last - 1]
  if (m > s && mp <= sp) return 'bull'
  if (m < s && mp >= sp) return 'bear'
  return m > s ? 'bull' : 'bear'
}

// ══════════════════════════════════════════════════════════════════
// ATR (Average True Range, returns scalar)
// ══════════════════════════════════════════════════════════════════
export function teacherCalcATR(bars: any, period?: any): any {
  const _TID = _getTID()
  period = period || _TID.atrPeriod
  if (!bars || bars.length < period + 1) return null
  const slice = bars.slice(-(period + 1))
  let sum = 0
  for (let i = 1; i < slice.length; i++) {
    sum += Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low - slice[i - 1].close)
    )
  }
  return sum / period
}

// ══════════════════════════════════════════════════════════════════
// Supertrend direction (bull/bear/neut)
// ══════════════════════════════════════════════════════════════════
export function teacherDetectSTDir(bars: any, mult?: any): string {
  const _TID = _getTID()
  mult = mult || _TID.stMult
  if (!bars || bars.length < 20) return 'neut'
  const slice = bars.slice(-20)
  // [BIAS-FIX] Proper SuperTrend with stateful flip-flop over bar window
  const atrs: any[] = []
  for (let i = 1; i < slice.length; i++) {
    atrs.push(Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low - slice[i - 1].close)
    ))
  }
  let atr = 0
  for (let i = 0; i < atrs.length; i++) atr += atrs[i]
  atr /= atrs.length

  // Initialize direction from first bar relative to midpoint
  const hl2_0 = (slice[0].high + slice[0].low) / 2
  let dir = slice[0].close >= hl2_0 ? 1 : -1 // 1=bull, -1=bear
  let finalUpper = (slice[0].high + slice[0].low) / 2 + mult * atr
  let finalLower = (slice[0].high + slice[0].low) / 2 - mult * atr

  for (let i = 1; i < slice.length; i++) {
    const hl2 = (slice[i].high + slice[i].low) / 2
    const basicUpper = hl2 + mult * atr
    const basicLower = hl2 - mult * atr

    // Ratchet bands: upper can only tighten down, lower can only tighten up
    finalUpper = (basicUpper < finalUpper || slice[i - 1].close > finalUpper) ? basicUpper : finalUpper
    finalLower = (basicLower > finalLower || slice[i - 1].close < finalLower) ? basicLower : finalLower

    // Flip logic — symmetric
    if (dir === 1 && slice[i].close < finalLower) {
      dir = -1
      finalUpper = basicUpper // reset resistance band
    } else if (dir === -1 && slice[i].close > finalUpper) {
      dir = 1
      finalLower = basicLower // reset support band
    }
  }

  return dir === 1 ? 'bull' : 'bear'
}

// ══════════════════════════════════════════════════════════════════
// Bollinger Bands (returns {upper, middle, lower, squeeze})
// ══════════════════════════════════════════════════════════════════
export function teacherCalcBB(closes: any, period?: any, mult?: any): any {
  const _TID = _getTID()
  period = period || _TID.bbPeriod
  mult   = mult   || _TID.bbMult
  if (!closes || closes.length < period) return null
  const slice = closes.slice(-period)
  let sum = 0
  for (let i = 0; i < slice.length; i++) sum += slice[i]
  const sma = sum / period
  let sqSum = 0
  for (let i = 0; i < slice.length; i++) sqSum += (slice[i] - sma) * (slice[i] - sma)
  const std = Math.sqrt(sqSum / period)
  const upper = sma + mult * std
  const lower = sma - mult * std
  const bandwidth = sma > 0 ? (upper - lower) / sma : 0
  // Squeeze: bandwidth < 4% of price (tight bands)
  const squeeze = bandwidth < 0.04
  return { upper: upper, middle: sma, lower: lower, squeeze: squeeze, bandwidth: bandwidth }
}

// ══════════════════════════════════════════════════════════════════
// Wick Chaos (pure — from regime.js logic)
// ══════════════════════════════════════════════════════════════════
export function teacherWickChaos(bars: any, n?: any): number {
  n = n || 10
  if (!bars || bars.length < n) return 0
  const slice = bars.slice(-n)
  let total = 0, count = 0
  for (let i = 0; i < slice.length; i++) {
    const range = slice[i].high - slice[i].low
    if (range <= 0) continue
    const body = Math.abs(slice[i].close - slice[i].open)
    total += 1 - body / range
    count++
  }
  return count === 0 ? 0 : Math.round((total / count) * 100)
}

// ══════════════════════════════════════════════════════════════════
// Breakout Strength (pure — from regime.js logic)
// ══════════════════════════════════════════════════════════════════
export function teacherBreakoutStrength(bars: any): number {
  if (!bars || bars.length < 10) return 0
  const last5 = bars.slice(-5)
  const prev5 = bars.slice(-10, -5)
  let volRecent = 0, volOld = 0, rangeRecent = 0, rangeOld = 0
  for (let i = 0; i < 5; i++) {
    volRecent += (last5[i].volume || 0)
    volOld    += (prev5[i].volume || 0)
    rangeRecent += last5[i].high - last5[i].low
    rangeOld    += prev5[i].high - prev5[i].low
  }
  volRecent /= 5; volOld /= 5; rangeRecent /= 5; rangeOld /= 5
  const volScore = volOld > 0 ? Math.min(40, Math.round((volRecent / volOld - 1) * 80)) : 0
  const rangeScore = rangeOld > 0 ? Math.min(30, Math.round((rangeRecent / rangeOld - 1) * 60)) : 0
  const dir = bars[bars.length - 1].close > bars[bars.length - 1].open ? 1 : -1
  let ftCount = 0
  for (let i = bars.length - 3; i < bars.length; i++) {
    if (i < 0) continue
    const bd = bars[i].close > bars[i].open ? 1 : -1
    if (bd === dir) ftCount++
  }
  const ftScore = Math.min(30, ftCount * 10)
  return Math.max(0, volScore + rangeScore + ftScore)
}

// ══════════════════════════════════════════════════════════════════
// Regime Detection (pure — reimplements regime.js core logic)
// Returns { regime, confidence, trendBias, volatilityState, trapRisk }
// ══════════════════════════════════════════════════════════════════
export function teacherDetectRegime(bars: any, adx?: any, rsi?: any): any {
  if (!bars || bars.length < 50) {
    return { regime: 'RANGE', confidence: 0, trendBias: 'neutral', volatilityState: 'normal', trapRisk: 0 }
  }
  adx = adx != null ? adx : teacherCalcADX(bars)
  const closes: any[] = []
  for (let i = 0; i < bars.length; i++) closes.push(bars[i].close)
  rsi = rsi != null ? rsi : (function () {
    const arr = teacherCalcRSI(closes)
    return arr[arr.length - 1]
  })()

  const wickScore = teacherWickChaos(bars, 10)
  const brkScore  = teacherBreakoutStrength(bars)
  const atr2 = teacherCalcATR(bars, 14) || 0
  const price = bars[bars.length - 1].close
  const atrPct = price > 0 ? (atr2 / price) * 100 : 0

  // Classify
  let regime = 'RANGE', confidence = 0, trendBias = 'neutral', volState = 'normal', trapRisk = 0

  if (adx != null && adx >= 25 && brkScore >= 40) {
    regime = 'BREAKOUT'
    confidence = Math.min(95, Math.round(adx * 0.8 + brkScore * 0.5))
    trendBias = bars[bars.length - 1].close > bars[bars.length - 6].close ? 'bullish' : 'bearish'
    volState = 'expanding'
    trapRisk = wickScore > 60 ? Math.round(wickScore * 0.6) : 0
  } else if (adx != null && adx >= 25) {
    regime = 'TREND'
    confidence = Math.min(90, Math.round(adx * 1.2))
    trendBias = rsi != null && rsi > 50 ? 'bullish' : 'bearish'
    volState = atrPct > 1.5 ? 'high' : 'normal'
    trapRisk = wickScore > 50 ? Math.round(wickScore * 0.4) : 0
  } else if (atrPct > 2.0 || wickScore > 65) {
    regime = 'VOLATILE'
    confidence = Math.min(80, Math.round(atrPct * 20 + wickScore * 0.3))
    volState = 'high'
    trapRisk = Math.round(wickScore * 0.5)
  } else {
    regime = 'RANGE'
    confidence = Math.min(85, Math.round((100 - (adx || 15)) * 0.9))
    volState = atrPct < 0.5 ? 'low' : 'normal'
    trapRisk = brkScore > 20 ? Math.round(brkScore * 0.3) : 0
  }

  return { regime: regime, confidence: confidence, trendBias: trendBias, volatilityState: volState, trapRisk: trapRisk }
}

// ══════════════════════════════════════════════════════════════════
// Confluence Score (pure math — reimplements confluence.js math only)
// Returns 0-100 score + component breakdown
// ══════════════════════════════════════════════════════════════════
export function teacherCalcConfluence(rsi: any, macdDir: any, stDir: any, adx: any, regime: any): any {
  const scores: any[] = []
  const dirs: any[] = []

  // RSI component
  if (rsi != null) {
    const rsiDir = rsi > 50 ? 'bull' : 'bear'
    const rsiScore = rsi > 70 ? 80 : rsi < 30 ? 80 : rsi > 55 ? 60 : rsi < 45 ? 60 : 50
    scores.push({ name: 'RSI', score: rsiScore, dir: rsiDir })
    dirs.push(rsiDir)
  }

  // MACD component
  if (macdDir) {
    const macdScore = macdDir === 'bull' ? 75 : macdDir === 'bear' ? 25 : 50
    scores.push({ name: 'MACD', score: macdScore, dir: macdDir })
    dirs.push(macdDir)
  }

  // SuperTrend component
  if (stDir) {
    const stScore = stDir === 'bull' ? 80 : stDir === 'bear' ? 20 : 50
    scores.push({ name: 'ST', score: stScore, dir: stDir })
    dirs.push(stDir)
  }

  // [BIAS-FIX] ADX measures strength not direction — follow existing directional consensus
  if (adx != null) {
    let bullSoFar = 0, bearSoFar = 0
    for (let j = 0; j < dirs.length; j++) { if (dirs[j] === 'bull') bullSoFar++; else if (dirs[j] === 'bear') bearSoFar++ }
    const adxDir = bullSoFar >= bearSoFar ? 'bull' : 'bear'
    scores.push({ name: 'ADX', score: Math.min(100, adx * 2), dir: adxDir })
    dirs.push(adxDir)
  }

  // [BIAS-FIX] Regime measures market state not direction — follow existing directional consensus
  if (regime) {
    let bullSoFar2 = 0, bearSoFar2 = 0
    for (let j = 0; j < dirs.length; j++) { if (dirs[j] === 'bull') bullSoFar2++; else if (dirs[j] === 'bear') bearSoFar2++ }
    const regDir = bullSoFar2 >= bearSoFar2 ? 'bull' : 'bear'
    scores.push({ name: 'REGIME', score: regime === 'TREND' ? 70 : regime === 'BREAKOUT' ? 80 : 40, dir: regDir })
    dirs.push(regDir)
  }

  if (dirs.length === 0) return { score: 50, components: [], alignment: 0 }

  let bullCount = 0
  for (let i = 0; i < dirs.length; i++) if (dirs[i] === 'bull') bullCount++
  const dirFactor = bullCount / dirs.length
  const baseScore = dirFactor * 100
  const signalBoost = dirs.length >= 4 ? 15 : dirs.length >= 2 ? 8 : 0
  const final = Math.round(Math.max(0, Math.min(100,
    bullCount > dirs.length - bullCount ? baseScore + signalBoost : baseScore - signalBoost
  )))
  const alignment = Math.round(Math.abs(dirFactor - 0.5) * 200) // 0=split, 100=all agree

  return { score: final, components: scores, alignment: alignment }
}

// ══════════════════════════════════════════════════════════════════
// Swing Pivots (pure — from forecast.js)
// ══════════════════════════════════════════════════════════════════
export function teacherSwingPivots(bars: any, lookback?: any, win?: any): any {
  lookback = lookback || 60
  win = win || 3
  if (!bars || bars.length < lookback) return { highs: [], lows: [] }
  const slice = bars.slice(-lookback)
  const highs: any[] = [], lows: any[] = []
  for (let i = win; i < slice.length - win; i++) {
    let isHigh = true, isLow = true
    for (let j = 1; j <= win; j++) {
      if (slice[i].high <= slice[i - j].high || slice[i].high <= slice[i + j].high) isHigh = false
      if (slice[i].low >= slice[i - j].low || slice[i].low >= slice[i + j].low) isLow = false
    }
    if (isHigh) highs.push({ idx: i, price: slice[i].high, ts: slice[i].time })
    if (isLow)  lows.push({ idx: i, price: slice[i].low, ts: slice[i].time })
  }
  return { highs: highs.slice(-3), lows: lows.slice(-3) }
}

// ══════════════════════════════════════════════════════════════════
// Divergence Detection (pure — from forecast.js)
// Returns {type:'bull'|'bear', conf} or null
// ══════════════════════════════════════════════════════════════════
export function teacherDetectDivergence(bars: any): any {
  if (!bars || bars.length < 40) return null
  const closes: any[] = []
  for (let i = 0; i < bars.length; i++) closes.push(bars[i].close)
  const rsiArr = teacherCalcRSI(closes, 14)
  let validCount = 0
  for (let i = 0; i < rsiArr.length; i++) if (rsiArr[i] !== null) validCount++
  if (validCount < 10) return null

  const pivots = teacherSwingPivots(bars, 80, 3)

  // Bear divergence: price higher high, RSI lower high
  const highs = pivots.highs
  if (highs.length >= 2) {
    const ph1 = highs[highs.length - 2], ph2 = highs[highs.length - 1]
    const rsiH1 = rsiArr[ph1.idx] != null ? rsiArr[ph1.idx] : 50
    const rsiH2 = rsiArr[ph2.idx] != null ? rsiArr[ph2.idx] : 50
    if (ph2.price > ph1.price && rsiH2 < rsiH1 - 3) {
      const conf = Math.min(90, Math.round(50 + (ph2.price - ph1.price) / ph1.price * 800 + (rsiH1 - rsiH2) * 1.2))
      return { type: 'bear', conf: conf }
    }
  }
  // Bull divergence: price lower low, RSI higher low
  const lows = pivots.lows
  if (lows.length >= 2) {
    const pl1 = lows[lows.length - 2], pl2 = lows[lows.length - 1]
    const rsiL1 = rsiArr[pl1.idx] != null ? rsiArr[pl1.idx] : 50
    const rsiL2 = rsiArr[pl2.idx] != null ? rsiArr[pl2.idx] : 50
    if (pl2.price < pl1.price && rsiL2 > rsiL1 + 3) {
      const conf2 = Math.min(90, Math.round(50 + (pl1.price - pl2.price) / pl1.price * 800 + (rsiL2 - rsiL1) * 1.2))
      return { type: 'bull', conf: conf2 }
    }
  }
  return null
}

// ══════════════════════════════════════════════════════════════════
// Volume Climax (pure — from forecast.js)
// Returns {dir:'buy'|'sell', mult} or null
// ══════════════════════════════════════════════════════════════════
export function teacherDetectClimax(bars: any): any {
  if (!bars || bars.length < 22) return null
  const recent = bars.slice(-21)
  let sma = 0
  for (let i = 0; i < 20; i++) sma += recent[i].volume
  sma /= 20
  if (sma <= 0) return null
  const last = recent[recent.length - 1]
  const mult = last.volume / sma
  if (mult < 3) return null
  const dir = last.close < last.open ? 'sell' : 'buy'
  return { dir: dir, mult: parseFloat(mult.toFixed(2)) }
}

// ══════════════════════════════════════════════════════════════════
// Fee Estimation (pure — mirrors risk.js estimateRoundTripFees)
// ══════════════════════════════════════════════════════════════════
export function teacherEstimateFees(notional: any, orderType: any, feeProfile: any): any {
  const n = Math.abs(notional) || 0
  const isLimit = (orderType || '').toUpperCase() === 'LIMIT'
  const feePct = isLimit ? w.TEACHER_FEES.makerPct : w.TEACHER_FEES.takerPct
  const slipPct = w.TEACHER_FEES.slippage[feeProfile] || w.TEACHER_FEES.slippage.swing
  const entryFee = n * feePct
  const exitFee  = n * feePct
  const slippage = n * slipPct
  return { entryFee: entryFee, exitFee: exitFee, slippage: slippage, total: entryFee + exitFee + slippage }
}

// ══════════════════════════════════════════════════════════════════
// MASTER: Compute all indicators for a bar slice (up to cursor)
// Returns a full indicator snapshot — used by replay engine each tick
// ══════════════════════════════════════════════════════════════════
export function teacherComputeIndicators(bars: any): any {
  if (!bars || bars.length < 30) {
    return {
      rsi: null, adx: null, macd: null, macdSignal: null, macdHist: null,
      macdDir: 'neut', stDir: 'neut', atr: null,
      bbUpper: null, bbMiddle: null, bbLower: null, bbSqueeze: false, bbBandwidth: 0,
      regime: 'RANGE', regimeConf: 0, trendBias: 'neutral', volatilityState: 'normal', trapRisk: 0,
      confluence: 50, confluenceAlignment: 0,
      divergence: null, climax: null,
      wickChaos: 0, breakoutStr: 0,
    }
  }

  const closes: any[] = []
  for (let i = 0; i < bars.length; i++) closes.push(bars[i].close)

  // Core indicators
  const rsiArr = teacherCalcRSI(closes)
  const rsi = rsiArr[rsiArr.length - 1]
  const adx = teacherCalcADX(bars)
  const macdData = teacherCalcMACD(closes)
  const macdDir = teacherDetectMACDDir(closes)
  const stDir = teacherDetectSTDir(bars)
  const atr = teacherCalcATR(bars)
  const bb = teacherCalcBB(closes)

  // Advanced
  const regimeData = teacherDetectRegime(bars, adx, rsi)
  const confData = teacherCalcConfluence(rsi, macdDir, stDir, adx, regimeData.regime)
  const divergence = teacherDetectDivergence(bars)
  const climax = teacherDetectClimax(bars)
  const wickChaos = teacherWickChaos(bars, 10)
  const breakoutStr = teacherBreakoutStrength(bars)

  return {
    rsi: rsi,
    adx: adx,
    macd: macdData ? macdData.macd : null,
    macdSignal: macdData ? macdData.signal : null,
    macdHist: macdData ? macdData.hist : null,
    macdDir: macdDir,
    stDir: stDir,
    atr: atr,
    bbUpper: bb ? bb.upper : null,
    bbMiddle: bb ? bb.middle : null,
    bbLower: bb ? bb.lower : null,
    bbSqueeze: bb ? bb.squeeze : false,
    bbBandwidth: bb ? bb.bandwidth : 0,
    regime: regimeData.regime,
    regimeConf: regimeData.confidence,
    trendBias: regimeData.trendBias,
    volatilityState: regimeData.volatilityState,
    trapRisk: regimeData.trapRisk,
    confluence: confData.score,
    confluenceAlignment: confData.alignment,
    divergence: divergence,
    climax: climax,
    wickChaos: wickChaos,
    breakoutStr: breakoutStr,
  }
}

// Attach to window for cross-file access
;(function _teacherIndicatorsGlobals() {
  if (typeof window !== 'undefined') {
    w.teacherCalcRSI = teacherCalcRSI
    w.teacherCalcADX = teacherCalcADX
    w.teacherCalcMACD = teacherCalcMACD
    w.teacherDetectMACDDir = teacherDetectMACDDir
    w.teacherCalcATR = teacherCalcATR
    w.teacherDetectSTDir = teacherDetectSTDir
    w.teacherCalcBB = teacherCalcBB
    w.teacherWickChaos = teacherWickChaos
    w.teacherBreakoutStrength = teacherBreakoutStrength
    w.teacherDetectRegime = teacherDetectRegime
    w.teacherCalcConfluence = teacherCalcConfluence
    w.teacherSwingPivots = teacherSwingPivots
    w.teacherDetectDivergence = teacherDetectDivergence
    w.teacherDetectClimax = teacherDetectClimax
    w.teacherEstimateFees = teacherEstimateFees
    w.teacherComputeIndicators = teacherComputeIndicators
  }
})()
