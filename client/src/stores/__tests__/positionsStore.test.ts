import { describe, it, expect, beforeEach } from 'vitest'
import { usePositionsStore } from '../positionsStore'
import type { Position, PositionsSnapshot } from '../../types'

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

function mkPos(overrides: Partial<Position>): Position {
  return { ...mockPosition, ...overrides }
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

  // ── [MIGRATION-F5 commit 2] replaceAll / applyDelta ──────────────────────
  describe('replaceAll (Phase 5 WS reconciliation)', () => {
    it('defaults lastSnapshotTs to 0', () => {
      expect(usePositionsStore.getState().lastSnapshotTs).toBe(0)
    })

    it('splits positions by mode and advances lastSnapshotTs', () => {
      const snap: PositionsSnapshot = {
        updated_at: 1000,
        positions: [
          mkPos({ seq: 1, mode: 'demo', symbol: 'BTCUSDT' }),
          mkPos({ seq: 2, mode: 'live', symbol: 'ETHUSDT' }),
          mkPos({ seq: 3, mode: 'demo', symbol: 'SOLUSDT' }),
        ],
      }
      const applied = usePositionsStore.getState().replaceAll(snap)
      const s = usePositionsStore.getState()

      expect(applied).toBe(true)
      expect(s.demoPositions).toHaveLength(2)
      expect(s.demoPositions.map(p => p.symbol).sort()).toEqual(['BTCUSDT', 'SOLUSDT'])
      expect(s.livePositions).toHaveLength(1)
      expect(s.livePositions[0].symbol).toBe('ETHUSDT')
      expect(s.lastSnapshotTs).toBe(1000)
    })

    it('drops stale snapshot (updated_at <= lastSnapshotTs) and returns false', () => {
      const first: PositionsSnapshot = {
        updated_at: 2000,
        positions: [mkPos({ seq: 1, symbol: 'BTCUSDT' })],
      }
      expect(usePositionsStore.getState().replaceAll(first)).toBe(true)

      const stale: PositionsSnapshot = {
        updated_at: 1500,
        positions: [mkPos({ seq: 99, symbol: 'STALE' })],
      }
      const dup: PositionsSnapshot = {
        updated_at: 2000,
        positions: [mkPos({ seq: 99, symbol: 'SAMETS' })],
      }

      expect(usePositionsStore.getState().replaceAll(stale)).toBe(false)
      expect(usePositionsStore.getState().replaceAll(dup)).toBe(false)

      const s = usePositionsStore.getState()
      expect(s.demoPositions).toHaveLength(1)
      expect(s.demoPositions[0].symbol).toBe('BTCUSDT')
      expect(s.lastSnapshotTs).toBe(2000)
    })

    it('empty positions array clears both lists', () => {
      usePositionsStore.getState().setDemoPositions([mkPos({ seq: 1, symbol: 'OLD' })])
      usePositionsStore.getState().setLivePositions([mkPos({ seq: 2, mode: 'live', symbol: 'OLDLIVE' })])

      const snap: PositionsSnapshot = { updated_at: 100, positions: [] }
      expect(usePositionsStore.getState().replaceAll(snap)).toBe(true)

      const s = usePositionsStore.getState()
      expect(s.demoPositions).toEqual([])
      expect(s.livePositions).toEqual([])
    })

    it('does NOT touch demoBalance or liveBalance', () => {
      usePositionsStore.getState().setDemoBalance(7777)
      usePositionsStore.getState().setLiveBalance({
        totalBalance: 3333,
        availableBalance: 3000,
        unrealizedPnL: 0,
      })

      const snap: PositionsSnapshot = {
        updated_at: 100,
        positions: [mkPos({ seq: 1 })],
      }
      usePositionsStore.getState().replaceAll(snap)

      const s = usePositionsStore.getState()
      expect(s.demoBalance).toBe(7777)
      expect(s.liveBalance.totalBalance).toBe(3333)
    })

    it('rejects snapshot with non-finite updated_at', () => {
      const bad = { updated_at: NaN, positions: [mkPos({ seq: 1 })] } as unknown as PositionsSnapshot
      expect(usePositionsStore.getState().replaceAll(bad)).toBe(false)
      expect(usePositionsStore.getState().lastSnapshotTs).toBe(0)
    })

    it('applyDelta is semantically identical to replaceAll in MVP', () => {
      const snap: PositionsSnapshot = {
        updated_at: 500,
        positions: [
          mkPos({ seq: 1, mode: 'demo', symbol: 'AAA' }),
          mkPos({ seq: 2, mode: 'live', symbol: 'BBB' }),
        ],
      }
      const applied = usePositionsStore.getState().applyDelta(snap)
      const s = usePositionsStore.getState()

      expect(applied).toBe(true)
      expect(s.demoPositions).toHaveLength(1)
      expect(s.livePositions).toHaveLength(1)
      expect(s.lastSnapshotTs).toBe(500)

      // Dedup also applies via applyDelta
      expect(usePositionsStore.getState().applyDelta({ ...snap })).toBe(false)
    })
  })
})
