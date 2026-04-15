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

export function startPositionsRealtime(): void {
  if (_started) return
  _started = true

  _unsub = wsService.subscribe((msg: WsMessage) => {
    if (msg.type !== 'positions.changed') return

    // Defensive shape check — the WsMessage union narrows msg here, but the
    // runtime payload ultimately comes from the wire. A malformed frame must
    // not crash the subscriber or reach the store.
    const snap = msg.snapshot
    if (
      !snap ||
      typeof snap !== 'object' ||
      !Array.isArray(snap.positions) ||
      !Number.isFinite(Number(snap.updated_at))
    ) {
      return
    }

    try {
      usePositionsStore.getState().applyDelta(snap)
    } catch {
      /* store handles dedup + validation silently; swallow any unforeseen throw */
    }
  })
}

export function stopPositionsRealtime(): void {
  if (_unsub) { _unsub(); _unsub = null }
  _started = false
}
