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

export function startSettingsRealtime(): void {
  if (_started) return
  _started = true

  _unsub = wsService.subscribe((msg: WsMessage) => {
    if (msg.type !== 'settings.changed') return
    const remoteTs = Number(msg.updated_at || 0)

    if (remoteTs > 0 && remoteTs <= _lastKnownTs) return
    if (_fetchInFlight) return

    _fetchInFlight = true
    useSettingsStore.getState().loadFromServer()
      .then(() => {
        if (remoteTs > _lastKnownTs) _lastKnownTs = remoteTs
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
