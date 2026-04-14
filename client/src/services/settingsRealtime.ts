// Zeus Terminal — settings realtime subscriber
// Phase 0 (Option A — WebSocket).
//
// Listens for "settings.changed" messages on the EXISTING /ws/sync channel
// (wsService). On a newer updated_at than last-known, triggers
// window._usFetchRemote() which GETs /api/user/settings and applies the
// flat payload into USER_SETTINGS in-place (see config.ts _usFetchRemote).
//
// Design:
//   - Reuses wsService (no parallel transport, no polling, no SSE)
//   - Idempotent start() — safe to call multiple times
//   - Dedup: skip when message updated_at is not newer than _lastKnownTs
//   - Dedup: skip when a fetch is already in-flight (coalesces bursts)
//   - Fail-soft: any error → swallow; next WS push retries naturally

import { wsService } from './ws'
import type { WsMessage } from '../types'

let _started = false
let _unsub: (() => void) | null = null
let _lastKnownTs = 0
let _fetchInFlight = false

type SettingsChangedMsg = {
  type: 'settings.changed'
  updated_at?: number
  keys?: string[]
}

export function startSettingsRealtime(): void {
  if (_started) return
  _started = true

  _unsub = wsService.subscribe((msg: WsMessage) => {
    // WsMessage union does not declare settings.changed (server extension
    // for phase 0). Treat the raw payload as unknown and narrow manually.
    const raw = msg as unknown as Partial<SettingsChangedMsg>
    if (!raw || raw.type !== 'settings.changed') return

    const remoteTs = Number(raw.updated_at || 0)

    // Dedup: skip if message is not newer than last-known
    if (remoteTs > 0 && remoteTs <= _lastKnownTs) return

    // Dedup: coalesce bursts
    if (_fetchInFlight) return

    const w = window as any
    if (typeof w._usFetchRemote !== 'function') return

    _fetchInFlight = true
    Promise.resolve()
      .then(() => w._usFetchRemote() as Promise<number>)
      .then((ts: number) => {
        if (typeof ts === 'number' && ts > _lastKnownTs) _lastKnownTs = ts
      })
      .catch(() => { /* transient — next WS push will retry */ })
      .finally(() => { _fetchInFlight = false })
  })
}

export function stopSettingsRealtime(): void {
  if (_unsub) { _unsub(); _unsub = null }
  _started = false
}

export function getLastKnownSettingsTs(): number {
  return _lastKnownTs
}
