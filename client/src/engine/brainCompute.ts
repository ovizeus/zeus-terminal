/**
 * Brain computation engine — pure TypeScript port of brain.js
 *
 * Ported from: public/js/brain/brain.js
 * Functions: detectRegimeEnhanced, detectSweepDisplacement, updateFlowEngine,
 *            computeMarketAtmosphere, computeDangerScore, computeConvictionScore,
 *            evaluateMarketPhase (from phaseFilter.js)
 *
 * All functions are PURE — no DOM, no globals, no side effects.
 */

// ── Types ──

export interface Kline {
  open: number
  high: number
  low: number
  close: number
  volume: number
  time: number
}

export interface RegimeResult {
  regime: string       // 'trend' | 'breakout' | 'squeeze' | 'range' | 'panic' | 'unknown'
  adx: number
  volMode: string      // 'expansion' | 'contraction' | 'normal'
  structure: string    // 'HH/HL' | 'LH/LL' | 'MIXED'
  squeeze: boolean
  atrPct: number
  slope20: number
  confidence: number
}

export interface SweepResult {
  type: 'above' | 'below' | 'none'
  reclaim: boolean
  displacement: boolean
  liqDist: number
}

export interface FlowResult {
  cvd: 'rising' | 'falling'
  delta: number
  ofi: 'buy' | 'sell' | 'neut'
}

export interface MtfResult {
  '15m': 'bull' | 'bear' | 'neut'
  '1h': 'bull' | 'bear' | 'neut'
  '4h': 'bull' | 'bear' | 'neut'
}

export interface PhaseResult {
  allow: boolean
  phase: string
  reason: string
  riskMode: string          // 'blocked' | 'reduced' | 'normal'
  sizeMultiplier: number
  allowedSetups: string[]
  blockedSetups: string[]
}

export interface AtmosphereResult {
  category: string          // 'trap_risk' | 'toxic_volatility' | 'range' | 'clean_trend' | 'neutral'
  allowEntry: boolean
  cautionLevel: string      // 'low' | 'medium' | 'high'
  confidence: number
  reasons: string[]
  sizeMultiplier: number
}

export interface ContextGates {
  mtf: boolean
  flow: boolean
  trigger: boolean
  antifake: boolean
}

export interface SafetyGates {
  risk: boolean
  spread: boolean
  cooldown: boolean
  news: boolean
  session: boolean
  noOpposite: boolean
  regime: boolean
}

export interface BrainComputeResult {
  regime: RegimeResult
  sweep: SweepResult
  flow: FlowResult
  mtf: MtfResult
  phase: PhaseResult
  atmosphere: AtmosphereResult
  contextGates: ContextGates
  safetyGates: SafetyGates
  entryScore: number
  entryReady: boolean
  danger: number
  conviction: number
  convictionMult: number
  dir: 'long' | 'short'
}

// ── Inputs needed from React stores ──

export interface BrainInputs {
  klines: Kline[]
  rsi: Record<string, number>   // { '5m': 55, '1h': 60, '4h': 48 }
  signalData: { bullCount: number; bearCount: number } | null
  fr: number                    // funding rate
  ofiBlendBuy: number          // orderflow indicator (0-100)
  atEnabled: boolean
  openPositionCount: number
  lastTradeSide: string | null
  lastTradeTs: number
  lossStreak: number
  dailyTrades: number
  profile: string               // 'fast' | 'swing' | 'defensive'
}

// ── Pure computation functions ──

function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1)
  let e = data[0]
  return data.map(v => { e = v * k + e * (1 - k); return e })
}

/**
 * Detect market regime from klines — port of brain.js:534-590
 */
export function detectRegimeEnhanced(klines: Kline[]): RegimeResult {
  if (!klines || klines.length < 50) {
    return { regime: 'unknown', adx: 0, volMode: 'normal', structure: 'MIXED', squeeze: false, atrPct: 0, slope20: 0, confidence: 0 }
  }
  const last = klines.slice(-50)
  const closes = last.map(k => k.close)
  const highs = last.map(k => k.high)
  const lows = last.map(k => k.low)
  const vols = last.map(k => k.volume)

  // ATR
  const atrs = last.slice(1).map((k, i) => Math.max(k.high - k.low, Math.abs(k.high - last[i].close), Math.abs(k.low - last[i].close)))
  const avgATR = atrs.reduce((a, b) => a + b, 0) / atrs.length
  const atrPct = avgATR / closes[closes.length - 1] * 100

  // EMA slopes
  const ema20 = calcEMA(closes, 20)
  const slope20 = (ema20[ema20.length - 1] - ema20[ema20.length - 10]) / ema20[ema20.length - 10] * 100

  // ADX approximation
  let plusDM = 0, minusDM = 0, tr = 0
  for (let i = 1; i < last.length; i++) {
    const upMove = last[i].high - last[i - 1].high
    const downMove = last[i - 1].low - last[i].low
    if (upMove > downMove && upMove > 0) plusDM += upMove
    if (downMove > upMove && downMove > 0) minusDM += downMove
    tr += Math.max(last[i].high - last[i].low, Math.abs(last[i].high - last[i - 1].close), Math.abs(last[i].low - last[i - 1].close))
  }
  const adx = tr > 0 ? Math.round(Math.abs(plusDM - minusDM) / tr * 100) : 0

  // Volume trend
  const avgVolRecent = vols.slice(-5).reduce((a, b) => a + b, 0) / 5
  const avgVolOld = vols.slice(-20, -5).reduce((a, b) => a + b, 0) / 15
  const volMode = avgVolRecent > avgVolOld * 1.3 ? 'expansion' : avgVolRecent < avgVolOld * 0.7 ? 'contraction' : 'normal'

  // Structure: HH/HL or LH/LL
  const recentHighs = highs.slice(-10)
  const recentLows = lows.slice(-10)
  const hhCount = recentHighs.slice(1).filter((h, i) => h > recentHighs[i]).length
  const llCount = recentLows.slice(1).filter((l, i) => l < recentLows[i]).length
  const structure = hhCount >= 6 ? 'HH/HL' : llCount >= 6 ? 'LH/LL' : 'MIXED'

  // Squeeze: Bollinger inside Keltner
  const bb20 = calcEMA(closes, 20)
  const stddev = Math.sqrt(closes.slice(-20).reduce((a, v) => a + (v - bb20[bb20.length - 1]) ** 2, 0) / 20)
  const squeeze = stddev < avgATR * 1.5

  // Regime classification
  let regime = 'unknown'
  if (atrPct > 2.5) regime = 'panic'
  else if (atrPct > 1.5 && volMode === 'expansion' && adx > 30) regime = 'breakout'
  else if (adx > 25 && Math.abs(slope20) > 0.3) regime = 'trend'
  else if (squeeze) regime = 'squeeze'
  else regime = 'range'

  return { regime, adx, volMode, structure, squeeze, atrPct, slope20, confidence: adx }
}

/**
 * Detect sweep/displacement — port of brain.js:608-635
 */
export function detectSweepDisplacement(klines: Kline[]): SweepResult {
  if (!klines || klines.length < 20) return { type: 'none', reclaim: false, displacement: false, liqDist: 0 }
  const last = klines.slice(-20)
  const cur = last[last.length - 1]
  const prev20High = Math.max(...last.slice(0, -1).map(k => k.high))
  const prev20Low = Math.min(...last.slice(0, -1).map(k => k.low))
  const atr = last.slice(-5).reduce((a, k) => a + (k.high - k.low), 0) / 5

  // Sweep above
  if (cur.high > prev20High && cur.close < prev20High) {
    return {
      type: 'above',
      reclaim: cur.close < prev20High,
      displacement: (prev20High - cur.close) > atr * 0.5,
      liqDist: parseFloat(((cur.high - cur.close) / cur.close * 100).toFixed(2)),
    }
  }
  // Sweep below
  if (cur.low < prev20Low && cur.close > prev20Low) {
    return {
      type: 'below',
      reclaim: cur.close > prev20Low,
      displacement: (cur.close - prev20Low) > atr * 0.5,
      liqDist: parseFloat(((cur.close - cur.low) / cur.close * 100).toFixed(2)),
    }
  }
  return { type: 'none', reclaim: false, displacement: false, liqDist: 0 }
}

/**
 * Flow engine — port of brain.js:638-658
 */
export function computeFlow(klines: Kline[], ofiBlendBuy: number): FlowResult {
  if (!klines || klines.length < 10) return { cvd: 'falling', delta: 0, ofi: 'neut' }
  const last = klines.slice(-10)

  let cvd = 0
  last.forEach(k => {
    const buyVol = k.close > k.open ? k.volume * 0.6 : k.volume * 0.4
    const sellVol = k.volume - buyVol
    cvd += buyVol - sellVol
  })

  const deltaLast = last[last.length - 1]
  const delta = deltaLast.close > deltaLast.open
    ? parseFloat((deltaLast.volume * 0.2).toFixed(0))
    : parseFloat((-deltaLast.volume * 0.2).toFixed(0))

  const ofi = ofiBlendBuy
  const ofiDir = ofi > 57 ? 'buy' : ofi < 43 ? 'sell' : 'neut'

  return { cvd: cvd > 0 ? 'rising' : 'falling', delta, ofi: ofiDir as FlowResult['ofi'] }
}

/**
 * MTF alignment — port of brain.js:593-604
 */
export function computeMtf(rsi: Record<string, number>): MtfResult {
  const calc = (tf: string): 'bull' | 'bear' | 'neut' => {
    const v = rsi[tf] ?? 50
    return v > 55 ? 'bull' : v < 45 ? 'bear' : 'neut'
  }
  return { '15m': calc('15m'), '1h': calc('1h'), '4h': calc('4h') }
}

/**
 * Phase filter — port of phaseFilter.js
 */
export function evaluateMarketPhase(input: { regime: string; confidence: number; trendBias: string; volatilityState: string; trapRisk: number }): PhaseResult {
  const phaseMap: Record<string, string> = {
    trend_up: 'TREND', trend_down: 'TREND', trend: 'TREND',
    range: 'RANGE', squeeze: 'SQUEEZE',
    expansion: 'EXPANSION', breakout: 'EXPANSION',
    chaos: 'CHAOS', panic: 'CHAOS',
    liquidation_event: 'LIQ_EVENT',
  }
  const phase = phaseMap[input.regime.toLowerCase()] || 'RANGE'

  // Risk mode
  let riskMode = 'normal'
  if (phase === 'LIQ_EVENT') riskMode = 'blocked'
  else if (phase === 'CHAOS' || input.volatilityState === 'extreme' || input.trapRisk >= 60 || input.confidence < 30) riskMode = 'reduced'

  // Size multiplier
  let sizeMult = 0.75
  if (riskMode === 'blocked') sizeMult = 0
  else if (riskMode === 'reduced') {
    sizeMult = phase === 'CHAOS' && input.trapRisk >= 50 ? 0.25 : phase === 'CHAOS' ? 0.5 : 0.5
  } else {
    if (phase === 'SQUEEZE') sizeMult = 0.6
    else if (phase === 'EXPANSION' && input.confidence >= 70) sizeMult = 1.2
    else if (phase === 'TREND' && input.confidence >= 60) sizeMult = 1.0
    else if (phase === 'RANGE') sizeMult = 0.8
  }

  // Allow
  let allow = true
  let reason = ''
  if (riskMode === 'blocked') { allow = false; reason = 'Liquidation event — blocked' }
  else if (phase === 'CHAOS' && input.trapRisk >= 70) { allow = false; reason = 'CHAOS + high trap risk' }
  else if (phase === 'SQUEEZE') { allow = false; reason = 'Squeeze — wait for breakout' }
  else if (input.confidence < 25) { allow = false; reason = 'Confidence too low' }

  return { allow, phase, reason, riskMode, sizeMultiplier: sizeMult, allowedSetups: [], blockedSetups: [] }
}

/**
 * Market atmosphere — port of brain.js:833-940
 */
export function computeAtmosphere(
  regime: RegimeResult,
  phase: PhaseResult,
  sweep: SweepResult,
  brainRegime: string,
  atrPct: number,
): AtmosphereResult {
  const reasons: string[] = []
  let category = 'neutral'
  let allowEntry = true
  let cautionLevel = 'low'
  let confidence = 50
  let sizeMult = phase.sizeMultiplier || 1.0
  const trapRisk = regime.confidence < 30 ? 30 : 0 // simplified — no OF data
  const volState = regime.volMode === 'expansion' && atrPct > 2.0 ? 'extreme' : 'normal'
  const regimeUp = (regime.regime || 'range').toUpperCase()
  const phaseUp = (phase.phase || 'RANGE').toUpperCase()

  // 1. TOXIC VOLATILITY
  if (volState === 'extreme' || regimeUp === 'CHAOS' || regimeUp === 'PANIC' || atrPct > 2.5) {
    category = 'toxic_volatility'
    allowEntry = false
    cautionLevel = 'high'
    confidence = Math.min(95, 40 + Math.round(atrPct * 20))
    sizeMult = 0
    if (volState === 'extreme') reasons.push('volatility extreme')
    if (atrPct > 2.5) reasons.push('ATR ' + atrPct.toFixed(2) + '% > 2.5')
  }
  // 2. RANGE
  else if (phaseUp === 'RANGE' || phaseUp === 'SQUEEZE' || brainRegime === 'range' || brainRegime === 'squeeze') {
    category = 'range'
    allowEntry = true
    cautionLevel = 'medium'
    confidence = Math.max(20, regime.confidence)
    sizeMult = Math.min(sizeMult, 0.7)
    reasons.push('phase ' + phaseUp)
  }
  // 3. CLEAN TREND
  else if (phaseUp === 'TREND' || phaseUp === 'EXPANSION' || brainRegime === 'trend' || brainRegime === 'breakout') {
    category = 'clean_trend'
    allowEntry = true
    cautionLevel = 'low'
    confidence = Math.max(60, regime.confidence)
    sizeMult = Math.max(sizeMult, 1.0)
    reasons.push('phase ' + phaseUp)
  }
  // 4. NEUTRAL
  else {
    category = 'neutral'
    allowEntry = true
    cautionLevel = 'medium'
    confidence = Math.max(30, regime.confidence)
    sizeMult = Math.min(sizeMult, 0.8)
    reasons.push('no clear regime')
  }

  if (reasons.length === 0) reasons.push('scanning...')

  return {
    category,
    allowEntry,
    cautionLevel,
    confidence: Math.round(Math.min(100, Math.max(0, confidence))),
    reasons,
    sizeMultiplier: Math.round(Math.max(0, Math.min(1.5, sizeMult)) * 100) / 100,
  }
}

/**
 * Context gates — port of brain.js:1198-1212
 */
export function computeContextGates(dir: 'long' | 'short', klines: Kline[], mtf: MtfResult, flow: FlowResult, sweep: SweepResult): ContextGates {
  // MTF: need >= 2 aligned
  const mtfDir = dir === 'long' ? 'bull' : 'bear'
  const mtfCount = [mtf['15m'], mtf['1h'], mtf['4h']].filter(d => d === mtfDir).length
  const mtfGate = mtfCount >= 2

  // Flow: OFI + CVD aligned
  const flowGate = dir === 'long'
    ? (flow.ofi === 'buy' && flow.cvd === 'rising')
    : (flow.ofi === 'sell' && flow.cvd === 'falling')

  // Trigger: sweep reclaimed in correct direction
  const triggerGate = dir === 'long'
    ? (sweep.type === 'below' && sweep.reclaim)
    : (sweep.type === 'above' && sweep.reclaim)

  // Antifake: >=2 of last 3 candles confirm direction
  let antifake = false
  if (klines.length >= 4) {
    const last3 = klines.slice(-3)
    const confirming = last3.filter(k => dir === 'long' ? k.close > k.open : k.close < k.open).length
    antifake = confirming >= 2
  }

  return { mtf: mtfGate, flow: flowGate, trigger: triggerGate, antifake }
}

/**
 * Safety gates (simplified — no DOM, no globals) — port of brain.js:1148-1180
 */
export function computeSafetyGates(inputs: BrainInputs, regime: RegimeResult): SafetyGates {
  const now = Date.now()

  // Risk: simplified check
  const risk = inputs.dailyTrades < 20 && inputs.openPositionCount < 5 && inputs.lossStreak < 5

  // Cooldown: profile-dependent
  const cooldownMs: Record<string, number> = { fast: 300000, swing: 1800000, defensive: 3600000 }
  const baseCd = cooldownMs[inputs.profile] || 300000
  const cd = inputs.lossStreak >= 3 ? baseCd * 2 : baseCd
  const cooldown = (now - inputs.lastTradeTs) > cd

  // Session: UTC hour in optimal windows
  const hour = new Date().getUTCHours()
  const session = (hour >= 7 && hour <= 11) || (hour >= 13 && hour <= 17) || (hour >= 19 && hour <= 23)

  // Regime: must be stable and valid
  const validRegimes = ['trend', 'breakout', 'range', 'squeeze']
  const regimeGate = validRegimes.includes(regime.regime)

  return {
    risk,
    spread: true,
    cooldown,
    news: true, // no news data available
    session,
    noOpposite: true, // simplified
    regime: regimeGate,
  }
}

/**
 * Entry score from gates — port of brain.js:779-828
 */
export function computeEntryScore(
  safety: SafetyGates,
  context: ContextGates,
  sweep: SweepResult,
  rsi5m: number,
  dir: 'long' | 'short',
  profile: string,
): { score: number; label: string; entryReady: boolean } {
  // Weighted gate scoring
  const weights: Record<string, number> = {
    regime: 15, mtf: 15, flow: 12, trigger: 10, antifake: 8,
    session: 8, risk: 10, cooldown: 5, spread: 4, news: 5, noOpposite: 5,
  }

  let score = 0
  const allGates: Record<string, boolean> = {
    regime: safety.regime, session: safety.session, risk: safety.risk,
    cooldown: safety.cooldown, spread: safety.spread, news: safety.news,
    noOpposite: safety.noOpposite,
    mtf: context.mtf, flow: context.flow, trigger: context.trigger, antifake: context.antifake,
  }

  for (const [gate, pass] of Object.entries(allGates)) {
    const w = weights[gate] || 0
    score += pass ? w : -w * 0.5
  }

  // Bonuses
  if (sweep.reclaim && sweep.displacement) score += 10
  if (dir === 'long' && rsi5m > 55 && rsi5m < 70) score += 5
  if (dir === 'short' && rsi5m > 30 && rsi5m < 45) score += 5

  score = Math.max(0, Math.min(100, Math.round(score)))

  const thresholds: Record<string, number> = { fast: 65, swing: 75, defensive: 80 }
  const thresh = thresholds[profile] || 65
  const label = score >= thresh ? 'READY' : score >= 60 ? 'WAIT' : 'BLOCK'

  return { score, label, entryReady: label === 'READY' }
}

/**
 * Danger score — port of brain.js:1499-1527
 */
export function computeDangerScore(klines: Kline[], atrPct: number, regime: string, fr: number, atmosphere: AtmosphereResult): number {
  let danger = 0

  // Volatility (0-25)
  danger += atrPct > 3.0 ? 25 : atrPct > 2.0 ? 18 : atrPct > 1.5 ? 12 : atrPct > 1.0 ? 6 : 0

  // Volume anomaly (0-20)
  if (klines.length >= 20) {
    const r5 = klines.slice(-5).reduce((a, k) => a + k.volume, 0) / 5
    const b15 = klines.slice(-20, -5).reduce((a, k) => a + k.volume, 0) / 15
    const vRatio = b15 > 0 ? r5 / b15 : 1
    danger += vRatio > 3.0 ? 20 : vRatio > 2.0 ? 14 : vRatio > 1.5 ? 8 : 0
  }

  // Funding (0-20)
  const frAbs = Math.abs(fr)
  danger += frAbs > 0.002 ? 20 : frAbs > 0.001 ? 14 : frAbs > 0.0005 ? 7 : 0

  // Regime chaos (0-15)
  danger += (regime === 'panic') ? 15 : regime === 'range' ? 8 : atmosphere.category === 'trap_risk' ? 10 : 0

  return Math.min(100, danger)
}

/**
 * Conviction score — port of brain.js:1531-1568
 */
export function computeConviction(
  entryScore: number,
  atmosphere: AtmosphereResult,
  mtf: MtfResult,
  ofiBlendBuy: number,
  signalData: { bullCount: number; bearCount: number } | null,
  dir: 'long' | 'short',
  danger: number,
): { conviction: number; convictionMult: number } {
  let cv = 0

  // Gate score (0-40)
  cv += Math.min(40, entryScore * 0.4)

  // Atmosphere confidence (0-15)
  cv += Math.min(15, atmosphere.confidence * 0.15)

  // MTF alignment (0-15)
  const mtfDir = dir === 'long' ? 'bull' : 'bear'
  if (mtf['1h'] === mtfDir) cv += 7
  if (mtf['4h'] === mtfDir) cv += 8

  // OFI alignment (0-10)
  if ((dir === 'long' && ofiBlendBuy > 57) || (dir === 'short' && ofiBlendBuy < 43)) cv += 10
  else if ((dir === 'long' && ofiBlendBuy < 43) || (dir === 'short' && ofiBlendBuy > 57)) cv -= 5

  // Signal consensus (0-5)
  if (signalData) {
    if ((dir === 'long' && signalData.bullCount > signalData.bearCount) ||
        (dir === 'short' && signalData.bearCount > signalData.bullCount)) cv += 5
  }

  const conviction = Math.max(0, Math.min(100, Math.round(cv)))

  // Sizing multiplier
  const cMult = conviction >= 60 ? 1.0 : conviction >= 40 ? 0.5 : 0.0
  const dMult = danger >= 80 ? 0.0 : danger >= 60 ? 0.6 : danger >= 40 ? 0.85 : 1.0
  const convictionMult = Math.round((cMult * dMult) * 100) / 100

  return { conviction, convictionMult }
}

/**
 * Full brain computation — orchestrates all sub-computations.
 * Called on every market data update (kline close or price change).
 */
export function computeBrain(inputs: BrainInputs): BrainComputeResult {
  const { klines, rsi, signalData, fr, ofiBlendBuy, profile } = inputs

  // Direction from signals
  const bullCount = signalData?.bullCount || 0
  const bearCount = signalData?.bearCount || 0
  const dir: 'long' | 'short' = bullCount >= bearCount ? 'long' : 'short'

  // 1. Regime
  const regime = detectRegimeEnhanced(klines)

  // 2. MTF
  const mtf = computeMtf(rsi)

  // 3. Sweep
  const sweep = detectSweepDisplacement(klines)

  // 4. Flow
  const flow = computeFlow(klines, ofiBlendBuy)

  // 5. Phase filter
  const phase = evaluateMarketPhase({
    regime: regime.regime,
    confidence: regime.confidence,
    trendBias: regime.slope20 > 0 ? 'bull' : 'bear',
    volatilityState: regime.atrPct > 2.0 ? 'extreme' : 'normal',
    trapRisk: 0, // no OF trap data in React yet
  })

  // 6. Atmosphere
  const atmosphere = computeAtmosphere(regime, phase, sweep, regime.regime, regime.atrPct)

  // 7. Safety gates
  const safetyGates = computeSafetyGates(inputs, regime)

  // 8. Context gates
  const contextGates = computeContextGates(dir, klines, mtf, flow, sweep)

  // 9. Entry score
  const rsi5m = rsi['5m'] || 50
  const { score: entryScore, entryReady } = computeEntryScore(safetyGates, contextGates, sweep, rsi5m, dir, profile)

  // 10. Danger
  const danger = computeDangerScore(klines, regime.atrPct, regime.regime, fr, atmosphere)

  // 11. Conviction
  const { conviction, convictionMult } = computeConviction(entryScore, atmosphere, mtf, ofiBlendBuy, signalData, dir, danger)

  return {
    regime, sweep, flow, mtf, phase, atmosphere,
    contextGates, safetyGates,
    entryScore, entryReady,
    danger, conviction, convictionMult, dir,
  }
}
