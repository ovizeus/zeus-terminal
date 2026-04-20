// Zeus Terminal — Market Radar realtime subscriber (Phase 11.3)
//
// Subscribes to the shared /ws/sync channel and routes frames of
// type:'market.radar' into useMarketRadarStore. Frames are broadcast by the
// server to every authenticated session (wsBroadcastAll, no user scoping —
// market radar data is the same for everyone), so every tab receives every
// event once.
//
// Design mirrors positionsRealtime.ts:
//   - Reuses the existing wsService; no parallel socket, no polling.
//   - Idempotent start — safe to call multiple times (no-op after first).
//   - Fail-soft shape validation — malformed frames are dropped before
//     reaching the store; any unforeseen throw is swallowed.
//   - No local cursor — the store's monotonic lastEventTs handles ordering.
//   - When MARKET_RADAR_ENABLED=0 on the server, zero frames are emitted,
//     so this subscriber simply stays idle (green/red queues remain empty
//     and the UI degrades quietly).

import { wsService } from './ws'
import type { WsMessage, RadarEvent } from '../types'
import { useMarketRadarStore } from '../stores/marketRadarStore'

let _started = false
let _unsub: (() => void) | null = null

const _validCategories = new Set([
    'spike1h', 'dump1h',
    'spike4h', 'dump4h',
    'spike24h', 'dump24h',
    'volSpike',
    'rankUp', 'rankDown',
    'newTop300', 'exitTop300',
])

function _isValidEvent(d: unknown): d is RadarEvent {
    if (!d || typeof d !== 'object') return false
    const ev = d as Record<string, unknown>
    if (typeof ev.ts !== 'number' || !isFinite(ev.ts)) return false
    if (typeof ev.symbol !== 'string' || ev.symbol.length === 0) return false
    if (typeof ev.category !== 'string' || !_validCategories.has(ev.category)) return false
    if (ev.color !== 'green' && ev.color !== 'red') return false
    return true
}

export function startMarketRadarRealtime(): void {
    if (_started) return
    _started = true

    _unsub = wsService.subscribe((msg: WsMessage) => {
        if (msg.type !== 'market.radar') return
        const ev = msg.data
        if (!_isValidEvent(ev)) return
        try {
            useMarketRadarStore.getState().push(ev)
        } catch {
            /* defensive — store already guards its own state */
        }
    })
}

export function stopMarketRadarRealtime(): void {
    if (_unsub) { _unsub(); _unsub = null }
    _started = false
}
