/**
 * useATBridge — syncs atStore from engine events.
 *
 * Dispatch sites for 'zeus:atStateChanged':
 * - autotrade.ts _emitATChanged(): toggle, kill, trade placed, resetKillSwitch
 * - guards.ts _onNewUTCDay(): daily counter reset
 * - marketDataTrading.ts: mode switch
 * - state.ts pullAndMerge(): server diff applied
 *
 * [9A-4] Event-only — polling removed (all AT write paths now emit events).
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

    window.addEventListener('zeus:atStateChanged', readATSnapshot)
    // Initial read after bridge loads
    setTimeout(readATSnapshot, 3000)

    return () => {
      window.removeEventListener('zeus:atStateChanged', readATSnapshot)
      registeredRef.current = false
    }
  }, [])
}
