import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ATPanel } from '../trading/ATPanel'
import { useATStore } from '../../stores'

// Mock api to prevent real fetch calls
vi.mock('../../services/api', () => ({
  api: { post: vi.fn().mockResolvedValue({ ok: true }) },
}))

describe('ATPanel', () => {
  beforeEach(() => {
    useATStore.setState({
      enabled: false, mode: 'demo', killTriggered: false,
      totalTrades: 0, wins: 0, losses: 0, totalPnL: 0,
      dailyPnL: 0, realizedDailyPnL: 0, closedTradesToday: 0,
    })
  })

  it('renders AT controls', () => {
    render(<ATPanel />)
    expect(screen.getByText('AT OFF')).toBeInTheDocument()
  })

  it('shows kill banner when kill switch is active', () => {
    useATStore.setState({ killTriggered: true })
    render(<ATPanel />)
    expect(screen.getByText('KILL SWITCH ACTIVE')).toBeInTheDocument()
  })

  it('shows win rate stats', () => {
    useATStore.setState({ totalTrades: 10, wins: 7, losses: 3 })
    render(<ATPanel />)
    expect(screen.getByText('70.0%')).toBeInTheDocument()
  })
})
