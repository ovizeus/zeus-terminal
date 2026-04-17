import { create } from 'zustand'
import type {
  BrainState,
  BrainMode,
  TradingProfile,
  BrainEngineState,
  BrainThought,
  BrainAdaptParams,
  BrainBlockReason,
  BrainSafetyPill,
  BrainBlockReasonDisplay,
  MtfAlignment,
} from '../types'

/**
 * Brain canonical store.
 *
 * Phase 6 C7: store is the single source of truth for the Brain surface.
 * The legacy engine (engine/brain.ts) writes directly through the typed
 * mutators below; `window.BM` is a Proxy that routes canonical reads to
 * this store and runtime-only keys back to the backing object (installed
 * in C6). `BlockReason` write-paths are mirrored canonically across all
 * known sites (autotrade.ts, klines.ts, arianova.ts, postMortem.ts,
 * bootstrapMisc.ts, state.ts hydration). `useBrainBridge` and
 * `syncFromEngine` were removed in C7 — there is no engine→store sync hop.
 *
 * Mutators cover the canonical Brain surface:
 *   - mode / profile
 *   - engineState (store-level `brainState`)
 *   - entryReady / entryScore
 *   - flow / mtf / sweep / gates
 *   - blockReason
 *   - thoughts (atomic replacement; engine uses `unshift` + bounded
 *     capacity on the backing array, then replaces via `setThoughts`)
 *   - adaptParams
 */
interface BrainStoreState {
  /** Brain state — mirrors window.BM */
  brain: BrainState
  /** Brain engine lifecycle state (SCANNING/ANALYZING/READY/TRADING/BLOCKED) */
  brainState: BrainEngineState
  /** Brain mode (assist/auto) */
  brainMode: BrainMode
  /** Brain thoughts log */
  thoughts: BrainThought[]
  /** Brain adapt params */
  adaptParams: BrainAdaptParams | null
  /** Block reason */
  blockReason: BrainBlockReason | null
  /** Safety pill (#at-why-blocked) — produced by data/klines.ts `_updateWhyBlocked`. */
  safetyPill: BrainSafetyPill | null
  /** Block-reason display (#zad-block-reason) — produced by engine/brain.ts top-reason logic. */
  blockReasonDisplay: BrainBlockReasonDisplay | null

  /** Merge partial brain state */
  patch: (partial: Partial<BrainState>) => void

  /** Set operating mode (updates both `brain.mode` and top-level `brainMode`) */
  setMode: (mode: BrainMode) => void
  /** Set trading profile (fast/swing/defensive) */
  setProfile: (profile: TradingProfile) => void
  /** Set engine lifecycle state */
  setEngineState: (state: BrainEngineState) => void
  /** Set entry readiness + score together */
  setEntry: (partial: { ready?: boolean; score?: number }) => void
  /** Set flow snapshot (CVD / delta / OFI) */
  setFlow: (flow: BrainState['flow']) => void
  /** Set multi-timeframe alignment */
  setMtf: (mtf: MtfAlignment) => void
  /** Set sweep snapshot */
  setSweep: (sweep: BrainState['sweep']) => void
  /** Replace gates map */
  setGates: (gates: Record<string, unknown>) => void
  /** Set block reason (null clears) */
  setBlockReason: (reason: BrainBlockReason | null) => void
  /** Set safety pill (#at-why-blocked). Short-circuits when unchanged. */
  setSafetyPill: (pill: BrainSafetyPill | null) => void
  /** Set block-reason display (#zad-block-reason). Short-circuits when unchanged. */
  setBlockReasonDisplay: (disp: BrainBlockReasonDisplay | null) => void
  /** Replace thoughts log atomically */
  setThoughts: (thoughts: BrainThought[]) => void
  /** Set adapt params (null clears) */
  setAdaptParams: (params: BrainAdaptParams | null) => void
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

export const useBrainStore = create<BrainStoreState>()((set) => ({
  brain: defaultBrain,
  brainState: 'scanning',
  brainMode: 'assist',
  thoughts: [],
  adaptParams: null,
  blockReason: null,
  safetyPill: null,
  blockReasonDisplay: null,

  patch: (partial) => set((s) => ({ brain: { ...s.brain, ...partial } })),

  setMode: (mode) =>
    set((s) => ({ brain: { ...s.brain, mode }, brainMode: mode })),
  setProfile: (profile) =>
    set((s) => ({ brain: { ...s.brain, profile } })),
  setEngineState: (state) => set({ brainState: state }),
  setEntry: ({ ready, score }) =>
    set((s) => ({
      brain: {
        ...s.brain,
        entryReady: ready !== undefined ? ready : s.brain.entryReady,
        entryScore: score !== undefined ? score : s.brain.entryScore,
      },
    })),
  setFlow: (flow) => set((s) => ({ brain: { ...s.brain, flow } })),
  setMtf: (mtf) => set((s) => ({ brain: { ...s.brain, mtf } })),
  setSweep: (sweep) => set((s) => ({ brain: { ...s.brain, sweep } })),
  setGates: (gates) => set((s) => ({ brain: { ...s.brain, gates } })),
  setBlockReason: (reason) => set({ blockReason: reason }),
  setSafetyPill: (pill) => set((s) => {
    const cur = s.safetyPill
    if (cur === pill) return s
    if (cur && pill &&
      cur.iconKind === pill.iconKind &&
      cur.text === pill.text &&
      cur.className === pill.className &&
      cur.visible === pill.visible) return s
    return { safetyPill: pill }
  }),
  setBlockReasonDisplay: (disp) => set((s) => {
    const cur = s.blockReasonDisplay
    if (cur === disp) return s
    if (cur && disp && cur.text === disp.text && cur.className === disp.className) return s
    return { blockReasonDisplay: disp }
  }),
  setThoughts: (thoughts) => set({ thoughts }),
  setAdaptParams: (params) => set({ adaptParams: params }),
}))
