import type { PositionMode } from './position'

/** Predator state */
export type PredatorState = 'HUNT' | 'SLEEP' | 'KILL'

/**
 * Trading config — mirrors window.TC from state.js:166
 * Synced to server via /api/tc/sync
 */
export interface TradingConfig {
  lev: number
  size: number
  slPct: number
  rr: number
  riskPct: number
  maxPos: number
  cooldownMs: number
  minADX: number
  hourStart: number
  hourEnd: number
  sigMin: number
  confMin: number

  // DSL defaults
  dslActivatePct: number
  dslTrailPct: number
  dslTrailSusPct: number
  dslExtendPct: number
}

/**
 * AutoTrade state — mirrors window.AT from events.js:6
 */
export interface ATState {
  enabled: boolean
  mode: PositionMode
  running: boolean
  killTriggered: boolean
  interval: number | null

  // Stats
  totalTrades: number
  wins: number
  losses: number
  totalPnL: number
  dailyPnL: number
  realizedDailyPnL: number
  closedTradesToday: number
  dailyStart: string

  // Cooldown
  lastTradeSide: string | null
  lastTradeTs: number
  cooldownMs: number
  _cooldownBySymbol: Record<string, number>
  _killTriggeredTs: number
  _modeConfirmed: boolean
  _enabledPerMode: Record<string, boolean>
  _serverMode: string
  _serverStats: ATStats | null
  _serverDemoStats: ATStats | null
  _serverLiveStats: ATStats | null

  // Log
  log: ATLogEntry[]
}

/** AT stats subset from server */
export interface ATStats {
  totalTrades: number
  wins: number
  losses: number
  totalPnL: number
  dailyPnL: number
  realizedDailyPnL: number
  closedTradesToday: number
}

/** AT log entry */
export interface ATLogEntry {
  ts: number
  action: string
  symbol?: string
  side?: string
  reason?: string
}

/**
 * DSL state — mirrors window.DSL from config.js:1985
 */
export interface DslState {
  enabled: boolean
  mode: string | null
  magnetEnabled: boolean
  magnetMode: string
  positions: Record<string, DslPositionState>
  checkInterval: number | null
}

/** Per-position DSL tracking */
export interface DslPositionState {
  active: boolean
  currentSL: number | null
  highWater: number
  tpExtended: boolean
  pivotLeft: number | null
  pivotRight: number | null
  impulseVal: number | null
  yellowLine: number | null
  originalSL: number | null
  originalTP: number | null
  source: string
  attachedTs: number
  impulseTriggered: boolean
  log: unknown[]
}

/** Predator engine state */
export interface Predator {
  state: PredatorState
  reason: string
  since: number
}

/** Balance info from exchange */
export interface Balance {
  totalBalance: number
  availableBalance: number
  unrealizedPnL: number
}

/** Block reason state */
export interface BlockReason {
  blocked: boolean
  reason: string
  since: number
}
