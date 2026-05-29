import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MultiExchangePage } from '../MultiExchangePage'
import { useMultiExchangeStore } from '../../../stores/multiExchangeStore'
import { usePositionsStore } from '../../../stores/positionsStore'

// [P7a.2] mock only toast (keep other helpers intact) for the Switch-flow tests.
vi.mock('../../../data/marketDataHelpers', async (orig) => ({
  ...(await (orig as any)()),
  toast: vi.fn(),
}))

describe('MultiExchangePage', () => {
  beforeEach(() => {
    useMultiExchangeStore.setState({ accounts: {}, loading: false, error: null, lastFetchTs: null, _loadInFlight: null })
    vi.restoreAllMocks()
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, accounts: [] }),
    } as any)
  })

  it('renders header with MULTIEXCHANGE title', () => {
    render(<MultiExchangePage />)
    expect(screen.getByText(/MULTIEXCHANGE/i)).toBeDefined()
  })

  it('renders all 7 exchange pillars (2 active-able + 5 coming-soon)', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => {
      expect(screen.getByText(/BINANCE/i)).toBeDefined()
      expect(screen.getByText(/BYBIT/i)).toBeDefined()
      expect(screen.getByText(/OKX/i)).toBeDefined()
      expect(screen.getByText(/HYPERLIQUID/i)).toBeDefined()
      expect(screen.getByText(/BITGET/i)).toBeDefined()
      expect(screen.getByText(/MEXC/i)).toBeDefined()
      expect(screen.getByText(/HTX/i)).toBeDefined()
    })
  })

  it('calls loadAccounts on mount', async () => {
    const loadAccounts = vi.fn().mockResolvedValue(undefined)
    useMultiExchangeStore.setState({ loadAccounts } as any)
    render(<MultiExchangePage />)
    await waitFor(() => expect(loadAccounts).toHaveBeenCalled())
  })

  it('renders ACTIVE state for binance when it is the active account', async () => {
    useMultiExchangeStore.setState({
      accounts: { binance: { connected: true, active: true, mode: 'live', maskedKey: '****x', balance: 500, lastVerified: '2026-05-20T20:00:00Z' } as any },
      lastFetchTs: Date.now(),
    })
    render(<MultiExchangePage />)
    await waitFor(() => {
      expect(screen.getByText('● ACTIVE')).toBeDefined()
    })
  })

  // [P7a.2] Mutual-exclusion 'BLOCKED' is gone — a connected-but-inactive exchange is
  // now SWITCHABLE (offers a one-click Switch), not blocked.
  it('renders a Switch button for a connected-but-inactive exchange', async () => {
    useMultiExchangeStore.setState({
      accounts: {
        binance: { connected: true, active: true, mode: 'testnet', maskedKey: '****x', balance: 0, lastVerified: '' } as any,
        bybit: { connected: true, active: false, mode: 'testnet', maskedKey: '****y', balance: 0, lastVerified: '' } as any,
      },
      lastFetchTs: Date.now(),
    })
    render(<MultiExchangePage />)
    await waitFor(() => {
      expect(screen.getByTestId('exchange-switch-bybit')).toBeDefined()
      expect(screen.queryByText(/BLOCKED/i)).toBeNull()
    })
  })

  it('clicking an inactive card opens ExchangeDetail sub-view', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => screen.getByTestId('exchange-card-binance'))
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-card-binance')) })
    expect(screen.getByTestId('exchange-detail-back')).toBeDefined()
  })

  it('clicking BACK in sub-view returns to grid', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => screen.getByTestId('exchange-card-binance'))
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-card-binance')) })
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-detail-back')) })
    expect(screen.getByText(/MULTIEXCHANGE/i)).toBeDefined()
  })

  it('zeus:page-back custom event when in sub-view: preventDefault to stay on page', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => screen.getByTestId('exchange-card-binance'))
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-card-binance')) })
    const ev = new CustomEvent('zeus:page-back', { cancelable: true })
    await act(async () => { window.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
    expect(screen.getByText(/MULTIEXCHANGE/i)).toBeDefined()
  })

  // [P7a.2] one-click Switch flow
  describe('one-click Switch', () => {
    let switchSpy: ReturnType<typeof vi.fn>
    beforeEach(() => {
      switchSpy = vi.fn().mockResolvedValue({ ok: true, from: 'binance', to: 'bybit', openPositionsOnPrevious: [] })
      useMultiExchangeStore.setState({
        accounts: {
          binance: { connected: true, active: true, mode: 'testnet', maskedKey: '****x', balance: 100, lastVerified: '' } as any,
          bybit: { connected: true, active: false, mode: 'testnet', maskedKey: '****y', balance: 100, lastVerified: '' } as any,
        },
        loadAccounts: vi.fn().mockResolvedValue(undefined),
        switchExchange: switchSpy,
      } as any)
      usePositionsStore.setState({ livePositions: [] } as any)
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
      expect(screen.getByTestId('switch-confirm-dialog')).toBeDefined()
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
})
