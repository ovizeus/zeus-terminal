import type { Position } from './position'

/**
 * WebSocket message from server
 * From server.js lines 1068-1087
 */
export type WsMessage = WsAtUpdate | WsSyncSignal | WsSettingsChanged | WsPositionsChanged

export interface WsAtUpdate {
  type: 'at_update'
  data: ServerATState
}

export interface WsSyncSignal {
  type: 'sync'
}

/**
 * Cross-device settings broadcast.
 * Emitted by server POST /api/user/settings → broadcastToUser over /ws/sync
 * (see server/routes/trading.js). Subscriber: services/settingsRealtime.ts.
 */
export interface WsSettingsChanged {
  type: 'settings.changed'
  updated_at?: number
  keys?: string[]
}

/**
 * [MIGRATION-F5 commit 1] Cross-device positions broadcast.
 * Emitted by server over /ws/sync **after** a successful DB commit on any
 * mutation of positions state (open / close / SL-TP hit / partial fill).
 * Carries a full snapshot (MVP design — not true delta), so every message
 * is auto-reconciliating: client applies via `replaceAll(snapshot)` and
 * does not need prior state. Dedup is authoritative on `updated_at`
 * (monotonic ms-since-epoch); client drops messages with
 * `updated_at <= _lastKnownTs`.
 *
 * Gated server-side by feature flag `MF.POSITIONS_WS`. Subscriber:
 * services/positionsRealtime.ts (added in Phase 5 C4). Not yet emitted
 * at C1 — this interface is strict contract only, zero call-site flip.
 */
export interface WsPositionsChanged {
  type: 'positions.changed'
  updated_at: number
  snapshot: PositionsSnapshot
}

/**
 * [MIGRATION-F5 commit 1] Full positions snapshot carried by
 * `WsPositionsChanged`. Shape is deliberately a superset of
 * `ServerSnapshot` (from GET /api/sync/state) so the WS path and the
 * polling fallback (`liveApiSyncState` → `ServerSnapshot`) can converge
 * on the same reducer logic in `positionsStore.replaceAll`.
 *
 * Fields:
 * - `updated_at`: authoritative monotonic timestamp for dedup.
 * - `positions`: complete open-positions array at the emit moment.
 * - `closedIds`: optional, mirrors `ServerSnapshot.closedIds` for
 *   consumers that need the closed-position ledger (Journal, PnL
 *   history). Omitted when the server has no cheap way to compute it;
 *   client must treat absence as "no change to closed set".
 */
export interface PositionsSnapshot {
  updated_at: number
  positions: Position[]
  closedIds?: (string | number)[]
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
  killActiveAt?: number
  killReason?: string | null
  killLoss?: number
  killLimit?: number
  killBalRef?: number
  killModeAtTrigger?: string | null
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
