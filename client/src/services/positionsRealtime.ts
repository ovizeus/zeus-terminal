// Zeus Terminal — positions realtime subscriber
// Phase 5 (Option A — WebSocket).
//
// Listens for "positions.changed" messages on the EXISTING /ws/sync channel
// (wsService). On receipt, hands the snapshot directly to
// usePositionsStore.getState().applyDelta(snapshot), which:
//   - splits the snapshot into demoPositions / livePositions,
//   - advances positionsStore.lastSnapshotTs monotonically,
//   - drops stale / duplicate messages silently (returns false).
//
// Design:
//   - Reuses wsService (no parallel socket, no polling, no SSE).
//   - Idempotent startPositionsRealtime() — safe to call multiple times.
//   - NO local cursor — the store owns dedup via its own lastSnapshotTs.
//     This avoids having two monotonic counters drifting apart.
//   - Fail-soft: unknown-shape messages are dropped before touching the
//     store; any unforeseen throw is swallowed so a bad payload cannot
//     take down the subscriber or the page.
//   - Effective no-op while server MF.POSITIONS_WS=false (server does not
//     emit, so this subscriber simply never receives 'positions.changed').
//
// [MIGRATION-F5 commit 4] Zero server flip, zero polling change.

import { wsService } from './ws'
import type { WsMessage } from '../types'
import { usePositionsStore } from '../stores/positionsStore'

let _started = false
let _unsub: (() => void) | null = null
let _lastReceivedTs = 0
let _stalenessTimer: ReturnType<typeof setInterval> | null = null
const STALENESS_MS = 120000

export function startPositionsRealtime(): void {
  if (_started) return
  _started = true

  _unsub = wsService.subscribe((msg: WsMessage) => {
    if (msg.type !== 'positions.changed') return

    const snap = msg.snapshot
    if (
      !snap ||
      typeof snap !== 'object' ||
      !Array.isArray(snap.positions) ||
      !Number.isFinite(Number(snap.updated_at))
    ) {
      return
    }

    // [FLICKER-FIX] Mark WS positions as active — state.ts REST poll defers to WS
    _lastReceivedTs = Date.now()
    ;(window as any)._positionsChangedActive = true

    try {
      usePositionsStore.getState().applyDelta(snap)
    } catch {
      /* store handles dedup + validation silently */
    }
  })

  // [FLICKER-FIX] Staleness check — if no positions.changed for 120s, fall back to REST
  _stalenessTimer = setInterval(() => {
    if (_lastReceivedTs > 0 && Date.now() - _lastReceivedTs > STALENESS_MS) {
      ;(window as any)._positionsChangedActive = false
    }
  }, 30000)
}

export function stopPositionsRealtime(): void {
  if (_unsub) { _unsub(); _unsub = null }
  if (_stalenessTimer) { clearInterval(_stalenessTimer); _stalenessTimer = null }
  ;(window as any)._positionsChangedActive = false
  _started = false
  _lastReceivedTs = 0
}
