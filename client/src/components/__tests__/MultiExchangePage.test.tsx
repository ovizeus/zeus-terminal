import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MultiExchangePage } from '../multiexchange/MultiExchangePage'
import { useMultiExchangeStore } from '../../stores/multiExchangeStore'
import { usePositionsStore } from '../../stores/positionsStore'

// Mock only toast (keep other helpers intact).
vi.mock('../../data/marketDataHelpers', async (orig) => ({
  ...(await (orig as any)()),
  toast: vi.fn(),
}))

const acc = (active: boolean, mode: 'testnet' | 'live' = 'testnet') =>
  ({ connected: true, active, mode, maskedKey: '****x', balance: 100, lastVerified: '' })

describe('[P7a.2] MultiExchangePage — one-click Switch', () => {
  let switchSpy: ReturnType<typeof vi.fn>
  beforeEach(() => {
    switchSpy = vi.fn().mockResolvedValue({ ok: true, from: 'binance', to: 'bybit', openPositionsOnPrevious: [] })
    useMultiExchangeStore.setState({
      accounts: { binance: acc(true), bybit: acc(false) },
      loadAccounts: vi.fn().mockResolvedValue(undefined),
      switchExchange: switchSpy,
      error: null,
    } as any)
    usePositionsStore.setState({ livePositions: [] } as any)
  })

  it('shows a Switch button only on the connected-but-inactive exchange', () => {
    render(<MultiExchangePage />)
    expect(screen.getByTestId('exchange-switch-bybit')).toBeInTheDocument()
    expect(screen.queryByTestId('exchange-switch-binance')).toBeNull() // active → no switch
  })

  it('switches immediately when there are no open positions (no dialog)', async () => {
    render(<MultiExchangePage />)
    fireEvent.click(screen.getByTestId('exchange-switch-bybit'))
    await waitFor(() => expect(switchSpy).toHaveBeenCalledWith('bybit'))
    expect(screen.queryByTestId('switch-confirm-dialog')).toBeNull()
  })

  it('confirms first when open positions exist, then switches on confirm', async () => {
    usePositionsStore.setState({ livePositions: [{ seq: 1 }] } as any)
    render(<MultiExchangePage />)
    fireEvent.click(screen.getByTestId('exchange-switch-bybit'))
    expect(screen.getByTestId('switch-confirm-dialog')).toBeInTheDocument()
    expect(switchSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('switch-confirm'))
    await waitFor(() => expect(switchSpy).toHaveBeenCalledWith('bybit'))
  })

  it('cancel dismisses the dialog without switching', () => {
    usePositionsStore.setState({ livePositions: [{ seq: 1 }] } as any)
    render(<MultiExchangePage />)
    fireEvent.click(screen.getByTestId('exchange-switch-bybit'))
    fireEvent.click(screen.getByTestId('switch-cancel'))
    expect(screen.queryByTestId('switch-confirm-dialog')).toBeNull()
    expect(switchSpy).not.toHaveBeenCalled()
  })
})
