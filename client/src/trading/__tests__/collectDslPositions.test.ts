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

  // [2026-06-14] liveApiSyncState rebuilds w.TP.livePositions from Binance data and
  // can classify a server-AT position as "safe-unknown" (autoTrade:null,
  // sourceMode:'unknown') when it can't match an existing row. The store copy
  // (id = server seq) and the TP copy (id = sym_side_qty) have DIFFERENT ids, so
  // dedup-by-id kept both → the unknown copy rendered as a "PAPER" card. Dedup by
  // stable identity (sym|side|mode, unique per open position) and keep the
  // AT-classified copy so the DSL card shows the real "AT" label, not PAPER.
  it('prefers the AT-classified copy over a PAPER/unknown copy of the same position', () => {
    usePositionsStore.setState({
      livePositions: [
        { id: 12345, sym: 'BNBUSDT', side: 'SHORT', mode: 'live', autoTrade: null, sourceMode: 'unknown' },
      ] as any,
    })
    w.TP.livePositions = [
      { id: 'BNBUSDT_SHORT_16.05', sym: 'BNBUSDT', side: 'SHORT', mode: 'live', autoTrade: true, owner: 'AT' },
    ]
    const out = _collectDslPositions()
    expect(out.length).toBe(1)
    expect(out[0].autoTrade).toBe(true)
    expect(out[0].owner).toBe('AT')
  })

  it('collapses the store(seq-id) and TP(sym_side_qty-id) copies of one position into a single card', () => {
    usePositionsStore.setState({
      livePositions: [{ id: 999, sym: 'BTCUSDT', side: 'SHORT', mode: 'live', autoTrade: true }] as any,
    })
    w.TP.livePositions = [{ id: 'BTCUSDT_SHORT_0.1', sym: 'BTCUSDT', side: 'SHORT', mode: 'live', autoTrade: true }]
    expect(_collectDslPositions().length).toBe(1)
  })
})
