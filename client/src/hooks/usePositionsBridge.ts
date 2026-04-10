/**
 * usePositionsBridge — syncs positionsStore from engine events.
 *
 * Engines (autotrade.ts, marketDataTrading.ts, marketDataClose.ts) emit
 * 'zeus:positionsChanged' after every push/close on window.TP.
 *
 * This hook reads a COMPLETE SNAPSHOT from window.TP (not incremental delta)
 * and applies it atomically to positionsStore via syncSnapshot().
 *
 * Rule: server is final truth at boot/refresh. Bridge events are fast local sync.
 *
 * Safety:
 * - cleanup on unmount (removeEventListener)
 * - useRef guard against duplicate registration in StrictMode
 * - snapshot read is atomic (no partial state)
 * - polling fallback every 5s as safety net
 */
import { useEffect, useRef } from 'react'
import { usePositionsStore } from '../stores'

export function usePositionsBridge() {
  const registeredRef = useRef(false)

  useEffect(() => {
    // Guard against double-register in React StrictMode
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

    function onPositionsChanged() {
      readSnapshotFromWindow()
    }

    // Listen for engine events
    window.addEventListener('zeus:positionsChanged', onPositionsChanged)

    // Polling fallback every 5s (safety net if engine misses event)
    const pollTimer = setInterval(readSnapshotFromWindow, 5000)

    // Initial read after bridge loads
    setTimeout(readSnapshotFromWindow, 2000)

    return () => {
      window.removeEventListener('zeus:positionsChanged', onPositionsChanged)
      clearInterval(pollTimer)
      registeredRef.current = false
    }
  }, [])
}
