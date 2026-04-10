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

interface BrainStoreExtended extends BrainStore {
  /** Brain engine state (SCANNING/ANALYZING/READY/TRADING/BLOCKED) */
  brainState: string
  /** Brain mode (assist/auto) */
  brainMode: string
  /** Brain thoughts log */
  thoughts: any[]
  /** Brain adapt params */
  adaptParams: any
  /** Block reason */
  blockReason: { code: string; text: string } | null
  /** Atomic snapshot sync from engine — one single set() call */
  syncFromEngine: () => void
}

export const useBrainStore = create<BrainStoreExtended>()((set) => ({
  brain: defaultBrain,
  brainState: 'scanning',
  brainMode: 'assist',
  thoughts: [],
  adaptParams: null,
  blockReason: null,
  patch: (partial) => set((s) => ({ brain: { ...s.brain, ...partial } })),

  syncFromEngine: () => {
    const w = window as any
    const BM = w.BM; const BR = w.BRAIN; const S = w.S
    if (!BM) return

    // Single atomic set() — complete snapshot from window.BM + window.BRAIN
    set({
      brain: {
        ...defaultBrain,
        mode: S?.mode || 'assist',
        profile: BM.profile || 'fast',
        confluenceScore: BM.confluenceScore || 50,
        confMin: BM.confMin || 65,
        protectMode: !!BM.protectMode,
        protectReason: BM.protectReason || '',
        dailyTrades: BM.dailyTrades || 0,
        dailyPnL: BM.dailyPnL || 0,
        lossStreak: BM.lossStreak || 0,
        newsRisk: BM.newsRisk || 'low',
        gates: BM.gates || {},
        entryScore: BM.entryScore || 0,
        entryReady: !!BM.entryReady,
        mtf: BM.mtf || { '15m': 'neut', '1h': 'neut', '4h': 'neut' },
        sweep: BM.sweep || { type: 'none', reclaim: false, displacement: false },
        flow: BM.flow || { cvd: 'neut', delta: 0, ofi: 'neut' },
        regimeEngine: BM.regimeEngine || defaultBrain.regimeEngine,
        phaseFilter: BM.phaseFilter || defaultBrain.phaseFilter,
        atmosphere: BM.atmosphere || defaultBrain.atmosphere,
        structure: BM.structure || defaultBrain.structure,
        liqCycle: BM.liqCycle || defaultBrain.liqCycle,
        volRegime: BM.volRegime || '—',
        volPct: BM.volPct ?? null,
        danger: BM.danger || 0,
        dangerBreakdown: BM.dangerBreakdown || defaultBrain.dangerBreakdown,
        conviction: BM.conviction || 0,
        convictionMult: BM.convictionMult ?? 1.0,
        positionSizing: BM.positionSizing || defaultBrain.positionSizing,
        probScore: BM.probScore || 0,
        probBreakdown: BM.probBreakdown || defaultBrain.probBreakdown,
      },
      brainState: BR?.state || 'scanning',
      brainMode: S?.mode || 'assist',
      thoughts: BR?.thoughts ? [...BR.thoughts] : [],
      adaptParams: BR?.adaptParams || null,
      blockReason: (typeof w.BlockReason !== 'undefined' && w.BlockReason.get()?.code)
        ? { code: w.BlockReason.get().code, text: w.BlockReason.get().text || '' }
        : null,
    })
  },
}))
