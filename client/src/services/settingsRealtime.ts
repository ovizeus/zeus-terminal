// Zeus Terminal — settings realtime subscriber
// Listens for "settings.changed" on the WS /ws/sync channel.
// On a newer updated_at, calls settingsStore.loadFromServer() directly.

import { wsService } from './ws'
import { useSettingsStore } from '../stores/settingsStore'
import type { WsMessage } from '../types'

let _started = false
let _unsub: (() => void) | null = null
let _lastKnownTs = 0
let _fetchInFlight = false
// [Phase 8A2] Highest updated_at seen while a fetch was already in-flight.
// When the current fetch resolves, if this is newer than what we observed,
// trigger one more fetch so the latest settings.changed push is not silently
// dropped. 0 = no pending re-fetch queued.
let _pendingTs = 0

function _runFetch(remoteTs: number): void {
  _fetchInFlight = true
  useSettingsStore.getState().loadFromServer()
    .then(() => {
      if (remoteTs > _lastKnownTs) _lastKnownTs = remoteTs
    })
    .catch(() => { /* transient — next WS push will retry */ })
    .finally(() => {
      _fetchInFlight = false
      // [Phase 8A2] Drain queued push if one arrived during this fetch.
      if (_pendingTs > _lastKnownTs) {
        const next = _pendingTs
        _pendingTs = 0
        _runFetch(next)
      } else {
        _pendingTs = 0
      }
    })
}

export function startSettingsRealtime(): void {
  if (_started) return
  _started = true

  _unsub = wsService.subscribe((msg: WsMessage) => {
    if (msg.type !== 'settings.changed') return
    const remoteTs = Number(msg.updated_at || 0)

    if (remoteTs > 0 && remoteTs <= _lastKnownTs) return

    if (_fetchInFlight) {
      // [Phase 8A2] Fetch in progress — remember newest ts seen so we run
      // one more fetch after it resolves. Without this consecutive pushes
      // during a single fetch window were silently dropped.
      if (remoteTs > _pendingTs) _pendingTs = remoteTs
      return
    }

    _runFetch(remoteTs)
  })
}

export function stopSettingsRealtime(): void {
  if (_unsub) { _unsub(); _unsub = null }
  _started = false
}

export function getLastKnownSettingsTs(): number {
  return _lastKnownTs
}

// [SETTINGS-SYNC-1 2026-05-13] Setter pentru a sync `_lastKnownTs` cu
// POST response `updated_at`. Eliminează own-echo loop: după POST success,
// WS `settings.changed` cu același ts arrive at originator → check
// `remoteTs <= _lastKnownTs` filtrează echo-ul → NU mai trigger GET inutil.
// Apelat din config.ts `_usApplyPostResponse` la fiecare POST OK.
export function setLastKnownSettingsTs(ts: number): void {
  if (ts > _lastKnownTs) _lastKnownTs = ts
}
