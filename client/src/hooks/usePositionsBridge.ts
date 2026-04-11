/**
 * usePositionsBridge — syncs positionsStore from engine events.
 *
 * Dispatch sites for 'zeus:positionsChanged':
 * - autotrade.ts: demo/live open, triggerKillSwitch mass close, execPartialClose
 * - marketDataTrading.ts: manual demo/live MARKET + LIMIT open
 * - marketDataPositions.ts: LIMIT fill, live close (async + sync paths)
 * - marketDataClose.ts: demo close
 * - liveApi.ts: live positions full rebuild from exchange sync
 * - state.ts: pullAndMerge server diff (on changed path)
 *
 * [9A-5] Event-only — polling removed (all TP write paths now emit events).
 */
import { useEffect, useRef } from 'react'
import { usePositionsStore } from '../stores'

export function usePositionsBridge() {
  const registeredRef = useRef(false)

  useEffect(() => {
    if (registeredRef.current) return
    registeredRef.current = true

    const w = window as any

    function readSnapshotFromWindow() {
      if (!w.TP) return
      usePositionsStore.getState().syncSnapshot({
        demoPositions: [...(w.TP.demoPositions || [])],
        livePositions: [...(w.TP.livePositions || [])],
        demoBalance: w.TP.demoBalance,
        liveBalance: w.TP.liveBalance,
        source: 'bridge',
      })
    }

    window.addEventListener('zeus:positionsChanged', readSnapshotFromWindow)
    // Initial read after bridge loads
    setTimeout(readSnapshotFromWindow, 2000)

    return () => {
      window.removeEventListener('zeus:positionsChanged', readSnapshotFromWindow)
      registeredRef.current = false
    }
  }, [])
}
