import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PositionTable } from '../trading/PositionTable'
import { usePositionsStore, useMarketStore } from '../../stores'
import type { Position } from '../../types'

const mockPos: Position = {
  seq: 1,
  symbol: 'BTCUSDT',
  side: 'LONG',
  size: 100,
  lev: 10,
  price: 60000,
  sl: 59000,
  tp: 62000,
  mode: 'demo',
  autoTrade: true,
  status: 'OPEN',
} as any

describe('PositionTable', () => {
  it('renders empty state when no positions', () => {
    render(<PositionTable mode="demo" />)
    expect(screen.getByText(/no open/i)).toBeInTheDocument()
  })

  it('renders positions with PnL', () => {
    usePositionsStore.setState({ demoPositions: [mockPos] })
    useMarketStore.setState({ market: { ...useMarketStore.getState().market, price: 61000 } })
    render(<PositionTable mode="demo" />)
    expect(screen.getByText('BTCUSDT')).toBeInTheDocument()
    expect(screen.getByText('LONG')).toBeInTheDocument()
  })

  it('renders live positions on live tab', () => {
    usePositionsStore.setState({ demoPositions: [], livePositions: [{ ...mockPos, mode: 'live' }] })
    render(<PositionTable mode="live" />)
    expect(screen.getByText('BTCUSDT')).toBeInTheDocument()
  })
})
