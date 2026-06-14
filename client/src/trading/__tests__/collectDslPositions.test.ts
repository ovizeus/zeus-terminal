import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { _collectDslPositions } from '../dsl'
import { usePositionsStore } from '../../stores/positionsStore'

const w = globalThis as any

beforeEach(() => {
  w.TP = { demoPositions: [], livePositions: [] }
  usePositionsStore.setState({ demoPositions: [], livePositions: [] })
})
afterEach(() => {
  delete w.TP
  usePositionsStore.setState({ demoPositions: [], livePositions: [] })
})

describe('_collectDslPositions (DSL position source)', () => {
  it('reads server-authoritative positions from the React store (w.TP empty)', () => {
    usePositionsStore.setState({
      demoPositions: [
        { id: 3, sym: 'BTCUSDT', autoTrade: true, dsl: { active: true } },
        { id: 4, sym: 'ETHUSDT', autoTrade: true, dsl: { active: false } },
      ] as any,
      livePositions: [],
    })
    const out = _collectDslPositions()
    expect(out.map((p) => p.sym).sort()).toEqual(['BTCUSDT', 'ETHUSDT'])
  })

  it('excludes closed positions', () => {
    usePositionsStore.setState({
      demoPositions: [
        { id: 1, sym: 'BTCUSDT' },
        { id: 2, sym: 'ETHUSDT', closed: true },
      ] as any,
    })
    expect(_collectDslPositions().map((p) => p.sym)).toEqual(['BTCUSDT'])
  })

  it('dedupes a position present in both the store and w.TP (by id)', () => {
    usePositionsStore.setState({ demoPositions: [{ id: 9, sym: 'BTCUSDT' }] as any })
    w.TP.demoPositions = [{ id: 9, sym: 'BTCUSDT' }, { id: 10, sym: 'SOLUSDT' }]
    const out = _collectDslPositions()
    expect(out.length).toBe(2)
    expect(out.map((p) => p.sym).sort()).toEqual(['BTCUSDT', 'SOLUSDT'])
  })

  it('returns empty when there are no open positions anywhere', () => {
    expect(_collectDslPositions()).toEqual([])
  })
})
