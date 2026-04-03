/** Position side */
export type Side = 'LONG' | 'SHORT'

/** Position mode */
export type PositionMode = 'demo' | 'live'

/** Source of position creation */
export type SourceMode = 'auto' | 'manual'

/** Who controls position SL/TP */
export type ControlMode = 'auto' | 'user'

/** Close reason strings */
export type CloseReason =
  | 'TP'
  | 'SL'
  | 'DSL'
  | 'MANUAL_CLIENT'
  | 'EMERGENCY_CLOSED'
  | 'RESET'
  | 'KILL_SWITCH'
  | string

/** Position status */
export type PositionStatus = 'OPEN' | CloseReason

/** Live execution status */
export type LiveStatus = 'LIVE' | 'LIVE_NO_SL' | 'EMERGENCY_CLOSED' | string

/** Quality metrics — computed at close */
export interface PositionQuality {
  mae: number
  mfe: number
  exitPct: number
  capturedPct: number
  minPrice: number
  maxPrice: number
}

/** Add-on event in history */
export interface AddOnEvent {
  price: number
  qty: number
  fillPrice?: number
  ts: number
}

/** Live exchange metadata — only for mode='live' */
export interface LiveMeta {
  status: LiveStatus
  liveSeq: number
  clientOrderId: string
  mainOrderId?: number
  avgPrice?: number
  executedQty?: number
  slOrderId?: number | null
  tpOrderId?: number | null
  slPlaced?: boolean
  tpPlaced?: boolean
  expectedPrice?: number
  fillPrice?: number
  entrySlippage?: number
  entrySlippagePct?: number
  exitSlippage?: number
  exitSlippagePct?: number
  exitExpectedPrice?: number
  exitFillPrice?: number
  error?: string
}

/** DSL progress snapshot persisted with position */
export interface DslProgress {
  active: boolean
  progress?: number
  activationPrice?: number
  currentSL?: number
  pivotLeft?: number | null
  pivotRight?: number | null
  impulseVal?: number | null
  yellowLine?: number | null
  impulseTriggered?: boolean
}

/** DSL params attached to position at entry */
export interface DslParams {
  mode?: string | null
  activatePct?: number
  trailPct?: number
  trailSusPct?: number
  extendPct?: number
}

/** Entry snapshot captured from brain at decision time */
export interface EntrySnapshot {
  confidence?: number
  confluenceScore?: number
  regime?: string | null
  tier?: string
  cycle?: number
}

/** Full position object — matches server/services/serverAT.js */
export interface Position {
  // Core
  seq: number
  userId: string | number
  ts: number
  symbol: string
  side: Side
  price: number
  size: number
  margin: number
  qty: number
  lev: number

  // Risk
  sl: number
  tp: number
  slPct: number
  rr: number
  slPnl: number
  tpPnl: number

  // Status
  status: PositionStatus
  closeTs: number | null
  closePnl: number | null
  closeReason: CloseReason | null

  // Mode & control
  mode: PositionMode
  sourceMode: SourceMode
  autoTrade: boolean
  controlMode: ControlMode

  // Decision metadata (optional — set by AT engine)
  cycle?: number
  tier?: string
  confidence?: number
  confluenceScore?: number
  fusionMult?: number
  regime?: string | null

  // Close regime tracking
  closeRegime?: string | null
  closeRegimeConf?: number | null

  // Add-on tracking
  addOnCount: number
  addOnHistory: AddOnEvent[]
  originalEntry?: number
  originalSize?: number
  originalQty?: number

  // DSL
  dslParams: DslParams
  dslProgress?: DslProgress

  // Quality (set at close)
  quality?: PositionQuality

  // Live exchange metadata
  live: LiveMeta | null

  // Entry snapshot
  entrySnapshot?: EntrySnapshot
}
