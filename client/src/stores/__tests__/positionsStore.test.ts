import { describe, it, expect, beforeEach } from 'vitest'
import { usePositionsStore } from '../positionsStore'
import type { Position } from '../../types'

const mockPosition: Position = {
  seq: 1,
  userId: 'test',
  ts: Date.now(),
  symbol: 'BTCUSDT',
  side: 'LONG',
  price: 43500,
  size: 500,
  margin: 500,
  qty: 0.0115,
  lev: 10,
  sl: 43000,
  tp: 45000,
  slPct: 1.5,
  rr: 2,
  slPnl: -75,
  tpPnl: 150,
  status: 'OPEN',
  closeTs: null,
  closePnl: null,
  closeReason: null,
  mode: 'demo',
  sourceMode: 'auto',
  autoTrade: true,
  controlMode: 'auto',
  addOnCount: 0,
  addOnHistory: [],
  dslParams: {},
  live: null,
}

describe('positionsStore', () => {
  beforeEach(() => {
    usePositionsStore.setState(usePositionsStore.getInitialState())
  })

  it('has correct defaults', () => {
    const s = usePositionsStore.getState()
    expect(s.demoPositions).toEqual([])
    expect(s.livePositions).toEqual([])
    expect(s.demoBalance).toBe(10000)
    expect(s.liveConnected).toBe(false)
  })

  it('setDemoPositions replaces array', () => {
    usePositionsStore.getState().setDemoPositions([mockPosition])
    expect(usePositionsStore.getState().demoPositions).toHaveLength(1)
    expect(usePositionsStore.getState().demoPositions[0].symbol).toBe('BTCUSDT')
  })

  it('setDemoBalance updates balance', () => {
    usePositionsStore.getState().setDemoBalance(8500)
    expect(usePositionsStore.getState().demoBalance).toBe(8500)
  })

  it('setLiveBalance updates balance object', () => {
    usePositionsStore.getState().setLiveBalance({
      totalBalance: 5000,
      availableBalance: 4200,
      unrealizedPnL: 120,
    })
    expect(usePositionsStore.getState().liveBalance.totalBalance).toBe(5000)
  })
})
