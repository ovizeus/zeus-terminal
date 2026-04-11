import { brainThink } from './brain'
// Zeus — engine/regime.ts
// Ported 1:1 from public/js/brain/regime.js (Phase 5A)
// Regime Engine — adapter/normalizer layer that REUSES existing detection logic
// Output-only module: no execution wiring, no trading behavior change

const w = window as any

// ── SAFE DEFAULT (returned when data is insufficient) ──────────
const _DEFAULT = Object.freeze({
  regime: 'RANGE',
  confidence: 0,
  trendBias: 'neutral',
  volatilityState: 'normal',
  trapRisk: 0,
  notes: ['insufficient data'],
})

// ── Previous regime for transition detection ───────────────────
let _prevRegime: string | null = null

// ── SMALL HELPER: wick chaos score (multi-bar wick analysis) ───
// Not available anywhere else — analyzes body/range ratio across N bars
function _wickChaos(klines: any[], n: number): number {
  if (!klines || klines.length < n) return 0
  const bars = klines.slice(-n)
  let totalWickRatio = 0
  let count = 0
  for (let i = 0; i < bars.length; i++) {
    const k = bars[i]
    const range = k.high - k.low
    if (range <= 0) continue
    const body = Math.abs(k.close - k.open)
    // wick ratio = 1 - body/range; 0 = all body, 1 = all wicks
    totalWickRatio += 1 - body / range
    count++
  }
  if (!count) return 0
  // Scale to 0-100
  return Math.round((totalWickRatio / count) * 100)
}

// ── SMALL HELPER: breakout strength (volume + ATR + follow-through) ──
// checkAntiFakeout is binary; this returns a 0-100 gradient
function _breakoutStrength(klines: any[]): number {
  if (!klines || klines.length < 10) return 0
  const last5 = klines.slice(-5)
  const prev5 = klines.slice(-10, -5)
  // Volume ratio
  const volRecent = last5.reduce(function (s: number, k: any) { return s + (k.volume || 0) }, 0) / 5
  const volOld = prev5.reduce(function (s: number, k: any) { return s + (k.volume || 0) }, 0) / 5
  const volScore = volOld > 0 ? Math.min(40, Math.round((volRecent / volOld - 1) * 80)) : 0
  // ATR expansion (range expansion)
  const rangeRecent = last5.reduce(function (s: number, k: any) { return s + (k.high - k.low) }, 0) / 5
  const rangeOld = prev5.reduce(function (s: number, k: any) { return s + (k.high - k.low) }, 0) / 5
  const rangeScore = rangeOld > 0 ? Math.min(30, Math.round((rangeRecent / rangeOld - 1) * 60)) : 0
  // Follow-through: how many of last 3 bars close in same direction
  const dir = klines[klines.length - 1].close > klines[klines.length - 1].open ? 1 : -1
  let ftCount = 0
  for (let i = klines.length - 3; i < klines.length; i++) {
    if (i < 0) continue
    const dC = klines[i].close > klines[i].open ? 1 : -1
    if (dC === dir) ftCount++
  }
  const ftScore = Math.round((ftCount / 3) * 30)
  return Math.max(0, Math.min(100, volScore + rangeScore + ftScore))
}

// ══════════════════════════════════════════════════════════════════
// ── MAIN: analyzeMarketRegime() — reads globals, returns result ──
// ══════════════════════════════════════════════════════════════════
function analyzeMarketRegime(): any {
  try {
    // ── Guard: need S.klines with ≥50 bars ──
    const klines = (typeof w.S !== 'undefined' && w.S.klines) ? w.S.klines : []
    if (!klines.length || klines.length < 50) {
      return Object.assign({}, _DEFAULT)
    }

    // ═══ 1. REUSE: detectRegimeEnhanced (brain.js L468) ═══════
    // Returns: {regime, adx, volMode, structure, squeeze, atrPct, slope20}
    let enhanced: any = { regime: 'unknown', adx: 0, volMode: '—', structure: '—', squeeze: false, atrPct: 0, slope20: 0 }
    if (typeof w.detectRegimeEnhanced === 'function') {
      enhanced = w.detectRegimeEnhanced(klines) || enhanced
    }
    // NOTE: kept on w.* — circular dep with engine/brain

    // ═══ 2. REUSE: BM.volRegime (config.js updateVolRegime) ═══
    const volRegime = (typeof w.BM !== 'undefined' && w.BM.volRegime) ? w.BM.volRegime : '—'

    // ═══ 3. REUSE: BM.sweep (brain.js detectSweepDisplacement) ═
    const sweep = (typeof w.BM !== 'undefined' && w.BM.sweep) ? w.BM.sweep : { type: 'none' }

    // ═══ 4. REUSE: OF.trap (orderflow.js MM Trap Detector) ════
    // [PATCH P2-3] null guard: typeof null !== 'undefined' is true → null.trap throws
    const ofTrap = (typeof w.OF !== 'undefined' && w.OF !== null && w.OF.trap) ? w.OF.trap : { active: false }

    // ═══ 5. REUSE: OF.sweep / OF.cascade (orderflow.js) ═══════
    // [PATCH P2-3] Same null guard for OF.sweep and OF.cascade
    const ofSweep = (typeof w.OF !== 'undefined' && w.OF !== null && w.OF.sweep) ? w.OF.sweep : { active: false }
    const ofCascade = (typeof w.OF !== 'undefined' && w.OF !== null && w.OF.cascade) ? w.OF.cascade : { state: 'idle' }

    // ═══ 6. REUSE: _fakeout (brain.js checkAntiFakeout) ═══════
    const fakeoutInvalid = (typeof w._fakeout !== 'undefined') ? !!w._fakeout.invalid : false

    // ═══ 7. REUSE: BRAIN.regimeConfidence (brain.js detectMarketRegime) ═
    const brainConf = (typeof w.BRAIN !== 'undefined' && w.BRAIN.regimeConfidence) ? w.BRAIN.regimeConfidence : 0

    // ═══ 8. NEW: compute wick chaos ════════════════════════════
    const wickChaos = _wickChaos(klines, 10)

    // ═══ 9. NEW: breakout strength ═════════════════════════════
    const brkStrength = _breakoutStrength(klines)

    // ══════════════════════════════════════════════════════════════
    // ── NORMALIZE into unified regime output ──────────────────────
    // ══════════════════════════════════════════════════════════════

    let regime = 'RANGE'
    let confidence = 0
    const notes: string[] = []

    // ── Map volatilityState from BM.volRegime ──
    const volStateMap: Record<string, string> = { 'LOW': 'low', 'MED': 'normal', 'HIGH': 'high', 'EXTREME': 'extreme' }
    const volatilityState = volStateMap[volRegime] || 'normal'

    // ── Determine trendBias from structure + slope ──
    let trendBias = 'neutral'
    if (enhanced.structure === 'HH/HL' || enhanced.slope20 > 0.3) {
      trendBias = 'bullish'
    } else if (enhanced.structure === 'LH/LL' || enhanced.slope20 < -0.3) {
      trendBias = 'bearish'
    }

    // ── LIQUIDATION_EVENT: highest priority ──
    if ((ofSweep.active && ofCascade.state === 'fired') ||
        (enhanced.regime === 'panic' && sweep.type !== 'none' && sweep.displacement)) {
      regime = 'LIQUIDATION_EVENT'
      confidence = Math.min(95, 60 + (ofCascade.state === 'fired' ? 25 : 0) + (sweep.displacement ? 10 : 0))
      notes.push('liq cascade detected')
      if (sweep.type !== 'none') notes.push('sweep ' + sweep.type + (sweep.reclaim ? ' + reclaim' : ''))
    }
    // ── CHAOS: high wick chaos + panic or extreme vol ──
    else if (wickChaos >= 65 && (enhanced.regime === 'panic' || volatilityState === 'extreme')) {
      regime = 'CHAOS'
      confidence = Math.min(95, Math.round(wickChaos * 0.6 + (enhanced.atrPct || 0) * 10))
      notes.push('wick chaos ' + wickChaos + '%')
      notes.push('atrPct ' + (enhanced.atrPct || 0).toFixed(2) + '%')
    }
    // ── EXPANSION: breakout regime with volume expansion ──
    else if (enhanced.regime === 'breakout' || (enhanced.volMode === 'expansion' && enhanced.adx > 25 && brkStrength >= 40)) {
      regime = 'EXPANSION'
      confidence = Math.min(95, Math.round(brkStrength * 0.5 + enhanced.adx * 0.6 + 20))
      notes.push('breakout strength ' + brkStrength)
      notes.push('adx ' + enhanced.adx)
      if (enhanced.volMode === 'expansion') notes.push('volume expanding')
    }
    // ── SQUEEZE: squeeze detected ──
    else if (enhanced.squeeze) {
      regime = 'SQUEEZE'
      confidence = Math.min(90, 55 + (volatilityState === 'low' ? 20 : 0) + (enhanced.adx < 20 ? 15 : 0))
      notes.push('BB inside Keltner analog')
      if (volatilityState === 'low') notes.push('vol regime LOW')
    }
    // ── TREND_UP / TREND_DOWN: trending regime ──
    else if (enhanced.regime === 'trend' || (enhanced.adx > 25 && Math.abs(enhanced.slope20) > 0.3)) {
      regime = enhanced.slope20 >= 0 ? 'TREND_UP' : 'TREND_DOWN'
      confidence = Math.min(95, Math.round(enhanced.adx * 0.8 + Math.abs(enhanced.slope20) * 15 + 20))
      notes.push('adx ' + enhanced.adx)
      notes.push('slope ' + (enhanced.slope20 || 0).toFixed(2))
      notes.push('structure ' + enhanced.structure)
    }
    // ── RANGE: fallback ──
    else {
      regime = 'RANGE'
      confidence = Math.max(30, Math.min(80, brainConf || 50))
      notes.push('adx ' + enhanced.adx)
      if (enhanced.volMode === 'contraction') notes.push('volume contracting')
    }

    // ── Compute trapRisk 0-100 ──
    let trapRisk = 0
    // [PATCH P1-2] From orderflow trap detector — binary flag (OF.trap has no .prob field)
    if (ofTrap.active) trapRisk += 40
    // High wick chaos adds trap suspicion
    if (wickChaos >= 50) trapRisk += Math.round((wickChaos - 50) * 0.6)
    // Fakeout detected adds to trap risk
    if (fakeoutInvalid) trapRisk += 20
    // Sweep without displacement = potential trap
    if (sweep.type !== 'none' && !sweep.displacement) trapRisk += 15
    trapRisk = Math.max(0, Math.min(100, trapRisk))

    if (trapRisk >= 40) notes.push('trap risk elevated')

    // ── Clamp confidence ──
    confidence = Math.max(0, Math.min(100, Math.round(confidence)))

    // ── Build result ──
    const result = {
      regime: regime,
      confidence: confidence,
      trendBias: trendBias,
      volatilityState: volatilityState,
      trapRisk: trapRisk,
      notes: notes,
    }

    // [P0.4] Decision log — regime snapshot
    if (typeof w.DLog !== 'undefined') w.DLog.record('regime', { regime: regime, confidence: confidence, trendBias: trendBias, volatilityState: volatilityState, trapRisk: trapRisk })

    // ── ZLOG on regime transition only ──
    if (_prevRegime !== null && _prevRegime !== regime) {
      if (typeof w.ZLOG !== 'undefined') {
        w.ZLOG.push('INFO', '[RE] ' + _prevRegime + '\u2192' + regime + ' conf=' + confidence + '%',
          { from: _prevRegime, to: regime, conf: confidence, trapRisk: trapRisk, volatilityState: volatilityState })
      }
      {
        brainThink('info', '\uD83D\uDD2E Regime: ' + regime + ' (' + confidence + '%)')
      }
    }
    _prevRegime = regime

    return result
  } catch (e: any) {
    console.warn('[RE] analyzeMarketRegime error:', e.message || e)
    return Object.assign({}, _DEFAULT)
  }
}

// ── getState() — returns last stored result from BM.regimeEngine ──
function getState(): any {
  if (typeof w.BM !== 'undefined' && w.BM.regimeEngine) return w.BM.regimeEngine
  return Object.assign({}, _DEFAULT)
}

// ── Public API ─────────────────────────────────────────────────
export const RegimeEngine = {
  compute: analyzeMarketRegime,
  getState: getState,
  // [PATCH P2-1] Reset previous regime on symbol switch to avoid spurious transition logs
  reset: function () { _prevRegime = null },
  _wickChaos: _wickChaos,           // exposed for debug/ZLOG only
  _breakoutStrength: _breakoutStrength,
}
