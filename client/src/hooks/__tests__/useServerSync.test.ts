import { describe, it, expect, beforeEach } from 'vitest'
import { usePositionsStore } from '../../stores/positionsStore'
import { useATStore } from '../../stores/atStore'
import type { Position } from '../../types'

function mockPosition(overrides: Partial<Position> = {}): Position {
  return {
    seq: 1, userId: '1', ts: Date.now(), symbol: 'BTCUSDT', side: 'LONG',
    price: 43500, size: 500, margin: 500, qty: 0.0115, lev: 10,
    sl: 43000, tp: 45000, slPct: 1.5, rr: 2, slPnl: -75, tpPnl: 150,
    status: 'OPEN', closeTs: null, closePnl: null, closeReason: null,
    mode: 'demo', sourceMode: 'auto', autoTrade: true, controlMode: 'auto',
    addOnCount: 0, addOnHistory: [], dslParams: {}, live: null,
    ...overrides,
  }
}

describe('server sync store updates', () => {
  beforeEach(() => {
    usePositionsStore.setState(usePositionsStore.getInitialState())
    useATStore.setState(useATStore.getInitialState())
  })

  it('AT update separates demo/live positions', () => {
    const demoPos = mockPosition({ seq: 1, mode: 'demo' })
    const livePos = mockPosition({ seq: 2, mode: 'live' })

    // Simulate what useServerSync does (test uses ATStats-shape stats — patch path accepts both)
    const data = {
      mode: 'demo' as const,
      positions: [demoPos, livePos],
      demoBalance: 9500,
      stats: { totalTrades: 5, wins: 3, losses: 2, totalPnL: 120, dailyPnL: 50, realizedDailyPnL: 30, closedTradesToday: 2, dailyStart: 'Thu Apr 03 2026' },
      killTriggered: false,
      enabled: true,
    }

    const demo = data.positions.filter((p) => p.mode === 'demo')
    const live = data.positions.filter((p) => p.mode === 'live')
    usePositionsStore.getState().setDemoPositions(demo)
    usePositionsStore.getState().setLivePositions(live)
    usePositionsStore.getState().setDemoBalance(data.demoBalance)

    expect(usePositionsStore.getState().demoPositions).toHaveLength(1)
    expect(usePositionsStore.getState().livePositions).toHaveLength(1)
    expect(usePositionsStore.getState().demoBalance).toBe(9500)

    useATStore.getState().patch({
      enabled: data.enabled,
      totalTrades: data.stats.totalTrades,
      wins: data.stats.wins,
      totalPnL: data.stats.totalPnL,
    })
    expect(useATStore.getState().enabled).toBe(true)
    expect(useATStore.getState().totalTrades).toBe(5)
    expect(useATStore.getState().totalPnL).toBe(120)
  })
})
