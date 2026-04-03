import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DslWidget } from '../trading/DslWidget'
import { useDslStore } from '../../stores'
import type { Position } from '../../types'

const mockPos: Position = {
  seq: 1, symbol: 'BTCUSDT', side: 'LONG', size: 100, lev: 10,
  price: 60000, sl: 59000, tp: 62000, mode: 'demo', source: 'AT',
  status: 'OPEN', openTime: Date.now(), positionId: 'pos-1',
}

describe('DslWidget', () => {
  it('returns null when DSL disabled', () => {
    useDslStore.setState({ dsl: { ...useDslStore.getState().dsl, enabled: false } })
    const { container } = render(<DslWidget position={mockPos} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders WAITING when DSL enabled but not active', () => {
    useDslStore.setState({ dsl: { ...useDslStore.getState().dsl, enabled: true } })
    render(<DslWidget position={mockPos} />)
    expect(screen.getByText('WAITING')).toBeInTheDocument()
  })
})
