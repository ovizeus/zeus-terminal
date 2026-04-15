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
  killReason: string | null
  killLoss: number
  killLimit: number
  killBalRef: number
  killModeAtTrigger: string | null
  killActiveAt: number
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
  enabledAt: number
  _modeConfirmed: boolean
  _enabledPerMode: Record<string, boolean>
  _serverMode: string
  _serverStats: ATStats | null
  _serverDemoStats: ATStats | null
  _serverLiveStats: ATStats | null

  // Log
  log: ATLogEntry[]
}

/**
 * AutoTrade config — canonical parameters consumed by the AT decision engine.
 * Phase 3 contract: mirror of the subset of `window.TC` that AT actually
 * reads (lev/size/slPct/rr/maxPos/sigMin/adxMin/cooldownMs). Wire mapping
 * to `SettingsPayload`: sl→slPct, others 1:1; adxMin and cooldownMs are
 * NOT in the flat wire and are hydrated from nested blobs / defaults.
 */
export interface ATConfig {
  lev: number
  size: number
  slPct: number
  rr: number
  maxPos: number
  sigMin: number
  adxMin: number
  cooldownMs: number
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
