import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { DemoPositionRow, PendingOrderRow } from '../PositionRows'

// [2026-10-11] The operator opened a manual demo position on b270 and got a red
// React error boundary: "Cannot read properties of null (reading 'toFixed')".
//
// This renders a row with the EXACT object _buildManualPosition produces
// (marketDataTrading.ts:613) — the shape a freshly opened demo position really
// has, including tp and sl left null when the operator does not set them, and
// no qty field at all.

const freshPosition = (over: Record<string, unknown> = {}) => ({
  id: 1760000000001,
  side: 'LONG',
  sym: 'BTCUSDT',
  entry: 83068.8,
  size: 100,
  lev: 5,
  tp: null,          // left empty in the ticket
  sl: null,          // left empty in the ticket
  liqPrice: 68947.1,
  pnl: 0,
  mode: 'demo',
  orderType: 'MARKET',
  autoTrade: false,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  const w = window as unknown as Record<string, unknown>
  w.allPrices = { BTCUSDT: 83100 }
  w.S = { symbol: 'BTCUSDT', overlays: {}, activeInds: {}, indicators: {} }
  w.TP = { demoPositions: [], livePositions: [], pendingOrders: [], demoBalance: 10000 }
})

describe('a freshly opened demo position renders', () => {
  it('does not throw with tp and sl null', () => {
    expect(() => render(<DemoPositionRow pos={freshPosition()} />)).not.toThrow()
  })

  it('does not throw before a price is known', () => {
    const w = window as unknown as Record<string, unknown>
    w.allPrices = {}
    expect(() => render(<DemoPositionRow pos={freshPosition()} />)).not.toThrow()
  })

  it('does not throw when liqPrice came back null', () => {
    // calcLiqPrice returns number | null and returns null for a zero leverage
    // or entry, so the field really can be null on a stored position.
    expect(() => render(<DemoPositionRow pos={freshPosition({ liqPrice: null })} />)).not.toThrow()
  })

  it('does not throw when entry is null, as it is on the operator stored rows', () => {
    // at_positions in the live database holds entryPrice: null on his open rows.
    expect(() => render(<DemoPositionRow pos={freshPosition({ entry: null })} />)).not.toThrow()
  })

  it('does not throw when size or lev are missing', () => {
    expect(() => render(<DemoPositionRow pos={freshPosition({ size: null, lev: null })} />)).not.toThrow()
  })

  it('a pending LIMIT order renders without throwing', () => {
    const pending = {
      id: 1760000000002, side: 'LONG', sym: 'BTCUSDT', limitPrice: 82000,
      size: 100, lev: 5, tp: null, sl: null, mode: 'demo',
      orderType: 'LIMIT', status: 'WAITING', createdAt: Date.now(),
    }
    expect(() => render(<PendingOrderRow ord={pending} />)).not.toThrow()
  })
})
