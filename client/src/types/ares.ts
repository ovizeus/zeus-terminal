/* ARES UI store slice types (R28.2).
 * Mirrors the output surface that aresUI.ts renders into #ares-* DOM nodes.
 * This is the UI contract; business SoT stays in engine (ARES_WALLET, ARES.positions, ARES.getState).
 */

/** Current ARES core state (badge, colors, glow). Produced by engine state machine. */
export interface AresCoreState {
  id: string
  label: string
  emoji: string
  color: string
  glow: string
  consecutiveLoss: number
}

/** Mortal-wound / mission-failed line. */
export interface AresWoundState {
  visible: boolean
  kind: 'none' | 'wound' | 'mission_failed'
  text: string
  color: string
}

/** Decision-engine output line (BUY/SELL or blocked). */
export interface AresDecisionLine {
  visible: boolean
  shouldTrade: boolean
  side: string | null
  reasons: string[]
  color: string
}

/** Wallet block under the ARES strip. */
export interface AresWalletUI {
  balance: number
  locked: number
  available: number
  realizedPnL: number
  fundedTotal: number
  withdrawEnabled: boolean
  withdrawTip: string
  failBannerVisible: boolean
  failMessage: string
}

/** Stage (SEED / ASCENT / SOVEREIGN) progress bar. */
export interface AresStageUI {
  name: string
  from: number
  to: number
  pct: number
  bar: string
  next: string
  complete: boolean
}

/** One objective row under the stage bar. */
export interface AresObjective {
  id: number
  label: string
  from: number
  to: number
  pct: number
  status: 'notstarted' | 'active' | 'done'
  color: string
  colorDim: string
}

/** Cognitive clarity bar (Cog). */
export interface AresCognitiveUI {
  clarity: number
  predictionAccuracy: number
  pulseSpeed: number
}

/** Stats row (Day / Δ / Pred / WR). */
export interface AresStatsUI {
  day: string
  delta: string
  prediction: string
  winRate: string
}

/** Compact summary of a position card rendered under ARES. */
export interface AresPositionCard {
  id: string
  side: 'LONG' | 'SHORT' | string
  symbol: string
  entry: number
  size: number
  pnl: number
  pnlPct: number
  live: boolean
  durationMs: number
  tag?: string
  closable: boolean
}

/** Trade-history bar entries (win/loss marks). */
export interface AresHistoryMark {
  pnl: number
  win: boolean
  ts: number
}

/** Full UI slice held in the Zustand store. */
export interface AresStoreUI {
  /** Strip-bar open/closed (persisted in LS via existing key). */
  stripOpen: boolean

  /** Core state machine output. */
  core: AresCoreState

  /** Confidence score (0–100). */
  confidence: number

  /** IMM — Immortality score percent (balance/10000, capped 100). */
  immPct: number

  /** Emotion suffix next to the badge. */
  emotion: string

  /** Mortal-wound / mission-failed line. */
  wound: AresWoundState

  /** Decision-engine status line. */
  decision: AresDecisionLine

  /** Stage bar (SEED/ASCENT/SOVEREIGN). */
  stage: AresStageUI

  /** Objective rows under the stage bar. */
  objectives: AresObjective[]

  /** Objectives title + color (title reflects funded/not-funded). */
  objectivesTitle: { text: string; color: string }

  /** Wallet block. */
  wallet: AresWalletUI

  /** Cognitive clarity (Cog fill + pct). */
  cognitive: AresCognitiveUI

  /** Stats row. */
  stats: AresStatsUI

  /** Position cards. */
  positions: AresPositionCard[]

  /** Whether the close-all button is shown. */
  closeAllVisible: boolean

  /** Trade history marks (last N). */
  history: AresHistoryMark[]

  /** Lesson line (from teacher/adaptive engine). */
  lesson: string

  /** Thought line(s) rendered in the thought bubble. */
  thoughts: string[]

  /** Consciousness lobe dot colors (6 dots). */
  lobeColors: string[]

  /** [R28.2-F] Lob status dots rendered inside the brain SVG overlay. */
  lobDots: AresLobDot[]

  /** [R28.2-F] Active consciousness dot index (0=SEED, 1=ASCENT, 2=SOVEREIGN). */
  consciousnessActiveIdx: number

  /** [R28.2-F] Mission-arc SVG values driven by progress + trajectory. */
  missionArc: AresMissionArcUI
}

/** [R28.2-F] One brain-lob status dot. */
export interface AresLobDot {
  /** DOM id (ldot-frontal / -temporal / -occipital / -cerebel / -trunchi). */
  id: string
  /** ok | bad | warn */
  level: 'ok' | 'bad' | 'warn'
  /** Display text (e.g. POLICY: BALANCED). */
  text: string
  /** Resolved color hex for the level. */
  color: string
}

/** [R28.2-F] Mission-arc SVG driver state. */
export interface AresMissionArcUI {
  visible: boolean
  pct: number
  tPct: number
  col: string
  startBalance: number
  daysPassed: number
  trajectoryDelta: number
}

/** Default empty UI slice — everything zeroed so components render a no-op state. */
export const DEFAULT_ARES_UI: AresStoreUI = {
  stripOpen: false,
  core: { id: 'FOCUSED', label: 'FOCUSED', emoji: '', color: '#6ef', glow: '#6ef8', consecutiveLoss: 0 },
  confidence: 0,
  immPct: 0,
  emotion: '',
  wound: { visible: false, kind: 'none', text: '', color: '' },
  decision: { visible: false, shouldTrade: false, side: null, reasons: [], color: '' },
  stage: { name: 'SEED', from: 0, to: 1000, pct: 0, bar: '', next: '', complete: false },
  objectives: [],
  objectivesTitle: { text: 'OBJECTIVES', color: '' },
  wallet: {
    balance: 0, locked: 0, available: 0, realizedPnL: 0, fundedTotal: 0,
    withdrawEnabled: false, withdrawTip: '', failBannerVisible: false, failMessage: '',
  },
  cognitive: { clarity: 0, predictionAccuracy: 0, pulseSpeed: 1 },
  stats: { day: '', delta: '', prediction: '', winRate: '' },
  positions: [],
  closeAllVisible: false,
  history: [],
  lesson: '',
  thoughts: [],
  lobeColors: [],
  lobDots: [],
  consciousnessActiveIdx: 0,
  missionArc: { visible: false, pct: 0, tPct: 0, col: '#6ef', startBalance: 0, daysPassed: 0, trajectoryDelta: 0 },
}
