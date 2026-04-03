import { create } from 'zustand'
import type { BrainState } from '../types'

interface BrainStore {
  /** Brain state — mirrors window.BM */
  brain: BrainState
  /** Merge partial brain state */
  patch: (partial: Partial<BrainState>) => void
}

const defaultBrain: BrainState = {
  mode: 'assist',
  profile: 'fast',
  confluenceScore: 50,
  confMin: 65,
  applyToOpen: false,
  protectMode: false,
  protectReason: '',
  dailyTrades: 0,
  dailyPnL: 0,
  lossStreak: 0,
  newsRisk: 'low',
  gates: {},
  entryScore: 0,
  entryReady: false,
  mtf: { '15m': 'neut', '1h': 'neut', '4h': 'neut' },
  sweep: { type: 'none', reclaim: false, displacement: false },
  flow: { cvd: 'neut', delta: 0, ofi: 'neut' },
  macroEvents: [],
  qexit: {
    risk: 0,
    signals: {
      divergence: { type: null, conf: 0 },
      climax: { dir: null, mult: 0 },
      regimeFlip: { from: null, to: null, conf: 0 },
      liquidity: { nearestAboveDistPct: null, nearestBelowDistPct: null, bias: 'neutral' },
    },
    action: 'HOLD',
    lastTs: 0,
    lastReason: '',
    shadowStop: null,
    confirm: { div: 0, climax: 0 },
  },
  macro: {
    cycleScore: 0,
    sentimentScore: 0,
    flowScore: 0,
    composite: 0,
    slope: 0,
    phase: 'NEUTRAL',
    confidence: 0,
    lastUpdate: 0,
  },
  regimeEngine: {
    regime: 'RANGE',
    confidence: 0,
    trendBias: 'neutral',
    volatilityState: 'normal',
    trapRisk: 0,
    notes: ['waiting'],
  },
  phaseFilter: {
    allow: false,
    phase: 'RANGE',
    reason: 'insufficient data',
    riskMode: 'reduced',
    sizeMultiplier: 0.5,
    allowedSetups: [],
    blockedSetups: [],
  },
  atmosphere: {
    category: 'neutral',
    allowEntry: true,
    cautionLevel: 'medium',
    confidence: 0,
    reasons: ['waiting for data'],
    sizeMultiplier: 1.0,
  },
  structure: {
    regime: 'unknown',
    adx: 0,
    atrPct: 0,
    squeeze: false,
    volMode: '—',
    structureLabel: '—',
    mtfAlign: { '15m': 'neut', '1h': 'neut', '4h': 'neut' },
    score: 0,
    lastUpdate: 0,
  },
  liqCycle: {
    currentSweep: 'none',
    sweepDisplacement: false,
    trapRate: null,
    trapsTotal: 0,
    sweepsTotal: 0,
    magnetAboveDist: null,
    magnetBelowDist: null,
    magnetBias: '—',
    lastUpdate: 0,
  },
  probScore: 0,
  probBreakdown: { regime: 0, liquidity: 0, signals: 0, flow: 0 },
  volBuffer: [],
  volRegime: '—',
  volPct: null,
  danger: 0,
  dangerBreakdown: { volatility: 0, spread: 0, liquidations: 0, volume: 0, funding: 0 },
  conviction: 0,
  convictionMult: 1.0,
  positionSizing: { baseRiskPct: 1.0, regimeMult: 1.0, perfMult: 1.0, finalMult: 1.0 },
  adapt: { enabled: false, allowLiveAdjust: false, exitMult: 1.0, lastTs: 0, lastPhase: 'NEUTRAL' },
  adaptive: { enabled: false, lastRecalcTs: 0, entryMult: 1.0, sizeMult: 1.0, exitMult: 1.0, buckets: {} },
  performance: {
    byRegime: {
      ACCUMULATION: { trades: 0, wins: 0, avgR: 0, mult: 1.0 },
      EARLY_BULL: { trades: 0, wins: 0, avgR: 0, mult: 1.0 },
      LATE_BULL: { trades: 0, wins: 0, avgR: 0, mult: 1.0 },
      DISTRIBUTION: { trades: 0, wins: 0, avgR: 0, mult: 1.0 },
      TOP_RISK: { trades: 0, wins: 0, avgR: 0, mult: 1.0 },
      NEUTRAL: { trades: 0, wins: 0, avgR: 0, mult: 1.0 },
    },
  },
  core: { lastLiqTs: 0, mtfOn: false, ticks: 0 },
}

export const useBrainStore = create<BrainStore>()((set) => ({
  brain: defaultBrain,
  patch: (partial) => set((s) => ({ brain: { ...s.brain, ...partial } })),
}))
