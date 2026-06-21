import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { collectOpenSymbols, applyTickerPrices, markPxFor, _recordMarkPx, _clearMarkPx } from '../positionPriceFeed'
import { usePositionsStore } from '../../stores/positionsStore'

const w = globalThis as any

beforeEach(() => {
  w.TP = { demoPositions: [], livePositions: [] }
  w.allPrices = {}
  _clearMarkPx()
  usePositionsStore.setState({ demoPositions: [], livePositions: [] })
})
afterEach(() => { delete w.TP; delete w.allPrices; _clearMarkPx(); usePositionsStore.setState({ demoPositions: [], livePositions: [] }) })

describe('collectOpenSymbols', () => {
  it('collects unique open symbols from demo + live, excludes closed', () => {
    w.TP.demoPositions = [
      { symbol: 'BTCUSDT', closed: false },
      { symbol: 'ETHUSDT', closed: false },
      { symbol: 'BNBUSDT', closed: true },          // closed → excluded
    ]
    w.TP.livePositions = [
      { sym: 'ETHUSDT' },                            // dup via `sym` → deduped
      { sym: 'SOLUSDT' },
    ]
    const syms = collectOpenSymbols().sort()
    expect(syms).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])
  })

  it('returns empty array when no positions', () => {
    expect(collectOpenSymbols()).toEqual([])
  })

  it('reads positions from the React positionsStore (server-authoritative path)', () => {
    // w.TP stays empty — positions arrived via positions.changed → store only
    usePositionsStore.setState({
      demoPositions: [{ sym: 'BTCUSDT' }, { sym: 'ETHUSDT' }] as any,
      livePositions: [{ symbol: 'BNBUSDT' }] as any,
    })
    expect(collectOpenSymbols().sort()).toEqual(['BNBUSDT', 'BTCUSDT', 'ETHUSDT'])
  })

  it('unions w.TP and the store, deduped', () => {
    w.TP.demoPositions = [{ sym: 'BTCUSDT' }]
    usePositionsStore.setState({ demoPositions: [{ sym: 'BTCUSDT' }, { sym: 'SOLUSDT' }] as any })
    expect(collectOpenSymbols().sort()).toEqual(['BTCUSDT', 'SOLUSDT'])
  })

  it('uppercases symbols', () => {
    w.TP.demoPositions = [{ symbol: 'btcusdt' }]
    expect(collectOpenSymbols()).toEqual(['BTCUSDT'])
  })
})

describe('applyTickerPrices', () => {
  it('writes lastPrice into allPrices for valid tickers', () => {
    const updated = applyTickerPrices([
      { symbol: 'BTCUSDT', lastPrice: '64999.5' },
      { symbol: 'ETHUSDT', lastPrice: '3200.10' },
    ])
    expect(w.allPrices.BTCUSDT).toBe(64999.5)
    expect(w.allPrices.ETHUSDT).toBe(3200.10)
    expect(updated.sort()).toEqual(['BTCUSDT', 'ETHUSDT'])
  })

  it('skips invalid prices (<=0, NaN, missing) and missing symbol', () => {
    const updated = applyTickerPrices([
      { symbol: 'BTCUSDT', lastPrice: '0' },
      { symbol: 'ETHUSDT', lastPrice: 'not-a-number' },
      { symbol: 'BNBUSDT' },                 // no lastPrice
      { lastPrice: '123' },                  // no symbol
      { symbol: 'SOLUSDT', lastPrice: '142.7' }, // valid
    ])
    expect(updated).toEqual(['SOLUSDT'])
    expect(w.allPrices.SOLUSDT).toBe(142.7)
    expect(w.allPrices.BTCUSDT).toBeUndefined()
    expect(w.allPrices.ETHUSDT).toBeUndefined()
  })

  it('returns [] for non-array input', () => {
    expect(applyTickerPrices(null as any)).toEqual([])
    expect(applyTickerPrices({} as any)).toEqual([])
  })

  it('proves the PnL-fix invariant: after applying, an off-chart position symbol resolves to a real price (not its entry)', () => {
    // entry 64499.95, real current 64999.5 → diff must be non-zero once allPrices is populated
    applyTickerPrices([{ symbol: 'BTCUSDT', lastPrice: '64999.5' }])
    const entry = 64499.95
    const cur = w.allPrices.BTCUSDT
    expect(cur).toBeGreaterThan(0)
    expect(cur - entry).not.toBe(0)   // the bug was cur===entry → diff 0 → pnl 0
  })
})

import { _positionMarkPrice } from '../positionPriceFeed'

describe('_positionMarkPrice', () => {
  const open = new Set(['BTCUSDT', 'ETHUSDT'])
  it('returns {symbol, price} for an open-position symbol with a valid markPrice', () => {
    expect(_positionMarkPrice({ symbol: 'BTCUSDT', price: '63700.5' }, open)).toEqual({ symbol: 'BTCUSDT', price: 63700.5 })
  })
  it('uppercases the symbol before matching', () => {
    expect(_positionMarkPrice({ symbol: 'btcusdt', price: 100 }, open)).toEqual({ symbol: 'BTCUSDT', price: 100 })
  })
  it('returns null for a symbol not in the open set', () => {
    expect(_positionMarkPrice({ symbol: 'SOLUSDT', price: 150 }, open)).toBeNull()
  })
  it('returns null for an invalid / non-positive price', () => {
    expect(_positionMarkPrice({ symbol: 'BTCUSDT', price: '0' }, open)).toBeNull()
    expect(_positionMarkPrice({ symbol: 'BTCUSDT', price: 'x' }, open)).toBeNull()
    expect(_positionMarkPrice({ symbol: 'BTCUSDT' }, open)).toBeNull()
  })
})

describe('markPxFor — dedicated, unclobberable markPrice store (root-cause fix 2026-06-21)', () => {
  it('returns the recorded markPrice when fresh', () => {
    _recordMarkPx('BNBUSDT', 591.81, 1000)
    expect(markPxFor('BNBUSDT', 15000, 5000)).toBe(591.81)
  })
  it('uppercases the symbol before matching', () => {
    _recordMarkPx('bnbusdt', 100, 1000)
    expect(markPxFor('BNBUSDT', 15000, 2000)).toBe(100)
  })
  it('returns null when the markPrice is stale (older than maxAge)', () => {
    _recordMarkPx('ETHUSDT', 3000, 1000)
    expect(markPxFor('ETHUSDT', 15000, 1000 + 15001)).toBeNull()
  })
  it('returns null for a symbol that was never recorded', () => {
    expect(markPxFor('NOPEUSDT', 15000, 1000)).toBeNull()
  })
  it('returns null for a non-positive / invalid recorded price', () => {
    _recordMarkPx('SOLUSDT', 0, 1000)
    expect(markPxFor('SOLUSDT', 15000, 2000)).toBeNull()
  })
  it('REGRESSION (the bug): a lastPrice write to w.allPrices does NOT change markPxFor — position pricing stays on the exchange markPrice', () => {
    _recordMarkPx('BNBUSDT', 591.81, 1000)   // exchange markPrice
    w.allPrices['BNBUSDT'] = 591.33          // watchlist WS feed clobbers the shared map with lastPrice
    // Before the fix, positions read w.allPrices (591.33, lastPrice) → PnL desynced from Binance.
    // Now they read the dedicated store, immune to the clobber:
    expect(markPxFor('BNBUSDT', 15000, 2000)).toBe(591.81)
  })
})
