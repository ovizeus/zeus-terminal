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
//
// [MIGRATION-F1 commit 3] Typed against WsSettingsChanged from the unified
// WsMessage union. Local `SettingsChangedMsg` alias removed; the `as unknown
// as Partial<...>` cast is gone. window narrowed via local ZeusWindowExt.

import { wsService } from './ws'
import type { WsMessage } from '../types'

interface ZeusWindowExt {
  _usFetchRemote?: () => Promise<number>
}

let _started = false
let _unsub: (() => void) | null = null
let _lastKnownTs = 0
let _fetchInFlight = false

export function startSettingsRealtime(): void {
  if (_started) return
  _started = true

  _unsub = wsService.subscribe((msg: WsMessage) => {
    if (msg.type !== 'settings.changed') return
    const remoteTs = Number(msg.updated_at || 0)

    // Dedup: skip if message is not newer than last-known
    if (remoteTs > 0 && remoteTs <= _lastKnownTs) return

    // Dedup: coalesce bursts
    if (_fetchInFlight) return

    const w = window as unknown as ZeusWindowExt
    const fetchRemote = w._usFetchRemote
    if (typeof fetchRemote !== 'function') return

    _fetchInFlight = true
    Promise.resolve()
      .then(() => fetchRemote())
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
