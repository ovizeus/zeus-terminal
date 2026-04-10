/**
 * useATBridge — syncs atStore from engine events.
 *
 * Engine (autotrade.ts) emits 'zeus:atStateChanged' after toggle, kill,
 * position open/close, stats update. This hook reads a COMPLETE SNAPSHOT
 * from window.AT and applies it atomically to atStore via patch().
 *
 * Rule: server is final truth at boot/refresh. Engine events are fast local sync.
 * Stats are mirrored, not recalculated — React is a pure observer.
 *
 * Safety:
 * - cleanup on unmount
 * - useRef guard against double registration in StrictMode
 * - snapshot read is atomic
 * - polling fallback every 5s
 */
import { useEffect, useRef } from 'react'
import { useATStore } from '../stores'

export function useATBridge() {
  const registeredRef = useRef(false)

  useEffect(() => {
    if (registeredRef.current) return
    registeredRef.current = true

    const w = window as any

    function readATSnapshot() {
      if (!w.AT) return
      const AT = w.AT
      useATStore.getState().patch({
        enabled: !!AT.enabled,
        mode: AT.mode || 'demo',
        killTriggered: !!AT.killTriggered,
        totalTrades: AT.totalTrades || 0,
        wins: AT.wins || 0,
        losses: AT.losses || 0,
        totalPnL: AT.totalPnL || 0,
        dailyPnL: AT.realizedDailyPnL || 0,
        realizedDailyPnL: AT.realizedDailyPnL || 0,
        closedTradesToday: AT.closedTradesToday || 0,
      })
    }

    function onATChanged() {
      readATSnapshot()
    }

    window.addEventListener('zeus:atStateChanged', onATChanged)

    // Polling fallback every 5s (safety net)
    const pollTimer = setInterval(readATSnapshot, 5000)

    // Initial read after bridge loads
    setTimeout(readATSnapshot, 3000)

    return () => {
      window.removeEventListener('zeus:atStateChanged', onATChanged)
      clearInterval(pollTimer)
      registeredRef.current = false
    }
  }, [])
}
