/** Brain operating mode */
export type BrainMode = 'assist' | 'auto' | 'manual'

/** Trading profile */
export type TradingProfile = 'fast' | 'swing' | 'defensive'

/** Volume regime */
export type VolRegime = 'LOW' | 'MED' | 'HIGH' | 'EXTREME' | '—'

/** Market regime */
export type MarketRegime =
  | 'ACCUMULATION'
  | 'EARLY_BULL'
  | 'LATE_BULL'
  | 'DISTRIBUTION'
  | 'TOP_RISK'
  | 'NEUTRAL'
  | 'RANGE'
  | 'UPTREND'
  | 'DOWNTREND'
  | string

/** MTF alignment */
export interface MtfAlignment {
  '15m': string
  '1h': string
  '4h': string
}

/** Quantum exit state */
export interface QExitState {
  risk: number
  signals: {
    divergence: { type: string | null; conf: number }
    climax: { dir: string | null; mult: number }
    regimeFlip: { from: string | null; to: string | null; conf: number }
    liquidity: {
      nearestAboveDistPct: number | null
      nearestBelowDistPct: number | null
      bias: string
    }
  }
  action: string
  lastTs: number
  lastReason: string
  shadowStop: number | null
  confirm: { div: number; climax: number }
}

/** Macro intelligence */
export interface MacroState {
  cycleScore: number
  sentimentScore: number
  flowScore: number
  composite: number
  slope: number
  phase: string
  confidence: number
  lastUpdate: number
}

/** Regime engine */
export interface RegimeEngine {
  regime: string
  confidence: number
  trendBias: string
  volatilityState: string
  trapRisk: number
  notes: string[]
}

/** Phase filter */
export interface PhaseFilter {
  allow: boolean
  phase: string
  reason: string
  riskMode: string
  sizeMultiplier: number
  allowedSetups: string[]
  blockedSetups: string[]
}

/** Atmosphere assessment */
export interface Atmosphere {
  category: string
  allowEntry: boolean
  cautionLevel: string
  confidence: number
  reasons: string[]
  sizeMultiplier: number
}

/** Structure analysis */
export interface StructureState {
  regime: string
  adx: number
  atrPct: number
  squeeze: boolean
  volMode: string
  structureLabel: string
  mtfAlign: MtfAlignment
  score: number
  lastUpdate: number
}

/** Liquidity cycle */
export interface LiqCycle {
  currentSweep: string
  sweepDisplacement: boolean
  trapRate: number | null
  trapsTotal: number
  sweepsTotal: number
  magnetAboveDist: number | null
  magnetBelowDist: number | null
  magnetBias: string
  lastUpdate: number
}

/** Regime performance bucket */
export interface RegimePerf {
  trades: number
  wins: number
  avgR: number
  mult: number
}

/** Position sizing state */
export interface PositionSizing {
  baseRiskPct: number
  regimeMult: number
  perfMult: number
  finalMult: number
}

/** Adaptive control state */
export interface AdaptiveState {
  enabled: boolean
  lastRecalcTs: number
  entryMult: number
  sizeMult: number
  exitMult: number
  buckets: Record<string, unknown>
}

/**
 * Brain state — mirrors window.BM from config.js:2075
 */
export interface BrainState {
  mode: BrainMode
  profile: TradingProfile
  confluenceScore: number
  confMin: number
  applyToOpen: boolean
  protectMode: boolean
  protectReason: string
  dailyTrades: number
  dailyPnL: number
  lossStreak: number
  newsRisk: string
  gates: Record<string, unknown>
  entryScore: number
  entryReady: boolean

  // Multi-timeframe
  mtf: MtfAlignment
  sweep: { type: string; reclaim: boolean; displacement: boolean }
  flow: { cvd: string; delta: number; ofi: string }
  macroEvents: unknown[]

  // Sub-engines
  qexit: QExitState
  macro: MacroState
  regimeEngine: RegimeEngine
  phaseFilter: PhaseFilter
  atmosphere: Atmosphere
  structure: StructureState
  liqCycle: LiqCycle

  // Probability
  probScore: number
  probBreakdown: { regime: number; liquidity: number; signals: number; flow: number }

  // Volume
  volBuffer: number[]
  volRegime: VolRegime
  volPct: number | null

  // Risk
  danger: number
  dangerBreakdown: {
    volatility: number
    spread: number
    liquidations: number
    volume: number
    funding: number
  }
  conviction: number
  convictionMult: number

  // Position sizing
  positionSizing: PositionSizing

  // Adaptive
  adapt: {
    enabled: boolean
    allowLiveAdjust: boolean
    exitMult: number
    lastTs: number
    lastPhase: string
  }
  adaptive: AdaptiveState

  // Performance tracking
  performance: {
    byRegime: Record<MarketRegime, RegimePerf>
  }

  // Core internals
  core: {
    lastLiqTs: number
    mtfOn: boolean
    ticks: number
  }
}
