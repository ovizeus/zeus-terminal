// Zeus — engine/phaseFilter.ts
// Ported 1:1 from public/js/brain/phaseFilter.js (Phase 5A)
// Market Phase Filter — analysis-only adapter consuming RegimeEngine output
// Returns standardized decision object for setup-type filtering
// NO execution wiring, NO autotrade behavior change

const w = window as any

// ── SAFE DEFAULT ───────────────────────────────────────────────
const _DEFAULT = {
  allow: false,
  phase: 'RANGE',
  reason: 'insufficient data',
  riskMode: 'reduced',
  sizeMultiplier: 0.5,
  allowedSetups: [] as string[],
  blockedSetups: [] as string[],
}

// ── Previous phase for transition detection ────────────────────
let _prevPhase: string | null = null

// ══════════════════════════════════════════════════════════════════
// ── HELPERS ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

// Map RegimeEngine regime string → phaseFilter phase string
function mapRegimeToPhase(regime: string): string {
  const map: Record<string, string> = {
    'TREND_UP': 'TREND',
    'TREND_DOWN': 'TREND',
    'RANGE': 'RANGE',
    'SQUEEZE': 'SQUEEZE',
    'EXPANSION': 'EXPANSION',
    'CHAOS': 'CHAOS',
    'LIQUIDATION_EVENT': 'LIQ_EVENT',
    // [P0-B2] Defensive: accept lowercase detectRegimeEnhanced output
    'trend': 'TREND',
    'range': 'RANGE',
    'squeeze': 'SQUEEZE',
    'breakout': 'EXPANSION',
    'panic': 'CHAOS',
    'unknown': 'RANGE',
  }
  return map[regime] || 'RANGE'
}

// Setups allowed per phase
function getAllowedSetups(phase: string, trendBias: string): string[] {
  switch (phase) {
    case 'TREND':
      // Allow with-trend setups
      if (trendBias === 'bullish') return ['breakout_long', 'pullback_long', 'continuation_long']
      if (trendBias === 'bearish') return ['breakout_short', 'pullback_short', 'continuation_short']
      return ['breakout', 'pullback', 'continuation']
    case 'RANGE':
      return ['fade', 'mean_reversion', 'range_bound']
    case 'SQUEEZE':
      return ['prepare_only']
    case 'EXPANSION':
      return ['breakout', 'continuation', 'momentum']
    case 'CHAOS':
      return ['scalp_reduced']
    case 'LIQ_EVENT':
      return []
    default:
      return []
  }
}

// Setups blocked per phase
function getBlockedSetups(phase: string, trendBias: string): string[] {
  switch (phase) {
    case 'TREND':
      // Block counter-trend weak setups
      if (trendBias === 'bullish') return ['fade_long', 'breakout_short', 'weak_countertrend_short']
      if (trendBias === 'bearish') return ['fade_short', 'breakout_long', 'weak_countertrend_long']
      return ['weak_countertrend']
    case 'RANGE':
      return ['breakout', 'momentum', 'weak_breakout']
    case 'SQUEEZE':
      return ['breakout', 'momentum', 'fade', 'aggressive_entry']
    case 'EXPANSION':
      return ['fade', 'mean_reversion', 'counter_momentum']
    case 'CHAOS':
      return ['breakout', 'continuation', 'fade', 'aggressive_entry']
    case 'LIQ_EVENT':
      return ['all']
    default:
      return []
  }
}

// Determine risk mode from phase + volatility + trapRisk
function calcRiskMode(phase: string, volatilityState: string, trapRisk: number, confidence: number): string {
  if (phase === 'LIQ_EVENT') return 'blocked'
  if (phase === 'CHAOS') return 'reduced'
  if (volatilityState === 'extreme') return 'reduced'
  if (trapRisk >= 60) return 'reduced'
  if (confidence < 30) return 'reduced'
  return 'normal'
}

// Determine size multiplier from phase + riskMode + trapRisk
function calcSizeMultiplier(phase: string, riskMode: string, trapRisk: number, confidence: number): number {
  if (riskMode === 'blocked') return 0
  if (riskMode === 'reduced') {
    // CHAOS or extreme conditions — halve or quarter
    if (phase === 'CHAOS') return trapRisk >= 50 ? 0.25 : 0.5
    return 0.5
  }
  // Normal mode — slight adjustments
  if (phase === 'SQUEEZE') return 0.6
  if (phase === 'EXPANSION' && confidence >= 70) return 1.2
  if (phase === 'TREND' && confidence >= 60) return 1.0
  if (phase === 'RANGE') return 0.8
  return 0.75
}

// ══════════════════════════════════════════════════════════════════
// ── MAIN: evaluateMarketPhase(input) ──────────────────────────────
// ══════════════════════════════════════════════════════════════════
function evaluateMarketPhase(input: any): any {
  try {
    if (!input || !input.regime) {
      return Object.assign({}, _DEFAULT)
    }

    const regime = input.regime
    const confidence = input.confidence || 0
    const trendBias = input.trendBias || 'neutral'
    const volatilityState = input.volatilityState || 'normal'
    const trapRisk = input.trapRisk || 0

    // ── 1. Map regime → phase ──
    const phase = mapRegimeToPhase(regime)

    // ── 2. Determine setups ──
    const allowedSetups = getAllowedSetups(phase, trendBias)
    const blockedSetups = getBlockedSetups(phase, trendBias)

    // ── 3. Determine risk ──
    const riskMode = calcRiskMode(phase, volatilityState, trapRisk, confidence)
    const sizeMultiplier = calcSizeMultiplier(phase, riskMode, trapRisk, confidence)

    // ── 4. Determine allow ──
    let allow = true
    let reason = ''

    if (riskMode === 'blocked') {
      allow = false
      reason = 'LIQ_EVENT — all entries blocked'
    } else if (phase === 'CHAOS' && trapRisk >= 70) {
      allow = false
      reason = 'CHAOS + high trap risk (' + trapRisk + '%)'
    } else if (phase === 'SQUEEZE') {
      allow = false
      reason = 'SQUEEZE — prepare only, wait for expansion'
    } else if (confidence < 25) {
      allow = false
      reason = 'low confidence (' + confidence + '%)'
    } else {
      // Phase-specific reasons
      switch (phase) {
        case 'TREND':
          reason = 'TREND ' + (trendBias === 'bullish' ? '▲' : trendBias === 'bearish' ? '▼' : '—') + ' conf=' + confidence + '%'
          break
        case 'RANGE':
          reason = 'RANGE — fade/reversion setups only'
          break
        case 'EXPANSION':
          reason = 'EXPANSION — breakout/continuation allowed'
          break
        case 'CHAOS':
          allow = trapRisk < 50
          reason = 'CHAOS — reduced size' + (trapRisk >= 40 ? ', elevated trap' : '')
          break
        default:
          reason = phase
      }
    }

    const result = {
      allow: allow,
      phase: phase,
      reason: reason,
      riskMode: riskMode,
      sizeMultiplier: Math.round(sizeMultiplier * 100) / 100,
      allowedSetups: allowedSetups,
      blockedSetups: blockedSetups,
    }

    // ── ZLOG on phase transition only ──
    if (_prevPhase !== null && _prevPhase !== phase) {
      if (typeof w.ZLOG !== 'undefined') {
        w.ZLOG.push('INFO', '[PF] ' + _prevPhase + '\u2192' + phase + ' risk=' + riskMode + ' size=' + sizeMultiplier.toFixed(2),
          { from: _prevPhase, to: phase, riskMode: riskMode, sizeMultiplier: sizeMultiplier, allow: allow })
      }
      if (typeof w.brainThink === 'function') {
        w.brainThink('info', '\uD83D\uDEE1 Phase: ' + phase + ' | ' + riskMode + ' | \u00D7' + sizeMultiplier.toFixed(2))
      }
    }
    _prevPhase = phase

    return result
  } catch (e: any) {
    console.warn('[PF] evaluateMarketPhase error:', e.message || e)
    return Object.assign({}, _DEFAULT)
  }
}

// ── getState() — returns last stored result from BM.phaseFilter ──
function getState(): any {
  if (typeof w.BM !== 'undefined' && w.BM.phaseFilter) return w.BM.phaseFilter
  return Object.assign({}, _DEFAULT)
}

// ── Public API ─────────────────────────────────────────────────
export const PhaseFilter = {
  evaluate: evaluateMarketPhase,
  getState: getState,
  // [PATCH P2-1] Reset previous phase on symbol switch to avoid spurious transition logs
  reset: function () { _prevPhase = null },
  mapRegimeToPhase: mapRegimeToPhase,
  getAllowedSetups: getAllowedSetups,
  getBlockedSetups: getBlockedSetups,
}
