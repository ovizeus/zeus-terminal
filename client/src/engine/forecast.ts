// Zeus — engine/forecast.ts
// Ported 1:1 from public/js/brain/forecast.js (Phase 5A)
// Quantum Exit Brain, scenario engine, probability score

import { fmtNow } from '../data/marketDataHelpers'
import { fmt, fP } from '../utils/format'
import { _ZI } from '../constants/icons'
import { macroAdjustExitRisk as _macroAdjustExitRisk } from '../trading/risk'
import { DEV , devLog } from '../utils/dev'
import { closeDemoPos } from '../data/marketDataClose'

const w = window as any

// QEB swing pivots
function _qebSwingPivots(bars: any[], lookback?: number, windowSize?: number): { highs: any[], lows: any[] } {
  try {
    lookback = lookback || 60
    windowSize = windowSize || 3
    const slice = bars.slice(-lookback)
    const highs: any[] = []
    const lows: any[] = []
    for (let i = windowSize; i < slice.length - windowSize; i++) {
      let isHigh = true, isLow = true
      for (let j = 1; j <= windowSize; j++) {
        if (slice[i].high <= slice[i - j].high || slice[i].high <= slice[i + j].high) isHigh = false
        if (slice[i].low >= slice[i - j].low || slice[i].low >= slice[i + j].low) isLow = false
      }
      if (isHigh) highs.push({ idx: i, price: slice[i].high, ts: slice[i].time })
      if (isLow) lows.push({ idx: i, price: slice[i].low, ts: slice[i].time })
    }
    return { highs: highs.slice(-3), lows: lows.slice(-3) }
  } catch (e) { return { highs: [], lows: [] } }
}

// ── (A1a) Divergence Detector ────────────────────────────────────
// Uses swing pivots + RSI peaks/valleys. Returns {type, conf} or null.
// 2-pivot minimum (needs 2 swings to compare).
// [v105 FIX Bug2] calcRSIArr la nivel GLOBAL — returneaza array RSI per-bara
function _calcRSIArr(prices: number[], p?: number): (number | null)[] {
  p = p || 14
  const out: (number | null)[] = new Array(prices.length).fill(null)
  if (prices.length < p + 1) return out
  let g = 0, l = 0
  for (let i = 1; i <= p; i++) { const d = prices[i] - prices[i - 1]; if (d > 0) g += d; else l += Math.abs(d) }
  let ag = g / p, al = l / p
  out[p] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)))
  for (let i = p + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1]
    if (d > 0) { ag = (ag * (p - 1) + d) / p; al = al * (p - 1) / p }
    else { ag = ag * (p - 1) / p; al = (al * (p - 1) + Math.abs(d)) / p }
    out[i] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)))
  }
  return out
}

function _qebDetectDivergence(bars: any[], rsiNow: number): { type: string, conf: number } | null {
  try {
    if (!bars || bars.length < 40) return null
    const pivots = _qebSwingPivots(bars, 80, 3)
    const closes = bars.map(function (b: any) { return b.close })
    // [v105 FIX Bug2] folosim calcRSIArr (array per-bara) in loc de calcRSI (scalar)
    const rsiArr = _calcRSIArr(closes, 14)
    const validCount = rsiArr.filter(function (v) { return v !== null }).length
    if (!rsiArr || validCount < 10) return null

    // [FIX QA-H6] Pivot indices are relative to bars.slice(-80). Offset to full array.
    const sliceOffset = Math.max(0, bars.length - 80)

    // Bear divergence: price makes higher high but RSI makes lower high
    const highs = pivots.highs
    if (highs.length >= 2) {
      const ph1 = highs[highs.length - 2]
      const ph2 = highs[highs.length - 1]
      const rsiH1 = rsiArr[sliceOffset + ph1.idx] != null ? rsiArr[sliceOffset + ph1.idx]! : 50
      const rsiH2 = rsiArr[sliceOffset + ph2.idx] != null ? rsiArr[sliceOffset + ph2.idx]! : 50
      if (ph2.price > ph1.price && rsiH2 < rsiH1 - 3) {
        const conf = Math.min(90, Math.round(50 + (ph2.price - ph1.price) / ph1.price * 800
          + (rsiH1 - rsiH2) * 1.2))
        return { type: 'bear', conf: conf }
      }
    }
    // Bull divergence: price makes lower low but RSI makes higher low
    const lows = pivots.lows
    if (lows.length >= 2) {
      const pl1 = lows[lows.length - 2]
      const pl2 = lows[lows.length - 1]
      const rsiL1 = rsiArr[sliceOffset + pl1.idx] != null ? rsiArr[sliceOffset + pl1.idx]! : 50
      const rsiL2 = rsiArr[sliceOffset + pl2.idx] != null ? rsiArr[sliceOffset + pl2.idx]! : 50
      if (pl2.price < pl1.price && rsiL2 > rsiL1 + 3) {
        const conf2 = Math.min(90, Math.round(50 + (pl1.price - pl2.price) / pl1.price * 800
          + (rsiL2 - rsiL1) * 1.2))
        return { type: 'bull', conf: conf2 }
      }
    }
    return null
  } catch (e) { return null }
}

// ── (A1b) Volume Climax Detector ─────────────────────────────────
// volCur > 3 × SMA20(volume) AND candle direction contra position.
// Returns {dir, mult} or null.
function _qebDetectClimax(bars: any[]): { dir: string, mult: number } | null {
  try {
    if (!bars || bars.length < 22) return null
    const recent = bars.slice(-21)
    const sma20vol = recent.slice(0, 20).reduce(function (a: number, b: any) { return a + b.volume }, 0) / 20
    if (sma20vol <= 0) return null
    const last = recent[recent.length - 1]
    const mult = last.volume / sma20vol
    if (mult < 3) return null
    const dir = last.close < last.open ? 'sell' : 'buy'
    return { dir: dir, mult: parseFloat(mult.toFixed(2)) }
  } catch (e) { return null }
}

// ── (A1c) Regime Flip Detector ───────────────────────────────────
// Detects trend→range or trend→reversal using BRAIN.regime history.
// Returns {from, to, conf} or null.
let _qebLastRegime: string | null = null
// [S2B1-T1] Reset forecast state on symbol change — called from setSymbol()
export function resetForecast(): void { _qebLastRegime = null }
function _qebDetectRegimeFlip(): { from: string, to: string, conf: number } | null {
  try {
    const cur = (typeof w.BRAIN !== 'undefined') ? w.BRAIN.regime : null
    const conf = (typeof w.BRAIN !== 'undefined') ? (w.BRAIN.regimeConfidence || 0) : 0
    if (!cur) return null
    if (_qebLastRegime && _qebLastRegime !== cur) {
      const prev = _qebLastRegime
      _qebLastRegime = cur
      // Only signal flip if previous was trend/breakout → now range/volatile
      const wasStrong = (prev === 'trend' || prev === 'breakout')
      const isWeaker = (cur === 'range' || cur === 'volatile')
      if (wasStrong && isWeaker) {
        return { from: prev, to: cur, conf: conf }
      }
    }
    _qebLastRegime = cur
    return null
  } catch (e) { return null }
}

// ── (A1d) Liquidity Proximity ────────────────────────────────────
// Returns {nearestAboveDistPct, nearestBelowDistPct, bias}.
function _qebLiquidityProximity(): { nearestAboveDistPct: number | null, nearestBelowDistPct: number | null, bias: string } {
  try {
    const price = w.S && w.S.price ? w.S.price : 0
    if (!price) return { nearestAboveDistPct: null, nearestBelowDistPct: null, bias: 'neutral' }
    const magnets = (w.S && w.S.magnets) ? w.S.magnets : { above: [], below: [] }
    const above = magnets.above && magnets.above[0]
    const below = magnets.below && magnets.below[0]
    const distA = above ? ((above.price - price) / price * 100) : null
    const distB = below ? ((price - below.price) / price * 100) : null
    const bias = (w.S && w.S.magnetBias) ? w.S.magnetBias : 'neutral'
    return { nearestAboveDistPct: distA, nearestBelowDistPct: distB, bias: bias }
  } catch (e) { return { nearestAboveDistPct: null, nearestBelowDistPct: null, bias: 'neutral' } }
}

// ── QEB: Position R-multiple calculator ───────────────────────
function _posR(pos: any): number | null {
  if (!pos || !pos.entry || !pos.sl) return null
  const price = (typeof w.S !== 'undefined' && w.S.price) ? w.S.price : pos.entry
  const risk = Math.abs(pos.entry - pos.sl)
  if (risk <= 0) return null
  const profit = pos.side === 'LONG' ? price - pos.entry : pos.entry - price
  return profit / risk
}

// ── (A2) Compute Exit Risk Score (0–100) ─────────────────────────
export function computeExitRisk(posDir: string): number {
  try {
    posDir = posDir || 'LONG'
    let risk = 0
    const sigs = w.BM.qexit.signals

    // Divergence: up to 35 pts
    const div = sigs.divergence
    if (div.type) {
      const divContra = (posDir === 'LONG' && div.type === 'bear') ||
        (posDir === 'SHORT' && div.type === 'bull')
      if (divContra) risk += Math.round(div.conf * 0.35)
    }

    // Climax: up to 40 pts
    const clim = sigs.climax
    if (clim.dir) {
      const climContra = (posDir === 'LONG' && clim.dir === 'sell') ||
        (posDir === 'SHORT' && clim.dir === 'buy')
      if (climContra) risk += Math.min(40, Math.round(clim.mult * 12))
    }

    // Regime flip: up to 20 pts
    const flip = sigs.regimeFlip
    if (flip.from && flip.to) {
      // Any flip away from trend is bad for open positions
      risk += Math.round(flip.conf * 0.20)
    }

    // Liquidity trap zone: +10–20 if very close to magnet in contra direction
    const liq = sigs.liquidity
    // [FIX QA-H9] Use else-if to prevent double-counting proximity risk
    if (posDir === 'LONG' && liq.nearestAboveDistPct !== null && liq.nearestAboveDistPct < 0.4) risk += 18
    else if (posDir === 'LONG' && liq.nearestAboveDistPct !== null && liq.nearestAboveDistPct < 1.0) risk += 8
    if (posDir === 'SHORT' && liq.nearestBelowDistPct !== null && liq.nearestBelowDistPct < 0.4) risk += 18
    else if (posDir === 'SHORT' && liq.nearestBelowDistPct !== null && liq.nearestBelowDistPct < 1.0) risk += 8

    // OFI/OI contra: up to 15 pts
    const ofi = (typeof w.BRAIN !== 'undefined' && w.BRAIN.ofi) ? (w.BRAIN.ofi.blendBuy || 50) : 50
    if (posDir === 'LONG' && ofi < 35) risk += Math.round((35 - ofi) * 0.5)
    if (posDir === 'SHORT' && ofi > 65) risk += Math.round((ofi - 65) * 0.5)
    if (w.S && w.S.oi && w.S.oiPrev && w.S.oiPrev > 0) {
      const oiChg = (w.S.oi - w.S.oiPrev) / w.S.oiPrev * 100
      if (posDir === 'LONG' && oiChg < -1.5) risk += Math.min(10, Math.round(Math.abs(oiChg) * 2))
      if (posDir === 'SHORT' && oiChg > 1.5) risk += Math.min(10, Math.round(oiChg * 2))
    }

    return Math.min(100, Math.max(0, Math.round(risk)))
  } catch (e) { return 0 }
}

// ── (A3) Decide Exit Action ──────────────────────────────────────
// Does NOT execute anything. Returns action string only.
export function decideExitAction(risk: number, posDir: string, dslActive: boolean): string {
  try {
    // 2-bar confirm gate: divergence OR climax must be confirmed ≥2 bars
    const confirmed = (w.BM.qexit.confirm.div >= 2) || (w.BM.qexit.confirm.climax >= 2)

    // [Etapa 5] Adaptive exitMult: ajustează doar emergency threshold
    // Gated: BM.adaptive.enabled && exitMult !== 1.0
    const baseEmergency = 80
    let emergencyTh = (w.BM.adapt && w.BM.adapt.enabled && w.BM.adapt.exitMult !== 1.0)
      ? Math.round(baseEmergency / w.BM.adapt.exitMult)
      : baseEmergency
    // Clamp threshold să nu devină absurd (ex: nu sub 65, nu peste 90)
    emergencyTh = Math.max(65, Math.min(90, emergencyTh))

    if (risk < 40) return 'HOLD'
    if (risk < 60) return 'TIGHTEN'
    if (risk < emergencyTh) {
      if (!confirmed) return 'TIGHTEN' // not confirmed → downgrade
      return dslActive ? 'TIGHTEN' : 'REDUCE'
    }
    // risk >= emergencyTh
    if (!confirmed) return 'TIGHTEN_HARD' // need 2-bar confirm for EMERGENCY
    if (dslActive) {
      const smartOn = w.USER_SETTINGS && w.USER_SETTINGS.autoTrade &&
        w.USER_SETTINGS.autoTrade.smartExitEnabled === true
      const divConf = w.BM.qexit.signals.divergence.conf >= 70
      const climConf = w.BM.qexit.signals.climax.mult >= 3
      const doubleConfirmed = divConf && climConf
      if (smartOn && doubleConfirmed) return 'EMERGENCY'
      return 'TIGHTEN_HARD'
    }
    return 'EMERGENCY'
  } catch (e) { return 'HOLD' }
}

// ── (A4) Apply Quantum Exit (advisory-first, exec gated) ─────────
export function applyQuantumExit(pos: any): void {
  try {
    if (!pos) return
    // Cooldown: 60s per position
    const now = Date.now()
    if (now - w.BM.qexit.lastTs < 60000) return

    const action = w.BM.qexit.action
    const risk = w.BM.qexit.risk
    // Profit Gate: if position hasn't reached 0.25R, no tighten/close — advisory only
    const r = _posR(pos)
    if (r !== null && r < 0.25) {
      // Below 0.25R: too early, advisory log only, no action
      if (DEV?.enabled && action !== 'HOLD') devLog?.('[QEB] Profit gate: R=' + r.toFixed(2) + ' < 0.25 → no action', 'info')
      return
    }

    const smartOn = w.USER_SETTINGS && w.USER_SETTINGS.autoTrade &&
      w.USER_SETTINGS.autoTrade.smartExitEnabled === true
    const dslActive = (typeof w.DSL !== 'undefined') &&
      w.DSL.enabled &&
      w.DSL.positions &&
      w.DSL.positions[String(pos.id)] &&
      w.DSL.positions[String(pos.id)].active === true
    const reason = 'QEB: ' + action + ' | risk=' + risk + ' | dsl=' + (dslActive ? 'ON' : 'OFF')

    if (action === 'HOLD') return

    w.BM.qexit.lastTs = now
    w.BM.qexit.lastReason = reason

    // ── TIGHTEN / TIGHTEN_HARD — advisory only, no close ─────────
    if (action === 'TIGHTEN' || action === 'TIGHTEN_HARD') {
      // Set shadowStop for UI display — does NOT touch DSL
      if (w.S.atr && pos.entry) {
        const atrMult = action === 'TIGHTEN_HARD' ? 1.0 : 1.5
        const shadowVal = pos.side === 'LONG'
          ? pos.entry + (w.S.atr * atrMult)   // tighten above entry as floor ref
          : pos.entry - (w.S.atr * atrMult)
        w.BM.qexit.shadowStop = shadowVal
      }
      _qebNotify(action, reason, pos)
      return
    }

    // ── REDUCE — only if partial close hook available ─────────────
    if (action === 'REDUCE') {
      // v1: no partial close hook available → fallback to TIGHTEN_HARD advisory
      _qebNotify('TIGHTEN_HARD', reason + ' [no partial close — advisory]', pos)
      return
    }

    // ── EMERGENCY — gated: smartExitEnabled must be true ─────────
    if (action === 'EMERGENCY') {
      if (!smartOn) {
        // Advisory only — user must enable smart exit
        _qebNotify('EMERGENCY_ADVISORY', reason + ' [auto-exec disabled]', pos)
        return
      }
      // Extra safety: DSL active → no close unless double-confirmed (handled in decideExitAction)
      // If we reach here: smartOn + action already decided by decideExitAction
      {
        closeDemoPos(pos.id, reason)
        _qebNotify('EMERGENCY_EXEC', reason, pos)
        if (typeof w.srRecord === 'function') {
          try { w.srRecord('qexit', 'EMERGENCY EXIT', pos.side, risk) } catch (_) { }
        }
      }
    }

  } catch (e: any) {
    console.warn('[QEB] applyQuantumExit error:', e.message)
  }
}

// ── Notify helper ────────────────────────────────────────────────
function _qebNotify(action: string, reason: string, pos: any): void {
  try {
    const sym = pos ? (pos.sym || w.S.symbol || 'BTC') : (w.S.symbol || 'BTC')
    const msg = 'QEB [' + sym + '] ' + action + ': ' + reason
    if (typeof w.ncAdd === 'function') w.ncAdd('warning', 'qexit', msg)
    devLog(msg, action.includes('EMERGENCY') ? 'error' : 'warning')
  } catch (e) { /* silent */ }
}

// ── Macro-adjust exit risk ────────────────────────────────────────
function macroAdjustExitRisk(rawRisk: number): number {
  // This function is called but defined in trading/risk — delegate to direct import
  if (typeof _macroAdjustExitRisk === 'function') return _macroAdjustExitRisk(rawRisk)
  return rawRisk
}

// ── Main QEB update loop ─────────────────────────────────────────
export function runQuantumExitUpdate(): void {
  try {
    const bars = w.S.chartBars || w.S.klines || []
    if (!bars.length || !w.S.price) return

    const rsiNow = (w.S.rsiData && w.S.rsiData['5m']) || (w.S.rsi && w.S.rsi['5m']) || 50

    // Run detectors — update BM.qexit.signals
    const divResult = _qebDetectDivergence(bars, rsiNow)
    const climResult = _qebDetectClimax(bars)
    const flipResult = _qebDetectRegimeFlip()
    const liqResult = _qebLiquidityProximity()

    w.BM.qexit.signals.divergence = divResult || { type: null, conf: 0 }
    w.BM.qexit.signals.climax = climResult || { dir: null, mult: 0 }
    w.BM.qexit.signals.regimeFlip = flipResult || { from: null, to: null, conf: 0 }
    w.BM.qexit.signals.liquidity = liqResult

    // Find first open position for risk calc (auto positions first)
    let openPos = null
    if (typeof w.TP !== 'undefined' && w.TP.demoPositions) {
      openPos = w.TP.demoPositions.find(function (p: any) { return !p.closed && p.autoTrade })
        || w.TP.demoPositions.find(function (p: any) { return !p.closed })
    }

    const posDir = openPos ? openPos.side : 'LONG'
    const dslActive = openPos && typeof w.DSL !== 'undefined' && w.DSL.enabled &&
      w.DSL.positions && w.DSL.positions[openPos.id] &&
      w.DSL.positions[openPos.id].active === true

    // Update 2-bar confirm counters
    const sig = w.BM.qexit.signals
    if (sig.divergence.type) w.BM.qexit.confirm.div = Math.min(2, w.BM.qexit.confirm.div + 1)
    else w.BM.qexit.confirm.div = Math.max(0, w.BM.qexit.confirm.div - 1)
    if (sig.climax.dir) w.BM.qexit.confirm.climax = Math.min(2, w.BM.qexit.confirm.climax + 1)
    else w.BM.qexit.confirm.climax = Math.max(0, w.BM.qexit.confirm.climax - 1)

    // Compute risk + macro-adjust
    const rawRisk = computeExitRisk(posDir)
    const risk = macroAdjustExitRisk(rawRisk)
    w.BM.qexit.risk = risk
    w.BM.qexit.action = decideExitAction(risk, posDir, dslActive)

    // Apply (advisory or exec depending on toggle)
    if (openPos) applyQuantumExit(openPos)

    // Compute prob score regardless of open position
    computeProbScore(posDir)

    // Update scenario
    updateScenarioData()

    // Update UI
    _qebUpdateRiskUI()

  } catch (e: any) {
    console.warn('[QEB] runQuantumExitUpdate error:', e.message)
  }
}

// ── Update risk bar UI ───────────────────────────────────────────
function _qebUpdateRiskUI(): void {
  try {
    const hasPos = typeof w.TP !== 'undefined' && w.TP.demoPositions &&
      w.TP.demoPositions.some(function (p: any) { return !p.closed })
    const strip = document.getElementById('qexit-risk-strip')
    if (strip) strip.style.display = hasPos ? '' : 'none'
    if (!hasPos) return

    const risk = w.BM.qexit.risk
    const action = w.BM.qexit.action

    const fillEl = document.getElementById('qexit-bar-fill')
    const valEl = document.getElementById('qexit-risk-val')
    const badgeEl = document.getElementById('qexit-action-badge')
    const sigsEl = document.getElementById('qexit-sigs-detail')
    const advEl = document.getElementById('qexit-advisory')

    const col = risk < 40 ? '#556677' : risk < 60 ? '#f0c040' : risk < 80 ? '#ff8844' : '#ff2244'
    if (fillEl) { (fillEl as HTMLElement).style.width = risk + '%'; (fillEl as HTMLElement).style.background = col }
    if (valEl) { valEl.textContent = risk; (valEl as HTMLElement).style.color = col }
    if (badgeEl) { badgeEl.textContent = action; badgeEl.className = 'qexit-action ' + action }

    // Signal details
    if (sigsEl) {
      const sigs = w.BM.qexit.signals
      const fmtPFn = fP
      const rows: string[] = []
      if (sigs.divergence.type) {
        rows.push('<span class="qexit-sig-name">DIVERGENCE</span> '
          + (sigs.divergence.type === 'bear' ? '<span style="color:#ff4455">BEAR</span>' : '<span style="color:#00d97a">BULL</span>')
          + ' <span style="color:#556677">conf ' + sigs.divergence.conf + '%</span>')
      }
      if (sigs.climax.dir) {
        rows.push('<span class="qexit-sig-name">VOL CLIMAX</span> '
          + (sigs.climax.dir === 'sell' ? '<span style="color:#ff4455">SELL</span>' : '<span style="color:#00d97a">BUY</span>')
          + ' <span style="color:#556677">\u00D7' + sigs.climax.mult + ' avg</span>')
      }
      if (sigs.regimeFlip.from) {
        rows.push('<span class="qexit-sig-name">REGIME FLIP</span> '
          + '<span style="color:#f0c040">' + sigs.regimeFlip.from.toUpperCase() + ' \u2192 ' + sigs.regimeFlip.to.toUpperCase() + '</span>')
      }
      if (sigs.liquidity.nearestAboveDistPct !== null) {
        rows.push('<span class="qexit-sig-name">LIQ ABOVE</span> '
          + '<span style="color:#8fa0b0">+' + (sigs.liquidity.nearestAboveDistPct).toFixed(2) + '%</span>')
      }
      sigsEl.innerHTML = rows.map(function (r) {
        return '<div class="qexit-sig-row">' + r + '</div>'
      }).join('')
    }

    // Advisory line
    if (advEl) {
      const smartOn = w.USER_SETTINGS && w.USER_SETTINGS.autoTrade &&
        w.USER_SETTINGS.autoTrade.smartExitEnabled === true
      advEl.innerHTML = smartOn
        ? _ZI.bolt + ' Smart Exit ENABLED \u2014 emergency actions may execute.'
        : _ZI.eye + ' Advisory mode \u2014 enable Smart Exit in Settings Hub to allow auto-exec.'
      ;(advEl as HTMLElement).style.color = smartOn ? 'var(--gold)' : '#556677'
    }
  } catch (e) { /* silent */ }
}

// ════════════════════════════════════════════════════════════════
// (B) PROBABILISTIC CONFLUENCE SCORE
// Weighted sum (v1 — no logistic regression yet)

// Prob score
export function computeProbScore(dir: string): number {
  try {
    dir = dir || 'LONG'
    const regime = (typeof w.BRAIN !== 'undefined') ? (w.BRAIN.regime || 'unknown') : 'unknown'
    const regConf = (typeof w.BRAIN !== 'undefined') ? (w.BRAIN.regimeConfidence || 0) : 0
    const regSlope = (typeof w.BRAIN !== 'undefined') ? (w.BRAIN.regimeSlope || 0) : 0
    const ofi = (typeof w.BRAIN !== 'undefined' && w.BRAIN.ofi) ? (w.BRAIN.ofi.blendBuy || 50) : 50
    const bullC = (w.S.signalData && w.S.signalData.bullCount) || 0
    const bearC = (w.S.signalData && w.S.signalData.bearCount) || 0
    const liq = _qebLiquidityProximity()

    // 1. Regime alignment (0–35)
    let regScore = 0
    if (regime === 'trend') {
      const aligned = (dir === 'LONG' && regSlope > 0) || (dir === 'SHORT' && regSlope < 0)
      regScore = aligned ? Math.min(35, Math.round(regConf * 0.35)) : Math.round(regConf * 0.10)
    } else if (regime === 'breakout') {
      regScore = 22
    } else if (regime === 'range') {
      regScore = 12
    } else if (regime === 'volatile') {
      regScore = 5
    }

    // 2. Liquidity bias + distance (0–25)
    let liqScore = 10 // neutral base
    if (liq.bias === dir.toLowerCase().replace('long', 'bull').replace('short', 'bear')) liqScore += 10
    if (dir === 'LONG' && liq.nearestBelowDistPct !== null && liq.nearestBelowDistPct > 1.5) liqScore += 5
    if (dir === 'SHORT' && liq.nearestAboveDistPct !== null && liq.nearestAboveDistPct > 1.5) liqScore += 5
    liqScore = Math.min(25, liqScore)

    // 3. Signal alignment bull/bear counts (0–25)
    let sigScore = 0
    const relevantC = (dir === 'LONG') ? bullC : bearC
    sigScore = Math.min(25, Math.round(relevantC * 6))

    // 4. Flow/OI/funding confirmation (0–15)
    let flowScore = 0
    if (dir === 'LONG' && ofi > 55) flowScore += Math.min(8, Math.round((ofi - 55) * 0.5))
    if (dir === 'SHORT' && ofi < 45) flowScore += Math.min(8, Math.round((45 - ofi) * 0.5))
    if (w.S.fr !== null && w.S.fr !== undefined) {
      if (dir === 'LONG' && w.S.fr < 0) flowScore += 4  // shorts paying → bullish
      if (dir === 'SHORT' && w.S.fr > 0) flowScore += 4  // longs paying  → bearish
    }
    if (w.S.oi && w.S.oiPrev && w.S.oiPrev > 0) {
      const oiChg2 = (w.S.oi - w.S.oiPrev) / w.S.oiPrev * 100
      if (dir === 'LONG' && oiChg2 > 0.5) flowScore += 3
      if (dir === 'SHORT' && oiChg2 < -0.5) flowScore += 3
    }
    flowScore = Math.min(15, flowScore)

    const total = Math.min(100, regScore + liqScore + sigScore + flowScore)

    w.BM.probScore = total
    w.BM.probBreakdown = { regime: regScore, liquidity: liqScore, signals: sigScore, flow: flowScore }

    return total
  } catch (e: any) {
    console.warn('[QEB] computeProbScore error:', e.message)
    return 0
  }
}

// ════════════════════════════════════════════════════════════════
// (C) SCENARIO ENGINE — read-only, UI
// Writes: S.scenario (additive field)

// Scenario data
export function updateScenarioData(): void {
  try {
    const regime = (typeof w.BRAIN !== 'undefined') ? (w.BRAIN.regime || 'unknown') : 'unknown'
    const regConf = (typeof w.BRAIN !== 'undefined') ? (w.BRAIN.regimeConfidence || 0) : 0
    const regSlope = (typeof w.BRAIN !== 'undefined') ? (w.BRAIN.regimeSlope || 0) : 0
    const price = w.S.price || 0
    const liq = _qebLiquidityProximity()
    const bullC = (w.S.signalData && w.S.signalData.bullCount) || 0
    const bearC = (w.S.signalData && w.S.signalData.bearCount) || 0
    const fPFn = fP
    const fmtFn = fmt

    const prob = w.BM.probScore
    const isBull = (bullC >= bearC) && ((typeof w.BRAIN !== 'undefined') ? regSlope >= 0 : true)
    const dir = isBull ? 'LONG' : 'SHORT'

    // ── Primary scenario ─────────────────────────────────────────
    const nearTarget = isBull
      ? (w.S.magnets && w.S.magnets.above && w.S.magnets.above[0]
        ? '$' + fPFn(w.S.magnets.above[0].price)
        : 'next resistance')
      : (w.S.magnets && w.S.magnets.below && w.S.magnets.below[0]
        ? '$' + fPFn(w.S.magnets.below[0].price)
        : 'next support')
    const primary = (isBull ? _ZI.tup + ' Bullish' : _ZI.drop + ' Bearish')
      + ' \u2014 ' + regime.toUpperCase() + ' regime'
      + (regConf > 0 ? ' (' + regConf + '% conf)' : '')
      + '. Target: ' + nearTarget + '.'

    // ── Alternate scenario ───────────────────────────────────────
    const altTarget = isBull
      ? (w.S.magnets && w.S.magnets.below && w.S.magnets.below[0]
        ? '$' + fPFn(w.S.magnets.below[0].price)
        : 'nearby support')
      : (w.S.magnets && w.S.magnets.above && w.S.magnets.above[0]
        ? '$' + fPFn(w.S.magnets.above[0].price)
        : 'nearby resistance')
    const altConf = Math.max(10, Math.round(100 - prob))
    const alternate = (isBull ? _ZI.drop + ' Bear reversal' : _ZI.tup + ' Bull reversal')
      + ' scenario (' + altConf + '% alt conf)'
      + '. Watch ' + altTarget + ' for early signs.'

    // ── Failure / Invalidation level ─────────────────────────────
    let failLevel = null
    if (isBull && w.S.magnets && w.S.magnets.below && w.S.magnets.below[0]) {
      failLevel = w.S.magnets.below[0].price
    } else if (!isBull && w.S.magnets && w.S.magnets.above && w.S.magnets.above[0]) {
      failLevel = w.S.magnets.above[0].price
    }
    const divSig = w.BM.qexit.signals.divergence.type
    const climSig = w.BM.qexit.signals.climax.dir
    const failure = 'Invalidation: '
      + (failLevel ? ('close ' + (isBull ? 'below' : 'above') + ' $' + fPFn(failLevel)) : 'loss of structural support')
      + (divSig ? ' + ' + divSig + ' divergence' : '')
      + (climSig ? ' + vol climax (' + climSig + ')' : '')
      + ' would cancel this scenario.'

    w.S.scenario = {
      primary: primary,
      alternate: alternate,
      failure: failure,
      updated: Date.now(),
    }

  } catch (e: any) {
    console.warn('[QEB] updateScenarioData error:', e.message)
  }
}

export function updateScenarioUI(): void {
  try {
    const elSc = document.getElementById('scenario-content')
    const upd = document.getElementById('scenario-upd')
    if (!elSc) return

    if (!w.S.price || !w.S.klines || w.S.klines.length < 20) {
      elSc.innerHTML = '<div style="text-align:center;padding:14px;color:var(--dim);font-size:12px">Waiting for market data...</div>'
      return
    }

    const sc = w.S.scenario
    if (!sc || !sc.primary) {
      elSc.innerHTML = '<div style="text-align:center;padding:14px;color:var(--dim);font-size:12px">Computing scenarios...</div>'
      return
    }

    const probStr = w.BM.probScore
    const probCls = probStr >= 65 ? 'hi' : probStr >= 40 ? 'med' : 'lo'

    elSc.innerHTML =
      '<div class="sc-block primary">'
      + '<div class="sc-label primary">' + _ZI.dGrn + ' PRIMARY <span class="sc-conf ' + probCls + '">' + probStr + '% prob</span></div>'
      + '<div class="sc-text">' + sc.primary + '</div>'
      + '</div>'
      + '<div class="sc-block alternate">'
      + '<div class="sc-label alternate">' + _ZI.dYlw + ' ALTERNATE</div>'
      + '<div class="sc-text">' + sc.alternate + '</div>'
      + '</div>'
      + '<div class="sc-block failure">'
      + '<div class="sc-label failure">' + _ZI.w + ' INVALIDATION</div>'
      + '<div class="sc-text">' + sc.failure + '</div>'
      + '</div>'

    if (upd) upd.textContent = 'updated ' + fmtNow()
  } catch (e: any) {
    console.warn('[QEB] updateScenarioUI error:', e.message)
  }
}
