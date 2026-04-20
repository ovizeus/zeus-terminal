import type { Position } from './position'

/**
 * WebSocket message from server
 * From server.js lines 1068-1087
 */
export type WsMessage = WsAtUpdate | WsSyncSignal | WsSettingsChanged | WsPositionsChanged | WsReconnect | WsMarketRadar | WsMarketRadarSnapshot

/**
 * [Phase 11.2] Market Radar event broadcast.
 * Emitted by server/services/marketRadar.js every poll (default 60s) when a
 * tracked symbol crosses a category threshold. Market-wide — sent via
 * wsBroadcastAll to every connected session. Subscriber:
 * services/marketRadarRealtime.ts.
 *
 * Dedup is authoritative on the server (5-min window per symbol/category),
 * so the client store stays simple: append to the colored FIFO queue and
 * drop from the front when cap is reached.
 *
 * The "TOP 300" universe is Binance Futures USDT perpetuals ranked by
 * 24h quoteVolume — a liquidity ranking, NOT global market cap.
 */
export type RadarCategory =
  | 'spike1h' | 'dump1h'
  | 'spike4h' | 'dump4h'
  | 'spike24h' | 'dump24h'
  | 'volSpike'
  | 'rankUp' | 'rankDown'
  | 'newTop300' | 'exitTop300'
  | 'fundingExtreme'     // crowded trade — |funding rate| ≥ 0.05% / 8h
  | 'oiSurge'            // |open-interest Δ| ≥ 10% vs 1h ago
  | 'liqLong'            // long position liquidated ≥ $100k notional
  | 'liqShort'           // short position liquidated ≥ $100k notional

export interface RadarEvent {
  ts: number
  symbol: string
  category: RadarCategory
  color: 'green' | 'red'
  price: number | null
  changePct: number | null
  volRatio?: number | null
  rank: number | null
  rankPrev?: number | null
  quoteVolume: number | null
  // ── Phase 11.4 enrichment (server attaches on every emit) ──
  btcDelta?: number | null        // BTCUSDT priceChangePercent24h at emit time
  streakCount?: number | null     // consecutive fires of (symbol, category) within 15 min
  // ── Phase 11.4 category-specific fields (present only for their category) ──
  fundingRate?: number | null     // fundingExtreme — Binance lastFundingRate (per 8h)
  oiChangePct?: number | null     // oiSurge — open-interest % change vs 1h ago
  notional?: number | null        // liqLong / liqShort — price × qty in USD
}

export interface WsMarketRadar {
  type: 'market.radar'
  data: RadarEvent
}

/**
 * [Phase 11.7] Market Radar warm-start snapshot. Emitted by server to every
 * new WebSocket session on connect (see server.js WS connection handler) so
 * the client doesn't start with empty bands on refresh / reconnect / first
 * tab open. Carries the same-shape events already in the server's rolling
 * cache (last 10 min, capped per color) plus the monotonic lastEventTs so
 * the client's stale-replay guard stays consistent.
 */
export interface WsMarketRadarSnapshot {
  type: 'market.radar.snapshot'
  data: {
    green: RadarEvent[]
    red: RadarEvent[]
    lastEventTs: number
  }
}

export interface WsAtUpdate {
  type: 'at_update'
  data: ServerATState
}

export interface WsSyncSignal {
  type: 'sync'
}

/**
 * [Phase 3E] Synthetic event emitted by services/ws.ts when the WebSocket
 * re-opens after a previous close (i.e. NOT on first connect). Subscribers
 * use this to trigger canonical-truth refresh (AT state, env flags, position
 * ownership) without waiting for the next server-initiated push or the 30s
 * polling tick. Carries no payload — receivers re-pull authoritative state.
 */
export interface WsReconnect {
  type: 'reconnect'
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
  resolvedEnv: 'DEMO' | 'TESTNET' | 'REAL' | null // [Phase 3D] aligned with executionEnv (canonical truth); null when blocked
  activeExchange?: 'binance' | 'bybit' | null
  // Phase 2C canonical execution env — truth from server _resolveExecutionEnv()
  executionEnv: 'DEMO' | 'TESTNET' | 'REAL' | null
  executionBlockedReason: 'NO_ACTIVE_API_CREDENTIALS' | 'INVALID_ACTIVE_API_CONFIGURATION' | null

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
