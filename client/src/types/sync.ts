import type { Position } from './position'

/**
 * WebSocket message from server
 * From server.js lines 1068-1081
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
 * Shape from serverAT.js getState()
 */
export interface ServerATState {
  mode: string
  positions: Position[]
  demoBalance: number
  liveBalance?: number
  stats: {
    totalTrades: number
    wins: number
    losses: number
    totalPnL: number
    dailyPnL: number
    realizedDailyPnL: number
    closedTradesToday: number
    dailyStart: string
  }
  killTriggered: boolean
  killPct?: number
  enabled: boolean
}

/**
 * Server snapshot from GET /api/sync/state
 * From server/routes/sync.js lines 52-80
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
