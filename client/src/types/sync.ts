import type { Position } from './position'

/**
 * WebSocket message from server
 * From server.js lines 1068-1087
 */
export type WsMessage = WsAtUpdate | WsSyncSignal

export interface WsAtUpdate {
  type: 'at_update'
  data: ServerATState
}

export interface WsSyncSignal {
  type: 'sync'
}

/**
 * Server AT state pushed via WebSocket at_update
 * Shape from serverAT.js getFullState() — lines 1763-1791
 */
export interface ServerATState {
  mode: string // 'demo' | 'live'
  enabled: boolean
  atActive: boolean
  apiConfigured: boolean
  exchangeMode: string | null // 'testnet' | 'live' | null
  resolvedEnv: string // 'DEMO' | 'TESTNET' | 'REAL'

  // Positions — server sends both flat and split
  positions: Position[]
  demoPositions?: Position[]
  livePositions?: Position[]

  // Stats
  stats: ServerATStats
  demoStats?: ServerATStats
  liveStats?: ServerLiveStats

  // Balance — server sends object: { balance, pnl, startBalance }
  demoBalance: number | ServerDemoBalance
  killActive: boolean
  killPct?: number
  dailyPnL: number
  dailyPnLDemo: number
  dailyPnLLive: number
  pnlAtReset: number
  ts: number
}

export interface ServerDemoBalance {
  balance: number
  pnl: number
  startBalance: number
}

export interface ServerATStats {
  entries: number
  exits: number
  openCount?: number
  pnl: number
  wins: number
  losses: number
  winRate: number
  dailyPnL: number
}

export interface ServerLiveStats extends ServerATStats {
  enabled: boolean
  tradingUserId: number
  blocked: number
  errors: number
}

/**
 * Server snapshot from GET /api/sync/state
 * From server/routes/sync.js
 */
export interface ServerSnapshot {
  ts: number
  positions: Position[]
  closedIds: (string | number)[]
  demoBalance: number
}

/** Sync state response */
export interface SyncStateResponse {
  ok: boolean
  data: ServerSnapshot | null
}

/** Sync push payload for POST /api/sync/state */
export interface SyncStatePush {
  ts: number
  positions: Position[]
  closedIds: (string | number)[]
  demoBalance: number
}
