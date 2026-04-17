/**
 * Forecast computation engine — pure TypeScript port of forecast.js
 *
 * Ported from: public/js/brain/forecast.js
 * Functions: QEB detectors (divergence, climax, regime flip, liquidity proximity),
 *            exit risk score, exit action decision, probability score, scenario engine
 *
 * All functions are PURE — no DOM, no globals, no side effects.
 */

import type { Kline } from './brainCompute'

// ── Types ──

export interface SwingPivots {
  highs: Array<{ idx: number; price: number; ts: number }>
  lows: Array<{ idx: number; price: number; ts: number }>
}

export interface DivergenceResult {
  type: 'bull' | 'bear' | null
  conf: number
}

export interface ClimaxResult {
  dir: 'buy' | 'sell' | null
  mult: number
}

export interface RegimeFlipResult {
  from: string | null
  to: string | null
  conf: number
}

export interface LiquidityProximity {
  nearestAboveDistPct: number | null
  nearestBelowDistPct: number | null
  bias: string
}

export interface QExitSignals {
  divergence: DivergenceResult
  climax: ClimaxResult
  regimeFlip: RegimeFlipResult
  liquidity: LiquidityProximity
}

export interface QExitResult {
  risk: number
  action: string
  signals: QExitSignals
  confirm: { div: number; climax: number }
}

export interface ProbBreakdown {
  regime: number
  liquidity: number
  signals: number
  flow: number
}

export interface ScenarioResult {
  primary: string | null
  alternate: string | null
  failure: string | null
  updated: number
}

export interface ForecastInputs {
  klines: Kline[]
  price: number
  rsi5m: number
  regime: string
  regimeConfidence: number
  regimeSlope: number
  ofiBlendBuy: number
  fr: number | null
  oi: number | null
  oiPrev: number | null
  magnetBias: string
  // Positions
  posDir: 'LONG' | 'SHORT'
  hasOpenPosition: boolean
  // Previous state for regime flip detection
  prevRegime: string | null
  // Previous confirm counters (stateful across calls)
  prevConfirm: { div: number; climax: number }
  // Adaptive settings
  adaptEnabled: boolean
  adaptExitMult: number
  // Macro cortex
  atrPct: number
  prevMacroComposite: number
}

// ── RSI Array (per-bar) ──
// Port of calcRSIArr from forecast.js

function calcRSIArr(prices: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(prices.length).fill(null)
  if (prices.length < period + 1) return out
  let ag = 0, al = 0
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1]
    if (d > 0) ag += d; else al += Math.abs(d)
  }
  ag /= period
  al /= period
  out[period] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)))
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1]
    if (d > 0) { ag = (ag * (period - 1) + d) / period; al = al * (period - 1) / period }
    else { ag = ag * (period - 1) / period; al = (al * (period - 1) + Math.abs(d)) / period }
    out[i] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)))
  }
  return out
}

// ── Swing Pivots ──

function swingPivots(bars: Kline[], lookback = 60, win = 3): SwingPivots {
  const slice = bars.slice(-lookback)
  const highs: SwingPivots['highs'] = []
  const lows: SwingPivots['lows'] = []
  for (let i = win; i < slice.length - win; i++) {
    let isHigh = true, isLow = true
    for (let j = 1; j <= win; j++) {
      if (slice[i].high <= slice[i - j].high || slice[i].high <= slice[i + j].high) isHigh = false
      if (slice[i].low >= slice[i - j].low || slice[i].low >= slice[i + j].low) isLow = false
    }
    if (isHigh) highs.push({ idx: i, price: slice[i].high, ts: slice[i].time })
    if (isLow) lows.push({ idx: i, price: slice[i].low, ts: slice[i].time })
  }
  return { highs: highs.slice(-3), lows: lows.slice(-3) }
}

// ── (A1a) Divergence Detector ──

function detectDivergence(bars: Kline[]): DivergenceResult {
  if (!bars || bars.length < 40) return { type: null, conf: 0 }
  const pivots = swingPivots(bars, 80, 3)
  const closes = bars.map(b => b.close)
  const rsiArr = calcRSIArr(closes, 14)
  const validCount = rsiArr.filter(v => v !== null).length
  if (validCount < 10) return { type: null, conf: 0 }

  const sliceOffset = Math.max(0, bars.length - 80)

  // Bear divergence: price higher high, RSI lower high
  const highs = pivots.highs
  if (highs.length >= 2) {
    const ph1 = highs[highs.length - 2]
    const ph2 = highs[highs.length - 1]
    const rsiH1 = rsiArr[sliceOffset + ph1.idx] ?? 50
    const rsiH2 = rsiArr[sliceOffset + ph2.idx] ?? 50
    if (ph2.price > ph1.price && rsiH2 < rsiH1 - 3) {
      const conf = Math.min(90, Math.round(50 + (ph2.price - ph1.price) / ph1.price * 800 + (rsiH1 - rsiH2) * 1.2))
      return { type: 'bear', conf }
    }
  }

  // Bull divergence: price lower low, RSI higher low
  const lows = pivots.lows
  if (lows.length >= 2) {
    const pl1 = lows[lows.length - 2]
    const pl2 = lows[lows.length - 1]
    const rsiL1 = rsiArr[sliceOffset + pl1.idx] ?? 50
    const rsiL2 = rsiArr[sliceOffset + pl2.idx] ?? 50
    if (pl2.price < pl1.price && rsiL2 > rsiL1 + 3) {
      const conf = Math.min(90, Math.round(50 + (pl1.price - pl2.price) / pl1.price * 800 + (rsiL2 - rsiL1) * 1.2))
      return { type: 'bull', conf }
    }
  }

  return { type: null, conf: 0 }
}

// ── (A1b) Volume Climax Detector ──

function detectClimax(bars: Kline[]): ClimaxResult {
  if (!bars || bars.length < 22) return { dir: null, mult: 0 }
  const recent = bars.slice(-21)
  const sma20vol = recent.slice(0, 20).reduce((a, b) => a + b.volume, 0) / 20
  if (sma20vol <= 0) return { dir: null, mult: 0 }
  const last = recent[recent.length - 1]
  const mult = last.volume / sma20vol
  if (mult < 3) return { dir: null, mult: 0 }
  const dir: 'buy' | 'sell' = last.close < last.open ? 'sell' : 'buy'
  return { dir, mult: parseFloat(mult.toFixed(2)) }
}

// ── (A1c) Regime Flip Detector ──
// Stateful: needs previous regime passed in

function detectRegimeFlip(currentRegime: string, prevRegime: string | null, confidence: number): RegimeFlipResult {
  if (!currentRegime || !prevRegime) return { from: null, to: null, conf: 0 }
  if (prevRegime === currentRegime) return { from: null, to: null, conf: 0 }
  const wasStrong = prevRegime === 'trend' || prevRegime === 'breakout'
  const isWeaker = currentRegime === 'range' || currentRegime === 'volatile'
  if (wasStrong && isWeaker) {
    return { from: prevRegime, to: currentRegime, conf: confidence }
  }
  return { from: null, to: null, conf: 0 }
}

// ── (A1d) Liquidity Proximity ──
// NOTE: S.magnets not available in React app yet — uses defaults

function computeLiquidityProximity(
  _price: number,
  magnetBias: string,
): LiquidityProximity {
  // S.magnets is not available in React app — no magnet data source yet.
  // Returns bias from marketStore, distances null.
  return {
    nearestAboveDistPct: null,
    nearestBelowDistPct: null,
    bias: magnetBias || 'neutral',
  }
}

// ── (A2) Compute Exit Risk Score (0–100) ──

function computeExitRisk(
  posDir: 'LONG' | 'SHORT',
  signals: QExitSignals,
  ofiBlendBuy: number,
  oi: number | null,
  oiPrev: number | null,
): number {
  let risk = 0

  // Divergence: up to 35 pts
  const div = signals.divergence
  if (div.type) {
    const divContra = (posDir === 'LONG' && div.type === 'bear') ||
      (posDir === 'SHORT' && div.type === 'bull')
    if (divContra) risk += Math.round(div.conf * 0.35)
  }

  // Climax: up to 40 pts
  const clim = signals.climax
  if (clim.dir) {
    const climContra = (posDir === 'LONG' && clim.dir === 'sell') ||
      (posDir === 'SHORT' && clim.dir === 'buy')
    if (climContra) risk += Math.min(40, Math.round(clim.mult * 12))
  }

  // Regime flip: up to 20 pts
  const flip = signals.regimeFlip
  if (flip.from && flip.to) {
    risk += Math.round(flip.conf * 0.20)
  }

  // Liquidity proximity: +10-20 if close to magnet in contra direction
  const liq = signals.liquidity
  if (posDir === 'LONG' && liq.nearestAboveDistPct !== null && liq.nearestAboveDistPct < 0.4) risk += 18
  else if (posDir === 'LONG' && liq.nearestAboveDistPct !== null && liq.nearestAboveDistPct < 1.0) risk += 8
  if (posDir === 'SHORT' && liq.nearestBelowDistPct !== null && liq.nearestBelowDistPct < 0.4) risk += 18
  else if (posDir === 'SHORT' && liq.nearestBelowDistPct !== null && liq.nearestBelowDistPct < 1.0) risk += 8

  // OFI/OI contra: up to 15 pts
  const ofi = ofiBlendBuy
  if (posDir === 'LONG' && ofi < 35) risk += Math.round((35 - ofi) * 0.5)
  if (posDir === 'SHORT' && ofi > 65) risk += Math.round((ofi - 65) * 0.5)
  if (oi != null && oiPrev != null && oiPrev > 0) {
    const oiChg = (oi - oiPrev) / oiPrev * 100
    if (posDir === 'LONG' && oiChg < -1.5) risk += Math.min(10, Math.round(Math.abs(oiChg) * 2))
    if (posDir === 'SHORT' && oiChg > 1.5) risk += Math.min(10, Math.round(oiChg * 2))
  }

  return Math.min(100, Math.max(0, Math.round(risk)))
}

// ── (A3) Decide Exit Action ──

function decideExitAction(
  risk: number,
  confirmed: boolean,
  adaptEnabled: boolean,
  adaptExitMult: number,
): string {
  const baseEmergency = 80
  let emergencyTh = (adaptEnabled && adaptExitMult !== 1.0)
    ? Math.round(baseEmergency / adaptExitMult)
    : baseEmergency
  emergencyTh = Math.max(65, Math.min(90, emergencyTh))

  if (risk < 40) return 'HOLD'
  if (risk < 60) return 'TIGHTEN'
  if (risk < emergencyTh) {
    if (!confirmed) return 'TIGHTEN'
    return 'REDUCE'
  }
  // risk >= emergencyTh
  if (!confirmed) return 'TIGHTEN_HARD'
  return 'EMERGENCY'
}

// ── (B) Probability Score ──

function computeProbScore(
  dir: 'LONG' | 'SHORT',
  regime: string,
  regimeConfidence: number,
  regimeSlope: number,
  ofiBlendBuy: number,
  liq: LiquidityProximity,
  fr: number | null,
  oi: number | null,
  oiPrev: number | null,
): { total: number; breakdown: ProbBreakdown } {
  // 1. Regime alignment (0–35)
  let regScore = 0
  if (regime === 'trend') {
    const aligned = (dir === 'LONG' && regimeSlope > 0) || (dir === 'SHORT' && regimeSlope < 0)
    regScore = aligned ? Math.min(35, Math.round(regimeConfidence * 0.35)) : Math.round(regimeConfidence * 0.10)
  } else if (regime === 'breakout') {
    regScore = 22
  } else if (regime === 'range') {
    regScore = 12
  } else if (regime === 'volatile') {
    regScore = 5
  }

  // 2. Liquidity bias + distance (0–25)
  let liqScore = 10 // neutral base
  const dirBias = dir === 'LONG' ? 'bull' : 'bear'
  if (liq.bias === dirBias) liqScore += 10
  if (dir === 'LONG' && liq.nearestBelowDistPct !== null && liq.nearestBelowDistPct > 1.5) liqScore += 5
  if (dir === 'SHORT' && liq.nearestAboveDistPct !== null && liq.nearestAboveDistPct > 1.5) liqScore += 5
  liqScore = Math.min(25, liqScore)

  // 3. Signal alignment (0–25) — no signalData available in React yet
  const sigScore = 0

  // 4. Flow/OI/funding confirmation (0–15)
  let flowScore = 0
  const ofi = ofiBlendBuy
  if (dir === 'LONG' && ofi > 55) flowScore += Math.min(8, Math.round((ofi - 55) * 0.5))
  if (dir === 'SHORT' && ofi < 45) flowScore += Math.min(8, Math.round((45 - ofi) * 0.5))
  if (fr !== null && fr !== undefined) {
    if (dir === 'LONG' && fr < 0) flowScore += 4
    if (dir === 'SHORT' && fr > 0) flowScore += 4
  }
  if (oi != null && oiPrev != null && oiPrev > 0) {
    const oiChg = (oi - oiPrev) / oiPrev * 100
    if (dir === 'LONG' && oiChg > 0.5) flowScore += 3
    if (dir === 'SHORT' && oiChg < -0.5) flowScore += 3
  }
  flowScore = Math.min(15, flowScore)

  const total = Math.min(100, regScore + liqScore + sigScore + flowScore)

  return { total, breakdown: { regime: regScore, liquidity: liqScore, signals: sigScore, flow: flowScore } }
}

// ── (C) Scenario Engine ──

function computeScenario(
  regime: string,
  regimeConfidence: number,
  regimeSlope: number,
  probScore: number,
  divSignal: DivergenceResult,
  climSignal: ClimaxResult,
): ScenarioResult {
  const isBull = regimeSlope >= 0


  // Primary scenario
  const primary = (isBull ? '▲ Bullish' : '▼ Bearish')
    + ' — ' + regime.toUpperCase() + ' regime'
    + (regimeConfidence > 0 ? ' (' + regimeConfidence + '% conf)' : '')
    + '. Target: ' + (isBull ? 'next resistance' : 'next support') + '.'

  // Alternate scenario
  const altConf = Math.max(10, Math.round(100 - probScore))
  const alternate = (isBull ? '▼ Bear reversal' : '▲ Bull reversal')
    + ' scenario (' + altConf + '% alt conf)'
    + '. Watch ' + (isBull ? 'nearby support' : 'nearby resistance') + ' for early signs.'

  // Failure / invalidation
  const failure = 'Invalidation: '
    + 'loss of structural support'
    + (divSignal.type ? ' + ' + divSignal.type + ' divergence' : '')
    + (climSignal.dir ? ' + vol climax (' + climSignal.dir + ')' : '')
    + ' would cancel this scenario.'

  return { primary, alternate, failure, updated: Date.now() }
}

// ── (D) Macro Cortex ──
// Port of computeMacroCortex from risk.js

export interface MacroResult {
  cycleScore: number
  sentimentScore: number
  flowScore: number
  composite: number
  slope: number
  phase: string
  confidence: number
  lastUpdate: number
}

function macroPhaseFromComposite(x: number): string {
  if (x <= 30) return 'ACCUMULATION'
  if (x <= 55) return 'EARLY_BULL'
  if (x <= 75) return 'LATE_BULL'
  if (x <= 90) return 'DISTRIBUTION'
  return 'TOP_RISK'
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function computeMacroCortex(
  regime: string,
  regimeConfidence: number,
  atrPct: number,
  ofiBlendBuy: number,
  prevComposite: number,
): MacroResult {
  // Regime component (0..40)
  const regConf = clamp(regimeConfidence, 0, 100) / 100
  let regScore = 20
  if (regime.includes('trend')) regScore = 30
  if (regime.includes('breakout')) regScore = 34
  if (regime.includes('range')) regScore = 18
  if (regime.includes('volatile')) regScore = 14
  regScore *= (0.6 + 0.4 * regConf)

  // Volatility penalty via ATR% (0..25)
  const atrClamped = clamp(atrPct * 100, 0, 8)
  const volScore = clamp(25 - atrClamped * 3, 0, 25)

  // Flow score from OFI (0..20) — simplified since we only have blendBuy
  // Map 0-100 blendBuy to -1..+1 bias, then 0..20
  const bias = (ofiBlendBuy - 50) / 50
  const flowScore = 10 + bias * 10

  // Sentiment (0..15) — no F&G widget in React, use neutral
  const sentScore = 7

  const composite = clamp(Math.round(regScore + volScore + flowScore + sentScore), 0, 100)
  const slope = clamp((composite - prevComposite) / 25, -1, 1)

  return {
    cycleScore: composite,
    flowScore: clamp(Math.round(flowScore * 5), 0, 100),
    sentimentScore: clamp(Math.round(sentScore * 6.6), 0, 100),
    composite,
    slope: parseFloat(slope.toFixed(3)),
    phase: macroPhaseFromComposite(composite),
    confidence: clamp(Math.round(30 + regimeConfidence * 0.7), 0, 100),
    lastUpdate: Date.now(),
  }
}

// ── Main Orchestrator ──

export interface ForecastResult {
  qexit: QExitResult
  probScore: number
  probBreakdown: ProbBreakdown
  scenario: ScenarioResult
  macro: MacroResult
  // Return updated regime for flip tracking
  currentRegime: string
}

export function computeForecast(inputs: ForecastInputs): ForecastResult {
  const {
    klines, price, regime, regimeConfidence, regimeSlope,
    ofiBlendBuy, fr, oi, oiPrev, magnetBias,
    posDir, prevRegime, prevConfirm,
    adaptEnabled, adaptExitMult,
    atrPct, prevMacroComposite,
  } = inputs

  // Run QEB detectors
  const divergence = detectDivergence(klines)
  const climax = detectClimax(klines)
  const regimeFlip = detectRegimeFlip(regime, prevRegime, regimeConfidence)
  const liquidity = computeLiquidityProximity(price, magnetBias)

  const signals: QExitSignals = { divergence, climax, regimeFlip, liquidity }

  // Update 2-bar confirm counters
  const confirm = { ...prevConfirm }
  if (divergence.type) confirm.div = Math.min(2, confirm.div + 1)
  else confirm.div = Math.max(0, confirm.div - 1)
  if (climax.dir) confirm.climax = Math.min(2, confirm.climax + 1)
  else confirm.climax = Math.max(0, confirm.climax - 1)

  // Exit risk
  const risk = computeExitRisk(posDir, signals, ofiBlendBuy, oi, oiPrev)
  // No macroAdjust — BM.adapt not enabled in current setup
  const adjustedRisk = adaptEnabled
    ? Math.min(100, Math.max(0, Math.round(risk * (adaptExitMult !== 0 ? 1 / adaptExitMult : 1))))
    : risk

  const confirmed = confirm.div >= 2 || confirm.climax >= 2
  const action = decideExitAction(adjustedRisk, confirmed, adaptEnabled, adaptExitMult)

  // Prob score
  const prob = computeProbScore(posDir, regime, regimeConfidence, regimeSlope, ofiBlendBuy, liquidity, fr, oi, oiPrev)

  // Scenario
  const scenario = computeScenario(regime, regimeConfidence, regimeSlope, prob.total, divergence, climax)

  // Macro cortex
  const macro = computeMacroCortex(regime, regimeConfidence, atrPct, ofiBlendBuy, prevMacroComposite)

  return {
    qexit: { risk: adjustedRisk, action, signals, confirm },
    probScore: prob.total,
    probBreakdown: prob.breakdown,
    scenario,
    macro,
    currentRegime: regime,
  }
}
