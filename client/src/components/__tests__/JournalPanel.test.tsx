import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { JournalPanel } from '../advanced/JournalPanel'
import { useJournalStore } from '../../stores'

describe('JournalPanel', () => {
  it('renders empty state', () => {
    render(<JournalPanel />)
    expect(screen.getByText('No journal entries')).toBeInTheDocument()
    expect(screen.getByText('TRADE JOURNAL')).toBeInTheDocument()
  })

  it('renders journal entries', () => {
    useJournalStore.setState({
      entries: [{
        id: 'j1', event: 'CLOSE', side: 'LONG',
        entryPrice: 60000, exitPrice: 61000,
        pnl: 100, pnlPct: 1.67, reason: 'TP',
        ts: Date.now(), symbol: 'BTCUSDT',
      }],
    })
    render(<JournalPanel />)
    expect(screen.getByText('$100.00')).toBeInTheDocument()
    expect(screen.getByText('TP')).toBeInTheDocument()
  })
})
