/**
 * Subscribes to WS messages and routes at_update to stores.
 * Also does initial AT state pull on mount.
 */
import { useEffect } from 'react'
import { wsService } from '../services/ws'
import { syncApi } from '../services/api'
import { usePositionsStore, useATStore, useUiStore } from '../stores'
import type { WsMessage, ServerATState } from '../types'

function applyATUpdate(data: ServerATState) {
  const posStore = usePositionsStore.getState()
  const atStore = useATStore.getState()

  // Separate demo/live positions
  const demo = data.positions.filter((p) => p.mode === 'demo')
  const live = data.positions.filter((p) => p.mode === 'live')
  posStore.setDemoPositions(demo)
  posStore.setLivePositions(live)
  posStore.setDemoBalance(data.demoBalance)
  if (data.liveBalance != null) {
    posStore.setLiveBalance({
      totalBalance: data.liveBalance,
      availableBalance: data.liveBalance,
      unrealizedPnL: 0,
    })
  }

  // AT state
  atStore.patch({
    enabled: data.enabled,
    mode: data.mode === 'demo' ? 'demo' : 'live',
    killTriggered: data.killTriggered,
    totalTrades: data.stats.totalTrades,
    wins: data.stats.wins,
    losses: data.stats.losses,
    totalPnL: data.stats.totalPnL,
    dailyPnL: data.stats.dailyPnL,
    realizedDailyPnL: data.stats.realizedDailyPnL,
    closedTradesToday: data.stats.closedTradesToday,
    _modeConfirmed: true,
    _serverMode: data.mode,
  })
}

export function useServerSync() {
  useEffect(() => {
    // Initial pull
    syncApi.pullState().then((res) => {
      if (res.ok && res.data) {
        const snap = res.data
        const demo = snap.positions.filter((p) => p.mode === 'demo')
        const live = snap.positions.filter((p) => p.mode === 'live')
        usePositionsStore.getState().setDemoPositions(demo)
        usePositionsStore.getState().setLivePositions(live)
        usePositionsStore.getState().setDemoBalance(snap.demoBalance)
      }
    })

    // WS subscription
    const unsub = wsService.subscribe((msg: WsMessage) => {
      if (msg.type === 'at_update' && msg.data) {
        applyATUpdate(msg.data)
      }
      // Update connection status
      useUiStore.getState().setConnected(true)
    })

    // Connection status check
    const interval = setInterval(() => {
      useUiStore.getState().setConnected(wsService.isConnected())
    }, 3000)

    return () => {
      unsub()
      clearInterval(interval)
    }
  }, [])
}
